fn main() {
    let manifest_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let env_path = manifest_dir.join(".env");
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
                        println!("cargo:rustc-env=EMBEDDED_MELOMING_CLIENT_ID={v}");
                    }
                }
            }
        }
    }
    if let Ok(v) = std::env::var("MELOMING_CLIENT_ID") {
        let v = v.trim();
        if !v.is_empty() {
            println!("cargo:rustc-env=EMBEDDED_MELOMING_CLIENT_ID={v}");
        }
    }
    println!("cargo:rerun-if-changed=.env");
    tauri_build::build()
}
