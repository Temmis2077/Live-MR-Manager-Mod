//! Meloming integration settings (SQLite Settings table).

use crate::state::DB;
use rusqlite::params;

pub const KEY_CHANNEL_ID: &str = "meloming_channel_id";
pub const KEY_CHANNEL_INPUT: &str = "meloming_channel_input";
pub const KEY_CLIENT_ID: &str = "meloming_client_id";
pub const KEY_CLIENT_SECRET: &str = "meloming_client_secret";
pub const KEY_API_KEY: &str = "meloming_api_key";
pub const KEY_OAUTH_VERIFIER: &str = "meloming_oauth_code_verifier";
pub const KEY_OAUTH_STATE: &str = "meloming_oauth_state";
pub const KEY_ACCESS_TOKEN: &str = "meloming_oauth_access_token";
pub const KEY_REFRESH_TOKEN: &str = "meloming_oauth_refresh_token";
pub const KEY_EXPIRES_AT: &str = "meloming_oauth_expires_at";

pub fn get_setting(key: &str) -> Option<String> {
    let db = DB.lock();
    db.query_row(
        "SELECT value FROM Settings WHERE key = ?",
        params![key],
        |row| row.get(0),
    )
    .ok()
}

pub fn set_setting(key: &str, value: &str) -> Result<(), String> {
    let db = DB.lock();
    db.execute(
        "INSERT OR REPLACE INTO Settings (key, value) VALUES (?, ?)",
        params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn clear_setting(key: &str) -> Result<(), String> {
    let db = DB.lock();
    db.execute("DELETE FROM Settings WHERE key = ?", params![key])
        .map_err(|e| e.to_string())?;
    Ok(())
}
