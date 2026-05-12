"use client";

import { useCallback, useState } from "react";
import { Icon, Spinner } from "@/lib/icons";
import { api, revealPath } from "@/lib/api";
import { useStore } from "@/lib/store";
import type { Clip } from "@/lib/types";

// ClipForge is a desktop app. Once a clip is rendered, its mp4 lives in the
// user's project working directory. This component replaces the old
// HTTP-download UX with a "here's the file on disk, here's what to do with
// it" mental model. Four states:
//   1) unrendered — no mp4 exists yet (primary: "Prepare clip")
//   2) rendering  — ffmpeg running (indeterminate shimmer)
//   3) ready      — file exists, in sync with current trim bounds
//   4) stale      — file exists but bounds changed since render
//
// Ported from design/project/screens/file-actions.jsx (Claude Design
// export, May 2026). Final design iteration: Ready state has a single
// primary action "Show in Finder" / "Show in File Explorer" — no "Save a
// copy" or "Copy path" affordances.

type State = "unrendered" | "rendering" | "ready" | "stale";

const isWindowsPlatform =
  typeof navigator !== "undefined" &&
  /Win/i.test(navigator.platform || navigator.userAgent || "");

const REVEAL_LABEL = isWindowsPlatform
  ? "Show in File Explorer"
  : "Show in Finder";

const FILE_MANAGER = isWindowsPlatform ? "File Explorer" : "Finder";

// Derive UI state from the clip's render flags + in-flight local state.
// `rendered` reflects "file exists AND bounds match render"; if the file
// exists but `needsRender` is true the user has edited bounds since the
// last render and we surface the "stale" affordance.
function deriveState(clip: Clip, localRendering: boolean): State {
  if (localRendering) return "rendering";
  if (clip.rendered) return "ready";
  // Stale = file exists on disk but bounds have moved. We know a file
  // exists when renderedPath is set even though `rendered` is false
  // (rendered=true requires both file existence AND bounds-in-sync).
  if (clip.renderedPath && clip.needsRender) return "stale";
  return "unrendered";
}

// --- Subcomponents (one per state) ----------------------------------------

const PathRow = ({
  fullPath,
  muted = false,
}: {
  fullPath: string;
  muted?: boolean;
}) => (
  <div
    title={fullPath}
    style={{
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "8px 10px",
      background: "var(--bg-sunken)",
      border: "1px solid var(--border)",
      borderRadius: 6,
      fontFamily: "var(--font-mono, ui-monospace, monospace)",
      fontSize: 12,
      color: muted ? "var(--fg-faint)" : "var(--fg)",
      minWidth: 0,
      opacity: muted ? 0.85 : 1,
    }}
  >
    <span
      style={{
        color: muted ? "var(--fg-faint)" : "var(--fg-muted)",
        display: "inline-flex",
        flexShrink: 0,
      }}
    >
      <Icon name="folder" size={13} />
    </span>
    <span
      style={{
        flex: 1,
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        textDecoration: muted ? "line-through" : "none",
        textDecorationColor: "oklch(0.78 0.008 70)",
      }}
    >
      {fullPath}
    </span>
  </div>
);

const UnrenderedState = ({ onPrepare }: { onPrepare: () => void }) => (
  <div
    className="card"
    style={{
      padding: 14,
      display: "flex",
      alignItems: "center",
      gap: 14,
      minWidth: 340,
    }}
  >
    <div
      style={{
        width: 36,
        height: 36,
        borderRadius: 6,
        background: "var(--bg-sunken)",
        border: "1px dashed var(--border)",
        display: "grid",
        placeItems: "center",
        color: "var(--fg-faint)",
        flexShrink: 0,
      }}
    >
      <Icon name="file" size={16} />
    </div>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 500, color: "var(--fg)" }}>
        Clip not in your project folder yet
      </div>
      <div
        style={{
          fontSize: 11.5,
          color: "var(--fg-muted)",
          marginTop: 2,
          lineHeight: 1.45,
        }}
      >
        We&apos;ll cut this clip from the source video and place the mp4 in
        your project folder.
      </div>
    </div>
    <button
      className="btn btn-primary"
      onClick={onPrepare}
      style={{ flexShrink: 0 }}
    >
      <Icon name="sparkle" size={14} />
      Prepare clip
    </button>
  </div>
);

const RenderingState = () => (
  <div
    className="card"
    style={{
      padding: 14,
      display: "flex",
      alignItems: "center",
      gap: 14,
      minWidth: 340,
      background: "var(--accent-soft)",
      borderColor: "oklch(0.88 0.08 50)",
    }}
  >
    <div
      style={{
        width: 36,
        height: 36,
        borderRadius: 6,
        background: "var(--bg)",
        border: "1px solid oklch(0.88 0.08 50)",
        display: "grid",
        placeItems: "center",
        color: "var(--accent)",
        flexShrink: 0,
      }}
    >
      <Spinner size={16} />
    </div>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div
        style={{ fontSize: 13, fontWeight: 500, color: "oklch(0.38 0.14 45)" }}
      >
        Preparing clip…
      </div>
      <div
        style={{
          marginTop: 6,
          height: 3,
          background: "oklch(1 0 0 / 0.6)",
          borderRadius: 999,
          overflow: "hidden",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(90deg, transparent 0%, var(--accent) 50%, transparent 100%)",
            animation: "chipShimmer 1.6s ease-in-out infinite",
          }}
        />
      </div>
      <div
        style={{
          fontSize: 11,
          color: "oklch(0.5 0.13 45)",
          marginTop: 4,
        }}
      >
        ffmpeg is rendering to your project folder.
      </div>
    </div>
  </div>
);

