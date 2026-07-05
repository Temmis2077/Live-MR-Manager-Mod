//! Push local library songs to Meloming songbook (POST/PATCH).

use std::collections::HashMap;
use std::future::Future;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;

use crate::library::{get_songs_internal, save_library_internal};
use crate::meloming::oauth::access_token;
use crate::state::{AppPaths, DB};
use crate::types::SongMetadata;
use crate::youtube_url::cache_key_variants;
use rusqlite::params;

use super::client::{ArtistResponse, CategoryResponse, MelomingClient, MelomingError, SongResponse};
use super::sync::{
    normalize_youtube_watch, upsert_artist_map_entry, upsert_artist_maps, upsert_category_map_entry,
    upsert_category_maps,
};

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
    lyrics_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    category_ids: Option<Vec<i64>>,
}

const CATEGORY_COLORS: [&str; 6] = [
    "#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899",
];
/// Meloming OpenAPI rate limit (~60/min). Write 호출 간 최소 간격.
const API_MIN_INTERVAL_MS: u64 = 1100;
const API_RATE_LIMIT_RETRIES: u32 = 4;
/// 로컬에 카테고리가 없을 때 멜로밍 필수 categoryIds용 기본값
const DEFAULT_CATEGORY_NAME: &str = "기본";

static LAST_API_CALL_MS: AtomicU64 = AtomicU64::new(0);

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

async fn meloming_throttle() {
    loop {
        let now = now_ms();
        let last = LAST_API_CALL_MS.load(Ordering::Relaxed);
        let elapsed = now.saturating_sub(last);
        if elapsed >= API_MIN_INTERVAL_MS {
            LAST_API_CALL_MS.store(now, Ordering::Relaxed);
            return;
        }
        tokio::time::sleep(Duration::from_millis(API_MIN_INTERVAL_MS - elapsed)).await;
    }
}

fn is_rate_limited(err: &MelomingError) -> bool {
    matches!(err, MelomingError::Http(429, _))
        || err.to_string().contains("RATE_LIMIT")
}

async fn api_with_retry<T, F, Fut>(mut call: F) -> Result<T, String>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<T, MelomingError>>,
{
    let mut attempt = 0u32;
    loop {
        meloming_throttle().await;
        match call().await {
            Ok(value) => return Ok(value),
            Err(err) if is_rate_limited(&err) && attempt < API_RATE_LIMIT_RETRIES => {
                attempt += 1;
                let backoff = API_MIN_INTERVAL_MS * attempt as u64;
                let _ = crate::audio_player::sys_log(&format!(
                    "[Meloming Push] rate limit — retry {attempt}/{API_RATE_LIMIT_RETRIES} after {backoff}ms"
                ));
                tokio::time::sleep(Duration::from_millis(backoff)).await;
            }
            Err(err) => return Err(err.to_string()),
        }
    }
}

fn normalize_name(name: &str) -> String {
    name.trim().to_lowercase()
}

