// Dual-System API Abstraction
import { invoke } from '@tauri-apps/api/core';

const isTauri = window.__TAURI_INTERNALS__ !== undefined;

export const api = {
  checkStatus: async () => {
    if (isTauri) {
      return { connected: false };
    } else {
      try {
        const res = await fetch('http://localhost:3001/api/status');
        return await res.json();
      } catch (e) { return { connected: false }; }
    }
  },

  login: async (creds) => {
    const payload = { ...creds, port: parseInt(creds.port || '22', 10) };
    if (isTauri) {
      try {
        const data = await invoke('ssh_connect', { config: payload });
        return data;
      } catch (error) {
        return { success: false, error: String(error) };
      }
    } else {
      const res = await fetch('http://localhost:3001/api/connect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      return await res.json();
    }
  },

  scan: async () => {
    if (isTauri) {
      try {
        const data = await invoke('ssh_scan');
        return data;
      } catch (error) {
        return { success: false, error: String(error) };
      }
    } else {
      const res = await fetch('http://localhost:3001/api/scan');
      return await res.json();
    }
  },

  getProjectFiles: async (proj) => {
    if (isTauri) {
      try {
        const data = await invoke('ssh_project_files', { projectPath: proj.path, portOrName: proj.name });
        return data;
      } catch (error) {
        return { success: false, error: String(error) };
      }
    } else {
      const res = await fetch('http://localhost:3001/api/project-files', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectPath: proj.path, portOrName: proj.name })
      });
      return await res.json();
    }
  },

  readFile: async (path) => {
    if (isTauri) {
      try {
        const data = await invoke('ssh_read_file', { path });
        return data;
      } catch (error) {
        return { error: String(error) };
      }
    } else {
      const res = await fetch('http://localhost:3001/api/read-file', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path })
      });
      return await res.json();
    }
  },

  saveFile: async (path, content) => {
    if (isTauri) {
      try {
        const data = await invoke('ssh_write_file', { path, content });
        return data;
      } catch (error) {
        return { success: false, error: String(error) };
      }
    } else {
      const res = await fetch('http://localhost:3001/api/write-file', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, content })
      });
      return await res.json();
    }
  },
  
  logout: async () => {
    if (isTauri) {
      try { await invoke('ssh_disconnect'); } catch (e) {}
    } else {
      await fetch('http://localhost:3001/api/logout', { method: 'POST' });
    }
  }
};
