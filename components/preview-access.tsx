"use client";

import { BoxError, type BoxClient, type PreviewStatus } from "@/lib/box-client";
import { useState } from "react";

const STATE_LABEL: Record<PreviewStatus["state"], string> = {
  none: "Not started",
  starting: "Starting",
  running: "Live",
  stopped: "Stopped",
  error: "No dev script",
};

export function previewStateLabel(preview: PreviewStatus) {
  return STATE_LABEL[preview.state];
}

/** Private by default. Public: anyone with the box address can see the app. */
export function PreviewAccess({
  client,
  preview,
  onChange,
}: {
  client: BoxClient;
  preview: PreviewStatus;
  onChange: (preview: PreviewStatus) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(value: boolean) {
    setPending(true);
    setError(null);
    try {
      onChange(await client.setPreviewPublic(value));
    } catch (reason) {
      setError(reason instanceof BoxError && reason.kind === "request" ? reason.message : "Could not change that. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="text-sm">
      <label className={`flex items-center gap-2 ${preview.protected ? "cursor-pointer" : "opacity-70"}`}>
        <input
          type="checkbox"
          className="h-4 w-4 shrink-0 accent-[var(--signal)]"
          checked={preview.public}
          disabled={pending || !preview.protected}
          onChange={(event) => void toggle(event.target.checked)}
        />
        <span>Make preview public</span>
      </label>
      <p className="muted mt-1 text-xs">
        {error ??
          (!preview.protected
            ? "Update your box to make it private."
            : preview.public
              ? "Anyone with the link can see your app."
              : "Only you can see it.")}
      </p>
    </div>
  );
}
