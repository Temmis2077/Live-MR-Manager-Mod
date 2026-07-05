//! MP3 export: 16-bit PCM temp WAV → ffmpeg CBR 320 kbps (no in-process LAME).

use anyhow::{anyhow, Context, Result};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;

fn f32_to_i16(sample: f32) -> i16 {
    (sample.clamp(-1.0, 1.0) * 32767.0).round() as i16
}

fn stereo_refs(samples: &[Vec<f32>]) -> Result<(&[f32], &[f32], usize)> {
    if samples.is_empty() || samples[0].is_empty() {
        return Ok((&[], &[], 0));
    }
    let num_frames = samples[0].len();
    for ch in &samples[1..] {
        if ch.len() != num_frames {
            return Err(anyhow!("MR channel length mismatch"));
        }
    }
    match samples.len() {
        1 => Ok((&samples[0], &samples[0], num_frames)),
        2 => Ok((&samples[0], &samples[1], num_frames)),
        n => Err(anyhow!("MR export supports mono/stereo only, got {n} channels")),
    }
}

pub(crate) fn mp3_encode_temp_wav_path(mp3_path: &Path) -> PathBuf {
    let stem = mp3_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("stem");
    mp3_path.with_file_name(format!("{stem}.encode.tmp.wav"))
}

/// Fast 16-bit PCM WAV for ffmpeg input (post-processed f32 samples).
pub fn write_stereo_wav_pcm16(path: &Path, sample_rate: u32, samples: &[Vec<f32>]) -> Result<()> {
    let (left, right, num_frames) = stereo_refs(samples)?;
    if num_frames == 0 {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let channels: u16 = 2;
    let bits_per_sample: u16 = 16;
    let byte_rate = sample_rate * channels as u32 * bits_per_sample as u32 / 8;
    let block_align = channels * bits_per_sample / 8;
    let data_size = num_frames as u32 * block_align as u32;
    let riff_size = 36 + data_size;

    let mut file = std::fs::File::create(path)?;
    file.write_all(b"RIFF")?;
    file.write_all(&riff_size.to_le_bytes())?;
    file.write_all(b"WAVE")?;
    file.write_all(b"fmt ")?;
    file.write_all(&16u32.to_le_bytes())?;
    file.write_all(&1u16.to_le_bytes())?;
    file.write_all(&channels.to_le_bytes())?;
    file.write_all(&sample_rate.to_le_bytes())?;
    file.write_all(&byte_rate.to_le_bytes())?;
    file.write_all(&block_align.to_le_bytes())?;
    file.write_all(&bits_per_sample.to_le_bytes())?;
    file.write_all(b"data")?;
    file.write_all(&data_size.to_le_bytes())?;

    const CHUNK_FRAMES: usize = 8192;
    let mut interleaved = Vec::with_capacity(CHUNK_FRAMES * 2);
    let mut written = 0usize;
    while written < num_frames {
        let chunk = (num_frames - written).min(CHUNK_FRAMES);
        interleaved.clear();
        for i in 0..chunk {
            let idx = written + i;
            interleaved.push(f32_to_i16(left[idx]));
            interleaved.push(f32_to_i16(right[idx]));
        }
        let bytes = unsafe {
            std::slice::from_raw_parts(
                interleaved.as_ptr() as *const u8,
                interleaved.len() * 2,
            )
        };
        file.write_all(bytes)?;
        written += chunk;
    }
    file.flush()?;
    Ok(())
}

pub fn encode_wav_file_to_mp3(wav: &Path, mp3: &Path) -> Result<()> {
    let wav_s = wav.to_str().ok_or_else(|| anyhow!("invalid temp wav path"))?;
    let mp3_s = mp3.to_str().ok_or_else(|| anyhow!("invalid mp3 path"))?;

    let ffmpeg = crate::ffmpeg_tools::find_ffmpeg_executable_or_download().ok_or_else(|| {
        anyhow!(
            "ffmpeg를 찾을 수 없습니다.\n\n설정에서「WAV」로 바꾸거나, 앱을 재시작한 뒤 다시 시도하세요. (자동 다운로드 실패 시 ffmpeg를 PATH에 설치해 주세요.)"
        )
    })?;

    let mut cmd = Command::new(&ffmpeg);
    cmd.args([
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        wav_s,
        "-codec:a",
        "libmp3lame",
        "-b:a",
        "320k",
        mp3_s,
    ]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let output = cmd
        .output()
        .with_context(|| "failed to run ffmpeg (PATH에 ffmpeg가 있는지 확인하세요)")?;

    if output.status.success() && mp3.is_file() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    Err(anyhow!(
        "ffmpeg MP3 변환 실패: {}\n\nMP3 저장에 실패했습니다. 설정에서「WAV」로 바꾸거나 ffmpeg를 PATH에 설치한 뒤 다시 시도하세요.",
        stderr.trim()
    ))
}
