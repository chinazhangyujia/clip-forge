"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon, Spinner } from "@/lib/icons";
import { useStore } from "@/lib/store";
import { api } from "@/lib/api";
import type { Clip, ClipVariant } from "@/lib/types";

type VariantOpt = {
  key: ClipVariant;
  label: string;
  has: boolean;
  stale: boolean;
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

export const DownloadControl = ({
  clip,
  variants,
}: {
  clip: Clip;
  variants: VariantOpt[];
}) => {
  const { pushToast, addJob, removeJob } = useStore();
  const [open, setOpen] = useState(false);
  const [job, setJob] = useState<DownloadJob | null>(null);
  const [stuck, setStuck] = useState(false);
  // Tracker: when the active job's id changes, reset `stuck` during render
  // (rather than in an effect, which the React 19 lint forbids).
  const [stuckTrackedJobId, setStuckTrackedJobId] = useState<string | null>(null);
  const currentJobId = job?.jobId ?? null;
  if (stuckTrackedJobId !== currentJobId) {
    setStuckTrackedJobId(currentJobId);
    setStuck(false);
  }
  const popRef = useRef<HTMLDivElement>(null);

  // Close the dropdown when clicking outside.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // After ~10s of an in-flight job with no terminal state, show the "Still
  // working…" hint. The reset on job-change is handled by the tracker above.
  useEffect(() => {
    if (!job || job.phase === "done" || job.phase === "error") return;
    const t = window.setTimeout(() => setStuck(true), 10_000);
    return () => window.clearTimeout(t);
  }, [job]);

  const safeName = clip.title.replace(/[/\\]/g, "-");

  // Held by ref so the failure-toast's Retry action can re-invoke the latest
  // `start` without `start` having to close over itself (which would create a
  // forward-reference cycle).
  const startRef = useRef<(v: ClipVariant) => void>(() => {});

  const start = useCallback(
    (variantKey: ClipVariant) => {
      if (variantKey !== "original") return;
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

      (async () => {
        try {
          const res = await fetch(api.clipDownloadUrl(clip.id), {
            signal: abort.signal,
          });
          if (!res.ok) {
            throw new Error(`Server returned ${res.status}`);
          }
          // Move chip into "Saving…" while we materialize the blob.
          setJob((prev) => (prev ? { ...prev, phase: "saving" } : prev));
          const blob = await res.blob();

          // Trigger the browser's save dialog with a synthetic anchor click.
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `${safeName}.mp4`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);

          setJob((prev) => (prev ? { ...prev, phase: "done" } : prev));
          // Brief 1s success flash, then collapse and toast.
          window.setTimeout(() => {
            setJob(null);
            removeJob(jobId);
            pushToast({
              kind: "success",
              title: "Download ready",
              body: `${safeName}.mp4 saved`,
              duration: 5000,
            });
          }, 1000);
        } catch (e) {
          if (abort.signal.aborted) {
            return;
          }
          const message = e instanceof Error ? e.message : String(e);
          setJob((prev) =>
            prev ? { ...prev, phase: "error", error: message } : prev,
          );
          window.setTimeout(() => {
            setJob(null);
            removeJob(jobId);
          }, 800);
          pushToast({
            kind: "error",
            title: "Download failed",
            body: message,
            duration: 6000,
            action: {
              label: "Retry",
              onClick: () => startRef.current(variantKey),
            },
          });
        }
      })();
    },
    [clip, job, safeName, addJob, removeJob, pushToast],
  );

  // Keep the ref pointed at the latest `start`. React 19 disallows ref writes
  // during render, so route through a passive effect.
  useEffect(() => {
    startRef.current = start;
  });

  const cancel = useCallback(() => {
    if (!job) return;
    job.abort.abort();
    removeJob(job.jobId);
    setJob(null);
    pushToast({ kind: "info", title: "Download cancelled", duration: 3000 });
  }, [job, removeJob, pushToast]);

  if (job) {
    return <DownloadChip job={job} onCancel={cancel} stuck={stuck} />;
  }

  return (
    <div ref={popRef} style={{ position: "relative" }}>
      <button className="btn btn-primary" onClick={() => setOpen((o) => !o)}>
        <Icon name="download" size={14} />
        Download
        <Icon name="chevronDown" size={13} />
      </button>
      {open && (
        <div className="popover" style={{ width: 240 }}>
          <div className="popover-head">
            <span>Available Variants</span>
          </div>
          {variants.map((v) => {
            const enabled = v.has && v.key === "original";
            return (
              <button
                key={v.key}
                disabled={!enabled}
                onClick={() => {
                  if (!enabled) return;
                  setOpen(false);
                  start(v.key);
                }}
                title={
                  v.key === "original"
                    ? ""
                    : "Variant generation not yet implemented"
                }
                style={{
                  display: "flex",
                  width: "100%",
                  padding: "10px 14px",
                  alignItems: "center",
                  gap: 10,
                  fontSize: 13,
                  opacity: enabled ? 1 : 0.4,
                  cursor: enabled ? "pointer" : "not-allowed",
                  borderBottom: "1px solid var(--border)",
                  color: "inherit",
                  textAlign: "left",
                }}
              >
                <span style={{ color: "var(--fg-faint)" }}>
                  <Icon name={enabled ? "download" : "x"} size={13} />
                </span>
                <span style={{ flex: 1, textAlign: "left" }}>{v.label}</span>
                <span
                  className="mono"
                  style={{ fontSize: 10, color: "var(--fg-faint)" }}
                >
                  MP4
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
