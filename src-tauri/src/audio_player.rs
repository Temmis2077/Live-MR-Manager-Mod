use std::collections::{VecDeque, HashSet, HashMap};
use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::num::{NonZeroU16, NonZeroU32};
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use std::path::PathBuf;

use rodio::{Source, Player, MixerDeviceSink, DeviceSinkBuilder};
use crate::types::AppState;
use parking_lot::Mutex;
use once_cell::sync::Lazy;
use tauri::Emitter;
use cpal::traits::{HostTrait, DeviceTrait};

pub static ACTIVE_DOWNLOADS: Lazy<Mutex<HashSet<PathBuf>>> = Lazy::new(|| Mutex::new(HashSet::new()));
pub static DOWNLOAD_FINISHED_NOTIFIER: Lazy<Mutex<HashMap<PathBuf, Arc<tokio::sync::Notify>>>> = Lazy::new(|| Mutex::new(HashMap::new()));
pub static DOWNLOAD_ERRORS: Lazy<Mutex<HashMap<PathBuf, String>>> = Lazy::new(|| Mutex::new(HashMap::new()));
pub static CANCEL_REQUESTS: Lazy<Mutex<HashSet<String>>> = Lazy::new(|| Mutex::new(HashSet::new()));
pub static IS_PREPARING_PLAYBACK: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

fn append_sys_log_file(message: &str) {
    let log_path = {
        if let Some(paths) = crate::state::APP_PATHS.lock().as_ref() {
            paths.root.join("logs").join("app.log")
        } else {
            let base = std::env::temp_dir().join("live-mr-manager");
            base.join("logs").join("app.log")
        }
    };

    if let Some(parent) = log_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(log_path) {
        let _ = writeln!(f, "[{}] {}", ts, message);
    }
}

pub fn sys_log(message: &str) {
    println!("{}", message);
    append_sys_log_file(message);
    if let Some(guard) = crate::state::MAIN_WINDOW.try_lock() {
        if let Some(window) = guard.as_ref() {
            let _ = window.emit("sys-log", message.to_string());
        }
    }
}

// --- Status types are now in types.rs ---

// --- Streaming Support ---

pub struct StreamingReader {
    pub file: File,
    pub is_youtube: bool,
    pub path: PathBuf,
}

impl StreamingReader {
    pub fn new(path: PathBuf, is_youtube: bool) -> std::io::Result<Self> {
        let file = File::open(&path)?;
        Ok(Self { file, is_youtube, path })
    }
}

impl Read for StreamingReader {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        loop {
            let n = self.file.read(buf)?;
            if n > 0 {
                // println!("[AUDIO_DEBUG] StreamingReader read {} bytes", n);
                return Ok(n);
            } else if self.is_youtube {
                // Check if still downloading
                let still_downloading = {
                    let downloads = ACTIVE_DOWNLOADS.lock();
                    downloads.contains(&self.path)
                };
                
                if still_downloading {
                    std::thread::sleep(std::time::Duration::from_millis(150));
                    continue;
                } else {
                    // Download finished and no more data
                    return Ok(0);
                }
            } else {
                return Ok(0);
            }
        }
    }
}

impl Seek for StreamingReader {
    fn seek(&mut self, pos: SeekFrom) -> std::io::Result<u64> {
        self.file.seek(pos)
    }
}

// --- Custom Audio Sources ---

/// Dynamic volume control source using atomic bits for f32 volume.
pub struct DynamicVolumeSource<S> where S: Source<Item = f32> {
    pub input: S,
    pub volume: Arc<AtomicU32>, // Shared target volume (bits of f32)
    pub current_vol: f32,       // Internal state for fading
}

impl<S> DynamicVolumeSource<S> where S: Source<Item = f32> {
    pub fn new(input: S, volume: Arc<AtomicU32>) -> Self {
        Self {
            input,
            volume,
            current_vol: 0.0,
        }
    }
}

impl<S> Iterator for DynamicVolumeSource<S> where S: Source<Item = f32> {
    type Item = f32;
    fn next(&mut self) -> Option<Self::Item> {
        let s = self.input.next()?;
        let target_vol_bits = self.volume.load(Ordering::Relaxed);
        let target_vol = f32::from_bits(target_vol_bits) / 125.0; // Linear scale for tracks to avoid nested quadratic drop
        
        // Smoothly interpolate current_vol towards target_vol

        // Smoothly interpolate current_vol towards target_vol
        // Fade duration: 100ms
        const FADE_DURATION: f32 = 0.1; 
        let sample_rate = self.input.sample_rate().get() as f32;
        let step = 1.0 / (sample_rate * FADE_DURATION);

        if (self.current_vol - target_vol).abs() > step {
            if self.current_vol < target_vol {
                self.current_vol += step;
            } else {
                self.current_vol -= step;
            }
        } else {
            self.current_vol = target_vol;
        }
        
        Some(s * self.current_vol)
    }
}

