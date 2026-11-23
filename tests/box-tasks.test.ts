import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { repoFolder, toProjectName, validNewProjectName, validProjectName, validSessionName } from "../lib/box-client";
import { EXIT_MARK } from "../public/box/login-parse.mjs";
import {
  cleanPrompt,
  findGhDevice,
  lastLines,
  makeSessionName,
  parseGhLogin,
  parseRepo,
  parseSessionList,
  promptTitle,
  SESSION_NAME,
  sessionState,
  toolArgs,
  validNewProject,
  validProject,
  validSession,
} from "../public/box/tasks.mjs";

// Captured from `gh auth login -h github.com -p https -w </dev/null` (gh 2.46) in tmux.
const GH_NO_TTY = `! First copy your one-time code: 1A0A-7334
Open this URL to continue in your web browser: https://github.com/login/device
`;
// The same command with a terminal on stdin: it asks two questions first.
const GH_TTY = `? Authenticate Git with your GitHub credentials? Yes
! First copy your one-time code: AC02-6676
Press Enter to open github.com in your browser...
`;

describe("project and session names", () => {
  it("accepts only safe new project names", () => {
    for (const name of ["a", "my-app", "bakery_2", "0start", "a".repeat(41)]) assert.equal(validNewProject(name), name, name);
    for (const name of ["", "-x", "_x", "My-App", "a b", "a.b", "../x", "a/b", "a".repeat(42), "x;rm", "ä"]) {
      assert.equal(validNewProject(name), null, name);
    }
    assert.equal(validNewProject(undefined), null);
  });

  it("accepts existing folders like cloned repos, never paths", () => {
    for (const name of ["Hello-World", "repo.js", "a_b", "x"]) assert.equal(validProject(name), name);
    for (const name of [".", "..", ".git", "-rf", "a/b", "a b", "", "x".repeat(101), "a\nb"]) assert.equal(validProject(name), null, name);
  });

  it("keeps the browser rules in step with the box", () => {
    const names = ["a", "my-app", "My-App", "-x", "a".repeat(41), "a".repeat(42), "x.y", "bakery_2"];
    for (const name of names) assert.equal(validNewProjectName(name), validNewProject(name) !== null, name);
    for (const name of ["cr-a-1", "chillrig", "a b", "a.b", "x".repeat(64), "x".repeat(65), ""]) {
      assert.equal(validSessionName(name), validSession(name) !== null, name);
    }
    for (const name of ["Hello-World", ".git", "a/b", "repo.js"]) assert.equal(validProjectName(name), validProject(name) !== null, name);
  });

  it("turns typing into a project name", () => {
    assert.equal(toProjectName("My Bakery!"), "my-bakery");
    assert.equal(toProjectName("  --Shop 2 "), "shop-2-");
    assert.equal(toProjectName("x".repeat(60)).length, 41);
  });

  it("makes tmux-safe session names", () => {
    const name = makeSessionName("Hello.World", 1_795_427_993_000);
    assert.match(name, SESSION_NAME);
    assert.match(name, /^cr-hello-world-[a-z0-9]{1,6}$/);
    assert.doesNotMatch(name, /[.:]/);
    assert.match(makeSessionName("...", 1), /^cr-task-1$/);
    assert.match(makeSessionName("x".repeat(100)), SESSION_NAME);
    assert.notEqual(makeSessionName("a", 1000), makeSessionName("a", 1001));
    assert.equal(validSession("cr-a;id"), null);
    assert.equal(validSession("=cr-a"), null);
  });
});

