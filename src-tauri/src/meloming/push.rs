//! Push local library songs to Meloming songbook (POST/PATCH).

use serde::Serialize;

use crate::library::{get_songs_internal, save_library_internal};
use crate::meloming::oauth::access_token;
use crate::state::{AppPaths, DB};
use crate::types::SongMetadata;
use rusqlite::params;

use super::client::{MelomingClient, MelomingError, SongResponse};
use super::sync::{normalize_youtube_watch, upsert_artist_maps};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PushResult {
    pub pushed: usize,
    pub created: usize,
    pub updated: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SongWriteBody {
    title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    artist_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    album_art: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    karaoke_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cover_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    original_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    difficulty: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    proficiency: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    song_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    bpm: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    lyrics_link: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    category_ids: Option<Vec<i64>>,
}

fn normalize_artist_name(name: &str) -> String {
    name.trim().to_lowercase()
}

fn resolve_artist_id(song: &SongMetadata, channel_id: i64) -> Option<i64> {
    if let Some(id) = song.meloming_artist_id {
        return Some(id);
    }
    let name = song.artist.as_deref()?.trim();
    if name.is_empty() {
        return None;
    }
    let db = DB.lock();
    if let Ok(id) = db.query_row(
        "SELECT meloming_artist_id FROM Meloming_Artist_Map WHERE channel_id = ? AND local_name = ?",
        params![channel_id, name],
        |row| row.get(0),
    ) {
        return Some(id);
    }

    let target = normalize_artist_name(name);
    let mut stmt = db
        .prepare("SELECT meloming_artist_id, local_name FROM Meloming_Artist_Map WHERE channel_id = ?")
        .ok()?;
    let rows = stmt
        .query_map(params![channel_id], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })
        .ok()?;
    let mapped: Vec<(i64, String)> = rows.flatten().collect();
    for (id, local) in &mapped {
        if normalize_artist_name(local) == target {
            return Some(*id);
        }
    }
    // 느슨한 매칭: CSV 아티스트명이 멜로밍 등록명을 포함하거나 그 반대인 경우
    for (id, local) in &mapped {
        let norm = normalize_artist_name(local);
        if norm.contains(&target) || target.contains(&norm) {
            return Some(*id);
        }
    }
    None
}

fn patch_song_id_for_channel(song: &SongMetadata, channel_id: i64) -> Option<i64> {
    let song_id = song.meloming_song_id?;
    match song.meloming_channel_id {
        Some(cid) if cid != channel_id => None,
        _ => Some(song_id),
    }
}

fn should_retry_as_create(err: &MelomingError) -> bool {
    match err {
        MelomingError::Http(status, body) => {
            matches!(*status, 403 | 404)
                || body.contains("PERMISSION_DENIED")
                || body.contains("NOT_FOUND")
        }
        MelomingError::Message(msg) => {
            msg.contains("403")
                || msg.contains("404")
                || msg.contains("PERMISSION_DENIED")
                || msg.contains("NOT_FOUND")
        }
    }
}

async fn enrich_youtube_metadata(song: &mut SongMetadata) {
    let path = song.path.trim();
    if !path.starts_with("http") {
        return;
    }
    let sparse = song.thumbnail.trim().is_empty()
        || song.duration.trim().is_empty()
        || song.duration.trim() == "0:00";
    if !sparse {
        return;
    }
    if let Ok(meta) = crate::model_commands::youtube_metadata_fetcher(path.to_string()).await {
        if song.thumbnail.trim().is_empty() && !meta.thumbnail.trim().is_empty() {
            song.thumbnail = meta.thumbnail;
        }
        if (song.duration.trim().is_empty() || song.duration.trim() == "0:00")
            && !meta.duration.trim().is_empty()
        {
            song.duration = meta.duration;
        }
        if song
            .artist
            .as_ref()
            .map(|a| a.trim().is_empty())
            .unwrap_or(true)
        {
            song.artist = meta.artist;
        }
        if song
            .original_url
            .as_ref()
            .map(|u| u.trim().is_empty())
            .unwrap_or(true)
        {
            song.original_url = Some(path.to_string());
        }
    }
}

fn original_url_for_push(song: &SongMetadata) -> Option<String> {
    if let Some(url) = song.original_url.as_deref().filter(|s| !s.is_empty()) {
        return normalize_youtube_watch(url).or_else(|| Some(url.to_string()));
    }
    if let Some(url) = normalize_youtube_watch(&song.path) {
        return Some(url);
    }
    None
}

