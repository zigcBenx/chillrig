"use client";

import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useImperativeHandle, useRef } from "react";
import type { Ref } from "react";
import type { TerminalHandle } from "@/components/mock-terminal";

type Flow = "shell" | "claude" | "codex";
type Status = "connecting" | "open" | "closed";

const THEME = {
  background: "#0c0c0e",
  foreground: "#f2f2f4",
  cursor: "#f2f2f4",
  cursorAccent: "#0c0c0e",
  selectionBackground: "rgba(255,255,255,0.18)",
};

export function LiveTerminal({
  mode,
  handle,
  onStatus,
}: {
  mode: Flow;
  handle?: Ref<TerminalHandle>;
  onStatus?: (status: Status) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const pendingRef = useRef<string | null>(null);
  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useImperativeHandle(handle, () => ({
    start() {
      const command = modeRef.current === "codex" ? "codex login --device-auth\n" : "claude\n";
      const socket = socketRef.current;
      if (socket && socket.readyState === WebSocket.OPEN) sendInput(socket, command);
      else pendingRef.current = command;
    },
  }));

  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      fontSize: 14,
      lineHeight: 1.35,
      theme: THEME,
      scrollback: 2000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(host);
    fit.fit();
    let stopped = false;
    let socket: WebSocket | null = null;
    let retry = 0;
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();

    const connect = async () => {
      if (stopped) return;
      onStatus?.("connecting");
      const response = await fetch("/api/terminal/ticket", { cache: "no-store" });
      if (stopped) return;
      if (!response.ok) {
        onStatus?.("closed");
        // Never leave a blank black screen: say why and where to go.
        if (response.status === 404) {
          term.writeln("You don't have a box yet.");
          term.writeln("Go back to the dashboard and pick a plan to get one.");
          window.setTimeout(() => {
            if (!stopped) window.location.assign("/dashboard");
          }, 2500);
        } else if (response.status === 401) {
          window.location.assign("/login");
        } else {
          term.writeln("Your box isn't reachable right now (still starting, or restarting).");
          term.writeln("Press Reconnect in a minute, or check the dashboard.");
        }
        return;
      }
      const ticket = (await response.json()) as { hostname: string; wsPath: string; ticket: string };
      const url = `wss://${ticket.hostname}${ticket.wsPath}?ticket=${encodeURIComponent(ticket.ticket)}`;
      socket = new WebSocket(url, ["tty"]);
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;
      socket.onopen = () => {
        if (stopped || !socket) return;
        retry = 0;
        onStatus?.("open");
        const columns = term.cols || 80;
        const rows = term.rows || 24;
        socket.send(encoder.encode(JSON.stringify({ AuthToken: "", columns, rows })));
        if (pendingRef.current) {
          sendInput(socket, pendingRef.current);
          pendingRef.current = null;
        }
      };
      socket.onmessage = (event) => {
        const raw = new Uint8Array(event.data as ArrayBuffer);
        if (raw[0] === 48) term.write(decoder.decode(raw.subarray(1)));
      };
      socket.onclose = () => {
        if (stopped) return;
        onStatus?.("closed");
        if (retry < 4) {
          retry += 1;
          window.setTimeout(() => void connect(), 600 * retry);
        }
      };
      socket.onerror = () => {
        socket?.close();
      };
    };

    const disposable = term.onData((data) => {
      const current = socketRef.current;
      if (current && current.readyState === WebSocket.OPEN) sendInput(current, data);
    });
    const observer = new ResizeObserver(() => {
      fit.fit();
      const current = socketRef.current;
      if (current && current.readyState === WebSocket.OPEN) {
        current.send(encoder.encode(`1${JSON.stringify({ columns: term.cols, rows: term.rows })}`));
      }
    });
    observer.observe(host);
    void connect();

    return () => {
      stopped = true;
      disposable.dispose();
      observer.disconnect();
      socket?.close();
      socketRef.current = null;
      term.dispose();
    };
  }, [onStatus]);

  return <div ref={ref} className="term-root h-full w-full" />;
}

function sendInput(socket: WebSocket, text: string) {
  const bytes = new TextEncoder().encode(text);
  const payload = new Uint8Array(bytes.length + 1);
  payload[0] = 48;
  payload.set(bytes, 1);
  socket.send(payload);
}
