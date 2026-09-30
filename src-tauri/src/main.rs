#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use serde::{Deserialize, Serialize};
use ssh2::Session;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::Mutex;
use tauri::{State, Emitter};
use std::sync::mpsc::{self, Sender};

#[derive(Deserialize, Serialize, Clone)]
pub struct SshConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
}

pub struct AppState {
    pub config: Mutex<Option<SshConfig>>,
    pub term_tx: Mutex<Option<Sender<String>>>,
    pub term_resize_tx: Mutex<Option<Sender<(u32, u32)>>>,
}

fn connect_ssh(config: &SshConfig) -> Result<Session, String> {
    let tcp = TcpStream::connect(format!("{}:{}", config.host, config.port))
        .map_err(|e| format!("TCP connect failed: {}", e))?;
    let mut sess = Session::new().map_err(|e| format!("Session create failed: {}", e))?;
    sess.set_tcp_stream(tcp);
    sess.handshake().map_err(|e| format!("Handshake failed: {}", e))?;

    if let Some(pwd) = &config.password {
        sess.userauth_password(&config.username, pwd)
            .map_err(|e| format!("Auth failed: {}", e))?;
    } else {
        return Err("Password required".into());
    }

    if !sess.authenticated() {
        return Err("Authentication failed".into());
    }
    Ok(sess)
}

fn exec_command(sess: &Session, cmd: &str) -> Result<String, String> {
    let mut channel = sess.channel_session().map_err(|e| e.to_string())?;
    channel.exec(cmd).map_err(|e| e.to_string())?;
    let mut s = String::new();
    channel.read_to_string(&mut s).map_err(|e| e.to_string())?;
    let _ = channel.wait_close();
    Ok(s)
}

#[tauri::command]
fn start_terminal(cols: u32, rows: u32, state: State<'_, AppState>, app: tauri::AppHandle) -> Result<(), String> {
    let config = state.config.lock().unwrap().clone().ok_or("Not connected")?;
    
    let (tx, rx) = mpsc::channel::<String>();
    let (resize_tx, resize_rx) = mpsc::channel::<(u32, u32)>();
    
    *state.term_tx.lock().unwrap() = Some(tx);
    *state.term_resize_tx.lock().unwrap() = Some(resize_tx);

    std::thread::spawn(move || {
        let sess = match connect_ssh(&config) {
            Ok(s) => s,
            Err(e) => {
                let _ = app.emit("terminal-data", format!("\r\n*** SSH Connect Error: {} ***\r\n", e));
                return;
            }
        };
        let mut channel = match sess.channel_session() {
            Ok(c) => c,
            Err(e) => {
                let _ = app.emit("terminal-data", format!("\r\n*** Channel Error: {} ***\r\n", e));
                return;
            }
        };

        if let Err(e) = channel.request_pty("xterm-256color", None, Some((cols, rows, 0, 0))) {
            let _ = app.emit("terminal-data", format!("\r\n*** PTY Error: {} ***\r\n", e));
        }
        if let Err(e) = channel.shell() {
            let _ = app.emit("terminal-data", format!("\r\n*** Shell Error: {} ***\r\n", e));
        }

        // Set non-blocking only AFTER the shell is successfully spawned
        sess.set_blocking(false);

        let _ = app.emit("terminal-data", "\r\n\x1b[32m[✓] Connection established. Waiting for shell...\x1b[0m\r\n".to_string());
        
        let _ = channel.write_all(b"\n");

        let mut buf = [0; 4096];
        loop {
            match channel.read(&mut buf) {
                Ok(0) => {
                    let _ = app.emit("terminal-data", "\r\n*** Shell Closed ***\r\n".to_string());
                    break;
                },
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app.emit("terminal-data", data);
                },
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {},
                Err(_) => break,
            }

            match rx.try_recv() {
                Ok(input) => {
                    let _ = channel.write_all(input.as_bytes());
                },
                Err(mpsc::TryRecvError::Disconnected) => break,
                Err(mpsc::TryRecvError::Empty) => {}
            }

            if let Ok((c, r)) = resize_rx.try_recv() {
                let _ = channel.request_pty_size(c, r, None, None);
            }

            std::thread::sleep(std::time::Duration::from_millis(10));
        }
    });

    Ok(())
}

#[tauri::command]
fn write_terminal(data: String, state: State<'_, AppState>) -> Result<(), String> {
    if let Some(tx) = state.term_tx.lock().unwrap().as_ref() {
        let _ = tx.send(data);
    }
    Ok(())
}

