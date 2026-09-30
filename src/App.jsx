import React, { useState, useEffect, useRef } from 'react';
import { Terminal, Server, FileCode, Play, LogOut, Loader2, CheckCircle2, AlertCircle, Folder, Settings, ShieldCheck, RefreshCw, FileText, Globe, Activity, Cpu, MemoryStick, Clock } from 'lucide-react';
import './index.css';
import TerminalPane from './TerminalPane';
import { invoke } from '@tauri-apps/api/core';

import { api } from './api';

function App() {
  const [step, setStep] = useState(0); 
  const [creds, setCreds] = useState({ host: '', port: '22', username: 'root', password: '' });
  const [rememberMe, setRememberMe] = useState(false);
  const [status, setStatus] = useState('');
  
  const [projects, setProjects] = useState([]);
  const [wwwProjects, setWwwProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [files, setFiles] = useState([]);
  
  const [fileContent, setFileContent] = useState('');
  const [currentFile, setCurrentFile] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isTerminalOpen, setIsTerminalOpen] = useState(false);
  const [deployTarget, setDeployTarget] = useState(null);
  const [deploySteps, setDeploySteps] = useState([]);
  const [logData, setLogData] = useState(null);
  const [showNginxRouter, setShowNginxRouter] = useState(false);
  const [nginxDomain, setNginxDomain] = useState('');
  const [nginxPort, setNginxPort] = useState('');
  const [nginxResult, setNginxResult] = useState('');
  const [sysInfo, setSysInfo] = useState({ ramPercent: 0, ramText: '0G / 0G', cpuLoad: '0.00', cpuCores: '0', cpuUsg: '0', uptime: 'N/A' });
  const [theme, setTheme] = useState('default');
  const [showThemeMenu, setShowThemeMenu] = useState(false);
  const themeMenuRef = useRef(null);
  useEffect(() => {
    function handleClickOutside(event) {
      if (themeMenuRef.current && !themeMenuRef.current.contains(event.target)) {
        setShowThemeMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
  
  return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);
  useEffect(() => { document.documentElement.setAttribute('data-theme', theme); }, [theme]);

  useEffect(() => {
    let interval;
    if (step === 2) {
      // Fetch after a short delay to avoid colliding with initial scanProjects
      setTimeout(fetchSysInfo, 3000);
      // Poll every 30 seconds to prevent SSH connection flooding (os error 10053)
      interval = setInterval(fetchSysInfo, 30000);
    }
    return () => clearInterval(interval);
  }, [step]);

  const fetchSysInfo = async () => {
    try {
      const info = await invoke('ssh_get_sysinfo');
      setSysInfo(info);
    } catch (e) {
      console.error("Failed to fetch sysinfo", e);
    }
  };



  const handleCloseCurrentView = () => {
    setCurrentFile('');
    setFileContent('');
    setShowNginxRouter(false);
    setLogData(null);
    setDeployTarget(null);
  };

  const handleViewLogs = async (appName) => {
    try {
      setStatus('FETCHING LOGS...');
      handleCloseCurrentView();
      setIsTerminalOpen(false);
      
      const logs = await invoke('ssh_get_pm2_logs', { name: appName });
      setLogData({ name: appName, logs });
      setStatus('');
    } catch (err) {
      console.error(err);
      setStatus(`LOGS FAILED: ${err}`);
    }
  };

  const handleAnalyzeDeploy = async (project) => {
    try {
      setStatus('ANALYZING PROJECT...');
      handleCloseCurrentView();
      setIsTerminalOpen(false);

      const result = await invoke('ssh_analyze_project', { path: project.path });
      
      let steps = [];
      steps.push({ id: 'cd', name: 'Navigate to Directory', cmd: `cd ${project.path}`, checked: true, readonly: true });
      
      if (result.isGit) {
        steps.push({ id: 'git', name: 'Pull Latest Source (Git)', cmd: 'git pull origin main', checked: true });
      } else {
        steps.push({ id: 'git_init', name: 'Git is not initialized', cmd: 'git init', checked: false });
      }
      
      if (result.hasNpm) {
        if (result.buildDir && result.buildDir !== '.') {
          steps.push({ id: 'cd_frontend', name: `Navigate to Subdirectory (${result.buildDir})`, cmd: `cd ${result.buildDir}`, checked: true, readonly: true });
        }

        steps.push({ id: 'npm', name: 'Install Dependencies', cmd: 'npm install', checked: false });
        
        // --- MULTI-BUILD DETECTION (FIXED VALUES) ---
        const buildScripts = (result.packageScripts || []).filter(s => s.toLowerCase().includes('build'));

        if (result.envBuildCmd) {
          steps.push({ id: 'build_env', name: 'Build Project (.env Override)', cmd: result.envBuildCmd, checked: true });
        } else if (buildScripts.length > 0) {
          // Generate a separate checkbox for EACH build script (Dual Build support)
          buildScripts.forEach((scriptName, index) => {
            steps.push({ 
              id: `build_${scriptName}`, 
              name: `Build Project (${scriptName})`, 
              cmd: `npm run ${scriptName}`, 
              checked: index === 0 // Default check the first one
            });
          });
        } else if (result.isVite) {
          steps.push({ id: 'build_vite', name: 'Build Project (Vite Native)', cmd: 'vite build', checked: true });
        } else {
          steps.push({ id: 'build_fallback', name: 'Build Project (Default)', cmd: 'npm run build', checked: true });
        }

        if (result.buildDir && result.buildDir !== '.') {
          steps.push({ id: 'cd_root', name: 'Return to Project Root', cmd: `cd ${project.path}`, checked: true, readonly: true });
        }
      }
      
      if (result.hasPm2) {
        steps.push({ id: 'pm2', name: 'Restart PM2 Process', cmd: `pm2 restart all`, checked: true });
      } else {
        steps.push({ id: 'pm2_start', name: 'Start PM2 Process', cmd: `pm2 start npm --name "${project.name}" -- start`, checked: false });
      }

      setDeploySteps(steps);
      setDeployTarget(project);
      setStatus('');
    } catch (err) {
      console.error(err);
      setStatus(`ANALYZE FAILED: ${err}`);
    }
  };

  const executeDeploy = () => {
    const selectedCommands = deploySteps.filter(s => s.checked || s.readonly).map(s => s.cmd);
    if (selectedCommands.length === 0) return;
    
    // Join commands with &&
    const fullCommand = selectedCommands.join(' && ');
    
    setIsTerminalOpen(true);
    setDeployTarget(null); // Close the deploy planner
    
    // Wait for terminal to be visible and ready, then execute
    setTimeout(() => {
      invoke('write_terminal', { data: fullCommand + '\r\n' });
    }, 500);
  };

  const handleApplyNginx = async () => {
    if (!nginxDomain || !nginxPort) return;
    setStatus('CONFIGURING NGINX...');
    setNginxResult('');
    try {
      const result = await invoke('ssh_add_nginx_domain', { 
        domain: nginxDomain, 
        port: nginxPort 
      });
      setNginxResult(result);
      setStatus('');
    } catch (err) {
      console.error(err);
      setNginxResult(`ERROR:\n${err}`);
      setStatus('NGINX FAILED');
    }
  };

  useEffect(() => { checkConnection(); }, []);

  const checkConnection = async () => {
    try {
      const data = await api.checkStatus();
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
      const data = await api.login(credentials);
      if (data.success) { setStep(2); scanProjects(); } 
      else { setStatus('Auto-login gagal: ' + data.error); setStep(1); }
    } catch (err) { setStatus('Error koneksi: ' + err.message); setStep(1); }
    setIsLoading(false);
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setIsLoading(true); setStatus('Menghubungkan via SSH...');
    try {
      const data = await api.login(creds);
      if (data.success) {
        if (rememberMe) localStorage.setItem('neo_vps_creds', JSON.stringify(creds));
        else localStorage.removeItem('neo_vps_creds');
        setStep(2); scanProjects(); setStatus('');
      } else setStatus('Gagal: ' + data.error);
    } catch (err) { setStatus('Error koneksi lokal: ' + err.message); }
    setIsLoading(false);
  };

  const handleLogout = async () => {
    await api.logout();
    localStorage.removeItem('neo_vps_creds');
    setCreds({ host: '', port: '22', username: 'root', password: '' });
    setRememberMe(false); setStep(1); setProjects([]); setWwwProjects([]); setFiles([]);
    setCurrentFile(''); setFileContent(''); setStatus('');
  };

  const scanProjects = async () => {
    setStatus('DETECTING PROCESSES & DIRS...'); setIsLoading(true);
    const data = await api.scan();
    if (data.success) {
      const uniqueProjects = data.projects.reduce((acc, curr) => {
        if (!acc.find(p => p.name === curr.name)) {
          acc.push(curr);
        }
        return acc;
      }, []);
      setProjects(uniqueProjects);
      if (data.wwwDirs) {
        setWwwProjects(data.wwwDirs);
      }
      setStatus('');
    }
    setIsLoading(false);
  };

  const handleSelectProject = async (proj) => {
    setSelectedProject(proj); setFiles([]); setFileContent(''); setCurrentFile('');
    setStatus('LOCATING CONFIG FILES...'); setIsLoading(true);
    const data = await api.getProjectFiles(proj);
    if (data.success) { setFiles(data.files); setStatus(''); }
    setIsLoading(false);
  };

  const openFile = async (file) => {
    handleCloseCurrentView();
    setIsTerminalOpen(false);
    setStatus('READING FILE...'); setIsLoading(true);
    const data = await api.readFile(file.path);
    if (data.data !== undefined) {
      setFileContent(data.data); setCurrentFile(file.path); setStatus('');
    } else setStatus('FAILED: ' + data.error);
    setIsLoading(false);
  };

  const saveFile = async () => {
    setIsSaving(true); setStatus('SAVING TO SERVER...');
    const data = await api.saveFile(currentFile, fileContent);
    if (data.success) { setStatus('SAVED!'); setTimeout(() => setStatus(''), 2000); }
    else setStatus('FAILED: ' + data.error);
    setIsSaving(false);
  };

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ctrl + J to toggle terminal
      if (e.ctrlKey && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setIsTerminalOpen(prev => !prev);
      }
      // Escape to close terminal, deployment playbook, nano, nginx, logs
      if (e.key === 'Escape') {
        setIsTerminalOpen(false);
        setCurrentFile('');
        setFileContent('');
        setShowNginxRouter(false);
        setLogData(null);
        setDeployTarget(null);
      }
      // Ctrl + S to save file
      if (e.ctrlKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (currentFile) {
          saveFile();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [currentFile, fileContent]);

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


  const renderProjectConfig = (p) => {
    if (selectedProject?.name !== p.name) return null;
    return (
      <div className="pl-2 py-1 border-l border-amber-800/60 ml-4 mt-0.5 mb-2 flex flex-col gap-0.5">
        {isLoading && !currentFile && <div className="text-xs opacity-50 pl-2 text-amber-500">Scanning...</div>}
        {files.map(f => (
          <div 
            key={f.path} onClick={(e) => { e.stopPropagation(); openFile(f); }}
            className={`cursor-pointer px-2 py-1.5 text-xs transition-colors flex items-center gap-2 rounded-r ${currentFile === f.path ? 'text-amber-300 bg-amber-900/40 font-bold' : 'text-amber-500 hover:text-amber-300 hover:bg-amber-900/20'}`}
          >
            <FileCode className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{f.name}</span>
          </div>
        ))}
        
        <div 
          onClick={(e) => {
            e.stopPropagation();
            setShowNginxRouter(true);
            setLogData(null);
            setDeployTarget(null);
            setCurrentFile('');
            setIsTerminalOpen(false);
          }}
          className={`cursor-pointer px-2 py-1.5 text-xs transition-colors flex items-center gap-2 rounded-r mt-0.5 ${showNginxRouter ? 'text-amber-300 bg-amber-900/40 font-bold' : 'text-amber-500 hover:text-amber-300 hover:bg-amber-900/20'}`}
        >
          <Globe className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">Nginx Router</span>
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-screen w-full bg-black font-mono text-slate-300 overflow-hidden">
        {/* SIDEBAR */}
        <div className="w-80 bg-slate-900 border-r border-green-900/30 flex flex-col shrink-0 h-full">
        <div className="h-10 px-4 border-b border-green-900/30 flex justify-between items-center">
          <div className="flex items-center text-green-400">
            <h3 className="font-bold tracking-widest text-lg leading-none pt-0.5">
              NeoPanel
            </h3>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={handleLogout} className="text-red-600 hover:text-red-400 font-bold text-sm leading-none pt-0.5" title="Logout">
              [EXIT]
            </button>
          </div>
        </div>

        <div className="px-4 py-3 flex items-center justify-between border-b border-green-900/30">
          <span className="font-bold tracking-wide text-sm truncate mr-2" title={`root@${creds.host}:~#`}>
            root@{creds.host}:~#
          </span>
          <button onClick={scanProjects} className="text-green-700 hover:text-green-400 font-bold shrink-0 text-sm">
            [RELOAD]
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-4 custom-scrollbar">
          <div className="pt-4 pb-2">
            <h4 className="text-xs font-bold text-green-600 uppercase">
              --- PM2 PROCESSES ---
            </h4>
          </div>
          <div className="flex flex-col mt-2">
            {projects.length === 0 && !isLoading && <div className="text-sm text-green-800">No apps running in PM2</div>}
            {projects.map(p => (
              <div key={p.name}>
                <div 
                  onClick={() => handleSelectProject(p)}
                  className={`cursor-pointer px-2 py-1 transition-colors ${selectedProject?.name === p.name ? 'text-green-400 bg-green-900/30' : 'text-green-700 hover:text-green-500 hover:bg-green-900/10'}`}
                >
                  <div className="flex items-center group">
                    <span className="w-6">{selectedProject?.name === p.name ? '*' : ' '}</span>
                    <strong className="font-normal text-sm flex-1">{p.name}</strong>
                    {p.status !== 'online' && <span className="ml-auto text-xs text-red-500 mr-2">[{p.status}]</span>}
                    
                    <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <FileText 
                        className="w-3.5 h-3.5 text-yellow-500 hover:text-yellow-300"
                        onClick={(e) => { e.stopPropagation(); handleViewLogs(p.name); }}
                        title="Log Sentinel"
                      />
                    </div>
                  </div>
                </div>
                {renderProjectConfig(p)}
              </div>
            ))}
          </div>

          <div className="pt-6 pb-2">
            <h4 className="text-xs font-bold text-green-600 uppercase">
              --- WWW DIRECTORY ---
            </h4>
          </div>
          <div className="flex flex-col mt-2">
            {wwwProjects.length === 0 && !isLoading && <div className="text-sm text-green-800">No directories found</div>}
            {wwwProjects.map(p => (
              <div key={p.path}>
                <div 
                  onClick={() => handleSelectProject(p)}
                  className={`cursor-pointer px-2 py-1 transition-colors ${selectedProject?.name === p.name ? 'text-green-400 bg-green-900/30' : 'text-green-700 hover:text-green-500 hover:bg-green-900/10'}`}
                >
                  <div className="flex items-center group">
                    <span className="w-6">{selectedProject?.name === p.name ? '*' : ' '}</span>
                    <strong className="font-normal text-sm flex-1">/{p.name}</strong>
                    <Terminal 
                      className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 text-green-500 hover:text-green-300 transition-opacity" 
                      onClick={(e) => { e.stopPropagation(); handleAnalyzeDeploy(p); }} 
                      title="Deployment Playbook"
                    />
                  </div>
                </div>
                {renderProjectConfig(p)}
              </div>
            ))}
          </div>

          
        </div>
      </div>

      {/* RIGHT PANEL (Editor + Footer) */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      
        {/* EDITOR AREA */}
        <div className="flex-1 flex flex-col bg-black min-w-0 overflow-hidden">
        {/* Header */}
        <div className="h-10 border-b border-green-900/30 flex items-center justify-between px-4 text-green-600 shrink-0">
          <div className="flex items-center gap-2 text-sm shrink-0">
            {isTerminalOpen ? (
              <span>$ terminal</span>
            ) : currentFile ? (
              <span>$ nano {currentFile}</span>
            ) : showNginxRouter ? (
              <span>$ nginx-router</span>
            ) : logData ? (
              <span>$ pm2 logs {logData.name}</span>
            ) : deployTarget ? (
              <span>$ deploy-playbook {deployTarget.name}</span>
            ) : (
              <span>$ _</span>
            )}
          </div>
          
          <div className="flex items-center gap-4">
            {status && <span className="text-sm animate-pulse text-yellow-500">{status}</span>}
            
            {isTerminalOpen && (
              <button 
                onClick={() => setIsTerminalOpen(false)}
                className="text-red-500 hover:text-red-400 text-sm font-bold"
                title="Close Terminal"
              >
                [CLOSE TERMINAL]
              </button>
            )}

            {(currentFile || showNginxRouter || logData || deployTarget) && !isTerminalOpen && (
              <button 
                onClick={handleCloseCurrentView}
                className="text-yellow-600 hover:text-yellow-400 text-sm font-bold"
                title="Close Current View"
              >
                [CLOSE]
              </button>
            )}
            
            {currentFile && !isTerminalOpen && (
              <button 
                onClick={saveFile} 
                disabled={isSaving}
                className="text-green-600 hover:text-green-400 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-bold"
              >
                {isSaving ? '[SAVING...]' : '[SAVE]'}
              </button>
            )}
          </div>
        </div>

        {/* Editor Content */}
        {/* Main Content Area */}
        <div className="flex-1 flex flex-col p-0 relative overflow-hidden bg-black">
          <style>{`
            .editor-textarea::selection { background: rgba(255, 255, 255, 0.2); color: transparent; }
          `}</style>
          
          {/* Editor View */}
          <div className={`${!isTerminalOpen ? 'flex-1 flex flex-col relative' : 'absolute inset-0 opacity-0 pointer-events-none z-[-1]'} overflow-hidden`}>
            {showNginxRouter ? (
              <div className="w-full h-full flex flex-col p-6 bg-black text-green-500 overflow-y-auto custom-scrollbar relative">
                <div className="flex items-center justify-between border-b border-green-900 pb-2 mb-6">
                  <h2 className="text-xl font-bold uppercase text-green-400 flex items-center gap-2">
                    <Globe className="w-6 h-6" />
                    NGINX VISUAL ROUTER
                  </h2>
                </div>
                
                <div className="max-w-xl w-full">
                  <p className="text-green-700 text-sm mb-8 font-mono">
                    Automatically generate server blocks, map domains to internal ports, and reload Nginx.
                    Compatible with both Debian/Ubuntu and RHEL architectures.
                  </p>

                  <div className="flex flex-col gap-6 font-mono">
                    <div className="flex flex-col gap-2">
                      <label className="text-sm font-bold text-green-600">DOMAIN NAME</label>
                      <input 
                        type="text" 
                        value={nginxDomain}
                        onChange={e => setNginxDomain(e.target.value)}
                        placeholder="e.g., api.example.com"
                        className="bg-black border border-green-900 p-2 text-green-400 focus:outline-none focus:border-green-500 placeholder-green-900/50"
                        spellCheck="false"
                      />
                    </div>
                    
                    <div className="flex flex-col gap-2">
                      <label className="text-sm font-bold text-green-600">TARGET PORT (Localhost)</label>
                      <input 
                        type="text" 
                        value={nginxPort}
                        onChange={e => setNginxPort(e.target.value.replace(/\D/g, ''))}
                        placeholder="e.g., 3000"
                        className="bg-black border border-green-900 p-2 text-green-400 focus:outline-none focus:border-green-500 placeholder-green-900/50"
                      />
                    </div>

                    <button 
                      onClick={handleApplyNginx}
                      disabled={!nginxDomain || !nginxPort || status !== ''}
                      className="border border-green-700 text-green-500 p-3 mt-4 hover:bg-green-900/30 transition-colors font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      [APPLY NGINX CONFIGURATION]
                    </button>

                    {nginxResult && (
                      <div className={`mt-4 p-4 border ${nginxResult.startsWith('ERROR') ? 'border-red-900 text-red-500 bg-red-900/10' : 'border-green-900 text-green-400 bg-green-900/10'} text-xs whitespace-pre-wrap`}>
                        {nginxResult}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : logData ? (
              <div className="w-full h-full flex flex-col p-6 bg-black text-gray-300 overflow-y-auto custom-scrollbar relative">
                <div className="flex items-center justify-between border-b border-green-900 pb-2 mb-4">
                  <h2 className="text-xl font-bold uppercase text-yellow-500 flex items-center gap-2">
                    <FileText className="w-5 h-5" />
                    LOG SENTINEL: {logData.name}
                  </h2>
                  <div className="flex gap-4">
                    <button 
                      onClick={() => handleViewLogs(logData.name)}
                      className="text-green-500 hover:text-green-300 font-bold"
                    >
                      [REFRESH]
                    </button>
                  </div>
                </div>
                <div className="font-mono text-xs whitespace-pre">
                  {logData.logs.split('\n').map((line, idx) => {
                    const isError = line.toLowerCase().includes('error') || line.toLowerCase().includes('exception') || line.toLowerCase().includes('fail');
                    return (
                      <div key={idx} className={`${isError ? 'text-red-500 font-bold bg-red-900/20' : 'text-green-600'} hover:bg-green-900/10 px-1 rounded`}>
                        {line}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : deployTarget ? (
              <div className="w-full h-full flex flex-col p-6 bg-black text-green-500 overflow-y-auto custom-scrollbar relative">
                <h2 className="text-xl font-bold mb-2 uppercase text-green-400">
                  --- DEPLOYMENT PLAYBOOK ---
                </h2>
                <div className="text-sm text-green-700 mb-6 font-mono">
                  Target: {deployTarget.path}
                </div>
                
                <div className="flex flex-col gap-4 flex-1 max-w-2xl">
                  {deploySteps.map((step, idx) => (
                    <div 
                      key={step.id} 
                      className={`flex flex-col p-3 border ${step.checked || step.readonly ? 'border-green-500/50 bg-green-900/10' : 'border-green-900/30 opacity-50'} rounded`}
                    >
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input 
                          type={step.id.startsWith('build_') ? "radio" : "checkbox"} 
                          name={step.id.startsWith('build_') ? "build_group" : undefined}
                          className="accent-green-500 w-4 h-4 cursor-pointer"
                          checked={step.checked || step.readonly}
                          disabled={step.readonly}
                          onChange={(e) => {
                            const isChecked = e.target.checked;
                            const newSteps = deploySteps.map(s => ({ ...s }));
                            
                            if (step.id.startsWith('build_')) {
                              newSteps.forEach(s => {
                                if (s.id.startsWith('build_')) {
                                  s.checked = (s.id === step.id);
                                }
                              });
                            } else {
                              newSteps[idx].checked = isChecked;
                            }
                            
                            setDeploySteps(newSteps);
                          }}
                        />
                        <div className="flex flex-col flex-1">
                          <span className="font-bold text-sm text-green-400">{step.name}</span>
                          <span className="text-xs text-green-700 font-mono mt-1">{step.cmd}</span>
                        </div>
                      </label>
                    </div>
                  ))}
                  
                  <div className="mt-8 flex items-center gap-4">
                    <button 
                      onClick={executeDeploy}
                      className="px-6 py-2 bg-green-900/50 text-green-400 font-bold border border-green-500 hover:bg-green-500 hover:text-black transition-colors rounded uppercase flex items-center gap-2"
                    >
                      <Play className="w-4 h-4" />
                      EXECUTE DEPLOYMENT
                    </button>
                    <button 
                      onClick={() => setDeployTarget(null)}
                      className="px-6 py-2 bg-transparent text-green-700 font-bold hover:text-green-500 transition-colors uppercase"
                    >
                      CANCEL
                    </button>
                  </div>
                </div>
              </div>
            ) : currentFile ? (
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
              <div className="w-full h-full flex flex-col items-center justify-center text-green-500">
                <pre className="text-xs font-bold -mt-16">
{`
    _   _ _____ ___      ____   _    _   _ _____ _     
   | \\ | | ____/ _ \\    |  _ \\ / \\  | \\ | | ____| |    
   |  \\| |  _|| | | |   | |_) / _ \\ |  \\| |  _| | |    
   | |\\  | |__| |_| |   |  __/ ___ \\| |\\  | |___| |___ 
   |_| \\_|_____\\___/    |_| /_/   \\_\\_| \\_|_____|_____|

`}
                </pre>
                <div className="mt-8 text-sm text-green-600 animate-pulse font-mono flex items-center gap-2">
                  <span>&gt;</span>
                  <span>Select a project from the left panel or open [TERMINAL]</span>
                </div>
              </div>
            )}
          </div>

          {/* Terminal View */}
          <div className={`${isTerminalOpen ? 'flex-1 relative' : 'absolute inset-0 opacity-0 pointer-events-none z-[-1]'} w-full h-full min-w-0 min-h-0 overflow-hidden`}>
            <TerminalPane theme={theme} />
          </div>

        </div>
      </div>
      
      {/* STATUS FOOTER */}
      <div className="h-6 bg-slate-950 border-t border-slate-800 flex items-center justify-between px-4 text-[10px] text-slate-500 shrink-0 font-bold select-none z-50 whitespace-nowrap">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-1.5" title="CPU Usage">
            <Cpu className="w-3 h-3" />
            <span>CPU: {sysInfo.cpuUsg}% ({sysInfo.cpuCores}C)</span>
          </div>
          <div className="flex items-center gap-1.5" title="CPU Load (1m)">
            <Activity className="w-3 h-3" />
            <span>LOAD: {sysInfo.cpuLoad}</span>
          </div>
          <div className="flex items-center gap-1.5" title="RAM Usage">
            <MemoryStick className="w-3 h-3" />
            <span>RAM: {sysInfo.ramText} ({sysInfo.ramPercent}%)</span>
          </div>
          <div className="flex items-center gap-1.5" title="System Uptime">
            <Clock className="w-3 h-3" />
            <span>UPTIME: {sysInfo.uptime.replace(/ weeks?, /g, "w ").replace(/ days?, /g, "d ").replace(/ hours?, /g, "h ").replace(/ minutes?/g, "m")}</span>
          </div>
        </div>
        
        <div className="flex items-center gap-6">
                    <div className="flex items-center gap-4 relative" ref={themeMenuRef}>
            <div 
              className="flex items-center gap-1.5 text-slate-500 hover:text-slate-300 cursor-pointer" 
              onClick={() => setShowThemeMenu(!showThemeMenu)}
              title="Theme Settings"
            >
              <span>[THEME]</span>
            </div>
            {showThemeMenu && (
              <div className="absolute bottom-8 right-16 bg-slate-900 border border-slate-700 rounded-md shadow-xl py-2 flex flex-col z-50 text-slate-300 w-44">
                <div className="px-4 py-2 hover:bg-slate-800 cursor-pointer text-green-400" onClick={() => {setTheme('default'); setShowThemeMenu(false)}}>Default (Neo)</div>
                <div className="px-4 py-2 hover:bg-slate-800 cursor-pointer text-[#b5d59c]" onClick={() => {setTheme('retro'); setShowThemeMenu(false)}}>Retro Green</div>
                <div className="px-4 py-2 hover:bg-slate-800 cursor-pointer text-[#0ea5e9]" onClick={() => {setTheme('blue'); setShowThemeMenu(false)}}>Ocean Blue</div>
                <div className="px-4 py-2 hover:bg-slate-800 cursor-pointer text-slate-900 bg-slate-200" onClick={() => {setTheme('light'); setShowThemeMenu(false)}}>Light Mode</div>
                <div className="px-4 py-2 hover:bg-slate-800 cursor-pointer text-[#bd93f9]" onClick={() => {setTheme('dracula'); setShowThemeMenu(false)}}>Dracula</div>
                <div className="px-4 py-2 hover:bg-slate-800 cursor-pointer text-[#00ff00]" onClick={() => {setTheme('matrix'); setShowThemeMenu(false)}}>Matrix Hacker</div>
              </div>
            )}
            <div className="flex items-center gap-1.5 text-green-800">
              <Server className="w-3 h-3" />
              <span>{creds.host}</span>
            </div>
          </div>
          <div 
            className={`flex items-center gap-1.5 transition-colors ${isTerminalOpen ? 'text-green-900 cursor-not-allowed' : 'text-green-500 hover:text-green-400 cursor-pointer'}`}
            onClick={() => {
              if (!isTerminalOpen) setIsTerminalOpen(true);
            }}
            title={isTerminalOpen ? "Terminal is open" : "Open Terminal"}
          >
            <Terminal className="w-3 h-3" />
            <span>[TERMINAL]</span>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}

export default App;