describe("prompts and tool flags", () => {
  it("keeps the prompt as typed, minus control characters", () => {
    assert.equal(cleanPrompt("  build $(rm -rf ~) `id` \"x\"\r\nline 2\t "), 'build $(rm -rf ~) `id` "x"\nline 2');
    assert.equal(cleanPrompt("a\u001b[31mb\u0007"), "a[31mb");
    assert.equal(cleanPrompt("   "), null);
    assert.equal(cleanPrompt("x".repeat(6001)), null);
    assert.equal(cleanPrompt(42), null);
    assert.equal(promptTitle("one\ttwo\nthree"), "one two three");
    assert.equal(promptTitle("x".repeat(200)).length, 120);
  });

  it("builds flags, with the prompt left to task.sh after --", () => {
    assert.deepEqual(toolArgs("claude", true), ["--dangerously-skip-permissions"]);
    assert.deepEqual(toolArgs("claude", false), ["--permission-mode", "acceptEdits"]);
    assert.deepEqual(toolArgs("codex", true), ["--no-alt-screen", "--dangerously-bypass-approvals-and-sandbox"]);
    assert.deepEqual(toolArgs("codex", false), ["--no-alt-screen", "--sandbox", "workspace-write", "--ask-for-approval", "on-request"]);
    assert.equal(toolArgs("bash", true), null);
  });

  it("reads GitHub links only", () => {
    assert.deepEqual(parseRepo("https://github.com/octocat/Hello-World"), {
      cloneUrl: "https://github.com/octocat/Hello-World.git",
      owner: "octocat",
      repo: "Hello-World",
    });
    assert.equal(parseRepo("github.com/a/b.git/")?.repo, "b");
    assert.equal(parseRepo(" https://github.com/a/b ")?.repo, "b");
    for (const url of [
      "http://github.com/a/b",
      "https://gitlab.com/a/b",
      "https://user:pw@github.com/a/b",
      "https://github.com/a/b?x=1",
      "https://github.com/a/b#x",
      "https://github.com/a/b/tree/main",
      "https://github.com/a/.git",
      "https://github.com/a/b c",
      "--upload-pack=x",
    ]) {
      assert.equal(parseRepo(url), null, url);
    }
    assert.equal(repoFolder("https://github.com/octocat/Hello-World.git"), "Hello-World");
    assert.equal(repoFolder("https://gitlab.com/a/b"), null);
  });
});

describe("GitHub device sign-in", () => {
  it("finds the code and the device page", () => {
    assert.deepEqual(findGhDevice(GH_NO_TTY), { code: "1A0A-7334", url: "https://github.com/login/device" });
    // Without a printed URL, the code still comes with GitHub's device page.
    assert.deepEqual(findGhDevice(GH_TTY), { code: "AC02-6676", url: "https://github.com/login/device" });
    assert.deepEqual(findGhDevice("\x1b[33m!\x1b[0m First copy your one-time code: \x1b[1mABCD-1234\x1b[0m\n"), {
      code: "ABCD-1234",
      url: "https://github.com/login/device",
    });
    assert.equal(findGhDevice("Open https://evil.example/login/device\none-time code: abcd-1234").code, null);
  });

  it("walks the phases", () => {
    assert.deepEqual(parseGhLogin(""), { phase: "starting" });
    assert.deepEqual(parseGhLogin(GH_NO_TTY), { phase: "open_url", url: "https://github.com/login/device", code: "1A0A-7334" });
    const done = `${GH_NO_TTY}✓ Authentication complete.\n✓ Logged in as octocat\n${EXIT_MARK}:0\n`;
    assert.equal(parseGhLogin(done).phase, "done");
    const failed = parseGhLogin(`${GH_NO_TTY}error: device code expired\n${EXIT_MARK}:1\n`);
    assert.equal(failed.phase, "error");
    assert.match(failed.message ?? "", /expired/);
    assert.equal(parseGhLogin(`${EXIT_MARK}:1`).message, "GitHub sign-in stopped. Try again.");
  });
});