impl<S> Source for DynamicVolumeSource<S> where S: Source<Item = f32> {
    fn current_span_len(&self) -> Option<usize> { self.input.current_span_len() }
    fn channels(&self) -> NonZeroU16 { self.input.channels() }
    fn sample_rate(&self) -> NonZeroU32 { self.input.sample_rate() }
    fn total_duration(&self) -> Option<Duration> { self.input.total_duration() }
    fn try_seek(&mut self, pos: Duration) -> Result<(), rodio::source::SeekError> {
        self.input.try_seek(pos)
    }
}

/// 메트로놈 클릭 소스. BPM에 맞춰 짧은 감쇠 톤을 낸다. 4박마다 다운비트를
/// 조금 높은 음으로 강조한다. 재생 위치(프레임)에서 시작하도록 start_frame을 받는다.
/// (무한 스트림이므로 사용 측에서 take_duration으로 곡 길이만큼 잘라 쓴다.)
pub struct MetronomeSource {
    sample_rate: u32,
    channels: u16,
    samples_per_beat: u64, // 프레임 단위
    click_len: u64,        // 프레임 단위
    frame: u64,
    ch_i: u16,
}

impl MetronomeSource {
    pub fn new(bpm: f32, sample_rate: u32, channels: u16, start_frame: u64) -> Self {
        let bpm = if bpm <= 0.0 { 120.0 } else { bpm };
        let spb = ((60.0 / bpm) * sample_rate as f32) as u64;
        Self {
            sample_rate,
            channels: channels.max(1),
            samples_per_beat: spb.max(1),
            click_len: ((sample_rate as f32) * 0.03) as u64, // 30ms
            frame: start_frame,
            ch_i: 0,
        }
    }
}

impl Iterator for MetronomeSource {
    type Item = f32;
    fn next(&mut self) -> Option<f32> {
        let into_beat = self.frame % self.samples_per_beat;
        let beat_index = self.frame / self.samples_per_beat;
        let sample = if into_beat < self.click_len {
            let t = into_beat as f32 / self.sample_rate as f32;
            // 선형 감쇠 엔벨로프.
            let env = 1.0 - (into_beat as f32 / self.click_len as f32);
            // 4박마다 다운비트 강조(높은 음).
            let freq = if beat_index % 4 == 0 { 1500.0 } else { 1000.0 };
            (2.0 * std::f32::consts::PI * freq * t).sin() * env * 0.4
        } else {
            0.0
        };
        // 모든 채널에 동일 값. 채널 인덱스가 한 바퀴 돌면 프레임 전진.
        self.ch_i += 1;
        if self.ch_i >= self.channels {
            self.ch_i = 0;
            self.frame += 1;
        }
        Some(sample)
    }
}

impl Source for MetronomeSource {
    fn current_span_len(&self) -> Option<usize> { None }
    fn channels(&self) -> NonZeroU16 { NonZeroU16::new(self.channels).unwrap_or(NonZeroU16::new(2).unwrap()) }
    fn sample_rate(&self) -> NonZeroU32 { NonZeroU32::new(self.sample_rate).unwrap_or(NonZeroU32::new(44100).unwrap()) }
    fn total_duration(&self) -> Option<Duration> { None }
    fn try_seek(&mut self, _pos: Duration) -> Result<(), rodio::source::SeekError> { Ok(()) }
}

/// Source for real-time pitch and tempo shifting.
pub struct StretchedSource<S> where S: Source<Item = f32> {
    pub input: S,
    pub stretcher: signalsmith_stretch::Stretch,
    pub pitch: Arc<AtomicU32>,
    pub tempo: Arc<AtomicU32>,
    pub pos: Arc<AtomicU64>,
    pub buffer: VecDeque<f32>,
    pub input_channels: usize,
    pub remainder_frames: f32, // For precise tempo matching
    pub remainder_pos: f32,    // For precise progress reporting
    pub last_pitch: f32,       // For caching
    pub last_tempo: f32,       // For caching
    pub output_buffer: Vec<f32>, // Reusable buffer to avoid allocations
}

