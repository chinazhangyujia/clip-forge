"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { api } from "@/lib/api";
import {
  compactToSource,
  cutsFromClip,
  fmtDuration,
  fmtTime,
  isPastLastInterval,
  nextSpeechSrcTime,
  sourceToCompact,
} from "@/lib/utils";
import { Icon, Spinner } from "@/lib/icons";
import { TrimPanel } from "@/components/TrimPanel";
import { DownloadControl } from "@/components/DownloadControl";
import { CutDivider, CutTickRail, CutsSummary } from "@/components/Cuts";
import type {
  Clip,
  ClipInterval,
  ClipVariant,
  Cut,
  StageState,
  TranscriptSegment,
} from "@/lib/types";

type GenKind = "reframe" | null;

type VariantOpt = { key: ClipVariant; label: string; has: boolean; stale: boolean };

type PreviewBand = { start: number; end: number } | null;

export type ClipDetailHint = { at: number; cut: string };

export const ClipDetail = ({
  projectId,
  clipId,
  hint,
}: {
  projectId: string;
  clipId: string;
  hint?: ClipDetailHint;
}) => {
  const { projects, clipsByProject, loadClips, updateClipBounds, updateClipLocally, pushToast } =
    useStore();
  const project = projects.find((p) => p.id === projectId);
  const clips = clipsByProject[projectId] || [];
  const clip = clips.find((c) => c.id === clipId);

  const [variant, setVariant] = useState<ClipVariant>("original");
  const [isPlaying, setIsPlaying] = useState(false);
  // currentSec is in source-time when playing the source URL with the
  // skip-silence logic, and rendered-file time (= compact time) when
  // playing a pre-rendered variant. Driven by the <video> element's events.
  const [currentSec, setCurrentSec] = useState(0);
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  // Project-level speech mask — used as a backdrop in the trim panel and
  // re-intersected with the user's draft bounds for live preview during a
  // drag. Empty array = legacy project with no mask, in which case the
  // trim panel falls back to single-band rendering.
  const [projectSpeechMask, setProjectSpeechMask] = useState<ClipInterval[]>([]);
  // `generating` is set to a variant key while the backend job is in
  // flight. The Generate button shows a spinner; we poll loadClips on a
  // timer and clear when the variant appears in clip.variants (and isn't
  // marked stale). Captions were dropped from MVP entirely; see
  // lib/types.ts for the rationale.
  const [generating, setGenerating] = useState<GenKind>(null);
  const [previewBand, setPreviewBand] = useState<PreviewBand>(null);
  // One-shot landing pill — appears briefly after navigating from the
  // project Auto-cuts report so the user sees where they landed. Cleared
  // by a timer; the seek itself is handled in Player via `seekHint`.
  const [landedFlash, setLandedFlash] = useState(false);
  const appliedHintRef = useRef<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!hint || !clip) return;
    if (appliedHintRef.current === hint.cut) return;
    appliedHintRef.current = hint.cut;
    setLandedFlash(true);
    const t = setTimeout(() => setLandedFlash(false), 2400);
    return () => clearTimeout(t);
  }, [hint, clip]);

  // Load clips for this project on mount (in case we deep-linked here).
  useEffect(() => {
    if (!clipsByProject[projectId]) {
      loadClips(projectId);
    }
  }, [projectId, clipsByProject, loadClips]);

  // Fetch the real transcript so the panel shows actual content (Chinese,
  // English, whatever the source is in) and the live-caption overlay works.
  useEffect(() => {
    let cancelled = false;
    api.fetchTranscript(projectId).then((segs) => {
      if (!cancelled) setTranscript(segs);
    });
    api.fetchSpeechIntervals(projectId).then((mask) => {
      if (!cancelled) setProjectSpeechMask(mask);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Poll the clip list while a variant is generating so the UI flips out
  // of "Generating…" automatically when the worker finishes the render.
  // Each tick reuses the existing loadClips fetch — no special endpoint.
  useEffect(() => {
    if (!generating) return;
    const tick = setInterval(() => {
      loadClips(projectId);
    }, 2500);
    return () => clearInterval(tick);
  }, [generating, projectId, loadClips]);

  // Detect completion: when the requested variant appears in clip.variants
  // and isn't stale, flip out of the generating state, switch the active
  // tab to it, and tell the user. Uses the React 19 tracker pattern (see
  // the InlineEdit component below for the canonical use) — an effect
  // with setState would trip the strict next/react-hooks lint.
  const [prevReadyVariant, setPrevReadyVariant] = useState<GenKind>(null);
  const readyVariant: GenKind =
    generating != null &&
    clip != null &&
    clip.variants.includes(generating) &&
    !(clip.staleVariants ?? []).includes(generating)
      ? generating
      : null;
  if (readyVariant !== prevReadyVariant) {
    setPrevReadyVariant(readyVariant);
    if (readyVariant != null) {
      setGenerating(null);
      setVariant(readyVariant);
      // Toasts are a side effect; defer to next tick so we're not
      // queuing one during render.
      const v = readyVariant;
      queueMicrotask(() =>
        pushToast({
          kind: "success",
          title: "Vertical reframe ready",
          body: "Switched to the 9:16 view.",
        }),
      );
      void v;
    }
  }

  // The Player owns its own seek-on-clip-change logic — it knows the
  // active variant (source vs. reframe) and what the right start
  // position is for each.

  // Local edits for in-memory metadata (title, hashtags, etc.) — not yet
  // persisted to backend. Trim bounds go through the real updateClipBounds.
  const updateClip = (patch: Partial<Clip>) => {
    updateClipLocally(clipId, patch);
  };

  // Seek helper used by TrimPanel as the user drags handles.
  const seekVideoTo = (sec: number) => {
    const v = videoRef.current;
    if (v && v.readyState >= 1) {
      v.currentTime = sec;
    }
  };

  const startReframeGeneration = async () => {
    if (generating) return;
    setGenerating("reframe");
    try {
      await api.generateReframe(clipId);
      pushToast({
        kind: "info",
        title: "Generating vertical reframe…",
        body: "Detecting the speaker and cropping to 9:16. This usually takes 30-60 seconds.",
      });
    } catch (e) {
      setGenerating(null);
      pushToast({
        kind: "error",
        title: "Couldn't start reframe",
        body: String(e instanceof Error ? e.message : e),
      });
    }
  };

  if (!project || !clip) {
    return (
      <div className="page">
        <div className="card" style={{ padding: 32, textAlign: "center", color: "var(--fg-muted)" }}>
          Clip not found.
          <div style={{ marginTop: 16 }}>
            <Link href="/" className="btn">
              Back to projects
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const hasReframe = clip.variants.includes("reframe");

  const staleVariants = clip.staleVariants ?? [];
  const isStale = (key: ClipVariant) => staleVariants.includes(key);

  const variants: VariantOpt[] = [
    { key: "original", label: "Original", has: true, stale: false },
    {
      key: "reframe",
      label: "+ Vertical reframe",
      has: hasReframe,
      stale: isStale("reframe"),
    },
  ];

  const anyStale = variants.some((v) => v.has && v.stale);

  const sourceDurationSec =
    project.file?.durationSec ?? Math.max(clip.endSec + 600, 600);

  // Snap-to-sentence boundaries come from the real transcript: each segment's
  // start/end is a natural sentence break.
  const snapBoundaries = transcript
    .flatMap((seg) => [seg.start, seg.end])
    .filter((t) => t >= 0 && t <= sourceDurationSec);

  const neighbors = clips.map((c) => ({
    id: c.id,
    startSec: c.startSec,
    endSec: c.endSec,
  }));

  // Auto-removed cuts surfaced on the transcript and the player scrubber.
  // Backend tags each removed range with a reason (long pause / filler);
  // we map them through the clip's compact timeline and place each one
  // after the transcript segment it belongs to.
  const visibleSegments = transcript.filter(
    (seg) => seg.end > clip.startSec && seg.start < clip.endSec,
  );
  const cuts: Cut[] = cutsFromClip(clip, visibleSegments);

  // Active cut: the one nearest the playhead within a small window — gives
  // the divider the same brief subtle highlight beat the active transcript
  // line uses. Compact-time clipTime drives this; reframe playback (which
  // plays a pre-rendered file) is treated as compact already.
  const reframeActive =
    variant === "reframe" &&
    clip.variants.includes("reframe") &&
    !(clip.staleVariants ?? []).includes("reframe");
  const compactNow = reframeActive
    ? currentSec
    : sourceToCompact(currentSec, clip.intervals);
  let activeCutId: string | null = null;
  if (isPlaying && cuts.length > 0) {
    let bestDist = 0.5;
    for (const c of cuts) {
      const d = Math.abs(compactNow - c.t);
      if (d < bestDist) {
        activeCutId = c.id;
        bestDist = d;
      }
    }
  }

  const onSaveTrim = async (startSec: number, endSec: number) => {
    const updated = await updateClipBounds(clipId, { startSec, endSec });
    if (updated) {
      pushToast({
        kind: "success",
        title: "Clip boundaries updated",
        body: `${fmtTime(startSec)} – ${fmtTime(endSec)} · ${(endSec - startSec).toFixed(1)}s`,
      });
    }
  };

  const regenerate = (key: ClipVariant) => {
    if (key === "reframe") {
      void startReframeGeneration();
    }
  };

  return (
    <div className="page" style={{ maxWidth: 1400 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 12,
          fontSize: 13,
          color: "var(--fg-muted)",
        }}
      >
        <Link href="/" style={{ color: "var(--fg-muted)" }}>
          Projects
        </Link>
        <span style={{ opacity: 0.5 }}>/</span>
        <Link href={`/project?id=${project.id}`} style={{ color: "var(--fg-muted)" }}>
          {project.name}
        </Link>
        <span style={{ opacity: 0.5 }}>/</span>
        <span style={{ color: "var(--fg)" }}>Clip</span>
      </div>

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>{clip.title}</h1>
          <div style={{ marginTop: 6, fontSize: 13, color: "var(--fg-muted)", display: "flex", gap: 14 }}>
            <span className="mono">
              {fmtTime(clip.startSec)} – {fmtTime(clip.endSec)}
            </span>
            <span>·</span>
            <span>{fmtDuration(clip.duration)}</span>
            <span>·</span>
            <span>9:16 vertical</span>
          </div>
        </div>
        <DownloadControl clip={clip} variants={variants} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 24, alignItems: "flex-start" }}>
        <main>
          <VariantTabs
            variants={variants}
            active={variant}
            setActive={setVariant}
            onGenerate={(k) => {
              if (k === "reframe") void startReframeGeneration();
            }}
            generating={generating}
          />
          {anyStale && (
            <StaleWarning variants={variants} onRegenerate={regenerate} generating={generating} />
          )}
          <TrimPanel
            key={`${clip.id}:${clip.startSec}:${clip.endSec}`}
            clip={clip}
            sourceDurationSec={sourceDurationSec}
            neighbors={neighbors}
            snapBoundaries={snapBoundaries}
            projectSpeechMask={projectSpeechMask}
            isPlaying={isPlaying}
            currentSec={isPlaying ? currentSec : null}
            onPreviewBand={(start, end) =>
              setPreviewBand(start == null ? null : { start, end: end ?? start })
            }
            onSave={onSaveTrim}
            onScrubTo={seekVideoTo}
          />
          <Player
            clip={clip}
            projectId={projectId}
            variant={variant}
            videoRef={videoRef}
            isPlaying={isPlaying}
            setIsPlaying={setIsPlaying}
            currentSec={currentSec}
            setCurrentSec={setCurrentSec}
            cuts={cuts}
            seekHint={hint?.at}
            seekHintKey={hint?.cut}
          />
          {landedFlash && hint != null && (
            <LandingPill projectId={projectId} at={hint.at} />
          )}
          <ActionBar
            hasReframe={hasReframe}
            generating={generating}
            genProgress={generating === "reframe" ? -1 : 0}
            onGenReframe={() => void startReframeGeneration()}
          />
          <CutsSummary cuts={cuts} />
          <Transcript
            segments={transcript}
            clip={clip}
            currentSec={currentSec}
            previewBand={previewBand}
            transcribeStage={project.pipeline.transcribe}
            cuts={cuts}
            activeCutId={activeCutId}
          />
        </main>

        <aside style={{ position: "sticky", top: 80, display: "flex", flexDirection: "column", gap: 14 }}>
          <MetaCard clip={clip} updateClip={updateClip} />
        </aside>
      </div>
    </div>
  );
};

// One-shot landing pill rendered above the player after navigating from
// the project Auto-cuts report. Auto-fades after a couple seconds; the
// inline link sends the user back to the report.
const LandingPill = ({ projectId, at }: { projectId: string; at: number }) => (
  <div
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      padding: "7px 12px",
      marginBottom: 14,
      borderRadius: 999,
      background: "var(--accent-soft)",
      border: "1px solid oklch(0.88 0.07 50)",
      color: "oklch(0.45 0.16 45)",
      fontSize: 12.5,
      fontWeight: 500,
      animation: "fadeIn .2s",
      boxShadow: "var(--shadow-sm)",
    }}
  >
    <span style={{ display: "inline-flex" }}>
      <Icon name="sparkle" size={12} />
    </span>
    Landed at{" "}
    <span className="mono" style={{ fontWeight: 600 }}>
      {fmtTime(at)}
    </span>{" "}
    from the auto-cut report
    <Link
      href={`/project?id=${projectId}`}
      style={{
        marginLeft: 8,
        color: "oklch(0.45 0.16 45)",
        borderLeft: "1px solid oklch(0.88 0.07 50)",
        paddingLeft: 10,
        fontSize: 11.5,
        fontWeight: 500,
      }}
    >
      Back to report
    </Link>
  </div>
);

const VariantTabs = ({
  variants,
  active,
  setActive,
  onGenerate,
  generating,
}: {
  variants: VariantOpt[];
  active: ClipVariant;
  setActive: (v: ClipVariant) => void;
  onGenerate: (k: GenKind) => void;
  generating: GenKind;
}) => (
  <div
    style={{
      display: "flex",
      background: "var(--bg-sunken)",
      borderRadius: "var(--radius)",
      padding: 4,
      gap: 2,
      marginBottom: 14,
    }}
  >
    {variants.map((v) => {
      const isActive = active === v.key;
      const dim = !v.has;
      const stale = v.has && v.stale;
      return (
        <button
          key={v.key}
          onClick={() => {
            if (v.has) setActive(v.key);
            else if (!generating) onGenerate(v.key as GenKind);
          }}
          style={{
            flex: 1,
            padding: "8px 12px",
            borderRadius: 6,
            background: isActive ? "var(--bg-elev)" : "transparent",
            border: "none",
            fontSize: 12.5,
            fontWeight: isActive ? 500 : 400,
            color:
              dim || stale ? "var(--fg-faint)" : isActive ? "var(--fg)" : "var(--fg-muted)",
            cursor: dim && generating ? "not-allowed" : "pointer",
            boxShadow: isActive ? "var(--shadow-sm)" : "none",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            transition: "all .12s",
            position: "relative",
            textAlign: "center",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            opacity: stale ? 0.7 : 1,
          }}
        >
          <span
            style={{
              textDecoration: stale ? "line-through" : "none",
              textDecorationColor: "var(--fg-faint)",
            }}
          >
            {v.label}
          </span>
          {dim && (
            <span
              style={{
                fontSize: 10,
                padding: "1px 6px",
                borderRadius: 999,
                background: "var(--bg-elev)",
                color: "var(--fg-faint)",
                fontWeight: 500,
                border: "1px solid var(--border)",
              }}
            >
              Generate
            </span>
          )}
          {stale && (
            <span
              style={{
                fontSize: 10,
                padding: "1px 6px",
                borderRadius: 999,
                background: "oklch(0.97 0.04 75)",
                color: "oklch(0.5 0.13 75)",
                fontWeight: 500,
                border: "1px solid oklch(0.9 0.06 75)",
              }}
            >
              Stale
            </span>
          )}
        </button>
      );
    })}
  </div>
);

const Player = ({
  clip,
  projectId,
  variant,
  videoRef,
  isPlaying,
  setIsPlaying,
  currentSec,
  setCurrentSec,
  cuts,
  seekHint,
  seekHintKey,
}: {
  clip: Clip;
  projectId: string;
  variant: ClipVariant;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  isPlaying: boolean;
  setIsPlaying: (p: boolean) => void;
  currentSec: number;
  setCurrentSec: (s: number) => void;
  cuts: Cut[];
  // Optional source-time second to seek to on mount/clip-load. Used by
  // the project Auto-cuts report deep-link (?at=&cut=). `seekHintKey`
  // identifies the hint so the seek doesn't re-fire on prop refreshes.
  seekHint?: number;
  seekHintKey?: string;
}) => {
  // The 9:16 variant plays a pre-rendered MP4 that's already silence-
  // removed, so we drop the source-time skip-silence machinery and treat
  // it as a single interval [0, clip.duration]. Source playback keeps
  // the multi-interval logic that jumps over removed pauses live.
  const reframeReady =
    clip.variants.includes("reframe") &&
    !(clip.staleVariants ?? []).includes("reframe");
  const usingReframe = variant === "reframe" && reframeReady;
  const isVertical = variant === "reframe";

  const intervals: ClipInterval[] = usingReframe
    ? [{ startSec: 0, endSec: clip.duration }]
    : clip.intervals;
  const firstStart = intervals[0]?.startSec ?? clip.startSec;
  const videoSrc = usingReframe
    ? api.variantUrl(clip.id, "reframe")
    : api.sourceUrl(projectId);

  // When the user switches clips inside the same project, the source
  // <video> element is reused (sourceUrl is project-scoped) and won't
  // emit `loadedmetadata` again — manually seek to this clip's start.
  // For reframe playback the variant URL changes per clip so a fresh
  // load fires automatically; this effect just no-ops in that case.
  useEffect(() => {
    const v = videoRef.current;
    if (v && v.readyState >= 1) v.currentTime = firstStart;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip.id, firstStart, usingReframe]);

  // Apply the deep-link seek hint from the Auto-cuts report. Runs after
  // the metadata-driven first-start seek so it wins. Reframe is skipped
  // — `seekHint` is source-time and the variant plays a pre-rendered
  // file. `seekHintKey` keys the effect so it fires once per landing.
  useEffect(() => {
    if (seekHint == null || usingReframe) return;
    const v = videoRef.current;
    if (!v) return;
    const apply = () => {
      v.currentTime = seekHint;
      setCurrentSec(seekHint);
    };
    if (v.readyState >= 1) apply();
    else v.addEventListener("loadedmetadata", apply, { once: true });
    return () => v.removeEventListener("loadedmetadata", apply);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip.id, seekHintKey, usingReframe]);

  // Clip-relative time for the controls + cold-open hook gating. With
  // silence removal, this is COMPACT time — `clip.duration` already comes
  // back as the sum of interval lengths from the backend, so the
  // progress bar reflects what the viewer actually experiences.
  const clipTime = Math.max(
    0,
    Math.min(clip.duration, sourceToCompact(currentSec, intervals)),
  );
  const progress = clip.duration > 0 ? clipTime / clip.duration : 0;
  const inHookWindow = Boolean(clip.hookText) && clipTime >= 0 && clipTime < 1.5;

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      if (isPastLastInterval(v.currentTime, intervals)) {
        v.currentTime = firstStart;
      }
      v.play().catch(() => {});
    } else {
      v.pause();
    }
  };

  const handleTimeUpdate = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const v = e.currentTarget;
    // Past the last speech window → pause and pin to the very end so the
    // scrubber lands at 100%.
    if (isPastLastInterval(v.currentTime, intervals)) {
      v.pause();
      v.currentTime = intervals[intervals.length - 1]?.endSec ?? clip.endSec;
      setCurrentSec(v.currentTime);
      return;
    }
    // We rolled into a removed-silence gap — jump to the start of the
    // next speech interval so the user never hears dead air.
    const nextStart = nextSpeechSrcTime(v.currentTime, intervals);
    if (nextStart != null && v.currentTime < nextStart) {
      v.currentTime = nextStart;
    }
    setCurrentSec(v.currentTime);
  };

  const handleLoadedMetadata = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const v = e.currentTarget;
    if (v.currentTime < firstStart || isPastLastInterval(v.currentTime, intervals)) {
      v.currentTime = firstStart;
    }
    setCurrentSec(v.currentTime);
  };

  const seekFromScrub = (e: React.MouseEvent<HTMLDivElement>) => {
    const v = videoRef.current;
    if (!v) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    // The scrub bar is in compact time; map back to a real source-time
    // position before seeking the underlying <video>.
    v.currentTime = compactToSource(frac * clip.duration, intervals);
  };

  return (
    <div className="card" style={{ overflow: "hidden", background: "oklch(0.12 0.01 60)" }}>
      <div
        style={{
          position: "relative",
          aspectRatio: isVertical ? "9 / 16" : "16 / 9",
          maxHeight: isVertical ? 560 : "unset",
          margin: isVertical ? "0 auto" : 0,
          width: isVertical ? "auto" : "100%",
          background: "oklch(0.08 0.005 60)",
          transition: "aspect-ratio .25s",
        }}
      >
        <video
          ref={videoRef}
          src={videoSrc}
          playsInline
          preload="metadata"
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            background: "black",
          }}
        />

        {inHookWindow && (
          <div
            style={{
              position: "absolute",
              top: "32%",
              left: "8%",
              right: "8%",
              color: "white",
              fontWeight: 800,
              fontSize: isVertical ? 32 : 38,
              letterSpacing: "-0.02em",
              textAlign: "center",
              textShadow: "0 2px 16px oklch(0 0 0 / 0.5)",
              lineHeight: 1.1,
              animation: "fadeIn .3s",
              pointerEvents: "none",
            }}
          >
            {clip.hookText}
          </div>
        )}

        {!isPlaying && (
          <button
            onClick={togglePlay}
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              background: "transparent",
              border: "none",
            }}
            aria-label="Play"
          >
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: 999,
                background: "oklch(1 0 0 / 0.95)",
                display: "grid",
                placeItems: "center",
                boxShadow: "var(--shadow-lg)",
                color: "var(--fg)",
              }}
            >
              <span style={{ marginLeft: 4 }}>
                <Icon name="play" size={22} />
              </span>
            </div>
          </button>
        )}

        {isVertical && (
          <div
            className="mono"
            style={{
              position: "absolute",
              top: 12,
              left: 12,
              background: "oklch(0 0 0 / 0.6)",
              color: "white",
              padding: "3px 8px",
              borderRadius: 4,
              fontSize: 10,
              letterSpacing: 0.05,
              pointerEvents: "none",
            }}
          >
            ZOOM &amp; FOLLOW · 9:16
          </div>
        )}
      </div>

      <div
        style={{
          padding: "10px 14px",
          background: "oklch(0.18 0.02 60)",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <button
          onClick={togglePlay}
          style={{ color: "white", display: "inline-flex" }}
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          <Icon name={isPlaying ? "pause" : "play"} size={16} />
        </button>
        <span className="mono" style={{ color: "oklch(1 0 0 / 0.7)", fontSize: 11 }}>
          {fmtTime(clipTime)} / {fmtTime(clip.duration)}
        </span>
        <div
          onClick={seekFromScrub}
          style={{
            flex: 1,
            height: 4,
            background: "oklch(1 0 0 / 0.15)",
            borderRadius: 999,
            cursor: "pointer",
            position: "relative",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${progress * 100}%`,
              background: "var(--accent)",
              borderRadius: 999,
            }}
          />
          {/* Auto-cut tick marks. The rail itself is pointer-events:none
              so click-to-scrub still passes through; ticks re-enable
              pointer events for their own hover tooltip. */}
          {cuts.length > 0 && clip.duration > 0 && (
            <CutTickRail cuts={cuts} durationSec={clip.duration} />
          )}
        </div>
      </div>
    </div>
  );
};

const ActionBar = ({
  hasReframe,
  generating,
  genProgress,
  onGenReframe,
}: {
  hasReframe: boolean;
  generating: GenKind;
  genProgress: number;
  onGenReframe: () => void;
}) => {
  const status = generating === "reframe" ? "Detecting instructor…" : null;
  return (
    <div style={{ marginTop: 14 }}>
      <ActionButton
        label="Generate vertical reframe"
        icon="crop"
        active={generating === "reframe"}
        progress={genProgress}
        status={status}
        done={hasReframe}
        onClick={onGenReframe}
        disabled={Boolean(generating) || hasReframe}
      />
    </div>
  );
};

const ActionButton = ({
  label,
  icon,
  active,
  progress,
  status,
  done,
  onClick,
  disabled,
}: {
  label: string;
  icon: "crop";
  active: boolean;
  progress: number;
  status: string | null;
  done: boolean;
  onClick: () => void;
  disabled: boolean;
}) => {
  if (active) {
    return (
      <div className="card" style={{ padding: 14, display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ color: "var(--accent)" }}>
          <Spinner size={16} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500 }}>
            {status}{" "}
            <span className="mono" style={{ color: "var(--accent)" }}>
              {Math.floor(progress)}%
            </span>
          </div>
          <div style={{ marginTop: 6, height: 3, background: "var(--bg-sunken)", borderRadius: 999, overflow: "hidden" }}>
            <div
              style={{
                height: "100%",
                width: `${progress}%`,
                background: "var(--accent)",
                borderRadius: 999,
                transition: "width .25s",
              }}
            />
          </div>
        </div>
      </div>
    );
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={done ? "btn" : "btn btn-primary"}
      style={{
        height: "auto",
        padding: 14,
        justifyContent: "flex-start",
        opacity: disabled && !done ? 0.55 : 1,
      }}
    >
      <span style={{ flexShrink: 0 }}>
        <Icon name={done ? "check" : icon} size={16} />
      </span>
      <span style={{ flex: 1, textAlign: "left" }}>
        {done ? `${label.replace("Generate ", "").replace(/^./, (c) => c.toUpperCase())} ready` : label}
      </span>
    </button>
  );
};

const Transcript = ({
  segments,
  clip,
  currentSec,
  previewBand,
  transcribeStage,
  cuts,
  activeCutId,
}: {
  segments: TranscriptSegment[];
  clip: Clip;
  currentSec: number;
  previewBand: PreviewBand;
  transcribeStage: StageState;
  cuts: Cut[];
  activeCutId: string | null;
}) => {
  const visible = segments.filter(
    (seg) => seg.end > clip.startSec && seg.start < clip.endSec,
  );

  // Index cuts by the segment they sit *after* so we can splice each
  // divider directly under its anchor row.
  const cutsAfter = cuts.reduce<Record<number, Cut[]>>((acc, c) => {
    (acc[c.afterIdx] ||= []).push(c);
    return acc;
  }, {});

  // The empty-segments case has three distinct meanings depending on the
  // pipeline state. Conflating them as "not finished" was actively
  // misleading: a user with rendered clips could see the message even
  // though transcribe had clearly completed.
  const transcribeNotDone =
    transcribeStage === "queued" || transcribeStage === "running";
  const transcribeFailed = transcribeStage === "failed";

  const emptyMessage =
    segments.length === 0
      ? transcribeFailed
        ? "Transcribe stage failed — re-run the project from the Pipeline panel to try again."
        : transcribeNotDone
          ? "Transcribe stage hasn't finished — refresh after pipeline completes."
          : "Transcribe finished, but produced no segments. Whisper found no speech in the audio."
      : null;

  const sub = previewBand
    ? "Previewing new boundaries…"
    : segments.length === 0
      ? transcribeNotDone
        ? "Transcript not yet available"
        : "No transcript segments"
      : "Highlights as the clip plays";

  return (
    <div className="card" style={{ marginTop: 20, padding: 20 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Transcript</h3>
          <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--fg-muted)" }}>{sub}</p>
        </div>
        <span style={{ fontSize: 11, color: "var(--fg-faint)" }}>Read-only</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {emptyMessage !== null ? (
          <div
            style={{
              color: "var(--fg-faint)",
              fontSize: 13,
              padding: "8px 4px",
            }}
          >
            {emptyMessage}
          </div>
        ) : visible.length === 0 ? (
          <div
            style={{
              color: "var(--fg-faint)",
              fontSize: 13,
              padding: "8px 4px",
            }}
          >
            No transcript content within this clip&apos;s window.
          </div>
        ) : (
          visible.flatMap((seg, i) => {
            const isActive =
              currentSec >= seg.start && currentSec < seg.end;

            let inPreview = true;
            let onPreviewEdge = false;
            if (previewBand) {
              inPreview =
                seg.start < previewBand.end && seg.end > previewBand.start;
              if (inPreview) {
                const distStart = Math.abs(seg.start - previewBand.start);
                const distEnd = Math.abs(seg.end - previewBand.end);
                onPreviewEdge = distStart < 3 || distEnd < 3;
              }
            }
            const dimmed = Boolean(previewBand) && !inPreview;
            const highlighted = isActive || (Boolean(previewBand) && inPreview);

            const segNode = (
              <div
                key={`seg-${i}`}
                style={{
                  display: "flex",
                  gap: 14,
                  padding: "7px 10px",
                  borderRadius: 6,
                  background: highlighted ? "var(--accent-soft)" : "transparent",
                  opacity: dimmed ? 0.35 : 1,
                  transition: "background .15s, opacity .15s",
                  borderLeft: onPreviewEdge
                    ? "2px solid var(--accent)"
                    : "2px solid transparent",
                  paddingLeft: 8,
                }}
              >
                <span
                  className="mono"
                  style={{
                    color: highlighted ? "oklch(0.5 0.16 45)" : "var(--fg-faint)",
                    fontSize: 11,
                    flexShrink: 0,
                    width: 56,
                    paddingTop: 2,
                    fontWeight: highlighted ? 500 : 400,
                  }}
                >
                  {fmtTime(seg.start)}
                </span>
                <span
                  style={{
                    fontSize: 13.5,
                    lineHeight: 1.55,
                    color: highlighted ? "var(--fg)" : "var(--fg-muted)",
                    fontWeight: highlighted ? 500 : 400,
                  }}
                >
                  {seg.text.trim()}
                </span>
              </div>
            );

            // Splice in any dividers that anchor to this segment.
            const after = cutsAfter[i];
            if (!after || after.length === 0) return [segNode];
            return [
              segNode,
              ...after.map((cut) => (
                <CutDivider
                  key={`cut-${cut.id}`}
                  cut={cut}
                  active={activeCutId === cut.id}
                />
              )),
            ];
          })
        )}
      </div>
    </div>
  );
};

const StaleWarning = ({
  variants,
  onRegenerate,
  generating,
}: {
  variants: VariantOpt[];
  onRegenerate: (key: ClipVariant) => void;
  generating: GenKind;
}) => {
  const stale = variants.filter((v) => v.has && v.stale);
  if (stale.length === 0) return null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px",
        marginBottom: 14,
        borderRadius: "var(--radius)",
        border: "1px solid oklch(0.9 0.06 75)",
        background: "oklch(0.98 0.025 75)",
        flexWrap: "wrap",
      }}
    >
      <span style={{ color: "oklch(0.5 0.13 75)", display: "inline-flex", flexShrink: 0 }}>
        <Icon name="alert" size={14} />
      </span>
      <span style={{ fontSize: 12.5, color: "oklch(0.4 0.08 75)", flex: 1, minWidth: 200 }}>
        Captions and reframe were generated for the previous cut. Regenerate to apply the new boundaries.
      </span>
      <div style={{ display: "flex", gap: 6 }}>
        {stale.map((v) => (
          <button
            key={v.key}
            onClick={() => onRegenerate(v.key)}
            disabled={Boolean(generating)}
            className="btn btn-sm"
            style={{
              background: "var(--bg-elev)",
              borderColor: "oklch(0.9 0.06 75)",
              color: "oklch(0.4 0.08 75)",
            }}
          >
            <Icon name="refresh" size={12} />
            Regenerate {v.key}
          </button>
        ))}
      </div>
    </div>
  );
};

const MetaCard = ({ clip, updateClip }: { clip: Clip; updateClip: (patch: Partial<Clip>) => void }) => (
  <div className="card" style={{ padding: 16 }}>
    <div
      style={{
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: 0.06,
        textTransform: "uppercase",
        color: "var(--fg-faint)",
        marginBottom: 14,
      }}
    >
      Clip metadata
    </div>
    <EditableField label="Title" value={clip.title} onSave={(v) => updateClip({ title: v })} />
    <EditableField label="Description" value={clip.description} multiline onSave={(v) => updateClip({ description: v })} />
    <HashtagField hashtags={clip.hashtags} onChange={(v) => updateClip({ hashtags: v })} />
    <EditableField
      label="Cold-open hook"
      sub="Overlay over first 1.5s"
      value={clip.hookText}
      onSave={(v) => updateClip({ hookText: v })}
    />
    <ThumbField
      clip={clip}
      onRegenerate={() => updateClip({ thumbFrame: Math.floor(Math.random() * 100) })}
    />
  </div>
);

const EditableField = ({
  label,
  sub,
  value,
  multiline,
  onSave,
}: {
  label: string;
  sub?: string;
  value: string;
  multiline?: boolean;
  onSave: (v: string) => void;
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [prevValue, setPrevValue] = useState(value);
  const [regenerating, setRegenerating] = useState(false);

  // Sync draft when external value changes (parent regenerated, etc.).
  // Uses the React 19 tracker pattern instead of an effect.
  if (prevValue !== value) {
    setPrevValue(value);
    setDraft(value);
  }

  const regen = () => {
    setRegenerating(true);
    setTimeout(() => {
      const altered =
        label === "Title"
          ? "Three words that 100x'd my views (a small teaching story)"
          : label === "Description"
          ? "A short, punchy clip pulled from a longer talk. Watch for the moment a 3-word change unlocks 1.4M views."
          : label === "Cold-open hook"
          ? "I changed three words."
          : value + " (regenerated)";
      onSave(altered);
      setRegenerating(false);
    }, 900);
  };

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <div>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: 0.06,
              textTransform: "uppercase",
              color: "var(--fg-faint)",
            }}
          >
            {label}
          </span>
          {sub && (
            <span
              style={{
                fontSize: 10.5,
                color: "var(--fg-faint)",
                marginLeft: 6,
                fontWeight: 400,
                textTransform: "none",
                letterSpacing: 0,
              }}
            >
              · {sub}
            </span>
          )}
        </div>
        <button
          onClick={regen}
          disabled={regenerating}
          title="Regenerate"
          style={{ padding: 3, color: regenerating ? "var(--accent)" : "var(--fg-faint)", borderRadius: 4 }}
        >
          {regenerating ? <Spinner size={11} /> : <Icon name="sparkle" size={12} />}
        </button>
      </div>
      {editing ? (
        multiline ? (
          <textarea
            className="textarea"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              onSave(draft);
              setEditing(false);
            }}
            autoFocus
            rows={3}
            style={{ fontSize: 13 }}
          />
        ) : (
          <input
            className="input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              onSave(draft);
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onSave(draft);
                setEditing(false);
              }
            }}
            autoFocus
            style={{ fontSize: 13, padding: "6px 8px" }}
          />
        )
      ) : (
        <div
          onClick={() => setEditing(true)}
          style={{
            fontSize: 13,
            lineHeight: 1.5,
            padding: "6px 8px",
            margin: "0 -8px",
            borderRadius: 5,
            cursor: "text",
            transition: "background .12s",
            color: "var(--fg)",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-sunken)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          {value}
        </div>
      )}
    </div>
  );
};

const HashtagField = ({ hashtags, onChange }: { hashtags: string[]; onChange: (v: string[]) => void }) => {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  const add = () => {
    const v = draft.trim().replace(/^#/, "");
    if (v) onChange([...hashtags, v]);
    setDraft("");
    setAdding(false);
  };

  const remove = (i: number) => onChange(hashtags.filter((_, idx) => idx !== i));

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: 0.06,
            textTransform: "uppercase",
            color: "var(--fg-faint)",
          }}
        >
          Hashtags
        </span>
        <button title="Regenerate" style={{ padding: 3, color: "var(--fg-faint)", borderRadius: 4 }}>
          <Icon name="sparkle" size={12} />
        </button>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {hashtags.map((h, i) => (
          <span
            key={i}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "3px 4px 3px 8px",
              background: "var(--bg-sunken)",
              border: "1px solid var(--border)",
              borderRadius: 999,
              fontSize: 12,
              fontFamily: "var(--font-mono-jb), ui-monospace, monospace",
            }}
          >
            #{h}
            <button
              onClick={() => remove(i)}
              style={{ display: "inline-flex", color: "var(--fg-faint)", padding: 2, borderRadius: 999 }}
            >
              <Icon name="x" size={11} />
            </button>
          </span>
        ))}
        {adding ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={add}
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
              if (e.key === "Escape") {
                setDraft("");
                setAdding(false);
              }
            }}
            placeholder="tag"
            style={{
              border: "1px dashed var(--border-strong)",
              background: "transparent",
              padding: "2px 8px",
              borderRadius: 999,
              fontSize: 12,
              fontFamily: "var(--font-mono-jb), ui-monospace, monospace",
              outline: "none",
              width: 80,
            }}
          />
        ) : (
          <button
            onClick={() => setAdding(true)}
            style={{
              padding: "3px 10px",
              border: "1px dashed var(--border-strong)",
              borderRadius: 999,
              fontSize: 12,
              color: "var(--fg-faint)",
              background: "transparent",
            }}
          >
            + add
          </button>
        )}
      </div>
    </div>
  );
};

const ThumbField = ({ clip, onRegenerate }: { clip: Clip; onRegenerate: () => void }) => {
  const [regenerating, setRegenerating] = useState(false);
  const seed = clip.thumbFrame + clip.id.charCodeAt(0);
  const h1 = (seed * 13) % 360;
  const h2 = (h1 + 50) % 360;

  const regen = () => {
    setRegenerating(true);
    setTimeout(() => {
      onRegenerate();
      setRegenerating(false);
    }, 700);
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: 0.06,
            textTransform: "uppercase",
            color: "var(--fg-faint)",
          }}
        >
          Thumbnail
        </span>
        <button
          onClick={regen}
          disabled={regenerating}
          title="Pick another frame"
          style={{ padding: 3, color: regenerating ? "var(--accent)" : "var(--fg-faint)", borderRadius: 4 }}
        >
          {regenerating ? <Spinner size={11} /> : <Icon name="refresh" size={12} />}
        </button>
      </div>
      <div
        style={{
          aspectRatio: "9 / 16",
          maxHeight: 160,
          width: 90,
          borderRadius: 6,
          background: `linear-gradient(135deg, oklch(0.5 0.13 ${h1}), oklch(0.35 0.14 ${h2}))`,
          position: "relative",
          overflow: "hidden",
          opacity: regenerating ? 0.5 : 1,
          transition: "opacity .2s",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "radial-gradient(120% 80% at 30% 30%, oklch(1 0 0 / 0.18), transparent 55%)",
          }}
        />
        <span
          className="mono"
          style={{
            position: "absolute",
            bottom: 6,
            right: 6,
            fontSize: 9,
            color: "oklch(1 0 0 / 0.85)",
          }}
        >
          frame {clip.thumbFrame}
        </span>
      </div>
    </div>
  );
};
