import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

// No R2 on the free plan: serve build-time prerenders from static assets.
// Swap in r2IncrementalCache when ISR/revalidation needs to persist.
export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
});