#[tauri::command]
fn resize_terminal(cols: u32, rows: u32, state: State<'_, AppState>) -> Result<(), String> {
    if let Some(tx) = state.term_resize_tx.lock().unwrap().as_ref() {
        let _ = tx.send((cols, rows));
    }
    Ok(())
}

#[tauri::command]
async fn ssh_connect(config: SshConfig, state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let _sess = connect_ssh(&config)?;
    *state.config.lock().unwrap() = Some(config);
    Ok(serde_json::json!({ "success": true, "message": "Connected successfully!" }))
}

#[tauri::command]
async fn ssh_disconnect(state: State<'_, AppState>) -> Result<(), String> {
    *state.config.lock().unwrap() = None;
    Ok(())
}

#[tauri::command]
async fn ssh_scan(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let config = state.config.lock().unwrap().clone().ok_or("Not connected")?;
    let sess = connect_ssh(&config)?;

    let pm2_out = exec_command(&sess, "pm2 jlist").unwrap_or_else(|_| "[]".to_string());
    let www_out = exec_command(&sess, "find /var/www -mindepth 1 -maxdepth 1 -type d -exec basename {} \\; 2>/dev/null || echo \"\"").unwrap_or_else(|_| "".to_string());

    let pm2_apps: Vec<serde_json::Value> = serde_json::from_str(&pm2_out).unwrap_or_else(|_| vec![]);
    let mut projects = vec![];
    for app in pm2_apps {
        let name = app["name"].as_str().unwrap_or("Unknown");
        let pid = app["pid"].as_i64().unwrap_or(0);
        let status = app["pm2_env"]["status"].as_str().unwrap_or("unknown");
        let mem = app["monit"]["memory"].as_f64().unwrap_or(0.0);
        let cpu = app["monit"]["cpu"].as_f64().unwrap_or(0.0);
        let path = app["pm2_env"]["pm_cwd"].as_str().unwrap_or("");

        projects.push(serde_json::json!({
            "name": name,
            "pid": pid,
            "status": status,
            "memory": format!("{} MB", (mem / 1024.0 / 1024.0).round()),
            "cpu": format!("{}%", cpu),
            "path": path
        }));
    }

    let mut www_dirs = vec![];
    for line in www_out.lines() {
        let trimmed = line.trim();
        if !trimmed.is_empty() {
            www_dirs.push(serde_json::json!({
                "name": trimmed,
                "path": format!("/var/www/{}", trimmed)
            }));
        }
    }

    Ok(serde_json::json!({
        "success": true,
        "projects": projects,
        "wwwDirs": www_dirs
    }))
}

#[tauri::command]
async fn ssh_project_files(project_path: String, _port_or_name: String, state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let config = state.config.lock().unwrap().clone().ok_or("Not connected")?;
    let sess = connect_ssh(&config)?;

    let mut files = vec![];

    let cmd_env = format!("ls -l {}/.env || echo 'NOT_FOUND'", project_path);
    let out_env = exec_command(&sess, &cmd_env).unwrap_or_default();
    if !out_env.contains("NOT_FOUND") {
        files.push(serde_json::json!({ "name": ".env", "path": format!("{}/.env", project_path), "type": "env" }));
    }

    let cmd_pkg = format!("ls -l {}/package.json || echo 'NOT_FOUND'", project_path);
    let out_pkg = exec_command(&sess, &cmd_pkg).unwrap_or_default();
    if !out_pkg.contains("NOT_FOUND") {
        files.push(serde_json::json!({ "name": "package.json", "path": format!("{}/package.json", project_path), "type": "config" }));
    }

    let cmd_nginx = format!("grep -Rl '{}' /etc/nginx/sites-available/ || echo 'NOT_FOUND'", project_path);
    let out_nginx = exec_command(&sess, &cmd_nginx).unwrap_or_default();
    if !out_nginx.contains("NOT_FOUND") {
        for f in out_nginx.lines() {
            let f_t = f.trim();
            if !f_t.is_empty() && f_t != "NOT_FOUND" {
                let name = f_t.split('/').last().unwrap_or(f_t);
                files.push(serde_json::json!({ "name": format!("{} (Nginx)", name), "path": f_t, "type": "nginx" }));
            }
        }
    }

    Ok(serde_json::json!({ "success": true, "files": files }))
}

#[tauri::command]
async fn ssh_read_file(path: String, state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let config = state.config.lock().unwrap().clone().ok_or("Not connected")?;
    let sess = connect_ssh(&config)?;
    let sftp = sess.sftp().map_err(|e| e.to_string())?;
    
    let mut file = sftp.open(std::path::Path::new(&path)).map_err(|e| e.to_string())?;
    let mut content = String::new();
    file.read_to_string(&mut content).map_err(|e| e.to_string())?;

    Ok(serde_json::json!({ "data": content }))
}

