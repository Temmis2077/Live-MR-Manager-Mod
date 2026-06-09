//! Resolve user input (Chzzk URL, SOOP URL, webPath, numeric ID) to Meloming channel ID.

use serde::Deserialize;

use super::client::{MelomingClient, MelomingError, BASE_URL};

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedChannel {
    pub id: i64,
    pub name: String,
    pub web_path: Option<String>,
    /// How the ID was resolved: numeric | chzzk | soop | web_path
    pub resolved_from: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChannelLookup {
    id: i64,
    name: String,
    web_path: Option<String>,
}

fn extract_chzzk_id(input: &str) -> Option<String> {
    let s = input.trim();
    let markers = ["chzzk.naver.com/", "chzzk.naver.com/live/"];
    for marker in markers {
        if let Some(idx) = s.find(marker) {
            let tail = &s[idx + marker.len()..];
            let id: String = tail
                .chars()
                .take_while(|c| *c != '/' && *c != '?' && *c != '#' && !c.is_whitespace())
                .collect();
            if !id.is_empty() {
                return Some(id);
            }
        }
    }
    if s.len() == 32 && s.chars().all(|c| c.is_ascii_hexdigit()) {
        return Some(s.to_ascii_lowercase());
    }
    None
}

fn extract_soop_id(input: &str) -> Option<String> {
    let s = input.trim();
    let markers = ["sooplive.co.kr/station/", "sooplive.co.kr/"];
    for marker in markers {
        if let Some(idx) = s.find(marker) {
            let tail = &s[idx + marker.len()..];
            let id: String = tail
                .chars()
                .take_while(|c| *c != '/' && *c != '?' && *c != '#' && !c.is_whitespace())
                .collect();
            if !id.is_empty() && id != "station" {
                return Some(id);
            }
        }
    }
    None
}

fn extract_web_path(input: &str) -> Option<String> {
    let s = input.trim();
    let stripped = s
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_start_matches("www.");
    if let Some(rest) = stripped.strip_prefix("meloming.com/") {
        let path: String = rest
            .chars()
            .take_while(|c| *c != '/' && *c != '?' && *c != '#')
            .collect();
        if !path.is_empty() {
            return Some(path);
        }
    }
    if !s.contains('/') && !s.contains(':') && !s.chars().all(|c| c.is_ascii_digit()) {
        return Some(s.to_string());
    }
    None
}

impl MelomingClient {
    pub async fn resolve_channel(input: &str) -> Result<ResolvedChannel, MelomingError> {
        let trimmed = input.trim();
        if trimmed.is_empty() {
            return Err(MelomingError::Message("채널 정보를 입력해 주세요.".into()));
        }

        if let Ok(id) = trimmed.parse::<i64>() {
            let ch: ChannelLookup = Self::get_json(&format!("{BASE_URL}/v1/channels/{id}")).await?;
            return Ok(ResolvedChannel {
                id: ch.id,
                name: ch.name,
                web_path: ch.web_path,
                resolved_from: "numeric".into(),
            });
        }

        if let Some(chzzk_id) = extract_chzzk_id(trimmed) {
            let ch: ChannelLookup =
                Self::get_json(&format!("{BASE_URL}/v1/channels/platforms/CHZZK/{chzzk_id}")).await?;
            return Ok(ResolvedChannel {
                id: ch.id,
                name: ch.name,
                web_path: ch.web_path,
                resolved_from: "chzzk".into(),
            });
        }

        if let Some(soop_id) = extract_soop_id(trimmed) {
            let ch: ChannelLookup =
                Self::get_json(&format!("{BASE_URL}/v1/channels/platforms/SOOP/{soop_id}")).await?;
            return Ok(ResolvedChannel {
                id: ch.id,
                name: ch.name,
                web_path: ch.web_path,
                resolved_from: "soop".into(),
            });
        }

        let identifier = extract_web_path(trimmed).unwrap_or_else(|| trimmed.to_string());
        let encoded = urlencoding::encode(&identifier);
        let ch: ChannelLookup = Self::get_json(&format!("{BASE_URL}/v1/channels/{encoded}")).await?;
        Ok(ResolvedChannel {
            id: ch.id,
            name: ch.name,
            web_path: ch.web_path,
            resolved_from: "web_path".into(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_chzzk_url() {
        let id = extract_chzzk_id("https://chzzk.naver.com/b26947470f4361083ac58fc2f822d517").unwrap();
        assert_eq!(id, "b26947470f4361083ac58fc2f822d517");
    }

    #[test]
    fn parses_bare_chzzk_id() {
        let id = extract_chzzk_id("b26947470f4361083ac58fc2f822d517").unwrap();
        assert_eq!(id, "b26947470f4361083ac58fc2f822d517");
    }
}