fn opt_non_empty(value: Option<String>) -> Option<String> {
    value
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn rating_for_push(value: Option<u8>) -> Option<i32> {
    value.and_then(|n| (1..=5).contains(&n).then_some(i32::from(n)))
}

fn bpm_for_push(value: Option<i32>) -> Option<i32> {
    value.filter(|&bpm| bpm > 0)
}

/// 로컬 `.lrc` / 캐시 `lyric.lrc` 를 읽어 멜로밍 `lyricsText` 로 보냅니다.
fn load_lyrics_for_push(paths: &AppPaths, song: &SongMetadata) -> Option<String> {
    let path = song.path.trim();
    if path.is_empty() {
        return None;
    }

    let mut search_paths = Vec::new();
    if path.starts_with("http") {
        for key in cache_key_variants(path) {
            let cache_dir = paths.separated.join(urlencoding::encode(&key).to_string());
            search_paths.push(cache_dir.join("lyric.lrc"));
            search_paths.push(cache_dir.join("vocal.lrc"));
        }
    } else {
        let original = PathBuf::from(path);
        search_paths.push(original.with_extension("lrc"));
        for key in cache_key_variants(path) {
            let cache_dir = paths.separated.join(urlencoding::encode(&key).to_string());
            search_paths.push(cache_dir.join("lyric.lrc"));
            search_paths.push(cache_dir.join("vocal.lrc"));
        }
        if let Some(parent) = original.parent() {
            search_paths.push(parent.join("lyric.lrc"));
            search_paths.push(parent.join("vocal.lrc"));
        }
    }

    for candidate in search_paths {
        if candidate.is_file() {
            if let Ok(content) = std::fs::read_to_string(&candidate) {
                let trimmed = content.trim();
                if !trimmed.is_empty() {
                    return Some(trimmed.to_string());
                }
            }
        }
    }
    None
}

fn category_color(name: &str) -> String {
    let hash = name.bytes().fold(0u32, |acc, b| acc.wrapping_add(b as u32));
    CATEGORY_COLORS[(hash as usize) % CATEGORY_COLORS.len()].to_string()
}

fn local_category_names(song: &SongMetadata) -> Vec<String> {
    let mut names: Vec<String> = song
        .categories
        .as_ref()
        .map(|cats| {
            cats.iter()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default();
    if names.is_empty() {
        if let Some(name) = song.curation_category.as_deref().filter(|s| !s.trim().is_empty()) {
            names.push(name.trim().to_string());
        }
    }
    names.sort();
    names.dedup();
    names
}

struct WriteCache {
    channel_id: i64,
    artists: HashMap<String, i64>,
    categories: HashMap<String, i64>,
}

impl WriteCache {
    fn from_lists(
        channel_id: i64,
        artists: &[ArtistResponse],
        categories: &[CategoryResponse],
    ) -> Self {
        let mut artist_map = HashMap::new();
        for a in artists {
            artist_map.insert(normalize_name(&a.name), a.id);
        }
        let mut category_map = HashMap::new();
        for c in categories {
            category_map.insert(normalize_name(&c.name), c.id);
        }
        Self {
            channel_id,
            artists: artist_map,
            categories: category_map,
        }
    }

    fn ingest_artists(&mut self, artists: &[ArtistResponse]) {
        for a in artists {
            self.artists.insert(normalize_name(&a.name), a.id);
        }
    }

    fn ingest_categories(&mut self, categories: &[CategoryResponse]) {
        for c in categories {
            self.categories.insert(normalize_name(&c.name), c.id);
        }
    }

    async fn refresh_artists(&mut self, _token: &str) -> Result<(), String> {
        let artists = api_with_retry(|| MelomingClient::list_artists(self.channel_id))
            .await?;
        upsert_artist_maps(self.channel_id, &artists).map_err(|e| e.to_string())?;
        self.ingest_artists(&artists);
        Ok(())
    }

    async fn refresh_categories(&mut self, _token: &str) -> Result<(), String> {
        let categories = api_with_retry(|| MelomingClient::list_categories(self.channel_id))
            .await?;
        upsert_category_maps(self.channel_id, &categories).map_err(|e| e.to_string())?;
        self.ingest_categories(&categories);
        Ok(())
    }

    fn find_artist_id_after_refresh(&self, name: &str) -> Option<i64> {
        self.lookup_artist_id(name)
            .or_else(|| self.lookup_artist_id_db(name))
    }

    fn find_category_id_after_refresh(&self, name: &str) -> Option<i64> {
        self.lookup_category_id(name)
            .or_else(|| self.lookup_category_id_db(name))
    }

    async fn create_or_resolve_artist(
        &mut self,
        name: &str,
        token: &str,
    ) -> Result<i64, String> {
        match api_with_retry(|| MelomingClient::create_artist(self.channel_id, name, token)).await
        {
            Ok(created) => {
                let _ = crate::audio_player::sys_log(&format!(
                    "[Meloming Push] created artist \"{name}\" -> id {}",
                    created.id
                ));
                upsert_artist_map_entry(self.channel_id, name, created.id)
                    .map_err(|e| e.to_string())?;
                self.artists.insert(normalize_name(name), created.id);
                Ok(created.id)
            }
            Err(err) if err.contains("이미 존재하는") => {
                let _ = crate::audio_player::sys_log(&format!(
                    "[Meloming Push] artist \"{name}\" already exists — refreshing list"
                ));
                self.refresh_artists(token).await?;
                self.find_artist_id_after_refresh(name).ok_or_else(|| {
                    format!("아티스트 \"{name}\"가 채널에 있으나 이름 매칭에 실패했습니다.")
                })
            }
            Err(err) => Err(err),
        }
    }

    async fn create_or_resolve_category(
        &mut self,
        name: &str,
        token: &str,
    ) -> Result<i64, String> {
        let color = category_color(name);
        match api_with_retry(|| {
            MelomingClient::create_category(self.channel_id, name, &color, token)
        })
        .await
        {
            Ok(created) => {
                let _ = crate::audio_player::sys_log(&format!(
                    "[Meloming Push] created category \"{name}\" -> id {}",
                    created.id
                ));
                upsert_category_map_entry(self.channel_id, name, created.id)
                    .map_err(|e| e.to_string())?;
                self.categories.insert(normalize_name(name), created.id);
                Ok(created.id)
            }
            Err(err) if err.contains("이미 존재하는") => {
                let _ = crate::audio_player::sys_log(&format!(
                    "[Meloming Push] category \"{name}\" already exists — refreshing list"
                ));
                self.refresh_categories(token).await?;
                self.find_category_id_after_refresh(name).ok_or_else(|| {
                    format!("카테고리 \"{name}\"가 채널에 있으나 이름 매칭에 실패했습니다.")
                })
            }
            Err(err) => Err(err),
        }
    }

    fn lookup_artist_id(&self, name: &str) -> Option<i64> {
        let target = normalize_name(name);
        if let Some(id) = self.artists.get(&target) {
            return Some(*id);
        }
        for (local, id) in &self.artists {
            if local.contains(&target) || target.contains(local) {
                return Some(*id);
            }
        }
        None
    }

    fn lookup_artist_id_db(&self, name: &str) -> Option<i64> {
        let db = DB.lock();
        if let Ok(id) = db.query_row(
            "SELECT meloming_artist_id FROM Meloming_Artist_Map WHERE channel_id = ? AND local_name = ?",
            params![self.channel_id, name.trim()],
            |row| row.get(0),
        ) {
            return Some(id);
        }

        let target = normalize_name(name);
        let mut stmt = db
            .prepare("SELECT meloming_artist_id, local_name FROM Meloming_Artist_Map WHERE channel_id = ?")
            .ok()?;
        let rows = stmt
            .query_map(params![self.channel_id], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })
            .ok()?;
        for row in rows.flatten() {
            let (id, local) = row;
            let norm = normalize_name(&local);
            if norm == target || norm.contains(&target) || target.contains(&norm) {
                return Some(id);
            }
        }
        None
    }

    fn lookup_category_id(&self, name: &str) -> Option<i64> {
        let target = normalize_name(name);
        if let Some(id) = self.categories.get(&target) {
            return Some(*id);
        }
        for (local, id) in &self.categories {
            if local.contains(&target) || target.contains(local) {
                return Some(*id);
            }
        }
        None
    }

    fn lookup_category_id_db(&self, name: &str) -> Option<i64> {
        let db = DB.lock();
        db.query_row(
            "SELECT meloming_category_id FROM Meloming_Category_Map WHERE channel_id = ? AND local_name = ?",
            params![self.channel_id, name.trim()],
            |row| row.get(0),
        )
        .ok()
    }

    async fn resolve_artist_id(
        &mut self,
        song: &mut SongMetadata,
        token: &str,
    ) -> Result<Option<i64>, String> {
        if let Some(id) = song.meloming_artist_id {
            return Ok(Some(id));
        }
        let name = song.artist.as_deref().unwrap_or("").trim();
        if name.is_empty() {
            return Ok(None);
        }

        if let Some(id) = self.find_artist_id_after_refresh(name) {
            song.meloming_artist_id = Some(id);
            return Ok(Some(id));
        }

        let id = self.create_or_resolve_artist(name, token).await?;
        song.meloming_artist_id = Some(id);
        Ok(Some(id))
    }

    async fn resolve_category_ids(
        &mut self,
        song: &mut SongMetadata,
        token: &str,
    ) -> Result<Vec<i64>, String> {
        if let Some(ids) = song.meloming_category_ids.as_ref().filter(|ids| !ids.is_empty()) {
            return Ok(ids.clone());
        }

        let mut names = local_category_names(song);
        if names.is_empty() {
            names.push(DEFAULT_CATEGORY_NAME.to_string());
        }
        let primary_name = names[0].clone();

        let mut ids = Vec::new();
        for name in &names {
            let id = if let Some(id) = self.find_category_id_after_refresh(name) {
                id
            } else {
                self.create_or_resolve_category(name, token).await?
            };
            if !ids.contains(&id) {
                ids.push(id);
            }
        }

        song.meloming_category_ids = Some(ids.clone());
        if song.categories.as_ref().is_none_or(|c| c.is_empty()) {
            song.categories = Some(vec![primary_name.clone()]);
        }
        if song.curation_category.as_ref().is_none_or(|c| c.trim().is_empty()) {
            song.curation_category = Some(primary_name);
        }
        Ok(ids)
    }
}

/// Push 시작 시 채널 노래책 전체와 대조해 POST/PATCH 를 결정합니다.
struct RemoteSongIndex {
    songs_by_id: HashMap<i64, SongResponse>,
    by_youtube: HashMap<String, i64>,
    by_title_artist_id: HashMap<String, i64>,
    by_title_artist_name: HashMap<String, i64>,
}

impl RemoteSongIndex {
    fn from_songs(songs: &[SongResponse]) -> Self {
        let mut index = Self {
            songs_by_id: HashMap::new(),
            by_youtube: HashMap::new(),
            by_title_artist_id: HashMap::new(),
            by_title_artist_name: HashMap::new(),
        };
        for song in songs {
            index.ingest(song);
        }
        index
    }

    fn get(&self, id: i64) -> Option<&SongResponse> {
        self.songs_by_id.get(&id)
    }

    fn ingest(&mut self, song: &SongResponse) {
        self.songs_by_id.insert(song.id, song.clone());
        if let Some(url) = song
            .original_url
            .as_deref()
            .and_then(normalize_youtube_watch)
        {
            self.index_youtube_url(&url, song.id);
        }
        if let Some(aid) = song.artist_id {
            self.by_title_artist_id
                .insert(title_artist_id_key(&song.title, aid), song.id);
        }
        if let Some(name) = song.artist_name.as_deref().filter(|s| !s.trim().is_empty()) {
            self.by_title_artist_name
                .insert(title_artist_name_key(&song.title, name), song.id);
        }
    }

    fn index_youtube_url(&mut self, url: &str, song_id: i64) {
        self.by_youtube.insert(normalize_name(url), song_id);
        for variant in cache_key_variants(url) {
            if let Some(norm) = normalize_youtube_watch(&variant) {
                self.by_youtube.insert(normalize_name(&norm), song_id);
            }
        }
    }

    fn match_local(&self, song: &SongMetadata, artist_id: Option<i64>) -> Option<i64> {
        if let Some(id) = song.meloming_song_id {
            if self.songs_by_id.contains_key(&id) {
                return Some(id);
            }
        }

        if let Some(url) = original_url_for_push(song) {
            if let Some(id) = self.by_youtube.get(&normalize_name(&url)) {
                return Some(*id);
            }
            for variant in cache_key_variants(&url) {
                if let Some(norm) = normalize_youtube_watch(&variant) {
                    if let Some(id) = self.by_youtube.get(&normalize_name(&norm)) {
                        return Some(*id);
                    }
                }
            }
        }

        if let Some(path_url) = normalize_youtube_watch(song.path.trim()) {
            if let Some(id) = self.by_youtube.get(&normalize_name(&path_url)) {
                return Some(*id);
            }
        }

        self.find_by_title_artist(&song.title, artist_id, song.artist.as_deref())
    }

    fn find_by_title_artist(
        &self,
        title: &str,
        artist_id: Option<i64>,
        artist_name: Option<&str>,
    ) -> Option<i64> {
        if let Some(aid) = artist_id {
            if let Some(id) = self
                .by_title_artist_id
                .get(&title_artist_id_key(title, aid))
            {
                return Some(*id);
            }
        }
        if let Some(name) = artist_name.filter(|s| !s.trim().is_empty()) {
            if let Some(id) = self
                .by_title_artist_name
                .get(&title_artist_name_key(title, name))
            {
                return Some(*id);
            }
        }
        None
    }
}

fn title_artist_id_key(title: &str, artist_id: i64) -> String {
    format!("{}\0{}", normalize_name(title), artist_id)
}

fn title_artist_name_key(title: &str, artist_name: &str) -> String {
    format!(
        "{}\0{}",
        normalize_name(title),
        normalize_name(artist_name)
    )
}

fn normalize_lyrics_for_compare(text: &str) -> String {
    text.trim().replace("\r\n", "\n")
}

/// PATCH 시 멜로밍과 동일한 가사는 다시 보내지 않습니다.
fn lyrics_text_for_push(
    local: Option<String>,
    remote_song: Option<&SongResponse>,
    is_create: bool,
) -> Option<String> {
    let local = opt_non_empty(local)?;
    if is_create {
        return Some(local);
    }

    let remote = remote_song
        .and_then(|s| s.lyrics_text.as_deref())
        .filter(|s| !s.trim().is_empty());

    match remote {
        None => None,
        Some(r) if normalize_lyrics_for_compare(r) == normalize_lyrics_for_compare(&local) => None,
        Some(_) => Some(local),
    }
}

fn link_local_to_remote(
    song: &mut SongMetadata,
    channel_id: i64,
    artist_id: Option<i64>,
    remote_index: &RemoteSongIndex,
) {
    if patch_song_id_for_channel(song, channel_id).is_some() {
        return;
    }
    if let Some(remote_id) = remote_index.match_local(song, artist_id) {
        let _ = crate::audio_player::sys_log(&format!(
            "[Meloming Push] matched remote: \"{}\" -> id {remote_id}",
            song.title
        ));
        song.meloming_song_id = Some(remote_id);
        song.meloming_channel_id = Some(channel_id);
    }
}

fn is_duplicate_song_error(err: &str) -> bool {
    err.contains("409") || err.contains("이미 동일한 노래")
}

fn patch_song_id_for_channel(song: &SongMetadata, channel_id: i64) -> Option<i64> {
    let song_id = song.meloming_song_id?;
    match song.meloming_channel_id {
        Some(cid) if cid != channel_id => None,
        _ => Some(song_id),
    }
}

fn should_retry_as_create_msg(err: &str) -> bool {
    err.contains("403")
        || err.contains("404")
        || err.contains("PERMISSION_DENIED")
        || err.contains("NOT_FOUND")
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

fn song_to_body(
    song: &SongMetadata,
    artist_id: Option<i64>,
    category_ids: Vec<i64>,
    lyrics_text: Option<String>,
    for_create: bool,
) -> Result<SongWriteBody, String> {
    if for_create && artist_id.is_none() {
        return Err(format!(
            "「{}」: 아티스트 이름이 없어 멜로밍에 등록할 수 없습니다.",
            song.title
        ));
    }
    if for_create && category_ids.is_empty() {
        return Err(format!(
            "「{}」: 카테고리를 지정할 수 없습니다.",
            song.title
        ));
    }

    let album_art = song
        .thumbnail
        .trim()
        .starts_with("http")
        .then(|| song.thumbnail.trim().to_string())
        .filter(|s| !s.is_empty());

    Ok(SongWriteBody {
        title: song.title.trim().to_string(),
        artist_id,
        album_art,
        karaoke_url: opt_non_empty(song.karaoke_url.clone()),
        cover_url: opt_non_empty(song.cover_url.clone()),
        original_url: original_url_for_push(song),
        difficulty: rating_for_push(song.difficulty),
        proficiency: rating_for_push(song.proficiency),
        song_key: opt_non_empty(song.song_key.clone()),
        bpm: bpm_for_push(song.bpm),
        lyrics_link: opt_non_empty(song.lyrics_link.clone()),
        lyrics_text: opt_non_empty(lyrics_text),
        category_ids: if category_ids.is_empty() {
            None
        } else {
            Some(category_ids)
        },
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
    let categories = MelomingClient::list_categories(channel_id)
        .await
        .unwrap_or_default();
    upsert_artist_maps(channel_id, &artists)?;
    upsert_category_maps(channel_id, &categories)?;

    let remote_songs =
        api_with_retry(|| MelomingClient::list_songs(channel_id)).await.map_err(MelomingError::Message)?;
    let _ = crate::audio_player::sys_log(&format!(
        "[Meloming Push] remote catalog loaded — {} songs",
        remote_songs.len()
    ));
    let mut remote_index = RemoteSongIndex::from_songs(&remote_songs);

    let mut cache = WriteCache::from_lists(channel_id, &artists, &categories);
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

        match push_one_song(paths, channel_id, song, &token, &mut cache, &mut remote_index).await {
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

async fn push_song_write(
    channel_id: i64,
    song: &mut SongMetadata,
    token: &str,
    body: &SongWriteBody,
    remote_index: &mut RemoteSongIndex,
) -> Result<PushAction, String> {
    if let Some(song_id) = patch_song_id_for_channel(song, channel_id) {
        match api_with_retry(|| MelomingClient::patch_song(channel_id, song_id, body, token)).await
        {
            Ok(resp) => {
                apply_push_response(song, channel_id, &resp);
                remote_index.ingest(&resp);
                return Ok(PushAction::Updated);
            }
            Err(e) if should_retry_as_create_msg(&e) => {
                song.meloming_song_id = None;
                song.meloming_channel_id = None;
            }
            Err(e) => return Err(e),
        }
    }

    match api_with_retry(|| MelomingClient::create_song(channel_id, body, token)).await {
        Ok(resp) => {
            apply_push_response(song, channel_id, &resp);
            remote_index.ingest(&resp);
            Ok(PushAction::Created)
        }
        Err(err) if is_duplicate_song_error(&err) => {
            let artist_id = body.artist_id;
            let artist_name = song.artist.as_deref();
            if let Some(remote_id) =
                remote_index.find_by_title_artist(&song.title, artist_id, artist_name)
            {
                let _ = crate::audio_player::sys_log(&format!(
                    "[Meloming Push] duplicate — patch instead: \"{}\" -> id {remote_id}",
                    song.title
                ));
                song.meloming_song_id = Some(remote_id);
                song.meloming_channel_id = Some(channel_id);
                match api_with_retry(|| {
                    MelomingClient::patch_song(channel_id, remote_id, body, token)
                })
                .await
                {
                    Ok(resp) => {
                        apply_push_response(song, channel_id, &resp);
                        remote_index.ingest(&resp);
                        Ok(PushAction::Updated)
                    }
                    Err(e) => Err(e),
                }
            } else {
                Err(err)
            }
        }
        Err(err) => Err(err),
    }
}

async fn push_one_song(
    paths: &AppPaths,
    channel_id: i64,
    song: &mut SongMetadata,
    token: &str,
    cache: &mut WriteCache,
    remote_index: &mut RemoteSongIndex,
) -> Result<PushAction, String> {
    if song.title.trim().is_empty() {
        return Err("제목이 비어 있습니다.".into());
    }

    let artist_id = cache.resolve_artist_id(song, token).await?;
    let category_ids = cache.resolve_category_ids(song, token).await?;
    link_local_to_remote(song, channel_id, artist_id, remote_index);

    let lyrics_text = load_lyrics_for_push(paths, song);
    let is_create = patch_song_id_for_channel(song, channel_id).is_none();
    let remote_song = patch_song_id_for_channel(song, channel_id)
        .and_then(|id| remote_index.get(id));
    let lyrics_for_body = lyrics_text_for_push(lyrics_text, remote_song, is_create);
    if lyrics_for_body.is_some() {
        let _ = crate::audio_player::sys_log(&format!(
            "[Meloming Push] lyrics upload: \"{}\"",
            song.title
        ));
    }

    let body = song_to_body(
        song,
        artist_id,
        category_ids,
        lyrics_for_body,
        is_create,
    )?;

    push_song_write(channel_id, song, token, &body, remote_index).await
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

    #[test]
    fn local_category_names_prefers_categories_vec() {
        let song = SongMetadata {
            categories: Some(vec!["포크".into(), "발라드".into()]),
            curation_category: Some("기본".into()),
            ..Default::default()
        };
        assert_eq!(
            local_category_names(&song),
            vec!["발라드".to_string(), "포크".to_string()]
        );
    }

    #[test]
    fn opt_non_empty_filters_blank() {
        assert_eq!(opt_non_empty(Some("  Am  ".into())), Some("Am".into()));
        assert_eq!(opt_non_empty(Some("".into())), None);
        assert_eq!(opt_non_empty(None), None);
    }

    #[test]
    fn bpm_for_push_rejects_zero() {
        assert_eq!(bpm_for_push(Some(120)), Some(120));
        assert_eq!(bpm_for_push(Some(0)), None);
    }

    #[test]
    fn remote_index_matches_title_and_artist_name() {
        let songs = vec![SongResponse {
            id: 42,
            title: "촛농의 노래".into(),
            artist_id: Some(100),
            artist_name: Some("심규선".into()),
            ..empty_song_response()
        }];
        let index = RemoteSongIndex::from_songs(&songs);
        let local = SongMetadata {
            title: "촛농의 노래".into(),
            artist: Some("심규선".into()),
            ..Default::default()
        };
        assert_eq!(index.match_local(&local, Some(100)), Some(42));
        assert_eq!(
            index.find_by_title_artist("촛농의 노래", None, Some("심규선")),
            Some(42)
        );
    }

    #[test]
    fn remote_index_matches_youtube_url() {
        let url = "https://www.youtube.com/watch?v=abc123";
        let songs = vec![SongResponse {
            id: 7,
            title: "Test".into(),
            original_url: Some(url.into()),
            ..empty_song_response()
        }];
        let index = RemoteSongIndex::from_songs(&songs);
        let local = SongMetadata {
            title: "Other".into(),
            path: "https://youtu.be/abc123".into(),
            ..Default::default()
        };
        assert_eq!(index.match_local(&local, None), Some(7));
    }

    #[test]
    fn lyrics_text_for_push_skips_unchanged_on_patch() {
        let local = Some("[00:01]hello".into());
        let remote = SongResponse {
            id: 1,
            title: "t".into(),
            lyrics_text: Some("[00:01]hello".into()),
            ..empty_song_response()
        };
        assert_eq!(lyrics_text_for_push(local, Some(&remote), false), None);
    }

    #[test]
    fn lyrics_text_for_push_includes_on_create() {
        let local = Some("가사".into());
        assert_eq!(
            lyrics_text_for_push(local.clone(), None, true),
            Some("가사".into())
        );
    }

    fn empty_song_response() -> SongResponse {
        SongResponse {
            id: 0,
            title: String::new(),
            artist_id: None,
            artist_name: None,
            album_art: None,
            karaoke_url: None,
            cover_url: None,
            original_url: None,
            difficulty: None,
            proficiency: None,
            song_key: None,
            bpm: None,
            lyrics_link: None,
            lyrics_text: None,
            category_ids: None,
        }
    }
}
