import express from 'express';
import cors from 'cors';
import { Client } from 'ssh2';
import http from 'http';
import { Server } from 'socket.io';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

let globalSshConfig = null;

const execSSH = (command) => {
  return new Promise((resolve, reject) => {
    if (!globalSshConfig) return reject(new Error('Not connected. Login first.'));
    const conn = new Client();
    conn.on('ready', () => {
      conn.exec(command, (err, stream) => {
        if (err) { conn.end(); return reject(err); }
        let stdout = ''; let stderr = '';
        stream.on('close', (code, signal) => {
          conn.end(); resolve({ stdout, stderr, code });
        }).on('data', (data) => stdout += data.toString())
          .stderr.on('data', (data) => stderr += data.toString());
      });
    }).on('error', (err) => reject(err)).connect(globalSshConfig);
  });
};

app.get('/api/status', (req, res) => {
  if (globalSshConfig) {
    res.json({ connected: true, host: globalSshConfig.host });
  } else {
    res.json({ connected: false });
  }
});

app.post('/api/logout', (req, res) => {
  globalSshConfig = null;
  res.json({ success: true });
});

app.post('/api/connect', async (req, res) => {
  const { host, port, username, password } = req.body;
  try {
    const config = { host, port: parseInt(port || '22'), username, password, readyTimeout: 10000 };
    const conn = new Client();
    await new Promise((resolve, reject) => {
      conn.on('ready', () => { conn.end(); resolve(); }).on('error', (err) => reject(err)).connect(config);
    });
    globalSshConfig = config;
    res.json({ success: true, message: 'Connected successfully!' });
  } catch (err) { res.status(401).json({ success: false, error: err.message }); }
});

app.get('/api/scan', async (req, res) => {
  try {
    const result = await execSSH('pm2 jlist');
    let pm2Apps = [];
    try { pm2Apps = JSON.parse(result.stdout); } catch(e) {}
    const projects = pm2Apps.map(app => ({
      name: app.name,
      pid: app.pid,
      status: app.pm2_env.status,
      memory: Math.round(app.monit.memory / 1024 / 1024) + ' MB',
      cpu: app.monit.cpu + '%',
      path: app.pm2_env.pm_cwd
    }));
    res.json({ success: true, projects });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/project-files', async (req, res) => {
  const { projectPath, portOrName } = req.body;
  try {
    let files = [];
    const cmdEnv = 'ls -l ' + projectPath + '/.env || echo "NOT_FOUND"';
    const envCheck = await execSSH(cmdEnv);
    if (!envCheck.stdout.includes('NOT_FOUND')) files.push({ name: '.env', path: projectPath + '/.env', type: 'env' });

    const cmdPkg = 'ls -l ' + projectPath + '/package.json || echo "NOT_FOUND"';
    const pkgCheck = await execSSH(cmdPkg);
    if (!pkgCheck.stdout.includes('NOT_FOUND')) files.push({ name: 'package.json', path: projectPath + '/package.json', type: 'config' });

    const cmdNginx = 'grep -Rl "' + projectPath + '" /etc/nginx/sites-available/ || echo "NOT_FOUND"';
    const nginxCheck = await execSSH(cmdNginx);
    if (!nginxCheck.stdout.includes('NOT_FOUND')) {
      const nginxFiles = nginxCheck.stdout.split('\n').filter(f => f.trim() !== '');
      nginxFiles.forEach(f => {
        if(f !== 'NOT_FOUND') files.push({ name: f.split('/').pop() + ' (Nginx)', path: f, type: 'nginx' });
      });
    }
    res.json({ success: true, files });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/read-file', async (req, res) => {
  const { path } = req.body;
  const conn = new Client();
  conn.on('ready', () => {
    conn.sftp((err, sftp) => {
      if (err) { conn.end(); return res.status(500).json({ error: err.message }); }
      sftp.readFile(path, 'utf8', (err, data) => {
        conn.end();
        if (err) return res.status(500).json({ error: err.message });
        res.json({ data });
      });
    });
  }).on('error', (err) => res.status(500).json({ error: err.message })).connect(globalSshConfig);
});

// Route SFTP Tulis File
app.post('/api/write-file', async (req, res) => {
  const { path, content } = req.body;
  const conn = new Client();
  conn.on('ready', () => {
    conn.sftp((err, sftp) => {
      if (err) { conn.end(); return res.status(500).json({ error: err.message }); }
      sftp.writeFile(path, content, 'utf8', (err) => {
        conn.end();
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
      });
    });
  }).on('error', (err) => res.status(500).json({ error: err.message })).connect(globalSshConfig);
});

const PORT = 3001;

// --- Interactive Terminal Logic via Socket.io ---
io.on('connection', (socket) => {
  let conn = null;

  socket.on('terminal:start', (opts) => {
    if (!globalSshConfig) {
      socket.emit('terminal:data', '\r\n*** SSH Not Connected ***\r\n');
      return;
    }
    
    conn = new Client();
    conn.on('ready', () => {
      conn.shell({ term: 'xterm-256color', cols: opts?.cols || 80, rows: opts?.rows || 24 }, (err, stream) => {
        if (err) {
          socket.emit('terminal:data', '\r\n*** Error opening shell ***\r\n');
          return;
        }

        socket.on('terminal:data', (data) => stream.write(data));
        
        socket.on('terminal:resize', ({ cols, rows }) => {
          stream.setWindow(rows, cols, 0, 0);
        });

        stream.on('data', (data) => socket.emit('terminal:data', data.toString('utf-8')))
              .on('close', () => { conn.end(); socket.emit('terminal:data', '\r\n*** Shell Closed ***\r\n'); });
      });
    }).on('error', (err) => {
      socket.emit('terminal:data', '\r\n*** SSH Connection Error ***\r\n');
    }).connect(globalSshConfig);
  });

  socket.on('disconnect', () => {
    if (conn) conn.end();
  });
});

server.listen(PORT, () => console.log('Backend running on ' + PORT));