describe("task sessions", () => {
  it("lists task sessions only", () => {
    const out = [
      "chillrig\t\t\t\t1795427587\t0\t",
      "chillrig-login-claude\t\t\t\t1795427588\t0\t",
      "cr-demo-abc\tclaude\tdemo\t\t1795427600\t0\tBuild a\tbakery site",
      "cr-old-xyz\tcodex\tHello-World\t0\t1795427500\t0\tFix bugs",
      "cr-dead-1\tclaude\tdemo\t\t1795427400\t1\t",
      "bad name\tclaude\tdemo\t\t1\t0\t",
      "cr-evil-1\tbash\tdemo\t\t1\t0\t",
      "cr-path-1\tclaude\t../etc\t\t1\t0\t",
    ].join("\n");
    const rows = parseSessionList(out);
    assert.deepEqual(
      rows.map((row) => [row.name, row.running, row.exitCode]),
      [
        ["cr-demo-abc", true, null],
        ["cr-old-xyz", false, 0],
        ["cr-dead-1", false, null],
        ["cr-path-1", true, null],
      ],
    );
    assert.equal(rows[0].title, "Build a bakery site");
    assert.equal(rows[0].startedAt, 1795427600000);
    assert.equal(rows[3].project, "");
    assert.deepEqual(parseSessionList(""), []);
  });

  it("keeps the last meaningful lines of a pane", () => {
    const pane = [
      "\x1b[1m▐▛███▜▌   Claude Code v2.1.330\x1b[0m",
      "❯ Build a landing page",
      "● Write(app/page.tsx)",
      "  ⎿  Wrote 84 lines to app/page.tsx",
      "",
      "─".repeat(80),
      "│ > │",
      "❯ ",
      "─".repeat(80),
      "  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents",
      "  ? for shortcuts",
      "",
    ].join("\n");
    assert.deepEqual(lastLines(pane), [
      "▐▛███▜▌   Claude Code v2.1.330",
      "❯ Build a landing page",
      "● Write(app/page.tsx)",
      "⎿  Wrote 84 lines to app/page.tsx",
    ]);
    const many = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
    assert.deepEqual(lastLines(many, 3), ["line 27", "line 28", "line 29"]);
    const wide = lastLines("y".repeat(500))[0];
    assert.equal(wide.length, 160);
    assert.ok(wide.endsWith("…"));
    assert.deepEqual(lastLines("\x1b]0;title\x07ok\r\n\x1b[2Kdone"), ["ok", "done"]);
  });

  it("tells working, waiting and finished apart", () => {
    assert.equal(sessionState(true, "● Write(x)\n✻ Thinking… (12s · esc to interrupt)\n❯ \n"), "working");
    assert.equal(sessionState(true, "• Working (5s • Esc to interrupt)"), "working");
    assert.equal(sessionState(true, "● Done.\n❯ "), "waiting");
    assert.equal(sessionState(false, "esc to interrupt"), "finished");
  });
});

describe("task scripts", () => {
  const agent = readFileSync("public/box/agent.mjs", "utf8");
  const task = readFileSync("public/box/task.sh", "utf8");
  const attach = readFileSync("public/box/attach.sh", "utf8");
  const update = readFileSync("public/box/update.sh", "utf8");

  it("passes the prompt as one argument, never through a shell string", () => {
    assert.match(task, /"\$tool" "\$@" -- "\$prompt"/);
    assert.match(task, /\^\[a-zA-Z0-9_-\]\{1,64\}\$/);
    assert.match(task, /"\$tool" != "claude" && "\$tool" != "codex"/);
    assert.match(agent, /"new-session", "-d", "-s", name, [^\n]*"--", "\/bin\/bash", taskScript, name, tool, \.\.\.toolArgs/);
    assert.doesNotMatch(agent, /new-session[^\n]*prompt/);
    assert.match(agent, /skipDangerousModePermissionPrompt/);
    assert.match(agent, /hasTrustDialogAccepted/);
    assert.match(agent, /trust_level/);
  });

  it("attaches only to a validated, existing session", () => {
    assert.match(attach, /\^\[a-zA-Z0-9_-\]\{1,64\}\$/);
    assert.match(attach, /has-session -t "=\$\{1\}"/);
    assert.match(attach, /attach -t "=\$\{target\}"/);
    assert.match(update, /ttyd -W -a /);
    assert.match(update, /for file in agent\.mjs login-parse\.mjs tasks\.mjs attach\.sh task\.sh; do/);
    assert.match(update, /node --check "\$\{tmp\}\/tasks\.mjs"/);
    assert.match(update, /bash -n "\$\{tmp\}\/task\.sh"/);
  });
});
