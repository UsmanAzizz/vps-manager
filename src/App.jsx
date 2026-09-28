import React, { useState, useEffect } from 'react';
import { Terminal, Server, FileCode, Play, LogOut, Loader2, CheckCircle2, AlertCircle, Folder, Settings, ShieldCheck, RefreshCw } from 'lucide-react';
import './index.css';
import TerminalPane from './TerminalPane';

function App() {
  const [step, setStep] = useState(0); 
  const [creds, setCreds] = useState({ host: '', port: '22', username: 'root', password: '' });
  const [rememberMe, setRememberMe] = useState(false);
  const [status, setStatus] = useState('');
  
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [files, setFiles] = useState([]);
  
  const [fileContent, setFileContent] = useState('');
  const [currentFile, setCurrentFile] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => { checkConnection(); }, []);

  const checkConnection = async () => {
    try {
      const res = await fetch('http://localhost:3001/api/status');
      const data = await res.json();
      if (data.connected) {
        setCreds({ ...creds, host: data.host });
        setStep(2); scanProjects();
      } else {
        const savedCreds = localStorage.getItem('neo_vps_creds');
        if (savedCreds) {
          const parsed = JSON.parse(savedCreds);
          setCreds(parsed); setRememberMe(true); autoLogin(parsed);
        } else setStep(1);
      }
    } catch (e) {
      const savedCreds = localStorage.getItem('neo_vps_creds');
      if (savedCreds) { setCreds(JSON.parse(savedCreds)); setRememberMe(true); }
      setStep(1);
    }
  };

  const autoLogin = async (credentials) => {
    setIsLoading(true); setStatus('Auto-connecting to VPS...');
    try {
      const res = await fetch('http://localhost:3001/api/connect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credentials)
      });
      const data = await res.json();
      if (data.success) { setStep(2); scanProjects(); } 
      else { setStatus('Auto-login gagal: ' + data.error); setStep(1); }
    } catch (err) { setStatus('Error koneksi: ' + err.message); setStep(1); }
    setIsLoading(false);
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setIsLoading(true); setStatus('Menghubungkan via SSH...');
    try {
      const res = await fetch('http://localhost:3001/api/connect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(creds)
      });
      const data = await res.json();
      if (data.success) {
        if (rememberMe) localStorage.setItem('neo_vps_creds', JSON.stringify(creds));
        else localStorage.removeItem('neo_vps_creds');
        setStep(2); scanProjects(); setStatus('');
      } else setStatus('Gagal: ' + data.error);
    } catch (err) { setStatus('Error koneksi lokal: ' + err.message); }
    setIsLoading(false);
  };

  const handleLogout = async () => {
    await fetch('http://localhost:3001/api/logout', { method: 'POST' });
    localStorage.removeItem('neo_vps_creds');
    setCreds({ host: '', port: '22', username: 'root', password: '' });
    setRememberMe(false); setStep(1); setProjects([]); setFiles([]);
    setCurrentFile(''); setFileContent(''); setStatus('');
  };

  const scanProjects = async () => {
    setStatus('DETECTING PM2 PROCESSES...'); setIsLoading(true);
    const res = await fetch('http://localhost:3001/api/scan');
    const data = await res.json();
    if (data.success) {
      const uniqueProjects = data.projects.reduce((acc, curr) => {
        if (!acc.find(p => p.name === curr.name)) {
          acc.push(curr);
        }
        return acc;
      }, []);
      setProjects(uniqueProjects);
      setStatus('');
    }
    setIsLoading(false);
  };

  const handleSelectProject = async (proj) => {
    setSelectedProject(proj); setFiles([]); setFileContent(''); setCurrentFile('');
    setStatus('LOCATING CONFIG FILES...'); setIsLoading(true);
    const res = await fetch('http://localhost:3001/api/project-files', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectPath: proj.path, portOrName: proj.name })
    });
    const data = await res.json();
    if (data.success) { setFiles(data.files); setStatus(''); }
    setIsLoading(false);
  };

  const openFile = async (file) => {
    setStatus('READING FILE...'); setIsLoading(true);
    const res = await fetch('http://localhost:3001/api/read-file', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: file.path })
    });
    const data = await res.json();
    if (data.data !== undefined) {
      setFileContent(data.data); setCurrentFile(file.path); setStatus('');
    } else setStatus('FAILED: ' + data.error);
    setIsLoading(false);
  };

  const saveFile = async () => {
    setIsSaving(true); setStatus('SAVING TO SERVER...');
    const res = await fetch('http://localhost:3001/api/write-file', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: currentFile, content: fileContent })
    });
    const data = await res.json();
    if (data.success) { setStatus('SAVED!'); setTimeout(() => setStatus(''), 2000); }
    else setStatus('FAILED: ' + data.error);
    setIsSaving(false);
  };

  if (step === 0) return (
    <div className="flex h-screen w-full items-center justify-center bg-slate-900 text-slate-300">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        <p>Loading secure session...</p>
      </div>
    </div>
  );

  if (step === 1) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-slate-900 font-sans">
        <div className="w-full max-w-md bg-slate-800 rounded-2xl shadow-2xl p-8 border border-slate-700">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
              <Terminal className="w-6 h-6 text-green-400" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white">Neo-Panel</h2>
              <p className="text-slate-400 text-sm">Manage your PM2 workspace</p>
            </div>
          </div>
          
          <form onSubmit={handleLogin} className="flex flex-col gap-5">
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 block">IP Address</label>
                <input className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none transition" value={creds.host} onChange={e => setCreds({...creds, host: e.target.value})} required />
              </div>
              <div className="w-24">
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 block">Port</label>
                <input className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none transition" value={creds.port} onChange={e => setCreds({...creds, port: e.target.value})} required />
              </div>
            </div>
            
            <div>
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 block">Username</label>
              <input className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none transition" value={creds.username} onChange={e => setCreds({...creds, username: e.target.value})} required />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 block">Password</label>
              <input type="password" className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none transition" value={creds.password} onChange={e => setCreds({...creds, password: e.target.value})} required />
            </div>
            
            <label className="flex items-center gap-3 cursor-pointer mt-2 group">
              <input type="checkbox" className="w-5 h-5 rounded border-slate-600 bg-slate-900 text-blue-500 focus:ring-blue-500/50" checked={rememberMe} onChange={e => setRememberMe(e.target.checked)} />
              <span className="text-sm text-slate-300 group-hover:text-white transition">Save Credentials</span>
            </label>
            
            <button type="submit" disabled={isLoading} className="mt-4 bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 px-4 rounded-lg flex items-center justify-center gap-2 transition disabled:opacity-50">
              {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ShieldCheck className="w-5 h-5" />}
              {isLoading ? 'Connecting...' : 'Connect SSH'}
            </button>
          </form>
          {status && <div className="mt-6 p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-sm flex items-center gap-2"><AlertCircle className="w-4 h-4"/>{status}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full bg-black font-mono text-green-500 overflow-hidden">
      {/* SIDEBAR */}
      <div className="w-80 bg-black border-r border-green-900/30 flex flex-col">
        <div className="p-4 border-b border-green-900/30 flex justify-between items-center">
          <div>
            <h3 className="font-bold tracking-wide">root@{creds.host}:~#</h3>
          </div>
          <button onClick={handleLogout} className="text-red-600 hover:text-red-400 font-bold" title="Logout">[EXIT]</button>
        </div>

        <div className="px-4 pt-4 pb-2 flex items-center justify-between">
          <h4 className="text-xs font-bold text-green-600 uppercase">
            --- PM2 PROCESSES ---
          </h4>
          <button onClick={scanProjects} className="text-green-700 hover:text-green-400">
            [RELOAD]
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-4 custom-scrollbar">
          <div className="flex flex-col mt-2">
            {projects.length === 0 && !isLoading && <div className="text-sm text-green-800">No apps running in PM2</div>}
            {projects.map(p => (
              <div 
                key={p.name} onClick={() => handleSelectProject(p)}
                className={`cursor-pointer px-2 py-1 transition-colors ${selectedProject?.name === p.name ? 'text-green-400 bg-green-900/30' : 'text-green-700 hover:text-green-500 hover:bg-green-900/10'}`}
              >
                <div className="flex items-center">
                  <span className="w-6">{selectedProject?.name === p.name ? '*' : ' '}</span>
                  <strong className="font-normal text-sm">{p.name}</strong>
                  {p.status !== 'online' && <span className="ml-auto text-xs text-red-500">[{p.status}]</span>}
                </div>
              </div>
            ))}
          </div>

          {selectedProject && (
            <div className="mt-6">
              <h4 className="text-xs font-bold text-yellow-600 uppercase mb-2">
                --- CONFIG.SYS ---
              </h4>
              <div className="flex flex-col">
                {isLoading && !currentFile && <div className="text-sm text-yellow-800">SCANNING...</div>}
                {files.map(f => (
                  <div 
                    key={f.path} onClick={() => openFile(f)}
                    className={`cursor-pointer px-2 py-1 transition-colors ${currentFile === f.path ? 'text-yellow-400 bg-yellow-900/30' : 'text-yellow-700 hover:text-yellow-500 hover:bg-yellow-900/10'}`}
                  >
                    <div className="flex items-center">
                      <span className="w-6">{currentFile === f.path ? '*' : ' '}</span>
                      <span className="text-sm">{f.name}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* EDITOR AREA */}
      <div className="flex-1 flex flex-col bg-black">
        {/* Header */}
        <div className="h-10 border-b border-green-900/30 flex items-center justify-between px-4 text-green-600">
          <div className="flex items-center gap-2 text-sm">
            {currentFile ? (
              <span>$ nano {currentFile}</span>
            ) : (
              <span>$ _</span>
            )}
          </div>
          
          <div className="flex items-center gap-4">
            {status && <span className="text-sm animate-pulse text-yellow-500">{status}</span>}
            <button 
              onClick={saveFile} 
              disabled={!currentFile || isSaving}
              className="text-green-600 hover:text-green-400 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
            >
              {isSaving ? '[SAVING...]' : '[SAVE]'}
            </button>
          </div>
        </div>

        {/* Editor Content */}
        <div className="flex-1 flex flex-col p-0 relative overflow-hidden bg-black">
          <style>{`
            .editor-textarea::selection { background: rgba(255, 255, 255, 0.2); color: transparent; }
          `}</style>
          
          {/* Top Half: Editor */}
          <div className="flex-1 relative overflow-hidden">
            {currentFile ? (
              <div className="w-full h-full overflow-auto custom-scrollbar relative">
                <div className="relative min-w-full inline-block min-h-full">
                  <pre 
                    className="p-4 m-0 bg-transparent font-mono text-sm pointer-events-none whitespace-pre"
                    style={{ lineHeight: '1.5', minHeight: '100%' }}
                  >
                    {fileContent.split('\n').map((line, i, arr) => (
                      <span key={i} className={line.trim().startsWith('#') ? 'text-blue-400' : 'text-white'}>
                        {line}{i === arr.length - 1 ? '' : '\n'}
                      </span>
                    ))}
                    {fileContent.endsWith('\n') ? ' ' : ''}
                  </pre>
                  <textarea 
                    value={fileContent} 
                    onChange={e => setFileContent(e.target.value)}
                    spellCheck="false"
                    className="editor-textarea absolute top-0 left-0 w-full h-full bg-transparent border-none text-transparent caret-white font-mono text-sm focus:outline-none resize-none overflow-hidden m-0 p-4 whitespace-pre"
                    style={{ lineHeight: '1.5' }}
                  />
                </div>
              </div>
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-green-900">
                <pre className="text-xs">
{`
    _   _ _____ ___      ____   _    _   _ _____ _     
   | \\ | | ____/ _ \\    |  _ \\ / \\  | \\ | | ____| |    
   |  \\| |  _|| | | |   | |_) / _ \\ |  \\| |  _| | |    
   | |\\  | |__| |_| |   |  __/ ___ \\| |\\  | |___| |___ 
   |_| \\_|_____\\___/    |_| /_/   \\_\\_| \\_|_____|_____|

`}
                </pre>
                <p className="mt-4 text-sm animate-pulse">Awaiting command...</p>
              </div>
            )}
          </div>

          {/* Bottom Half: Terminal */}
          <div className="h-64 border-t border-green-900/30">
            <TerminalPane />
          </div>

        </div>
      </div>
    </div>
  );
}

export default App;
