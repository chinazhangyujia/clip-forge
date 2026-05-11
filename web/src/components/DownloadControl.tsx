"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon, Spinner } from "@/lib/icons";
import { useStore } from "@/lib/store";
import { api, formatDownloadError } from "@/lib/api";
import type { Clip } from "@/lib/types";

// Best-effort clipboard write. navigator.clipboard.writeText is available in
// the Tauri WebView (Edge WebView2 on Windows, WKWebView on Mac), but it can
// reject when the document isn't focused — e.g. user just clicked away. We
// resolve a boolean so the caller can fall back to manual select-and-copy
// from the modal textarea instead of swallowing the failure.
async function tryCopyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through.
  }
  return false;
}

type ErrorModalProps = {
  details: string;
  onClose: () => void;
};

// Fixed-position dialog over the page. Shown when the user clicks "Copy error
// details" on the failure toast. The friend reported the existing failure
// message ("Failed to fetch") was unactionable — this dialog puts a fully
// selectable, copy-button-backed diagnostic block one click away.
const ErrorDetailsModal = ({ details, onClose }: ErrorModalProps) => {
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const [copiedAt, setCopiedAt] = useState<number | null>(null);

  // Auto-select the text once the modal opens so the user can Ctrl+C even
  // if the Copy button fails. React 19 doesn't allow side effects in render,
  // so route through an effect on mount.
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  const handleCopy = useCallback(() => {
    void tryCopyToClipboard(details).then((ok) => {
      if (ok) {
        setCopiedAt(Date.now());
        return;
      }
      // Manual fallback — re-select so a Ctrl+C completes the copy.
      const el = textRef.current;
      if (el) {
        el.focus();
        el.select();
      }
    });
  }, [details]);

  // Close on Escape for keyboard users.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="dl-error-title"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "oklch(0 0 0 / 0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          padding: 20,
          width: "min(720px, 100%)",
          maxHeight: "min(80vh, 720px)",
          display: "flex",
          flexDirection: "column",
          gap: 12,
          boxShadow: "0 12px 40px oklch(0 0 0 / 0.18)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ color: "var(--red)", display: "inline-flex" }}>
            <Icon name="alert" size={18} />
          </span>
          <div id="dl-error-title" style={{ fontWeight: 600, fontSize: 15 }}>
            Download error details
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="btn-ghost btn-sm btn-icon"
            style={{ marginLeft: "auto", height: 28, width: 28 }}
          >
            <Icon name="x" size={14} />
          </button>
        </div>
        <div style={{ fontSize: 13, color: "var(--fg-muted)" }}>
          Send this whole block back to whoever set you up. It contains
          everything they need to diagnose the failure.
        </div>
        <textarea
          ref={textRef}
          readOnly
          value={details}
          spellCheck={false}
          style={{
            flex: 1,
            minHeight: 220,
            fontFamily: "var(--font-mono, ui-monospace, monospace)",
            fontSize: 12,
            lineHeight: 1.45,
            padding: 12,
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--bg-subtle, oklch(0.97 0.005 250))",
            color: "var(--fg)",
            resize: "vertical",
            whiteSpace: "pre",
            overflow: "auto",
          }}
        />
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={handleCopy} className="btn btn-primary">
            {copiedAt ? "Copied!" : "Copy to clipboard"}
          </button>
          <button onClick={onClose} className="btn">
            Close
          </button>
          <div
            style={{
              marginLeft: "auto",
              fontSize: 12,
              color: "var(--fg-faint)",
            }}
          >
            Or press <kbd>Ctrl</kbd>+<kbd>A</kbd> then <kbd>Ctrl</kbd>+<kbd>C</kbd>
          </div>
        </div>
      </div>
    </div>
  );
};

type Phase = "encoding" | "saving" | "done" | "error";

type DownloadJob = {
  phase: Phase;
  // Indeterminate while ffmpeg runs synchronously on the backend; we have no
  // progress telemetry. The chip therefore renders shimmer rather than a fill
  // width.
  startedAt: number;
  error?: string;
  jobId: string;
  abort: AbortController;
};

type ChipProps = {
  job: DownloadJob;
  onCancel: () => void;
  stuck: boolean;
};

