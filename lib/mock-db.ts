import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Box, Profile, Subscription } from "@/lib/types";

type MockState = {
  profiles: Profile[];
  subscriptions: Subscription[];
  boxes: Box[];
  events: string[];
};

const empty = (): MockState => ({ profiles: [], subscriptions: [], boxes: [], events: [] });

function dbFile() {
  const dir = process.env.VERCEL ? path.join("/tmp", "chillrig") : path.join(process.cwd(), ".data");
  return { dir, file: path.join(dir, "mock-db.json") };
}

async function readState(): Promise<MockState> {
  const { file } = dbFile();
  try {
    const raw = await readFile(/* turbopackIgnore: true */ file, "utf8");
    const parsed = JSON.parse(raw) as MockState;
    return {
      profiles: parsed.profiles ?? [],
      subscriptions: parsed.subscriptions ?? [],
      boxes: parsed.boxes ?? [],
      events: parsed.events ?? [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty();
    throw error;
  }
}

async function writeState(state: MockState) {
  const { dir, file } = dbFile();
  await mkdir(dir, { recursive: true });
  await writeFile(/* turbopackIgnore: true */ file, JSON.stringify(state, null, 2));
}

let queue: Promise<void> = Promise.resolve();

export function withMock<T>(fn: (state: MockState) => T, persist = false): Promise<T> {
  const run = queue.then(async () => {
    const state = await readState();
    const result = fn(state);
    if (persist) await writeState(state);
    return result;
  });
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
