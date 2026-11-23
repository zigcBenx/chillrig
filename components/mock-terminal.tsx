"use client";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useImperativeHandle, useRef } from "react";
import type { Ref } from "react";

export type TerminalHandle = { start: () => void };
type Flow = "shell" | "claude" | "codex";

const THEME = {
  background: "#0c0c0e",
  foreground: "#f2f2f4",
  cursor: "#f2f2f4",
  cursorAccent: "#0c0c0e",
  selectionBackground: "rgba(255,255,255,0.18)",
};

export function MockTerminal({
  mode,
  projects = [],
  handle,
  session,
}: {
  mode: Flow;
  projects?: string[];
  handle?: Ref<TerminalHandle>;
  session?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const modeRef = useRef(mode);
  const projectKey = (projects ?? []).join("|");
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useImperativeHandle(handle, () => ({
    start() {
      const term = termRef.current;
      if (!term) return;
      beginLogin(term, modeRef.current, state);
    },
  }));

  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 14,
      lineHeight: 1.35,
      theme: THEME,
      scrollback: 500,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();
    termRef.current = term;
    state.flow = "free";
    state.buffer = "";
    term.writeln("\x1b[38;5;108mChillrig demo\x1b[0m");
    term.writeln("Keystrokes stay in this browser.");
    if (session) {
      term.writeln("");
      term.writeln(`\x1b[2mAttached to ${session}. On a real box, Claude's session shows here live.\x1b[0m`);
    }
    prompt(term);
    const names = projectKey ? projectKey.split("|") : [];
    const disposable = term.onData((data) => onData(term, data, names));
    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(host);
    return () => {
      disposable.dispose();
      observer.disconnect();
      term.dispose();
      termRef.current = null;
    };
  }, [projectKey, session]);

  return <div ref={ref} className="term-root h-full w-full" />;
}

const state = { flow: "free" as "free" | "paste" | "confirm", buffer: "" };

function prompt(term: Terminal) {
  term.write("\r\n\x1b[38;5;108mcoder@chillrig\x1b[0m \x1b[38;5;146m~\x1b[0m ");
}

function beginLogin(term: Terminal, mode: Flow, current: typeof state) {
  current.flow = mode === "codex" ? "confirm" : "paste";
  current.buffer = "";
  term.writeln("");
  if (mode === "codex") {
    term.writeln("$ codex login --device-auth");
    term.writeln("");
    term.writeln("ChatGPT Codex");
    term.writeln("The official CLI prints a one-time code and a sign-in link.");
    term.writeln("Open the link and enter the code.");
    term.writeln("");
    term.writeln("Demo. Nothing is sent.");
    term.writeln("Press Enter when you have finished.");
    return;
  }
  term.writeln("$ claude");
  term.writeln("");
  term.writeln("Claude Code");
  term.writeln("The official CLI prints a one-time link.");
  term.writeln("Open it, sign in, then paste the code.");
  term.writeln("");
  term.writeln("Demo. The code stays in this browser and is discarded.");
  term.write("> ");
}

function onData(term: Terminal, data: string, projects: string[]) {
  for (const char of data) {
    if (char === "\u0003") {
      state.flow = "free";
      state.buffer = "";
      term.write("^C");
      prompt(term);
      continue;
    }
    if (state.flow !== "free") {
      if (char === "\r" || char === "\n") {
        finishLogin(term);
      } else if (char === "\u007f") {
        if (state.buffer.length > 0) {
          state.buffer = state.buffer.slice(0, -1);
          term.write("\b \b");
        }
      } else if (char >= " " && state.buffer.length < 256) {
        state.buffer += char;
        if (state.flow === "paste") term.write("•");
      }
      continue;
    }
    if (char === "\r" || char === "\n") {
      const line = state.buffer;
      state.buffer = "";
      term.writeln("");
      runLine(term, line.trim(), projects);
    } else if (char === "\u007f") {
      if (state.buffer.length > 0) {
        state.buffer = state.buffer.slice(0, -1);
        term.write("\b \b");
      }
    } else if (char >= " ") {
      state.buffer += char;
      term.write(char);
    }
  }
}

function finishLogin(term: Terminal) {
  const typed = state.buffer;
  state.buffer = "";
  if (state.flow === "paste" && typed.length === 0) {
    term.writeln("");
    term.writeln("Paste the code, then press Enter.");
    term.write("> ");
    return;
  }
  state.flow = "free";
  term.writeln("");
  term.writeln("Signed in.");
  prompt(term);
}

function runLine(term: Terminal, line: string, projects: string[]) {
  if (!line) {
    prompt(term);
    return;
  }
  if (line === "clear") {
    term.clear();
    prompt(term);
    return;
  }
  if (line === "help") {
    term.writeln("claude");
    term.writeln("codex login --device-auth");
    term.writeln("ls  pwd  whoami  clear");
    prompt(term);
    return;
  }
  if (line === "pwd") {
    term.writeln("/home/coder");
    prompt(term);
    return;
  }
  if (line === "whoami") {
    term.writeln("coder");
    prompt(term);
    return;
  }
  if (line === "ls") {
    term.writeln(["projects", ...projects].join("  ") || "projects");
    prompt(term);
    return;
  }
  if (line === "claude") {
    beginLogin(term, "claude", state);
    return;
  }
  if (line === "codex login --device-auth" || line === "codex") {
    beginLogin(term, "codex", state);
    return;
  }
  term.writeln("command not found");
  prompt(term);
}