#[tauri::command]
async fn ssh_write_file(path: String, content: String, state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let config = state.config.lock().unwrap().clone().ok_or("Not connected")?;
    let sess = connect_ssh(&config)?;
    let sftp = sess.sftp().map_err(|e| e.to_string())?;
    
    let mut file = sftp.create(std::path::Path::new(&path)).map_err(|e| e.to_string())?;
    file.write_all(content.as_bytes()).map_err(|e| e.to_string())?;

    Ok(serde_json::json!({ "success": true }))
}

#[tauri::command]
async fn ssh_analyze_project(path: String, state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let config = state.config.lock().unwrap().clone().ok_or("Not connected")?;
    let sess = connect_ssh(&config)?;

    let cmd_git = format!("test -d {}/.git && echo 'yes' || echo 'no'", path);
    let is_git = exec_command(&sess, &cmd_git).unwrap_or_default().trim() == "yes";
    
    // Find where the package.json is (root, frontend, or client)
    let cmd_find_pkg = format!("test -f {path}/package.json && echo '.' || (test -f {path}/frontend/package.json && echo 'frontend' || (test -f {path}/client/package.json && echo 'client' || echo ''))");
    let pkg_dir = exec_command(&sess, &cmd_find_pkg).unwrap_or_default().trim().to_string();
    
    let has_npm = !pkg_dir.is_empty();
    let mut package_scripts = Vec::new();
    
    if has_npm {
        let pkg_path = if pkg_dir == "." { format!("{}/package.json", path) } else { format!("{}/{}/package.json", path, pkg_dir) };
        let cmd_pkg = format!("cat {} 2>/dev/null || echo ''", pkg_path);
        let pkg_content = exec_command(&sess, &cmd_pkg).unwrap_or_default();
        
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&pkg_content) {
            if let Some(scripts) = json.get("scripts").and_then(|s| s.as_object()) {
                for (k, _) in scripts {
                    package_scripts.push(k.clone());
                }
            }
        }
    }

    // Smart Detection: Check .env for BUILD_COMMAND override
    let cmd_env = format!("cat {}/.env 2>/dev/null | grep -E '^BUILD_CMD=|^BUILD_COMMAND=' | cut -d '=' -f2- | tr -d '\"' | tr -d \"'\" || echo ''", path);
    let env_build_cmd = exec_command(&sess, &cmd_env).unwrap_or_default().trim().to_string();

    // Smart Detection: Check for Vite
    let cmd_vite = format!("test -f {}/vite.config.js -o -f {}/vite.config.ts && echo 'yes' || echo 'no'", path, path);
    let is_vite = exec_command(&sess, &cmd_vite).unwrap_or_default().trim() == "yes";

    // Check if path is managed by pm2 by doing a simple grep on pm2 jlist
    let cmd_pm2 = format!("pm2 jlist 2>/dev/null | grep '\"pm_cwd\":\"{}\"' && echo 'yes' || echo 'no'", path);
    let has_pm2 = exec_command(&sess, &cmd_pm2).unwrap_or_default().trim().contains("yes");

    Ok(serde_json::json!({
        "success": true,
        "isGit": is_git,
        "hasNpm": has_npm,
        "packageScripts": package_scripts,
        "envBuildCmd": env_build_cmd,
        "isVite": is_vite,
        "hasPm2": has_pm2,
        "buildDir": pkg_dir
    }))
}

#[tauri::command]
async fn ssh_get_pm2_logs(name: String, state: State<'_, AppState>) -> Result<String, String> {
    let config = state.config.lock().unwrap().clone().ok_or("Not connected")?;
    let sess = connect_ssh(&config)?;

    let cmd = format!("pm2 logs {} --nostream --lines 200", name);
    let logs = exec_command(&sess, &cmd).unwrap_or_else(|e| format!("Error fetching logs: {}", e));
    Ok(logs)
}