const DownloadChip = ({ job, onCancel, stuck }: ChipProps) => {
  const [hover, setHover] = useState(false);
  const isDone = job.phase === "done";
  const isError = job.phase === "error";

  const label = isDone
    ? "Done"
    : isError
      ? "Failed"
      : job.phase === "saving"
        ? "Saving…"
        : "Encoding…";

  const accent = isDone
    ? "var(--green)"
    : isError
      ? "var(--red)"
      : "var(--accent)";

  const fillBg = isDone
    ? "oklch(0.96 0.05 155)"
    : isError
      ? "oklch(0.97 0.04 25)"
      : "var(--accent-soft)";

  const borderC = isDone
    ? "oklch(0.85 0.08 155)"
    : isError
      ? "oklch(0.88 0.08 25)"
      : "oklch(0.88 0.08 50)";

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      role="status"
      aria-live="polite"
      style={{
        height: 36,
        minWidth: 156,
        padding: "0 4px 0 12px",
        borderRadius: "var(--radius)",
        border: `1px solid ${borderC}`,
        background: fillBg,
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        position: "relative",
        overflow: "hidden",
        transition: "border-color .15s, background .15s",
        animation: isDone ? "chipFlashSuccess .8s ease-out" : undefined,
      }}
    >
      {/* Background fill — shimmer for in-flight, full tint for terminal states */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          overflow: "hidden",
          borderRadius: "inherit",
        }}
      >
        {isDone || isError ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: isDone ? "oklch(0.93 0.08 155)" : "oklch(0.94 0.06 25)",
            }}
          />
        ) : (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "linear-gradient(90deg, transparent 0%, oklch(1 0 0 / 0.55) 50%, transparent 100%)",
              animation: "chipShimmer 1.4s ease-in-out infinite",
            }}
          />
        )}
      </div>

      <span
        style={{
          position: "relative",
          zIndex: 1,
          color: accent,
          display: "inline-flex",
          flexShrink: 0,
        }}
      >
        {isDone ? (
          <Icon name="check" size={14} />
        ) : isError ? (
          <Icon name="alert" size={14} />
        ) : (
          <Spinner size={13} />
        )}
      </span>

      <span
        style={{
          position: "relative",
          zIndex: 1,
          fontSize: 12.5,
          fontWeight: 500,
          letterSpacing: "-0.005em",
          color: isDone
            ? "oklch(0.38 0.13 155)"
            : isError
              ? "oklch(0.4 0.16 25)"
              : "oklch(0.38 0.14 45)",
        }}
      >
        {label}
      </span>

      {!isDone && !isError && (
        <button
          onClick={onCancel}
          aria-label="Cancel download"
          title="Cancel download"
          style={{
            position: "relative",
            zIndex: 1,
            marginLeft: hover ? "auto" : "auto",
            opacity: hover ? 1 : 0,
            transition: "opacity .12s",
            width: 24,
            height: 24,
            borderRadius: 6,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "oklch(0.42 0.13 45)",
            background: "oklch(1 0 0 / 0.5)",
            flexShrink: 0,
          }}
        >
          <Icon name="x" size={12} />
        </button>
      )}

      {stuck && !isDone && !isError && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            fontSize: 11,
            color: "var(--fg-muted)",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            whiteSpace: "nowrap",
          }}
        >
          <span
            style={{
              display: "inline-block",
              width: 6,
              height: 6,
              borderRadius: 999,
              background: "var(--amber)",
            }}
          />
          Still working…
        </div>
      )}
    </div>
  );
};

