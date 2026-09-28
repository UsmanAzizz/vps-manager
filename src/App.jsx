import React, { useState, useEffect } from 'react';
import './index.css';

function App() {
  const [step, setStep] = useState(0); // 0: loading, 1: login, 2: dashboard
  const [creds, setCreds] = useState({ host: '', port: '22', username: 'root', password: '' });
  const [rememberMe, setRememberMe] = useState(false);
  const [status, setStatus] = useState('');
  
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [files, setFiles] = useState([]);
  
  const [fileContent, setFileContent] = useState('');
  const [currentFile, setCurrentFile] = useState('');

  useEffect(() => {
    checkConnection();
  }, []);

  const checkConnection = async () => {
    try {
      const res = await fetch('http://localhost:3001/api/status');
      const data = await res.json();
      if (data.connected) {
        setCreds({ ...creds, host: data.host });
        setStep(2);
        scanProjects();
      } else {
        // Cek localStorage jika backend ternyata reset
        const savedCreds = localStorage.getItem('neo_vps_creds');
        if (savedCreds) {
          const parsed = JSON.parse(savedCreds);
          setCreds(parsed);
          setRememberMe(true);
          // Lakukan auto-login secara background
          autoLogin(parsed);
        } else {
          setStep(1);
        }
      }
    } catch (e) {
      const savedCreds = localStorage.getItem('neo_vps_creds');
      if (savedCreds) {
        setCreds(JSON.parse(savedCreds));
        setRememberMe(true);
      }
      setStep(1);
    }
  };

  const autoLogin = async (credentials) => {
    setStatus('Auto-connecting...');
    try {
      const res = await fetch('http://localhost:3001/api/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials)
      });
      const data = await res.json();
      if (data.success) {
        setStep(2);
        scanProjects();
      } else {
        setStatus('Auto-login gagal: ' + data.error);
        setStep(1);
      }
    } catch (err) {
      setStatus('Error koneksi lokal: ' + err.message);
      setStep(1);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setStatus('Menghubungkan ke VPS...');
    try {
      const res = await fetch('http://localhost:3001/api/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(creds)
      });
      const data = await res.json();
      if (data.success) {
        if (rememberMe) {
          localStorage.setItem('neo_vps_creds', JSON.stringify(creds));
        } else {
          localStorage.removeItem('neo_vps_creds');
        }
        setStatus('Berhasil terhubung!');
        setStep(2);
        scanProjects();
      } else {
        setStatus('Gagal: ' + data.error);
      }
    } catch (err) {
      setStatus('Error koneksi lokal: ' + err.message);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('http://localhost:3001/api/logout', { method: 'POST' });
      localStorage.removeItem('neo_vps_creds');
      setCreds({ host: '', port: '22', username: 'root', password: '' });
      setRememberMe(false);
      setStep(1);
      setProjects([]);
      setFiles([]);
      setCurrentFile('');
      setFileContent('');
      setStatus('');
    } catch (e) {}
  };

  const scanProjects = async () => {
    setStatus('Mendeteksi project Node.js / PM2...');
    const res = await fetch('http://localhost:3001/api/scan');
    const data = await res.json();
    if (data.success) {
      setProjects(data.projects);
      setStatus('Scan selesai. Temukan ' + data.projects.length + ' project.');
    }
  };

  const handleSelectProject = async (proj) => {
    setSelectedProject(proj);
    setFiles([]);
    setFileContent('');
    setStatus('Mencari file terkait (Nginx, .env) untuk ' + proj.name + '...');
    const res = await fetch('http://localhost:3001/api/project-files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectPath: proj.path, portOrName: proj.name })
    });
    const data = await res.json();
    if (data.success) {
      setFiles(data.files);
      setStatus('File terkait berhasil ditemukan.');
    }
  };

  const openFile = async (file) => {
    setStatus('Membaca ' + file.path + '...');
    const res = await fetch('http://localhost:3001/api/read-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: file.path })
    });
    const data = await res.json();
    if (data.data !== undefined) {
      setFileContent(data.data);
      setCurrentFile(file.path);
      setStatus('File dimuat.');
    } else {
      setStatus('Gagal baca file: ' + data.error);
    }
  };

  const saveFile = async () => {
    setStatus('Menyimpan ' + currentFile + '...');
    const res = await fetch('http://localhost:3001/api/write-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: currentFile, content: fileContent })
    });
    const data = await res.json();
    if (data.success) {
      setStatus('Berhasil disimpan!');
    } else {
      setStatus('Gagal menyimpan: ' + data.error);
    }
  };

  if (step === 0) return <div style={{padding:'40px', fontFamily:'sans-serif'}}>Memuat sesi... {status}</div>;

  if (step === 1) {
    return (
      <div style={{ padding: '40px', maxWidth: '400px', margin: '0 auto', fontFamily: 'sans-serif' }}>
        <h2>?? Neo-Panel Login</h2>
        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <input placeholder="IP VPS (misal 103.x.x.x)" value={creds.host} onChange={e => setCreds({...creds, host: e.target.value})} required />
          <input placeholder="Port" value={creds.port} onChange={e => setCreds({...creds, port: e.target.value})} required />
          <input placeholder="Username" value={creds.username} onChange={e => setCreds({...creds, username: e.target.value})} required />
          <input type="password" placeholder="Password" value={creds.password} onChange={e => setCreds({...creds, password: e.target.value})} required />
          
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '14px' }}>
            <input type="checkbox" checked={rememberMe} onChange={e => setRememberMe(e.target.checked)} />
            Simpan Kredensial (Auto-Login saat direfresh)
          </label>
          
          <button type="submit" style={{ padding: '10px', background: '#3b82f6', color: 'white', border: 'none', cursor: 'pointer', borderRadius: '4px' }}>Connect to VPS</button>
        </form>
        <p style={{ marginTop: '20px', color: '#666' }}>{status}</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'sans-serif' }}>
      {/* SIDEBAR */}
      <div style={{ width: '300px', background: '#1e293b', color: 'white', padding: '20px', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>?? Neo-Panel</h3>
          <button onClick={handleLogout} style={{ background: '#ef4444', color: 'white', border: 'none', padding: '5px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>Logout</button>
        </div>
        <p style={{ fontSize: '12px', color: '#94a3b8' }}>Connected to {creds.host}</p>
        
        <h4 style={{ marginTop: '30px', color: '#93c5fd' }}>?? PM2 Projects</h4>
        {projects.length === 0 && <p style={{fontSize: '12px'}}>Loading...</p>}
        {projects.map(p => (
          <div 
            key={p.name} 
            onClick={() => handleSelectProject(p)}
            style={{ 
              padding: '10px', background: selectedProject?.name === p.name ? '#3b82f6' : '#334155', 
              marginBottom: '10px', borderRadius: '5px', cursor: 'pointer' 
            }}
          >
            <strong>{p.name}</strong> ({p.status})
            <div style={{ fontSize: '11px', color: '#cbd5e1' }}>RAM: {p.memory} | CPU: {p.cpu}</div>
          </div>
        ))}

        {selectedProject && (
          <>
            <h4 style={{ marginTop: '30px', color: '#93c5fd' }}>?? File Terkait ({selectedProject.name})</h4>
            {files.length === 0 && <p style={{fontSize: '12px'}}>Mencari file...</p>}
            {files.map(f => (
              <div 
                key={f.path} 
                onClick={() => openFile(f)}
                style={{ 
                  padding: '8px', background: currentFile === f.path ? '#475569' : 'transparent',
                  fontSize: '13px', cursor: 'pointer', borderBottom: '1px solid #334155'
                }}
              >
                {f.name}
              </div>
            ))}
          </>
        )}
      </div>

      {/* EDITOR */}
      <div style={{ flex: 1, padding: '20px', display: 'flex', flexDirection: 'column', background: '#f8fafc' }}>
        <div style={{ marginBottom: '15px', color: '#64748b', fontSize: '14px' }}>
          <strong>Status:</strong> {status}
        </div>
        
        {currentFile ? (
          <>
            <h3 style={{ margin: '0 0 10px 0' }}>{currentFile}</h3>
            <textarea 
              value={fileContent} 
              onChange={e => setFileContent(e.target.value)}
              style={{ 
                flex: 1, width: '100%', background: '#1e1e1e', color: '#d4d4d4', 
                fontFamily: 'monospace', padding: '15px', border: 'none', borderRadius: '5px' 
              }} 
            />
            <div>
              <button onClick={saveFile} style={{ padding: '10px 20px', background: '#10b981', color: 'white', border: 'none', borderRadius: '4px', marginTop: '10px', cursor: 'pointer' }}>
                Save to Server
              </button>
            </div>
          </>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>
            Pilih file dari sidebar untuk mulai mengedit
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
