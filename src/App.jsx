import React, { useState } from 'react';
import { Terminal, Server, FileCode, Play } from 'lucide-react';
import './index.css';

function App() {
  const [output, setOutput] = useState('');
  const [command, setCommand] = useState('pm2 jlist');

  const runCommand = async () => {
    setOutput('Loading...');
    try {
      const res = await fetch('http://localhost:3001/api/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command })
      });
      const data = await res.json();
      if (data.error) setOutput('ERROR:\n' + data.error);
      else setOutput(data.stdout || data.stderr);
    } catch (e) {
      setOutput('Failed to connect to local backend: ' + e.message);
    }
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>?? Neo-Panel VPS Manager</h1>
      <p>Local Web App to securely manage your VPS via SSH2</p>
      
      <div style={{ marginTop: '20px', display: 'flex', gap: '10px' }}>
        <input 
          value={command} 
          onChange={(e) => setCommand(e.target.value)} 
          style={{ width: '400px', padding: '8px' }} 
        />
        <button onClick={runCommand} style={{ padding: '8px 16px', background: '#3b82f6', color: 'white', border: 'none' }}>
          Run SSH Command
        </button>
      </div>

      <pre style={{ background: '#1e1e1e', color: '#00ff00', padding: '20px', marginTop: '20px', minHeight: '300px', overflowX: 'auto' }}>
        {output || 'Output will appear here...'}
      </pre>
    </div>
  );
}

export default App;
