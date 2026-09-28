import React, { useState } from 'react';
import './index.css';

function App() {
  const [step, setStep] = useState(1); // 1: Login, 2: Dashboard
  const [creds, setCreds] = useState({ host: '', port: '22', username: 'root', password: '' });
  const [status, setStatus] = useState('');
  
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [files, setFiles] = useState([]);
  
  const [fileContent, setFileContent] = useState('');
  const [currentFile, setCurrentFile] = useState('');

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
    if (data.data) {
      setFileContent(data.data);
      setCurrentFile(file.path);
      setStatus('File dimuat.');
    } else {
      setStatus('Gagal baca file: ' + data.error);
    }
  };

  if (step === 1) {
    return (
      <div style={{ padding: '40px', maxWidth: '400px', margin: '0 auto', fontFamily: 'sans-serif' }}>
        <h2>?? Neo-Panel Login</h2>
        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <input placeholder="IP VPS (misal 103.x.x.x)" value={creds.host} onChange={e => setCreds({...creds, host: e.target.value})} required />
          <input placeholder="Port" value={creds.port} onChange={e => setCreds({...creds, port: e.target.value})} required />
          <input placeholder="Username" value={creds.username} onChange={e => setCreds({...creds, username: e.target.value})} required />
          <input type="password" placeholder="Password" value={creds.password} onChange={e => setCreds({...creds, password: e.target.value})} required />
          <button type="submit" style={{ padding: '10px', background: '#3b82f6', color: 'white', border: 'none', cursor: 'pointer' }}>Connect to VPS</button>
        </form>
        <p style={{ marginTop: '20px', color: '#666' }}>{status}</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'sans-serif' }}>
      {/* SIDEBAR */}
      <div style={{ width: '300px', background: '#1e293b', color: 'white', padding: '20px', overflowY: 'auto' }}>
        <h3>?? Neo-Panel</h3>
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
            <button style={{ padding: '10px', background: '#10b981', color: 'white', border: 'none', marginTop: '10px', cursor: 'pointer' }}>
              Save to Server
            </button>
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