impl<S> StretchedSource<S> where S: Source<Item = f32> {
    pub fn new(input: S, pitch: Arc<AtomicU32>, tempo: Arc<AtomicU32>, pos: Arc<AtomicU64>) -> Self {
        let channels = input.channels().get() as u32;
        let rate = input.sample_rate().get();
        Self {
            input,
            stretcher: signalsmith_stretch::Stretch::preset_default(channels, rate),
            pitch,
            tempo,
            pos,
            buffer: VecDeque::new(),
            input_channels: channels as usize,
            remainder_frames: 0.0,
            remainder_pos: 0.0,
            last_pitch: 0.0,
            last_tempo: 1.0,
            output_buffer: Vec::with_capacity(2048 * channels as usize), // Pre-allocate enough space
        }
    }
}

impl<S> Iterator for StretchedSource<S> where S: Source<Item = f32> {
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        let pitch_semitones = f32::from_bits(self.pitch.load(Ordering::Relaxed));
        let tempo_scale = f32::from_bits(self.tempo.load(Ordering::Relaxed)).max(0.1); // Prevent div by zero

        // 1. Pop from buffer if available
        if let Some(s) = self.buffer.pop_front() {
            // Track progress relative to the output samples
            // For every output sample, we've "traversed" tempo_scale worth of original samples
            if self.buffer.len() % self.input_channels == 0 {
                self.remainder_pos += tempo_scale;
                let whole_samples = self.remainder_pos.floor();
                if whole_samples >= 1.0 {
                    self.pos.fetch_add(whole_samples as u64, Ordering::Relaxed);
                    self.remainder_pos -= whole_samples;
                }
            }
            return Some(s);
        }

        // 2. Read input block
        let block_size = 1024;
        let mut input_interleaved: Vec<f32> = Vec::with_capacity(block_size * self.input_channels);
        for _ in 0..block_size {
            for _ in 0..self.input_channels {
                if let Some(s) = self.input.next() {
                    input_interleaved.push(s);
                }
            }
        }

        let frames_read = input_interleaved.len() / self.input_channels;
        if frames_read == 0 { return None; }

        // 3. Stretch or Bypass
        if pitch_semitones == 0.0 && (tempo_scale - 1.0).abs() < 0.001 {
            // Bypass mode
            for s in input_interleaved {
                self.buffer.push_back(s);
            }
            self.remainder_frames = 0.0; // Reset error
            self.last_pitch = 0.0;
            self.last_tempo = 1.0;
        } else {
            // Stretch mode
            // Only update pitch if it changed significantly
            if (pitch_semitones - self.last_pitch).abs() > 0.01 {
                let pitch_factor = 2.0f32.powf(pitch_semitones / 12.0);
                self.stretcher.set_transpose_factor(pitch_factor, None);
                self.last_pitch = pitch_semitones;
            }
            self.last_tempo = tempo_scale;
            
            // Calculate precise output frames with error diffusion
            let total_needed = (frames_read as f32 / tempo_scale) + self.remainder_frames;
            let output_frames = total_needed.floor() as usize;
            self.remainder_frames = total_needed - output_frames as f32;
            
            if output_frames > 0 {
                // Resize internal buffer if needed (usually stays constant)
                let needed_samples = output_frames * self.input_channels;
                if self.output_buffer.len() < needed_samples {
                    self.output_buffer.resize(needed_samples, 0.0);
                }
                
                // Use slice of internal buffer directly
                let target_slice = &mut self.output_buffer[0..needed_samples];
                self.stretcher.process(&input_interleaved, target_slice);
                
                // Re-borrow for the loop
                for &s in self.output_buffer[0..needed_samples].iter() {
                    self.buffer.push_back(s);
                }
            }
        }

        // 4. Return first sample from new buffer
        self.buffer.pop_front().map(|s| {
            if self.buffer.len() % self.input_channels == 0 {
                self.remainder_pos += tempo_scale;
                let whole_samples = self.remainder_pos.floor();
                if whole_samples >= 1.0 {
                    self.pos.fetch_add(whole_samples as u64, Ordering::Relaxed);
                    self.remainder_pos -= whole_samples;
                }
            }
            s
        })
    }
}

