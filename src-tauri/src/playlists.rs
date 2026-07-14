//! 플레이리스트 — 곡을 사용자 정의 목록으로 묶는 기능 (스포티파이 스타일).
//!
//! Categories(필터/멜로밍 연동용)와 별개의 전용 테이블을 쓴다:
//! `Playlists(id, name, created_at)` + `Playlist_Track_Map(playlist_id,
//! track_id, position)`. 곡 식별은 프론트가 쓰는 키인 `path`로 받아
//! Tracks.id로 해석한다. 순서는 position(추가 순, max+1)으로 보존.

use rusqlite::params;
use serde::Serialize;

use crate::library::to_sqlite_err;
use crate::state::DB;

#[derive(Debug, Serialize)]
pub struct PlaylistInfo {
    pub id: i64,
    pub name: String,
    pub track_count: i64,
}

#[tauri::command]
pub async fn get_playlists() -> Result<Vec<PlaylistInfo>, String> {
    let db = DB.lock();
    let mut stmt = db
        .prepare(
            "SELECT p.id, p.name, COUNT(m.track_id)
             FROM Playlists p
             LEFT JOIN Playlist_Track_Map m ON m.playlist_id = p.id
             GROUP BY p.id
             ORDER BY p.created_at ASC, p.id ASC",
        )
        .map_err(to_sqlite_err)?;
    let rows = stmt
        .query_map([], |row| {
            Ok(PlaylistInfo { id: row.get(0)?, name: row.get(1)?, track_count: row.get(2)? })
        })
        .map_err(to_sqlite_err)?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub async fn create_playlist(name: String) -> Result<i64, String> {
    let trimmed = name.trim().to_string();
    if trimmed.is_empty() {
        return Err("플레이리스트 이름을 입력해주세요.".to_string());
    }
    let db = DB.lock();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    db.execute("INSERT INTO Playlists (name, created_at) VALUES (?, ?)", params![trimmed, now])
        .map_err(to_sqlite_err)?;
    Ok(db.last_insert_rowid())
}

#[tauri::command]
pub async fn rename_playlist(playlist_id: i64, name: String) -> Result<(), String> {
    let trimmed = name.trim().to_string();
    if trimmed.is_empty() {
        return Err("플레이리스트 이름을 입력해주세요.".to_string());
    }
    let db = DB.lock();
    db.execute("UPDATE Playlists SET name = ? WHERE id = ?", params![trimmed, playlist_id])
        .map_err(to_sqlite_err)?;
    Ok(())
}

#[tauri::command]
pub async fn delete_playlist(playlist_id: i64) -> Result<(), String> {
    let db = DB.lock();
    // FK CASCADE는 PRAGMA foreign_keys에 의존하므로 맵부터 명시적으로 삭제.
    db.execute("DELETE FROM Playlist_Track_Map WHERE playlist_id = ?", params![playlist_id])
        .map_err(to_sqlite_err)?;
    db.execute("DELETE FROM Playlists WHERE id = ?", params![playlist_id])
        .map_err(to_sqlite_err)?;
    Ok(())
}

fn track_id_for_path(db: &rusqlite::Connection, path: &str) -> Result<i64, String> {
    db.query_row("SELECT id FROM Tracks WHERE path = ?", params![path], |row| row.get(0))
        .map_err(|_| "라이브러리에서 곡을 찾을 수 없습니다.".to_string())
}

#[tauri::command]
pub async fn add_track_to_playlist(playlist_id: i64, path: String) -> Result<(), String> {
    let db = DB.lock();
    let track_id = track_id_for_path(&db, &path)?;
    let next_pos: i64 = db
        .query_row(
            "SELECT COALESCE(MAX(position), 0) + 1 FROM Playlist_Track_Map WHERE playlist_id = ?",
            params![playlist_id],
            |row| row.get(0),
        )
        .map_err(to_sqlite_err)?;
    // 이미 담긴 곡은 조용히 무시 (position 유지).
    db.execute(
        "INSERT OR IGNORE INTO Playlist_Track_Map (playlist_id, track_id, position) VALUES (?, ?, ?)",
        params![playlist_id, track_id, next_pos],
    )
    .map_err(to_sqlite_err)?;
    Ok(())
}

#[tauri::command]
pub async fn remove_track_from_playlist(playlist_id: i64, path: String) -> Result<(), String> {
    let db = DB.lock();
    let track_id = track_id_for_path(&db, &path)?;
    db.execute(
        "DELETE FROM Playlist_Track_Map WHERE playlist_id = ? AND track_id = ?",
        params![playlist_id, track_id],
    )
    .map_err(to_sqlite_err)?;
    Ok(())
}

/// 플레이리스트의 곡 경로 목록을 추가 순서대로 반환.
/// 프론트는 이 순서로 state.songLibrary에서 곡을 찾아 렌더한다.
#[tauri::command]
pub async fn get_playlist_track_paths(playlist_id: i64) -> Result<Vec<String>, String> {
    let db = DB.lock();
    let mut stmt = db
        .prepare(
            "SELECT t.path FROM Playlist_Track_Map m
             JOIN Tracks t ON t.id = m.track_id
             WHERE m.playlist_id = ?
             ORDER BY m.position ASC",
        )
        .map_err(to_sqlite_err)?;
    let rows = stmt.query_map(params![playlist_id], |row| row.get::<_, String>(0)).map_err(to_sqlite_err)?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}
