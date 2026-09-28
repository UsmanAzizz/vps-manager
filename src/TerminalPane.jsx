import React, { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { io } from 'socket.io-client';
import 'xterm/css/xterm.css';

export default function TerminalPane() {
  const terminalRef = useRef(null);
  const socketRef = useRef(null);
  const termInstance = useRef(null);
  const fitAddon = useRef(null);

  useEffect(() => {
    // Initialize xterm.js
    const term = new Terminal({
      cursorBlink: true,
      theme: {
        background: '#000000',
        foreground: '#22c55e', // text-green-500
        cursor: '#22c55e'
      },
      fontFamily: 'monospace',
      fontSize: 13
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(terminalRef.current);
    
    // Slight delay to ensure parent container is rendered for fitting
    setTimeout(() => {
      fit.fit();
    }, 100);
    
    termInstance.current = term;
    fitAddon.current = fit;

    // Connect to Socket.io
    const socket = io('http://localhost:3001');
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('terminal:start', { cols: term.cols, rows: term.rows });
    });

    socket.on('terminal:data', (data) => {
      term.write(data);
    });

    term.onData((data) => {
      socket.emit('terminal:data', data);
    });

    // Handle Resize
    const handleResize = () => {
      try {
        fit.fit();
        socket.emit('terminal:resize', { cols: term.cols, rows: term.rows });
      } catch (e) {}
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      socket.disconnect();
      term.dispose();
    };
  }, []);

  return (
    <div className="w-full h-full bg-black p-2 overflow-hidden" ref={terminalRef}></div>
  );
}