impl<S> Source for StretchedSource<S> where S: Source<Item = f32> {
    #[allow(deprecated)]
    fn current_span_len(&self) -> Option<usize> { None }
    fn channels(&self) -> std::num::NonZeroU16 { std::num::NonZeroU16::new((self.input_channels as u16).max(1)).unwrap() }
    fn sample_rate(&self) -> std::num::NonZeroU32 { self.input.sample_rate() }
    fn total_duration(&self) -> Option<Duration> { self.input.total_duration() }
    fn try_seek(&mut self, pos: Duration) -> Result<(), rodio::source::SeekError> {
        self.input.try_seek(pos)?;
        self.buffer.clear();
        self.stretcher.reset();
        self.remainder_frames = 0.0;
        self.remainder_pos = 0.0;
        Ok(())
    }
}

// --- PlaybackProgress and SeekToArgs are in types.rs or defined locally ---
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SeekToArgs {
    pub position_ms: u64,
}

// --- App Handler Struct ---

// --- AppState is in types.rs ---

pub struct AudioHandler {
    // 출력 장치는 런타임에 교체될 수 있으므로 sink와 player를 함께 잠그고 바꾼다.
    // (device 전환 시 새 sink에 새 player를 연결해 통째로 교체)
    pub _stream: Mutex<MixerDeviceSink>, // Keep alive
    pub controller: Mutex<Player>,
    pub state: Mutex<AppState>,
    pub active_pitch: Arc<AtomicU32>,
    pub active_tempo: Arc<AtomicU32>,
    pub current_pos_samples: Arc<AtomicU64>,
    pub total_duration_ms: Arc<AtomicU64>,
    // 현재 열린 출력 장치의 실제 설정. 장치 전환 시 갱신되어 리샘플 타깃으로 쓰인다.
    pub active_sample_rate: Arc<AtomicU32>,
    pub active_channels: Arc<AtomicU32>, // u16 값을 u32로 보관
    /// 현재 선택된 출력 장치 이름(빈 문자열이면 시스템 기본).
    pub output_device_name: Mutex<String>,
    pub track_sample_rate: Arc<AtomicU32>,
    pub vocal_volume: Arc<AtomicU32>, // 모니터 채널 보컬 게인, f32 bits
    pub instrumental_volume: Arc<AtomicU32>, // 모니터 채널 인스트 게인, f32 bits
    pub mon_metro_volume: Arc<AtomicU32>, // 모니터 채널 메트로놈 게인
    pub mr_vocal_volume: Arc<AtomicU32>,  // MR 채널 보컬 게인
    pub mr_inst_volume: Arc<AtomicU32>,   // MR 채널 인스트 게인
    pub mr_metro_volume: Arc<AtomicU32>,  // MR 채널 메트로놈 게인
    /// 마스터 게인(Player.set_volume에 넣는 최종값, f32 bits). 장치 전환 시 새
    /// player에 다시 적용하기 위해 보관한다(마스터 볼륨은 player에만 있으므로).
    pub master_gain: Arc<AtomicU32>,
    // MR 채널(2번째 출력, 선택). device_name이 비면 채널 꺼짐(모니터만 재생).
    pub mr_stream: Mutex<Option<MixerDeviceSink>>,
    pub mr_controller: Mutex<Option<Player>>,
    pub mr_device_name: Mutex<String>,
    pub mr_active_sample_rate: Arc<AtomicU32>,
    pub mr_active_channels: Arc<AtomicU32>,
    pub playback_cv: parking_lot::Condvar,
}

/// 지정한 이름의 출력 장치를 열어 (sink, sample_rate, channels, 실제 장치 이름)을
/// 돌려준다. `device_name`이 None이거나 매칭에 실패하면 시스템 기본 장치로 폴백한다.
pub fn open_output_sink(
    device_name: Option<&str>,
) -> Result<(MixerDeviceSink, u32, u16, String), String> {
    let host = cpal::default_host();

    // 요청한 이름과 일치하는 장치를 먼저 찾는다.
    let picked: Option<cpal::Device> = device_name.filter(|s| !s.is_empty()).and_then(|want| {
        host.output_devices().ok().and_then(|devs| {
            devs.into_iter()
                .find(|d| d.description().map(|desc| desc.name() == want).unwrap_or(false))
        })
    });

    let (stream, resolved) = if let Some(dev) = picked {
        let name = dev
            .description()
            .map(|d| d.name().to_string())
            .unwrap_or_else(|_| "Unknown Device".into());
        let s = DeviceSinkBuilder::from_device(dev)
            .map_err(|e| e.to_string())?
            .open_stream()
            .map_err(|e| e.to_string())?;
        (s, name)
    } else {
        // 기본 장치. (요청 이름이 없거나 그 장치가 사라진 경우)
        let s = DeviceSinkBuilder::open_default_sink().map_err(|e| e.to_string())?;
        let name = host
            .default_output_device()
            .and_then(|d| d.description().ok().map(|x| x.name().to_string()))
            .unwrap_or_else(|| "기본 장치".into());
        (s, name)
    };

    let cfg = stream.config();
    let rate = u32::from(cfg.sample_rate()).max(1);
    let channels = u16::from(cfg.channel_count()).max(1);
    Ok((stream, rate, channels, resolved))
}

