//! Tauri commands for Meloming integration.

use crate::meloming::client::MelomingClient;
use crate::meloming::oauth::{
    self, build_authorize_url, logout, oauth_status, open_authorize_url, OAuthStatus,
    REDIRECT_URI,
};
use crate::meloming::push::{push_channel, PushResult};
use crate::meloming::resolve::ResolvedChannel;
use crate::meloming::settings::{
    get_setting, set_setting, KEY_API_KEY, KEY_CLIENT_ID, KEY_CLIENT_SECRET,
};
use crate::meloming::sync::{pull_channel, PullResult};
use crate::state::AppPaths;
use serde::Serialize;
use tauri::{AppHandle, State};

use super::settings::{KEY_CHANNEL_ID, KEY_CHANNEL_INPUT};

async fn resolve_input(input: Option<String>) -> Result<(ResolvedChannel, String), String> {
    let raw = input
        .filter(|s| !s.trim().is_empty())
        .or_else(|| get_setting(KEY_CHANNEL_INPUT))
        .or_else(|| get_setting(KEY_CHANNEL_ID))
        .ok_or_else(|| "치지직·SOOP(숲)·씨미 주소 또는 채널 정보를 입력해 주세요.".to_string())?;
    let resolved = MelomingClient::resolve_channel(&raw)
        .await
        .map_err(|e| e.to_string())?;
    Ok((resolved, raw))
}

