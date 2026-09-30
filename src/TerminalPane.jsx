import React, { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { io } from 'socket.io-client';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import 'xterm/css/xterm.css';

const isTauri = window.__TAURI_INTERNALS__ !== undefined;

export default function TerminalPane({ theme }) {
  const terminalRef = useRef(null);
  const socketRef = useRef(null);
  const termInstance = useRef(null);
  const fitAddon = useRef(null);
  const initialized = useRef(false);

  useEffect(() => {

    // Initialize xterm.js
    const term = new Terminal({
      cursorBlink: true,
      theme: { background: '#000000', foreground: '#22c55e', cursor: '#22c55e' },
      fontFamily: 'monospace',
      fontSize: 13
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(terminalRef.current);
    
    term.write('\x1b[33mConnecting to terminal...\x1b[0m\r\n');

    setTimeout(() => {
      if (terminalRef.current && terminalRef.current.clientWidth > 0) {
        try { fit.fit(); } catch(e) {}
      }
    }, 100);
    
    termInstance.current = term;
    fitAddon.current = fit;

    let isMounted = true;
    let unlistenTauri = null;
    let socket = null;

    const setupTerminal = async () => {
      if (isTauri) {
        try {
          const unlisten = await listen('terminal-data', (event) => {
            term.write(event.payload);
          });
          if (!isMounted) {
            unlisten();
          } else {
            unlistenTauri = unlisten;
          }

          term.onData((data) => {
            invoke('write_terminal', { data }).catch(console.error);
          });

          // Wait for a proper fit before starting
          let cols = term.cols || 80;
          let rows = term.rows || 24;
          await invoke('start_terminal', { cols, rows });
        } catch (error) {
          term.write(`\r\n\x1b[31mTerminal Error: ${error}\x1b[0m\r\n`);
        }
      } else {
        socket = io('http://localhost:3001');
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
      }
    };

    setupTerminal();

    const handleResize = async () => {
      if (terminalRef.current && terminalRef.current.clientWidth > 0) {
        try {
          fit.fit();
          if (isTauri) {
            const { invoke } = await import('@tauri-apps/api/core');
            invoke('resize_terminal', { cols: term.cols, rows: term.rows });
          } else if (socket) {
            socket.emit('terminal:resize', { cols: term.cols, rows: term.rows });
          }
        } catch (e) {}
      }
    };

    window.addEventListener('resize', handleResize);
    
    let observer;
    if (window.ResizeObserver && terminalRef.current) {
      observer = new ResizeObserver(() => {
        setTimeout(() => handleResize(), 20);
      });
      observer.observe(terminalRef.current);
    }

    return () => {
      isMounted = false;
      window.removeEventListener('resize', handleResize);
      if (observer) observer.disconnect();
      if (socket) socket.disconnect();
      if (unlistenTauri) unlistenTauri();
      term.dispose();
    };
  }, []);

  useEffect(() => {
    if (!termInstance.current) return;
    setTimeout(() => {
      const style = getComputedStyle(document.documentElement);
      const bg = style.getPropertyValue('--dyn-black').trim() || '#000000';
      const fg = style.getPropertyValue('--dyn-green-500').trim() || '#22c55e';
      termInstance.current.options.theme = {
        background: bg,
        foreground: fg,
        cursor: fg
      };
    }, 50);
  }, [theme]);

  return (
    <>
      <style>{`
        .xterm-viewport::-webkit-scrollbar {
          width: 8px;
        }
        .xterm-viewport::-webkit-scrollbar-track {
          background: var(--dyn-black);
        }
        .xterm-viewport::-webkit-scrollbar-thumb {
          background: var(--dyn-green-900);
          border-radius: 4px;
        }
        .xterm-viewport::-webkit-scrollbar-thumb:hover {
          background: var(--dyn-green-800);
        }
      `}</style>
      <div className="w-full h-full p-2 overflow-hidden" style={{ backgroundColor: "var(--dyn-black)" }} ref={terminalRef}></div>
    </>
  );
}