/// Settings DB에 저장된 출력 장치 이름(없으면 None → 기본 장치).
fn saved_output_device() -> Option<String> {
    saved_setting("output_device")
}

fn saved_setting(key: &str) -> Option<String> {
    let db = crate::state::DB.lock();
    db.query_row(
        "SELECT value FROM Settings WHERE key = ?",
        [key],
        |row| row.get::<_, String>(0),
    )
    .ok()
    .filter(|s| !s.is_empty())
}

pub static AUDIO_HANDLER: Lazy<Result<Arc<AudioHandler>, String>> = Lazy::new(|| {
    // 저장된 장치를 우선 열되, 실패하면 기본 장치로 폴백.
    let saved = saved_output_device();
    let (stream, mut device_rate, mut device_channels, device_name) =
        match open_output_sink(saved.as_deref()) {
            Ok(v) => v,
            Err(e) => match open_output_sink(None) {
                Ok(v) => v,
                Err(_) => return Err(format!("오디오 출력을 열지 못했습니다: {}", e)),
            },
        };

    if device_rate == 0 { device_rate = 44100; }
    if device_channels == 0 { device_channels = 2; }

    sys_log(&format!("[AUDIO] Device Initialized: {} ({}Hz, {}ch)", device_name, device_rate, device_channels));

    let player = Player::connect_new(&stream.mixer());

    // MR 채널(2번째 출력) 복원 — 저장된 장치가 있으면 best-effort로 연다.
    let (mr_stream_opt, mr_player_opt, mr_name, mr_rate, mr_ch) =
        match saved_setting("mr_output_device").and_then(|n| open_output_sink(Some(&n)).ok()) {
            Some((s, r, c, name)) => {
                let p = Player::connect_new(&s.mixer());
                sys_log(&format!("[AUDIO] MR channel restored: {} ({}Hz, {}ch)", name, r, c));
                (Some(s), Some(p), name, r, c as u32)
            }
            None => (None, None, String::new(), device_rate, device_channels as u32),
        };

    Ok(Arc::new(AudioHandler {
        _stream: Mutex::new(stream),
        controller: Mutex::new(player),
        state: Mutex::new(AppState::default()),
        active_pitch: Arc::new(AtomicU32::new(0f32.to_bits())),
        active_tempo: Arc::new(AtomicU32::new(1.0f32.to_bits())),
        current_pos_samples: Arc::new(AtomicU64::new(0)),
        total_duration_ms: Arc::new(AtomicU64::new(0)),
        active_sample_rate: Arc::new(AtomicU32::new(device_rate)),
        active_channels: Arc::new(AtomicU32::new(device_channels as u32)),
        output_device_name: Mutex::new(device_name),
        track_sample_rate: Arc::new(AtomicU32::new(device_rate)),
        vocal_volume: Arc::new(AtomicU32::new(100.0f32.to_bits())),
        instrumental_volume: Arc::new(AtomicU32::new(100.0f32.to_bits())),
        mon_metro_volume: Arc::new(AtomicU32::new(0.0f32.to_bits())),
        mr_vocal_volume: Arc::new(AtomicU32::new(0.0f32.to_bits())),
        mr_inst_volume: Arc::new(AtomicU32::new(0.0f32.to_bits())),
        mr_metro_volume: Arc::new(AtomicU32::new(0.0f32.to_bits())),
        master_gain: Arc::new(AtomicU32::new(1.0f32.to_bits())),
        mr_stream: Mutex::new(mr_stream_opt),
        mr_controller: Mutex::new(mr_player_opt),
        mr_device_name: Mutex::new(mr_name),
        mr_active_sample_rate: Arc::new(AtomicU32::new(mr_rate)),
        mr_active_channels: Arc::new(AtomicU32::new(mr_ch)),
        playback_cv: parking_lot::Condvar::new(),
    }))
});
