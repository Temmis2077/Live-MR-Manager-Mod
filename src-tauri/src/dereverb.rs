//! 가사 정렬 전용 디리버브(de-reverb).
//!
//! MR 분리된 보컬에 Mel-Band RoFormer 디리버브 모델을 돌려 잔향/이펙트를 걷어낸
//! 보컬(vocal_dr)을 만들고, **가사 정렬은 그 보컬로** 수행한다(재생에는 미적용).
//! 리버브·보컬 이펙트가 심하면 CTC 정렬 정확도가 크게 떨어지는데(특히 영어처럼
//! 음소 단위로 맞추는 경우), 드라이한 보컬로 정렬하면 정확도가 올라간다.
//!
//! 모델은 anvuew/dereverb_mel_band_roformer(mono 권장)를 Deux와 같은 방식으로
//! ONNX 변환해 `%LOCALAPPDATA%\LiveMRManager\tools\dereverb\`에 두면 활성화된다.
//! 없거나 꺼져 있으면 원본 보컬로 폴백하므로 무회귀. 우리 엔진의 RawWaveform
//! (melband_roformer 프리셋)을 그대로 재사용한다.

use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use crate::ffmpeg_tools::tools_cache_dir;
use crate::vocal_remover::{InferenceEngine, WaveformRemover};

const MODEL_FILENAME: &str = "dereverb_mel_band_roformer.onnx";

/// 디리버브 모델을 두는 폴더(수동 배치 — GPU 팩과 동일 패턴).
pub fn dereverb_dir() -> PathBuf {
    tools_cache_dir().join("dereverb")
}
pub fn model_path() -> PathBuf {
    dereverb_dir().join(MODEL_FILENAME)
}
pub fn is_installed() -> bool {
    model_path().is_file()
}

/// 정렬 디리버브 사용 여부(Settings 'dereverb_align_enabled', 기본 true).
pub fn is_enabled() -> bool {
    let db = crate::state::DB.lock();
    db.query_row(
        "SELECT value FROM Settings WHERE key = 'dereverb_align_enabled'",
        [],
        |r| r.get::<_, String>(0),
    )
    .map(|v| v != "false")
    .unwrap_or(true)
}

fn set_enabled_db(enabled: bool) {
    let db = crate::state::DB.lock();
    let _ = db.execute(
        "INSERT OR REPLACE INTO Settings (key, value) VALUES ('dereverb_align_enabled', ?)",
        rusqlite::params![if enabled { "true" } else { "false" }],
    );
}

/// 이미 만들어진 디리버브 보컬 캐시(mp3/wav 어느 형식이든).
fn cached_dr(vocal_parent: &Path) -> Option<PathBuf> {
    for ext in ["wav", "mp3"] {
        let p = vocal_parent.join(format!("vocal_dr.{}", ext));
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

/// 정렬에 쓸 보컬 경로를 돌려준다. 디리버브가 켜져 있고 모델이 있으면 잔향을
/// 걷어낸 vocal_dr을 만들어(또는 캐시 재사용) 그 경로를, 아니면 원본 vocal 경로를
/// 반환한다. **어떤 실패든 원본으로 폴백한다**(정렬이 절대 막히지 않게).
pub async fn resolve_alignment_vocal(vocal_path: PathBuf) -> PathBuf {
    if !is_enabled() || !is_installed() {
        return vocal_path;
    }
    let parent = match vocal_path.parent() {
        Some(p) => p.to_path_buf(),
        None => return vocal_path,
    };
    if let Some(c) = cached_dr(&parent) {
        return c;
    }
    // 무거운 RoFormer 패스라 블로킹 스레드에서.
    let vp = vocal_path.clone();
    match tokio::task::spawn_blocking(move || generate(&vp, &parent)).await {
        Ok(Ok(dr)) => dr,
        Ok(Err(e)) => {
            crate::audio_player::sys_log(&format!("[Dereverb] 실패 — 원본 보컬로 정렬: {}", e));
            vocal_path
        }
        Err(e) => {
            crate::audio_player::sys_log(&format!("[Dereverb] 스레드 오류 — 원본 보컬로 정렬: {}", e));
            vocal_path
        }
    }
}

/// 보컬에 디리버브 모델을 돌려 vocal_dr을 만든다(stem0=dry 유지).
fn generate(vocal_path: &Path, out_parent: &Path) -> Result<PathBuf, String> {
    let mp = model_path();
    if !mp.is_file() {
        return Err("디리버브 모델 없음".into());
    }
    let params = crate::custom_models::preset_by_key("melband_roformer")
        .map(|p| p.to_params())
        .ok_or_else(|| "melband_roformer 프리셋을 찾을 수 없음".to_string())?;

    crate::audio_player::sys_log("[Dereverb] 디리버브 모델 로드 + 추론 시작");
    let engine = WaveformRemover::new_with_params(&mp, Some("dereverb_roformer"), Some(params))
        .map_err(|e| e.to_string())?;

    // 임시 폴더에 분리 → stem0(dry)을 vocal_dr로.
    let tmp = out_parent.join("._dereverb_tmp");
    std::fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;
    let cancel = Arc::new(AtomicBool::new(false));
    let (dry, _reverb) = engine
        .separate(vocal_path, &tmp, cancel, Box::new(|_p| {}))
        .map_err(|e| e.to_string())?;

    // dry의 실제 확장자를 보존(분리 출력이 mp3일 수도 wav일 수도).
    let ext = dry.extension().and_then(|e| e.to_str()).unwrap_or("wav");
    let dest = out_parent.join(format!("vocal_dr.{}", ext));
    std::fs::copy(&dry, &dest).map_err(|e| format!("vocal_dr 복사 실패: {}", e))?;
    let _ = std::fs::remove_dir_all(&tmp);
    crate::audio_player::sys_log(&format!("[Dereverb] 정렬용 디리버브 보컬 생성: {:?}", dest));
    Ok(dest)
}

// --- Commands ---

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DereverbStatus {
    pub installed: bool,
    pub enabled: bool,
    pub dir: String,
}

#[tauri::command]
pub fn get_dereverb_status() -> DereverbStatus {
    DereverbStatus {
        installed: is_installed(),
        enabled: is_enabled(),
        dir: dereverb_dir().to_string_lossy().to_string(),
    }
}

#[tauri::command]
pub fn set_dereverb_enabled(enabled: bool) -> Result<(), String> {
    set_enabled_db(enabled);
    Ok(())
}

/// 디리버브 모델 폴더를 파일 탐색기로 연다(수동 배치 안내용).
#[tauri::command]
pub fn open_dereverb_dir() -> Result<(), String> {
    let dir = dereverb_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("explorer")
            .arg(&dir)
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new("xdg-open").arg(&dir).spawn().map_err(|e| e.to_string())?;
    }
    Ok(())
}
