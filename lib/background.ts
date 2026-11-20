import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Keep work running after the response is sent.
 * On Cloudflare Workers this uses ctx.waitUntil, so a webhook can answer fast while
 * provisioning continues. Elsewhere (next dev, Node) the promise just runs on its own.
 * Callers must not rely on this finishing: anything important can be resumed on the next poll.
 */
export function runInBackground(label: string, work: () => Promise<unknown>) {
  const task = work().catch((error) => {
    console.error(`${label}: ${error instanceof Error ? error.message.slice(0, 300) : "failed"}`);
  });
  try {
    getCloudflareContext().ctx.waitUntil(task);
  } catch {
    // Not running on Workers.
  }
  return task;
}