fn persist_resolved(resolved: &ResolvedChannel, raw_input: &str) -> Result<(), String> {
    set_setting(KEY_CHANNEL_INPUT, raw_input.trim())?;
    set_setting(KEY_CHANNEL_ID, &resolved.id.to_string())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MelomingConnectionTest {
    pub ok: bool,
    pub channel_id: Option<i64>,
    pub channel_name: String,
    pub total_songs: i64,
    pub sample_title: String,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MelomingOAuthStart {
    pub authorize_url: String,
    pub redirect_uri: String,
    pub state: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MelomingCredentialsStatus {
    pub has_client_id: bool,
    pub has_client_secret: bool,
    pub has_api_key: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MelomingUserProfile {
    pub logged_in: bool,
    pub nickname: Option<String>,
    pub profile_image_url: Option<String>,
}

async fn resolve_saved_channel_id() -> Option<i64> {
    if let Some(id_str) = get_setting(KEY_CHANNEL_ID) {
        if let Ok(id) = id_str.parse::<i64>() {
            return Some(id);
        }
    }
    let input = get_setting(KEY_CHANNEL_INPUT).or_else(|| get_setting(KEY_CHANNEL_ID))?;
    MelomingClient::resolve_channel(&input)
        .await
        .ok()
        .map(|r| r.id)
}

#[tauri::command]
pub async fn meloming_get_user_profile() -> Result<MelomingUserProfile, String> {
    if !oauth_status().logged_in {
        return Ok(MelomingUserProfile {
            logged_in: false,
            nickname: None,
            profile_image_url: None,
        });
    }

    let Some(channel_id) = resolve_saved_channel_id().await else {
        return Ok(MelomingUserProfile {
            logged_in: true,
            nickname: Some("멜로밍".into()),
            profile_image_url: None,
        });
    };

    let channel = MelomingClient::get_channel_info(channel_id)
        .await
        .map_err(|e| e.to_string())?;
    let profile = MelomingClient::get_channel_profile(channel_id)
        .await
        .ok();

    let nickname = profile
        .as_ref()
        .and_then(|p| p.nickname.clone())
        .filter(|s| !s.trim().is_empty())
        .or_else(|| Some(channel.name.clone()));

    Ok(MelomingUserProfile {
        logged_in: true,
        nickname,
        profile_image_url: channel.profile_image_url,
    })
}

#[tauri::command]
pub async fn meloming_get_channel_id() -> Result<Option<String>, String> {
    Ok(get_setting(KEY_CHANNEL_INPUT).or_else(|| get_setting(KEY_CHANNEL_ID)))
}

#[tauri::command]
pub async fn meloming_set_channel_id(channel_id: String) -> Result<ResolvedChannel, String> {
    let (resolved, raw) = resolve_input(Some(channel_id)).await?;
    persist_resolved(&resolved, &raw)?;
    Ok(resolved)
}

#[tauri::command]
pub async fn meloming_test_connection(channel_id: Option<String>) -> Result<MelomingConnectionTest, String> {
    match resolve_input(channel_id).await {
        Ok((resolved, raw)) => match MelomingClient::test_channel(resolved.id).await {
            Ok((total, sample)) => {
                let _ = persist_resolved(&resolved, &raw);
                let message = format!(
                    "연결 성공 — {} (ID {}) · 노래 약 {}곡 (샘플: {})",
                    resolved.name, resolved.id, total, sample
                );
                Ok(MelomingConnectionTest {
                    ok: true,
                    channel_id: Some(resolved.id),
                    channel_name: resolved.name,
                    total_songs: total,
                    sample_title: sample,
                    message,
                })
            }
            Err(e) => Ok(MelomingConnectionTest {
                ok: false,
                channel_id: Some(resolved.id),
                channel_name: resolved.name,
                total_songs: 0,
                sample_title: String::new(),
                message: e.to_string(),
            }),
        },
        Err(e) => Ok(MelomingConnectionTest {
            ok: false,
            channel_id: None,
            channel_name: String::new(),
            total_songs: 0,
            sample_title: String::new(),
            message: e,
        }),
    }
}

#[tauri::command]
pub async fn meloming_pull_songs(channel_id: Option<String>) -> Result<PullResult, String> {
    let (resolved, raw) = resolve_input(channel_id).await?;
    persist_resolved(&resolved, &raw)?;
    pull_channel(resolved.id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn meloming_get_credentials() -> Result<MelomingCredentialsStatus, String> {
    Ok(MelomingCredentialsStatus {
        has_client_id: get_setting(KEY_CLIENT_ID)
            .or_else(|| std::env::var("MELOMING_CLIENT_ID").ok())
            .is_some_and(|s| !s.trim().is_empty()),
        has_client_secret: get_setting(KEY_CLIENT_SECRET)
            .or_else(|| std::env::var("MELOMING_CLIENT_SECRET").ok())
            .is_some_and(|s| !s.trim().is_empty()),
        has_api_key: get_setting(KEY_API_KEY)
            .or_else(|| std::env::var("MELOMING_API_KEY").ok())
            .is_some_and(|s| !s.trim().is_empty()),
    })
}

#[tauri::command]
pub async fn meloming_set_credentials(
    client_id: Option<String>,
    client_secret: Option<String>,
    api_key: Option<String>,
) -> Result<(), String> {
    if let Some(v) = client_id {
        let t = v.trim();
        if t.is_empty() {
            crate::meloming::settings::clear_setting(KEY_CLIENT_ID)?;
        } else {
            set_setting(KEY_CLIENT_ID, t)?;
        }
    }
    if let Some(v) = client_secret {
        let t = v.trim();
        if t.is_empty() {
            crate::meloming::settings::clear_setting(KEY_CLIENT_SECRET)?;
        } else {
            set_setting(KEY_CLIENT_SECRET, t)?;
        }
    }
    if let Some(v) = api_key {
        let t = v.trim();
        if t.is_empty() {
            crate::meloming::settings::clear_setting(KEY_API_KEY)?;
        } else {
            set_setting(KEY_API_KEY, t)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn meloming_oauth_status() -> Result<OAuthStatus, String> {
    Ok(oauth_status())
}

#[tauri::command]
pub async fn meloming_oauth_start(app: AppHandle) -> Result<MelomingOAuthStart, String> {
    oauth::sync_credentials_from_env();
    let (authorize_url, state) = build_authorize_url()?;
    open_authorize_url(&app, &authorize_url)?;
    Ok(MelomingOAuthStart {
        authorize_url,
        redirect_uri: REDIRECT_URI.into(),
        state,
    })
}

#[tauri::command]
pub async fn meloming_oauth_finish(code: String, state: String) -> Result<(), String> {
    oauth::exchange_code(&code, &state)
        .await
        .map_err(|e| oauth::format_oauth_error(&e))
}

#[tauri::command]
pub fn meloming_oauth_logout() -> Result<(), String> {
    logout()
}

#[tauri::command]
pub async fn meloming_push_songs(
    paths: State<'_, AppPaths>,
    channel_id: Option<String>,
) -> Result<PushResult, String> {
    let (resolved, raw) = resolve_input(channel_id).await?;
    persist_resolved(&resolved, &raw)?;
    push_channel(paths.inner(), resolved.id)
        .await
        .map_err(|e| e.to_string())
}
