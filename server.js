import express from 'express';
import cors from 'cors';
import { Client } from 'ssh2';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const sshConfig = {
  host: process.env.VPS_HOST || '127.0.0.1',
  port: parseInt(process.env.VPS_PORT || '22'),
  username: process.env.VPS_USER || 'root',
  password: process.env.VPS_PASSWORD || ''
};

app.get('/api/test', (req, res) => {
  res.json({ message: 'Backend connected!' });
});

app.post('/api/exec', (req, res) => {
  const { command } = req.body;
  if (!command) return res.status(400).json({ error: 'Command is required' });

  const conn = new Client();
  conn.on('ready', () => {
    conn.exec(command, (err, stream) => {
      if (err) { conn.end(); return res.status(500).json({ error: err.message }); }
      let stdout = ''; let stderr = '';
      stream.on('close', (code, signal) => {
        conn.end(); res.json({ stdout, stderr, code });
      }).on('data', (data) => stdout += data.toString())
        .stderr.on('data', (data) => stderr += data.toString());
    });
  }).on('error', (err) => res.status(500).json({ error: 'SSH Error: ' + err.message })).connect(sshConfig);
});

app.get('/api/file', (req, res) => {
  const { filepath } = req.query;
  const conn = new Client();
  conn.on('ready', () => {
    conn.sftp((err, sftp) => {
      if (err) { conn.end(); return res.status(500).json({ error: err.message }); }
      sftp.readFile(filepath, 'utf8', (err, data) => {
        conn.end();
        if (err) return res.status(500).json({ error: err.message });
        res.json({ data });
      });
    });
  }).on('error', (err) => res.status(500).json({ error: 'SSH Error: ' + err.message })).connect(sshConfig);
});

const PORT = 3001;
app.listen(PORT, () => console.log([VPS Manager] Backend running on http://localhost:));