#[tauri::command]
async fn ssh_add_nginx_domain(domain: String, port: String, state: State<'_, AppState>) -> Result<String, String> {
    let config = state.config.lock().unwrap().clone().ok_or("Not connected")?;
    let sess = connect_ssh(&config)?;

    let nginx_conf = format!(r#"
server {{
    listen 80;
    server_name {domain};

    location / {{
        proxy_pass http://127.0.0.1:{port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }}
}}
"#);

    // Determine config path
    let check_path = exec_command(&sess, "test -d /etc/nginx/sites-available && echo 'sites' || echo 'conf'").unwrap_or_default();
    let is_sites = check_path.trim() == "sites";

    let file_path = if is_sites {
        format!("/etc/nginx/sites-available/{}", domain)
    } else {
        format!("/etc/nginx/conf.d/{}.conf", domain)
    };

    // Write file using cat EOF
    let write_cmd = format!("cat << 'EOF_NGINX' > {}\n{}\nEOF_NGINX", file_path, nginx_conf);
    exec_command(&sess, &write_cmd).map_err(|e| format!("Failed to write config: {}", e))?;

    // Create symlink if needed
    if is_sites {
        let link_cmd = format!("ln -sf {} /etc/nginx/sites-enabled/{}", file_path, domain);
        exec_command(&sess, &link_cmd).unwrap_or_default();
    }

    // Test and reload
    let test_cmd = "nginx -t 2>&1 && systemctl reload nginx 2>&1 || service nginx reload 2>&1";
    let test_res = exec_command(&sess, test_cmd).unwrap_or_default();
    
    if test_res.to_lowercase().contains("failed") || test_res.to_lowercase().contains("emerg") {
        // Rollback
        let _ = exec_command(&sess, &format!("rm -f {}", file_path));
        if is_sites { let _ = exec_command(&sess, &format!("rm -f /etc/nginx/sites-enabled/{}", domain)); }
        return Err(format!("Nginx test failed (Rolled back):\n{}", test_res));
    }

    Ok(format!("Successfully routed {} to port {}", domain, port))
}

#[tauri::command]
async fn ssh_get_sysinfo(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let config = state.config.lock().unwrap().clone().ok_or("Not connected")?;
    let sess = connect_ssh(&config)?;

    // Fetch RAM
    let mem_cmd = "cat /proc/meminfo | grep -E 'MemTotal|MemAvailable'";
    let mem_out = exec_command(&sess, mem_cmd).unwrap_or_default();
    
    let mut total_kb = 0.0;
    let mut avail_kb = 0.0;
    
    for line in mem_out.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 2 {
            if parts[0] == "MemTotal:" { total_kb = parts[1].parse().unwrap_or(0.0); }
            if parts[0] == "MemAvailable:" { avail_kb = parts[1].parse().unwrap_or(0.0); }
        }
    }
    
    let used_kb = total_kb - avail_kb;
    let ram_percent: f64 = if total_kb > 0.0 { (used_kb / total_kb) * 100.0 } else { 0.0 };
    let ram_percent = ram_percent.round() as u32;
    let ram_used_gb = used_kb / 1024.0 / 1024.0;
    let ram_total_gb = total_kb / 1024.0 / 1024.0;

    // Fetch CPU Load, Cores & Uptime
    let load_out = exec_command(&sess, "cat /proc/loadavg").unwrap_or_default();
    let load_parts: Vec<&str> = load_out.split_whitespace().collect();
    let load_1m = if !load_parts.is_empty() { load_parts[0] } else { "0.00" };

    let cores_out = exec_command(&sess, "nproc").unwrap_or_default().trim().to_string();
    
    let cpu_usg_cmd = "top -bn1 | awk '/[Cc]pu/ {print $2 + $4}' | head -n1 | awk '{printf \"%.0f\", $1}'";
    let cpu_usg = exec_command(&sess, cpu_usg_cmd).unwrap_or_default().trim().to_string();
    let cpu_usg = if cpu_usg.is_empty() { "0" } else { &cpu_usg };

    let uptime_out = exec_command(&sess, "uptime -p").unwrap_or_default().replace("up ", "").trim().to_string();

    Ok(serde_json::json!({
        "ramPercent": ram_percent,
        "ramText": format!("{:.1}G / {:.1}G", ram_used_gb, ram_total_gb),
        "cpuLoad": load_1m,
        "cpuCores": cores_out,
        "cpuUsg": cpu_usg,
        "uptime": uptime_out
    }))
}

fn main() {
    tauri::Builder::default()
        .manage(AppState {
            config: Mutex::new(None),
            term_tx: Mutex::new(None),
            term_resize_tx: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            ssh_connect,
            ssh_disconnect,
            ssh_scan,
            ssh_project_files,
            ssh_read_file,
            ssh_write_file,
            ssh_analyze_project,
            ssh_get_pm2_logs,
            ssh_add_nginx_domain,
            ssh_get_sysinfo,
            start_terminal,
            write_terminal,
            resize_terminal
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
