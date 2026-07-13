fn main() {
    let manifest_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let env_path = manifest_dir.join(".env");

    let mut client_id: Option<String> = None;

    if env_path.is_file() {
        if let Ok(content) = std::fs::read_to_string(&env_path) {
            for line in content.lines() {
                let line = line.trim();
                if line.is_empty() || line.starts_with('#') {
                    continue;
                }
                if let Some((k, v)) = line.split_once('=') {
                    let k = k.trim();
                    let v = v.trim().trim_matches('"').trim_matches('\'').to_string();
                    if k == "MELOMING_CLIENT_ID" && !v.is_empty() {
                        client_id = Some(v);
                    }
                }
            }
        }
    }

    // CI/release: GitHub secret 등이 프로세스 env로 들어오면 우선
    if let Ok(v) = std::env::var("MELOMING_CLIENT_ID") {
        let v = v.trim();
        if !v.is_empty() {
            client_id = Some(v.to_string());
        }
    }

    // Client ID만 바이너리에 임베드. Secret은 절대 임베드하지 않음
    // (배포본은 Secret 없이 Companion /api/oauth/exchange·refresh 사용).
    if let Some(id) = client_id {
        println!("cargo:rustc-env=EMBEDDED_MELOMING_CLIENT_ID={id}");
    }

    println!("cargo:rerun-if-changed=.env");
    println!("cargo:rerun-if-env-changed=MELOMING_CLIENT_ID");
    tauri_build::build()
}