export const DownloadControl = ({ clip }: { clip: Clip }) => {
  const { pushToast, addJob, removeJob } = useStore();
  const [job, setJob] = useState<DownloadJob | null>(null);
  const [stuck, setStuck] = useState(false);
  // Set when a download fails; shown as a modal so the friend can copy a
  // full diagnostic block (URL, status, response body, JS stack, env).
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  // Tracker: when the active job's id changes, reset `stuck` during render
  // (rather than in an effect, which the React 19 lint forbids).
  const [stuckTrackedJobId, setStuckTrackedJobId] = useState<string | null>(null);
  const currentJobId = job?.jobId ?? null;
  if (stuckTrackedJobId !== currentJobId) {
    setStuckTrackedJobId(currentJobId);
    setStuck(false);
  }

  // After ~10s of an in-flight job with no terminal state, show the "Still
  // working…" hint. The reset on job-change is handled by the tracker above.
  useEffect(() => {
    if (!job || job.phase === "done" || job.phase === "error") return;
    const t = window.setTimeout(() => setStuck(true), 10_000);
    return () => window.clearTimeout(t);
  }, [job]);

  const safeName = clip.title.replace(/[/\\]/g, "-");

  const start = useCallback(() => {
    if (job) return; // duplicate-click guard

    const abort = new AbortController();
    const jobId = `dl-${clip.id}-${Date.now()}`;

    setJob({
      phase: "encoding",
      startedAt: Date.now(),
      jobId,
      abort,
    });

    addJob({
      id: jobId,
      projectId: clip.projectId,
      label: `Downloading clip — ${clip.title}`,
      stage: "download",
      progress: 0,
      status: "running",
      indeterminate: true,
    });

    const url = api.clipDownloadUrl(clip.id);
    const filename = `${safeName}.mp4`;
    const startedAt = Date.now();

    (async () => {
      // Status info we need to format the diagnostic block on failure. Built
      // up as the fetch progresses; tracked outside the try so the catch can
      // see whatever we managed to capture.
      let status = 0;
      let statusText = "Network error";
      let responseText = "";
      // Set the moment fetch() resolves with headers. Splitting "time to
      // headers" from "time to body failure" tells us next time whether
      // the long wait was on the server (ffmpeg) or the wire (stream cut).
      let headersAt: number | null = null;
      try {
        const res = await fetch(url, { signal: abort.signal });
        headersAt = Date.now();
        status = res.status;
        statusText = res.statusText;
        if (!res.ok) {
          // Read the body BEFORE throwing so the catch block has the
          // backend's structured detail (cause/traceback) to render.
          try {
            responseText = await res.text();
          } catch {
            /* body read can itself fail mid-stream — that's fine. */
          }
          throw new Error(`Server returned ${status} ${statusText}`);
        }
        // Move chip into "Saving…" while we materialize the blob.
        setJob((prev) => (prev ? { ...prev, phase: "saving" } : prev));
        const blob = await res.blob();

        // Trigger the browser's save dialog with a synthetic anchor click.
        const objUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = objUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(objUrl);

        setJob((prev) => (prev ? { ...prev, phase: "done" } : prev));
        // Brief 1s success flash, then collapse and toast.
        window.setTimeout(() => {
          setJob(null);
          removeJob(jobId);
          pushToast({
            kind: "success",
            title: "Download ready",
            body: `${filename} saved`,
            duration: 5000,
          });
        }, 1000);
      } catch (e) {
        if (abort.signal.aborted) {
          return;
        }
        const shortMessage = e instanceof Error ? e.message : String(e);
        // Self-contained diagnostic block. The desktop user is non-technical;
        // the goal is one paste-able blob with everything we'd want for triage
        // (URL, response body if any, JS error stack, user agent, timing).
        const details = formatDownloadError({
          url,
          clipId: clip.id,
          clipTitle: clip.title,
          projectId: clip.projectId,
          status,
          statusText,
          responseText,
          thrown: e,
          startedAt,
          headersAt,
        });
        setJob((prev) =>
          prev ? { ...prev, phase: "error", error: shortMessage } : prev,
        );
        window.setTimeout(() => {
          setJob(null);
          removeJob(jobId);
        }, 800);
        // Open the error modal eagerly so the diagnostic block is in front
        // of the user immediately, and pre-copy to clipboard so the friend
        // can paste back without an extra click. The toast is a secondary
        // notification — the modal is the real UI for this failure mode.
        setErrorDetails(details);
        void tryCopyToClipboard(details);
        pushToast({
          kind: "error",
          title: "Download failed",
          body: shortMessage,
          action: {
            label: "Show error details",
            onClick: () => setErrorDetails(details),
          },
        });
      }
    })();
  }, [clip, job, safeName, addJob, removeJob, pushToast]);

  const cancel = useCallback(() => {
    if (!job) return;
    job.abort.abort();
    removeJob(job.jobId);
    setJob(null);
    pushToast({ kind: "info", title: "Download cancelled", duration: 3000 });
  }, [job, removeJob, pushToast]);

  const modal =
    errorDetails !== null ? (
      <ErrorDetailsModal
        details={errorDetails}
        onClose={() => setErrorDetails(null)}
      />
    ) : null;

  if (job) {
    return (
      <>
        <DownloadChip job={job} onCancel={cancel} stuck={stuck} />
        {modal}
      </>
    );
  }

  return (
    <>
      <button className="btn btn-primary" onClick={start}>
        <Icon name="download" size={14} />
        Download
      </button>
      {modal}
    </>
  );
};
