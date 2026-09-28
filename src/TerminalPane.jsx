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
      if (terminalRef.current && terminalRef.current.clientWidth > 0) {
        try { fit.fit(); } catch(e) {}
      }
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
      if (terminalRef.current && terminalRef.current.clientWidth > 0) {
        try {
          fit.fit();
          socket.emit('terminal:resize', { cols: term.cols, rows: term.rows });
        } catch (e) {}
      }
    };

    window.addEventListener('resize', handleResize);
    
    // Auto-fit when container becomes visible or changes size
    let observer;
    if (window.ResizeObserver && terminalRef.current) {
      observer = new ResizeObserver(() => {
        // Small timeout to let browser calculate new DOM size
        setTimeout(() => handleResize(), 20);
      });
      observer.observe(terminalRef.current);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      if (observer) observer.disconnect();
      socket.disconnect();
      term.dispose();
    };
  }, []);

  return (
    <>
      <style>{`
        .xterm-viewport::-webkit-scrollbar {
          width: 8px;
        }
        .xterm-viewport::-webkit-scrollbar-track {
          background: #000000;
        }
        .xterm-viewport::-webkit-scrollbar-thumb {
          background: #14532d; /* green-900 */
          border-radius: 4px;
        }
        .xterm-viewport::-webkit-scrollbar-thumb:hover {
          background: #166534; /* green-800 */
        }
      `}</style>
      <div className="w-full h-full bg-black p-2 overflow-hidden" ref={terminalRef}></div>
    </>
  );
}
