# NeoPanel Roadmap

## Phase 1: Core Foundation & Deployment (COMPLETED)
- [x] PTY Terminal with Rust `ssh2`
- [x] Dual-System API Bridge (Tauri + Fetch)
- [x] File Manager (Read/Write)
- [x] Semi-Auto Deployment Playbook (Smart Detection for package.json, vite, .env)

## Phase 2: The Architect Tools (WIP)
- [ ] **Hook 1: Nginx Visual Router**
  - Scan Nginx configs (`sites-available` or `conf.d`).
  - Visual UI to map domain -> port.
  - Auto-generate server blocks and restart Nginx.
- [ ] **Hook 3: PM2 Log Sentinel**
  - Fetch/stream PM2 logs.
  - UI visualizer with "Error" highlighting and filtering.

## Phase 3: Polish
- [ ] UI Navigation (Sidebar Tabs for Nginx & Logs)