fn song_to_body(song: &SongMetadata, channel_id: i64, for_create: bool) -> Result<SongWriteBody, String> {
    let artist_id = resolve_artist_id(song, channel_id);
    if for_create && artist_id.is_none() {
        let artist_hint = song
            .artist
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .map(|s| format!(" (아티스트: {s})"))
            .unwrap_or_else(|| " (아티스트 미입력)".into());
        return Err(format!(
            "「{}」{artist_hint}: 멜로밍 아티스트 ID를 찾을 수 없습니다. 멜로밍 웹에서 아티스트를 등록하거나, 「가져오기」로 매핑을 갱신한 뒤 아티스트 이름을 맞춰 주세요.",
            song.title
        ));
    }

    let album_art = song
        .thumbnail
        .trim()
        .starts_with("http")
        .then(|| song.thumbnail.clone())
        .filter(|s| !s.is_empty());

    Ok(SongWriteBody {
        title: song.title.clone(),
        artist_id,
        album_art,
        karaoke_url: song.karaoke_url.clone(),
        cover_url: song.cover_url.clone(),
        original_url: original_url_for_push(song),
        difficulty: song.difficulty.map(i32::from),
        proficiency: song.proficiency.map(i32::from),
        song_key: song.song_key.clone(),
        bpm: song.bpm,
        lyrics_link: song.lyrics_link.clone(),
        category_ids: song.meloming_category_ids.clone(),
    })
}

fn apply_push_response(song: &mut SongMetadata, channel_id: i64, resp: &SongResponse) {
    song.meloming_song_id = Some(resp.id);
    song.meloming_channel_id = Some(channel_id);
    if song.meloming_artist_id.is_none() {
        song.meloming_artist_id = resp.artist_id;
    }
    if let Some(ids) = &resp.category_ids {
        song.meloming_category_ids = Some(ids.clone());
    }
    song.sync_status = Some("synced".into());
}

pub async fn push_channel(paths: &AppPaths, channel_id: i64) -> Result<PushResult, MelomingError> {
    let token = access_token().await?;
    let artists = MelomingClient::list_artists(channel_id).await.unwrap_or_default();
    upsert_artist_maps(channel_id, &artists)?;

    let mut songs = get_songs_internal(paths.clone()).await.map_err(MelomingError::Message)?;

    let mut result = PushResult {
        pushed: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        errors: Vec::new(),
    };

    let mut persist_library = false;

    for song in &mut songs {
        let thumb_before = song.thumbnail.clone();
        let duration_before = song.duration.clone();
        enrich_youtube_metadata(song).await;
        if song.thumbnail != thumb_before || song.duration != duration_before {
            persist_library = true;
        }

        match push_one_song(channel_id, song, &token).await {
            Ok(action) => {
                result.pushed += 1;
                match action {
                    PushAction::Created => result.created += 1,
                    PushAction::Updated => result.updated += 1,
                }
                persist_library = true;
            }
            Err(e) => {
                result.skipped += 1;
                let msg = format!("{}: {}", song.title, e);
                let _ = crate::audio_player::sys_log(&format!("[Meloming Push] skip: {msg}"));
                result.errors.push(msg);
            }
        }
    }

    if persist_library {
        save_library_internal(songs)
            .await
            .map_err(MelomingError::Message)?;
    }

    let _ = crate::audio_player::sys_log(&format!(
        "[Meloming Push] done — pushed={} created={} updated={} skipped={}",
        result.pushed, result.created, result.updated, result.skipped
    ));

    Ok(result)
}

enum PushAction {
    Created,
    Updated,
}

async fn push_one_song(
    channel_id: i64,
    song: &mut SongMetadata,
    token: &str,
) -> Result<PushAction, String> {
    if song.title.trim().is_empty() {
        return Err("제목이 비어 있습니다.".into());
    }

    if let Some(song_id) = patch_song_id_for_channel(song, channel_id) {
        let body = song_to_body(song, channel_id, false)?;
        match MelomingClient::patch_song(channel_id, song_id, &body, token).await {
            Ok(resp) => {
                apply_push_response(song, channel_id, &resp);
                return Ok(PushAction::Updated);
            }
            Err(e) if should_retry_as_create(&e) => {
                song.meloming_song_id = None;
                song.meloming_channel_id = None;
            }
            Err(e) => return Err(e.to_string()),
        }
    }

    let body = song_to_body(song, channel_id, true)?;
    let resp = MelomingClient::create_song(channel_id, &body, token)
        .await
        .map_err(|e| e.to_string())?;
    apply_push_response(song, channel_id, &resp);
    Ok(PushAction::Created)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn patch_id_ignored_for_other_channel() {
        let song = SongMetadata {
            meloming_song_id: Some(99),
            meloming_channel_id: Some(1),
            ..Default::default()
        };
        assert_eq!(patch_song_id_for_channel(&song, 2), None);
        assert_eq!(patch_song_id_for_channel(&song, 1), Some(99));
    }
}
