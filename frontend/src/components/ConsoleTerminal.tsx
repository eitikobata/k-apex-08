'use client';

import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { Socket } from 'socket.io-client';
import { sendRawCommand } from '@/lib/socket-client';

const PROMPT = '\r\n\x1b[38;2;0;0;0m\x1b[48;2;63;208;232m K-APEX-08> \x1b[0m ';

export function ConsoleTerminal({ socket }: { socket: Socket | null }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const lineBufferRef = useRef('');
  // Always holds the latest socket without forcing the creation effect
  // below to re-run (and re-dispose/recreate the terminal) every time
  // the parent connects/reconnects.
  const socketRef = useRef<Socket | null>(socket);

  useEffect(() => {
    socketRef.current = socket;
  }, [socket]);

  // Terminal instance is created exactly once, on mount — never
  // re-created on socket changes. Disposing/recreating xterm mid-layout
  // is what caused "Cannot read properties of undefined (reading
  // 'dimensions')" before.
  useEffect(() => {
    if (!containerRef.current) return;

    const term = new XTerm({
      convertEol: true,
      fontFamily: 'var(--font-jetbrains), monospace',
      fontSize: 13,
      theme: {
        background: '#00000000',
        foreground: '#d5dae2',
        cursor: '#3fd0e8',
        selectionBackground: '#3fd0e8',
      },
      cursorBlink: true,
      disableStdin: false,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);

    // Defer the first fit() to the next frame — the container may not
    // have real dimensions yet in the same tick as term.open().
    const rafId = requestAnimationFrame(() => {
      fitAddon.fit();
      term.writeln('K-APEX-08 console link established.');
      term.writeln('Type a command — e.g. CONFIRM SPLICE //<incidentId>, AUTONOMOUS ON');
      term.write(PROMPT);
    });

    term.onData((data) => {
      const code = data.charCodeAt(0);
      if (data === '\r') {
        const line = lineBufferRef.current.trim();
        lineBufferRef.current = '';
        term.write(PROMPT);
        const currentSocket = socketRef.current;
        if (line && currentSocket) {
          sendRawCommand(currentSocket, line);
        } else if (line && !currentSocket) {
          term.writeln('\r\n[link down — not connected]');
          term.write(PROMPT);
        }
      } else if (code === 127) {
        if (lineBufferRef.current.length > 0) {
          lineBufferRef.current = lineBufferRef.current.slice(0, -1);
          term.write('\b \b');
        }
      } else if (code >= 32) {
        lineBufferRef.current += data;
        term.write(data);
      }
    });

    termRef.current = term;

    const handleResize = () => {
      try {
        fitAddon.fit();
      } catch {
        // Container may be mid-transition (e.g. tab hidden) — safe to skip a frame.
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleResize);
      term.dispose();
      termRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Prints gateway feedback (command results/errors) into the terminal.
  // This effect legitimately depends on `socket` — it just attaches/detaches
  // listeners, it never touches the terminal's lifecycle.
  useEffect(() => {
    if (!socket || !termRef.current) return;
    const term = termRef.current;

    const onResult = (payload: { result: Record<string, unknown> }) => {
      term.writeln(`\r\n[ok] ${JSON.stringify(payload.result)}`);
      term.write(PROMPT);
    };
    const onError = (payload: { message: string }) => {
      term.writeln(`\r\n[error] ${payload.message}`);
      term.write(PROMPT);
    };

    socket.on('command_result', onResult);
    socket.on('command_error', onError);
    return () => {
      socket.off('command_result', onResult);
      socket.off('command_error', onError);
    };
  }, [socket]);

  return <div ref={containerRef} className="terminal-shell" />;
}