const ReadyState = ({
  fullPath,
  onReveal,
}: {
  fullPath: string;
  onReveal: () => void;
}) => (
  <div
    className="card"
    style={{
      padding: 14,
      display: "flex",
      flexDirection: "column",
      gap: 10,
      minWidth: 380,
      maxWidth: 460,
    }}
  >
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span
        style={{
          display: "inline-flex",
          width: 18,
          height: 18,
          borderRadius: 999,
          background: "oklch(0.96 0.05 155)",
          border: "1px solid oklch(0.85 0.08 155)",
          color: "var(--green)",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Icon name="check" size={11} />
      </span>
      <span
        style={{
          fontSize: 12.5,
          fontWeight: 500,
          color: "oklch(0.42 0.13 155)",
        }}
      >
        Clip is in your project folder
      </span>
    </div>

    <PathRow fullPath={fullPath} />

    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <button
        className="btn btn-primary"
        onClick={onReveal}
        style={{ flex: 1 }}
      >
        <Icon name="folder" size={14} />
        {REVEAL_LABEL}
      </button>
    </div>
  </div>
);

const StaleState = ({
  fullPath,
  onReprepare,
  rendering,
}: {
  fullPath: string;
  onReprepare: () => void;
  rendering: boolean;
}) => (
  <div
    className="card"
    style={{
      padding: 14,
      display: "flex",
      flexDirection: "column",
      gap: 10,
      minWidth: 380,
      maxWidth: 460,
      background: "oklch(0.985 0.025 75)",
      borderColor: "oklch(0.9 0.06 75)",
    }}
  >
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
      <span
        style={{
          display: "inline-flex",
          width: 18,
          height: 18,
          borderRadius: 999,
          background: "oklch(0.97 0.04 75)",
          border: "1px solid oklch(0.9 0.06 75)",
          color: "oklch(0.5 0.13 75)",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          marginTop: 1,
        }}
      >
        <Icon name="alert" size={11} />
      </span>
      <span
        style={{
          fontSize: 12.5,
          fontWeight: 500,
          color: "oklch(0.4 0.13 75)",
          lineHeight: 1.45,
        }}
      >
        Bounds changed since last render — the file in your project folder
        reflects the older cut.
      </span>
    </div>

    <PathRow fullPath={fullPath} muted />

    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <button
        className="btn btn-primary"
        onClick={onReprepare}
        disabled={rendering}
        style={{ flex: 1 }}
      >
        {rendering ? <Spinner size={14} /> : <Icon name="refresh" size={14} />}
        {rendering ? "Re-preparing…" : "Re-prepare clip"}
      </button>
    </div>
  </div>
);

// --- The integrated control --------------------------------------------------

export const ClipFileActions = ({
  clip,
  onClipUpdated,
}: {
  clip: Clip;
  // Parent updates its local clip state after a successful render so the
  // component flips into Ready immediately without waiting for a refetch.
  onClipUpdated: (updated: Clip) => void;
}) => {
  const { pushToast } = useStore();
  const [rendering, setRendering] = useState(false);

  const state = deriveState(clip, rendering);

  const startRender = useCallback(async () => {
    if (rendering) return;
    setRendering(true);
    try {
      const updated = await api.prepareClip(clip.id);
      onClipUpdated(updated);
      pushToast({
        kind: "success",
        title: "Clip is ready",
        body: updated.renderedPath
          ? `Saved to your project folder.`
          : `Clip prepared.`,
        duration: 4000,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      pushToast({
        kind: "error",
        title: "Couldn't prepare clip",
        body: message,
        duration: 6000,
      });
    } finally {
      setRendering(false);
    }
  }, [rendering, clip.id, onClipUpdated, pushToast]);

  const onReveal = useCallback(async () => {
    if (!clip.renderedPath) return;
    try {
      await revealPath(clip.renderedPath);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      pushToast({
        kind: "error",
        title: `Couldn't open ${FILE_MANAGER}`,
        body: message,
        duration: 5000,
      });
    }
  }, [clip.renderedPath, pushToast]);

  if (state === "rendering") return <RenderingState />;
  if (state === "unrendered") {
    return <UnrenderedState onPrepare={startRender} />;
  }
  if (state === "stale") {
    return (
      <StaleState
        fullPath={clip.renderedPath ?? ""}
        onReprepare={startRender}
        rendering={rendering}
      />
    );
  }
  return (
    <ReadyState fullPath={clip.renderedPath ?? ""} onReveal={onReveal} />
  );
};
