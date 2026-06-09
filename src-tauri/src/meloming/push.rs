//! Push local library songs to Meloming songbook (POST/PATCH).

use serde::Serialize;

use crate::library::{get_songs_internal, save_library_internal};
use crate::meloming::oauth::access_token;
use crate::state::{AppPaths, DB};
use crate::types::SongMetadata;
use rusqlite::params;

use super::client::{MelomingClient, MelomingError, SongResponse};
use super::sync::normalize_youtube_watch;

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

fn resolve_artist_id(song: &SongMetadata, channel_id: i64) -> Option<i64> {
    if let Some(id) = song.meloming_artist_id {
        return Some(id);
    }
    let name = song.artist.as_deref()?.trim();
    if name.is_empty() {
        return None;
    }
    let db = DB.lock();
    db.query_row(
        "SELECT meloming_artist_id FROM Meloming_Artist_Map WHERE channel_id = ? AND local_name = ?",
        params![channel_id, name],
        |row| row.get(0),
    )
    .ok()
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
        return Err(format!(
            "「{}」: 멜로밍 아티스트 ID를 찾을 수 없습니다. Pull 후 아티스트 이름을 맞추거나 meloming_artist_id를 설정해 주세요.",
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
    let mut songs = get_songs_internal(paths.clone()).await.map_err(MelomingError::Message)?;

    let mut result = PushResult {
        pushed: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        errors: Vec::new(),
    };

    let mut changed = Vec::new();

    for song in &mut songs {
        let path_key = song.path.clone();
        match push_one_song(channel_id, song, &token).await {
            Ok(action) => {
                result.pushed += 1;
                match action {
                    PushAction::Created => result.created += 1,
                    PushAction::Updated => result.updated += 1,
                }
                changed.push(path_key);
            }
            Err(e) => {
                result.skipped += 1;
                result.errors.push(format!("{}: {}", song.title, e));
            }
        }
    }

    if !changed.is_empty() {
        save_library_internal(songs)
            .await
            .map_err(MelomingError::Message)?;
    }

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

    if let Some(song_id) = song.meloming_song_id {
        let body = song_to_body(song, channel_id, false)?;
        let resp = MelomingClient::patch_song(channel_id, song_id, &body, token)
            .await
            .map_err(|e| e.to_string())?;
        apply_push_response(song, channel_id, &resp);
        return Ok(PushAction::Updated);
    }

    let body = song_to_body(song, channel_id, true)?;
    let resp = MelomingClient::create_song(channel_id, &body, token)
        .await
        .map_err(|e| e.to_string())?;
    apply_push_response(song, channel_id, &resp);
    Ok(PushAction::Created)
}
