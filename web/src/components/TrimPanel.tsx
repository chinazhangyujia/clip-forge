"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/lib/icons";
import type { Clip, ClipInterval } from "@/lib/types";

type Neighbor = { id: string; startSec: number; endSec: number };

type Props = {
  clip: Clip;
  sourceDurationSec: number;
  neighbors: Neighbor[];
  snapBoundaries: number[];
  // Project-level speech mask — pause-removed source-time intervals. The
  // panel re-intersects this with [draftStart, draftEnd] for live preview
  // of the speech bands as the user drags. Empty = no mask available
  // (legacy project) → fall back to single-band rendering.
  projectSpeechMask?: ClipInterval[];
  isPlaying: boolean;
  currentSec: number | null;
  onPreviewBand: (start: number | null, end?: number) => void;
  onSave: (startSec: number, endSec: number) => void;
  // Optional. Called while a handle is being dragged so the parent can
  // seek the source video to the new boundary — gives the user a live
  // preview of what frame each handle lands on.
  onScrubTo?: (sec: number) => void;
};

// Slice the project's speech mask by a source-time range. The result is
// the list of speech bands the renderer would actually concat — its sum
// is the compact duration the viewer experiences.
const sliceMask = (
  start: number,
  end: number,
  mask: ClipInterval[],
): ClipInterval[] => {
  if (mask.length === 0 || end <= start) return [];
  const out: ClipInterval[] = [];
  for (const iv of mask) {
    if (iv.endSec <= start || iv.startSec >= end) continue;
    const s = Math.max(iv.startSec, start);
    const e = Math.min(iv.endSec, end);
    if (e - s > 0.05) out.push({ startSec: s, endSec: e });
  }
  return out;
};

const fmtTrim = (s: number): string => {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${String(m).padStart(2, "0")}:${sec.toFixed(1).padStart(4, "0")}`;
};

const fmtMMSS = (s: number): string => {
  if (!isFinite(s) || s < 0) s = 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
};

const parseTrim = (str: string): number | null => {
  const t = str.trim();
  const m = t.match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const mm = m[1] ? parseInt(m[1], 10) : 0;
  const ss = parseFloat(m[2]);
  if (!isFinite(ss)) return null;
  return mm * 60 + ss;
};

// Window spans clipDuration + 2 * margin, where margin = max(clipDuration * 0.5, 15s).
// Clamped to [0, sourceDurationSec]. Centered on the clip.
const computeWindow = (
  startSec: number,
  endSec: number,
  sourceDurationSec: number,
): { winStart: number; winEnd: number; span: number } => {
  const clipDur = Math.max(0.5, endSec - startSec);
  const margin = Math.max(clipDur * 0.5, 15);
  let winStart = startSec - margin;
  let winEnd = endSec + margin;
  if (winStart < 0) {
    winEnd += -winStart;
    winStart = 0;
  }
  if (winEnd > sourceDurationSec) {
    winStart -= winEnd - sourceDurationSec;
    winEnd = sourceDurationSec;
  }
  winStart = Math.max(0, winStart);
  winEnd = Math.min(sourceDurationSec, winEnd);
  return { winStart, winEnd, span: winEnd - winStart };
};

type DragKind = "in" | "out";

type DragState = {
  kind: DragKind;
  pointerX: number;
  fixedOtherEdgeSec: number;
  currentDraftStart: number;
  currentDraftEnd: number;
  currentWinStart: number;
  currentWinSpan: number;
  lastFrameTs: number;
  raf: number | null;
  rect: DOMRect;
};

export const TrimPanel = ({
  clip,
  sourceDurationSec,
  neighbors,
  snapBoundaries,
  projectSpeechMask,
  isPlaying,
  currentSec,
  onPreviewBand,
  onSave,
  onScrubTo,
}: Props) => {
  const trackRef = useRef<HTMLDivElement>(null);

  const [draftStart, setDraftStart] = useState(clip.startSec);
  const [draftEnd, setDraftEnd] = useState(clip.endSec);
  const [snap, setSnap] = useState(true);
  const [drag, setDrag] = useState<DragKind | null>(null);
  const [inText, setInText] = useState(fmtTrim(clip.startSec));
  const [outText, setOutText] = useState(fmtTrim(clip.endSec));

  const initialWin = useMemo(
    () => computeWindow(clip.startSec, clip.endSec, sourceDurationSec),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [winStart, setWinStart] = useState(initialWin.winStart);
  const [winSpan, setWinSpan] = useState(initialWin.span);

  const winEnd = winStart + winSpan;

  const original = clip.original ?? { startSec: clip.startSec, endSec: clip.endSec };
  const dirty =
    Math.abs(draftStart - clip.startSec) > 0.05 || Math.abs(draftEnd - clip.endSec) > 0.05;
  const fromOriginal =
    Math.abs(draftStart - original.startSec) > 0.05 ||
    Math.abs(draftEnd - original.endSec) > 0.05;

  useEffect(() => {
    if (drag) onPreviewBand(draftStart, draftEnd);
    else onPreviewBand(null);
    return () => onPreviewBand(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, draftStart, draftEnd]);

  const viewFrac = (sec: number): number => (sec - winStart) / winSpan;
  const viewPct = (sec: number): string => `${viewFrac(sec) * 100}%`;

  const snapTo = useCallback(
    (sec: number): number => {
      if (!snap) return sec;
      const candidates = [0, sourceDurationSec, ...snapBoundaries];
      let best = sec;
      let bestDist = Infinity;
      const threshold = Math.max(0.5, winSpan * 0.012);
      for (const c of candidates) {
        const d = Math.abs(c - sec);
        if (d < bestDist && d <= threshold) {
          best = c;
          bestDist = d;
        }
      }
      return best;
    },
    [snap, snapBoundaries, sourceDurationSec, winSpan],
  );

  const dragStateRef = useRef<DragState | null>(null);

  const startDrag = (kind: DragKind, e: React.PointerEvent) => {
    e.preventDefault();
    if (!trackRef.current) return;
    setDrag(kind);

    const state: DragState = {
      kind,
      pointerX: e.clientX,
      fixedOtherEdgeSec: kind === "in" ? draftEnd : draftStart,
      currentDraftStart: draftStart,
      currentDraftEnd: draftEnd,
      currentWinStart: winStart,
      currentWinSpan: winSpan,
      lastFrameTs: performance.now(),
      raf: null,
      rect: trackRef.current.getBoundingClientRect(),
    };
    dragStateRef.current = state;

    const PAN_EDGE_PX = 36;

    const computeFromPointer = () => {
      const s = dragStateRef.current;
      if (!s) return;
      const rect = s.rect;
      const x = s.pointerX - rect.left;
      const clampedX = Math.max(0, Math.min(rect.width, x));
      const ratio = clampedX / rect.width;
      let sec = s.currentWinStart + ratio * s.currentWinSpan;
      sec = snapTo(sec);

      if (s.kind === "in") {
        sec = Math.max(0, Math.min(sec, s.fixedOtherEdgeSec - 0.5));
        s.currentDraftStart = sec;
        setDraftStart(sec);
        setInText(fmtTrim(sec));
      } else {
        sec = Math.max(s.fixedOtherEdgeSec + 0.5, Math.min(sec, sourceDurationSec));
        s.currentDraftEnd = sec;
        setDraftEnd(sec);
        setOutText(fmtTrim(sec));
      }
      onScrubTo?.(sec);
    };

    const tick = (ts: number) => {
      const s = dragStateRef.current;
      if (!s) return;
      const dt = Math.min(64, ts - s.lastFrameTs) / 1000;
      s.lastFrameTs = ts;

      const rect = s.rect;
      const xRel = s.pointerX - rect.left;

      let panSecPerSec = 0;

      if (xRel < PAN_EDGE_PX) {
        const into = PAN_EDGE_PX - xRel;
        const fracPerSec = 0.4 + Math.max(0, xRel < 0 ? -xRel : 0) * 0.025;
        panSecPerSec = -fracPerSec * s.currentWinSpan * (into / PAN_EDGE_PX);
      } else if (xRel > rect.width - PAN_EDGE_PX) {
        const into = xRel - (rect.width - PAN_EDGE_PX);
        const beyond = Math.max(0, xRel - rect.width);
        const fracPerSec = 0.4 + beyond * 0.025;
        panSecPerSec = fracPerSec * s.currentWinSpan * (into / PAN_EDGE_PX);
      }

      if (panSecPerSec !== 0) {
        let nextWinStart = s.currentWinStart + panSecPerSec * dt;
        nextWinStart = Math.max(
          0,
          Math.min(sourceDurationSec - s.currentWinSpan, nextWinStart),
        );
        if (nextWinStart !== s.currentWinStart) {
          s.currentWinStart = nextWinStart;
          setWinStart(nextWinStart);
        }
      }

      computeFromPointer();
      s.raf = requestAnimationFrame(tick);
    };

    const move = (ev: PointerEvent) => {
      const s = dragStateRef.current;
      if (!s || !trackRef.current) return;
      s.pointerX = ev.clientX;
      s.rect = trackRef.current.getBoundingClientRect();
      computeFromPointer();
    };

    const up = () => {
      const s = dragStateRef.current;
      if (s && s.raf != null) cancelAnimationFrame(s.raf);
      dragStateRef.current = null;
      setDrag(null);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    state.raf = requestAnimationFrame(tick);
  };

  const commitInput = (kind: DragKind) => {
    const raw = kind === "in" ? inText : outText;
    const parsed = parseTrim(raw);
    if (parsed == null) {
      if (kind === "in") setInText(fmtTrim(draftStart));
      else setOutText(fmtTrim(draftEnd));
      return;
    }
    if (kind === "in") {
      const v = Math.max(0, Math.min(parsed, draftEnd - 0.5));
      setDraftStart(v);
      setInText(fmtTrim(v));
      if (v < winStart || v > winEnd) {
        const w = computeWindow(v, draftEnd, sourceDurationSec);
        setWinStart(w.winStart);
        setWinSpan(w.span);
      }
    } else {
      const v = Math.max(draftStart + 0.5, Math.min(parsed, sourceDurationSec));
      setDraftEnd(v);
      setOutText(fmtTrim(v));
      if (v < winStart || v > winEnd) {
        const w = computeWindow(draftStart, v, sourceDurationSec);
        setWinStart(w.winStart);
        setWinSpan(w.span);
      }
    }
  };

  const reset = () => {
    setDraftStart(original.startSec);
    setDraftEnd(original.endSec);
    setInText(fmtTrim(original.startSec));
    setOutText(fmtTrim(original.endSec));
    const w = computeWindow(original.startSec, original.endSec, sourceDurationSec);
    setWinStart(w.winStart);
    setWinSpan(w.span);
  };

  const cancel = () => {
    setDraftStart(clip.startSec);
    setDraftEnd(clip.endSec);
    setInText(fmtTrim(clip.startSec));
    setOutText(fmtTrim(clip.endSec));
    const w = computeWindow(clip.startSec, clip.endSec, sourceDurationSec);
    setWinStart(w.winStart);
    setWinSpan(w.span);
  };

  const save = () => onSave(draftStart, draftEnd);

  // Active speech bands within the draft range. With a project mask the
  // panel renders one solid block per band (and a visible gap where each
  // long pause was removed); without a mask we fall back to a single band
  // covering [draftStart, draftEnd], same as before this feature.
  const activeBands: ClipInterval[] =
    projectSpeechMask && projectSpeechMask.length > 0
      ? sliceMask(draftStart, draftEnd, projectSpeechMask)
      : [{ startSec: draftStart, endSec: draftEnd }];
  const compactDuration = activeBands.reduce(
    (sum, b) => sum + (b.endSec - b.startSec),
    0,
  );
  const sourceSpan = draftEnd - draftStart;
  const removedSeconds = sourceSpan - compactDuration;

  const visibleNeighbors = neighbors.filter(
    (n) => n.id !== clip.id && n.endSec > winStart && n.startSec < winEnd,
  );

  const overlapping = neighbors.some(
    (n) => n.id !== clip.id && !(n.endSec <= draftStart || n.startSec >= draftEnd),
  );

  const visibleSnapBoundaries = snapBoundaries.filter(
    (b) => b >= winStart && b <= winEnd,
  );

  return (
    <div className="card" style={{ padding: 18, marginBottom: 14 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 14,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: 0.06,
              textTransform: "uppercase",
              color: "var(--fg-faint)",
            }}
          >
            Trim
          </span>
          <span
            className="mono"
            style={{
              fontSize: 12.5,
              color: dirty ? "var(--fg)" : "var(--fg-muted)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {fmtTrim(draftStart)} → {fmtTrim(draftEnd)}
            <span style={{ color: "var(--fg-faint)" }}> · </span>
            <span
              style={{
                color: dirty ? "var(--accent)" : "var(--fg-muted)",
                fontWeight: 500,
              }}
            >
              {compactDuration.toFixed(1)}s
            </span>
            {removedSeconds > 0.2 && (
              <span style={{ color: "var(--fg-faint)", marginLeft: 4 }}>
                (−{removedSeconds.toFixed(1)}s pauses)
              </span>
            )}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <TimeInput label="In" value={inText} onChange={setInText} onCommit={() => commitInput("in")} />
          <TimeInput label="Out" value={outText} onChange={setOutText} onCommit={() => commitInput("out")} />
          <SnapToggle value={snap} onChange={setSnap} />
          {fromOriginal && (
            <button
              onClick={reset}
              className="btn btn-sm"
              title="Restore pipeline's original cut"
              style={{ color: "var(--fg-muted)" }}
            >
              <Icon name="refresh" size={12} />
              Reset
            </button>
          )}
        </div>
      </div>

      <div style={{ position: "relative", padding: "14px 9px 24px" }}>
        <div
          style={{
            position: "absolute",
            left: 9,
            right: 9,
            bottom: 4,
            display: "flex",
            justifyContent: "space-between",
            fontFamily: "var(--font-mono-jb), ui-monospace, monospace",
            fontSize: 10,
            color: "var(--fg-faint)",
            letterSpacing: 0.02,
            pointerEvents: "none",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <span>{fmtMMSS(winStart)}</span>
          <span style={{ color: "var(--fg-faint)", opacity: 0.7 }}>
            window · {fmtMMSS(winSpan)}
          </span>
          <span>{fmtMMSS(winEnd)}</span>
        </div>

        <div
          ref={trackRef}
          style={{
            position: "relative",
            height: 6,
            background: "var(--border)",
            borderRadius: 999,
            cursor: "pointer",
          }}
          onPointerDown={(e) => {
            if (e.target !== trackRef.current) return;
            const rect = trackRef.current!.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const sec = winStart + (x / rect.width) * winSpan;
            const distIn = Math.abs(sec - draftStart);
            const distOut = Math.abs(sec - draftEnd);
            const kind: DragKind = distIn < distOut ? "in" : "out";
            if (kind === "in") {
              const v = snapTo(Math.max(0, Math.min(sec, draftEnd - 0.5)));
              setDraftStart(v);
              setInText(fmtTrim(v));
              onScrubTo?.(v);
            } else {
              const v = snapTo(Math.max(draftStart + 0.5, Math.min(sec, sourceDurationSec)));
              setDraftEnd(v);
              setOutText(fmtTrim(v));
              onScrubTo?.(v);
            }
          }}
        >
          {visibleNeighbors.map((n) => {
            const left = Math.max(0, viewFrac(n.startSec)) * 100;
            const right = Math.min(1, viewFrac(n.endSec)) * 100;
            const width = Math.max(0, right - left);
            return (
              <div
                key={n.id}
                title={`${fmtMMSS(n.startSec)} – ${fmtMMSS(n.endSec)}`}
                style={{
                  position: "absolute",
                  top: 0,
                  height: "100%",
                  left: `${left}%`,
                  width: `${width}%`,
                  background: "var(--fg-faint)",
                  opacity: 0.18,
                  borderRadius: 999,
                  pointerEvents: "none",
                }}
              />
            );
          })}

          {/* Faint outer-bounds region — the source-time span the user
              has selected. Speech bands render on top in solid color;
              the visible gap between them represents removed silence. */}
          <div
            style={{
              position: "absolute",
              top: 0,
              height: "100%",
              left: `${Math.max(0, viewFrac(draftStart)) * 100}%`,
              width: `${Math.max(0, Math.min(1, viewFrac(draftEnd)) - Math.max(0, viewFrac(draftStart))) * 100}%`,
              background: "var(--accent-soft)",
              borderRadius: 999,
              opacity: 0.55,
              pointerEvents: "none",
            }}
          />
          {activeBands.map((band, i) => {
            const left = Math.max(0, viewFrac(band.startSec)) * 100;
            const right = Math.min(1, viewFrac(band.endSec)) * 100;
            const width = Math.max(0, right - left);
            return (
              <div
                key={i}
                title={`Speech ${fmtTrim(band.startSec)} → ${fmtTrim(band.endSec)}`}
                style={{
                  position: "absolute",
                  top: 0,
                  height: "100%",
                  left: `${left}%`,
                  width: `${width}%`,
                  background: "var(--accent)",
                  borderRadius: activeBands.length === 1 ? 999 : 3,
                  boxShadow: drag ? "0 0 0 4px var(--accent-soft)" : "none",
                  transition: drag
                    ? "none"
                    : "box-shadow .15s, left .12s, width .12s",
                  pointerEvents: "none",
                }}
              />
            );
          })}

          {[
            { sec: original.startSec, key: "os" },
            { sec: original.endSec, key: "oe" },
          ]
            .filter((t) => t.sec >= winStart && t.sec <= winEnd)
            .map((t) => (
              <div
                key={t.key}
                title={`Original cut · ${fmtTrim(t.sec)}`}
                style={{
                  position: "absolute",
                  top: -3,
                  height: 12,
                  width: 1,
                  left: `calc(${viewPct(t.sec)} - 0.5px)`,
                  background: "var(--fg-muted)",
                  opacity: 0.55,
                  pointerEvents: "none",
                  zIndex: 1,
                }}
              />
            ))}

          {snap &&
            visibleSnapBoundaries.map((b, i) => (
              <div
                key={i}
                style={{
                  position: "absolute",
                  top: -2,
                  height: 10,
                  width: 1,
                  left: viewPct(b),
                  background: "var(--border-strong)",
                  opacity: 0.5,
                  pointerEvents: "none",
                }}
              />
            ))}

          {isPlaying && currentSec != null && currentSec >= winStart && currentSec <= winEnd && (
            <div
              style={{
                position: "absolute",
                top: -5,
                height: 16,
                width: 2,
                left: `calc(${viewPct(currentSec)} - 1px)`,
                background: "var(--fg)",
                borderRadius: 2,
                pointerEvents: "none",
                boxShadow: "0 0 0 2px var(--bg-elev)",
              }}
            />
          )}

          <Handle
            position={viewPct(draftStart)}
            visible={draftStart >= winStart && draftStart <= winEnd}
            active={drag === "in"}
            onPointerDown={(e) => startDrag("in", e)}
            label={fmtTrim(draftStart)}
            side="left"
          />
          <Handle
            position={viewPct(draftEnd)}
            visible={draftEnd >= winStart && draftEnd <= winEnd}
            active={drag === "out"}
            onPointerDown={(e) => startDrag("out", e)}
            label={fmtTrim(draftEnd)}
            side="right"
          />
        </div>
      </div>

      {(dirty || overlapping) && (
        <div
          style={{
            marginTop: 6,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              fontSize: 12,
              color: "var(--fg-muted)",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            {overlapping ? (
              <>
                <span style={{ color: "var(--amber)", display: "inline-flex" }}>
                  <Icon name="alert" size={13} />
                </span>
                <span>Overlaps with an adjacent clip — that&apos;s allowed, just a heads up.</span>
              </>
            ) : dirty ? (
              <>
                <span style={{ display: "inline-flex", color: "var(--accent)" }}>
                  <Icon name="info" size={13} />
                </span>
                <span>Unsaved changes</span>
              </>
            ) : null}
          </div>
          {dirty && (
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-sm" onClick={cancel}>
                Cancel
              </button>
              <button className="btn btn-sm btn-primary" onClick={save}>
                <Icon name="check" size={13} />
                Save
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const Handle = ({
  position,
  active,
  visible = true,
  onPointerDown,
  label,
  side,
}: {
  position: string;
  active: boolean;
  visible?: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  label: string;
  side: "left" | "right";
}) => (
  <div
    onPointerDown={onPointerDown}
    style={{
      position: "absolute",
      top: "50%",
      left: position,
      transform: `translate(-50%, -50%) scale(${active ? 1.15 : 1})`,
      width: 14,
      height: 14,
      borderRadius: 999,
      background: "var(--bg-elev)",
      border: "2px solid var(--accent)",
      boxShadow: active
        ? "0 0 0 6px var(--accent-soft), var(--shadow-sm)"
        : "var(--shadow-sm)",
      cursor: "ew-resize",
      transition: active ? "none" : "transform .12s, box-shadow .15s, left .12s",
      zIndex: 2,
      touchAction: "none",
      opacity: visible ? 1 : 0,
      pointerEvents: visible ? "auto" : "none",
    }}
  >
    {active && (
      <div
        className="mono"
        style={{
          position: "absolute",
          top: -28,
          [side === "left" ? "left" : "right"]: "50%",
          transform: side === "left" ? "translateX(-50%)" : "translateX(50%)",
          background: "var(--fg)",
          color: "var(--bg)",
          padding: "2px 6px",
          borderRadius: 4,
          fontSize: 10.5,
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
          pointerEvents: "none",
        }}
      >
        {label}
      </div>
    )}
  </div>
);

const TimeInput = ({
  label,
  value,
  onChange,
  onCommit,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
}) => (
  <label
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      background: "var(--bg-sunken)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-sm)",
      padding: "0 8px 0 10px",
      height: 28,
    }}
  >
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 600,
        letterSpacing: 0.06,
        textTransform: "uppercase",
        color: "var(--fg-faint)",
      }}
    >
      {label}
    </span>
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur();
      }}
      style={{
        width: 64,
        border: "none",
        outline: "none",
        background: "transparent",
        fontFamily: "var(--font-mono-jb), ui-monospace, monospace",
        fontSize: 12,
        fontVariantNumeric: "tabular-nums",
        color: "var(--fg)",
        padding: "4px 0",
      }}
    />
  </label>
);

const SnapToggle = ({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) => (
  <button
    onClick={() => onChange(!value)}
    title={value ? "Snapping to sentence boundaries" : "Frame-precise (no snapping)"}
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      height: 28,
      padding: "0 10px",
      borderRadius: "var(--radius-sm)",
      border: `1px solid ${value ? "var(--accent)" : "var(--border)"}`,
      background: value ? "var(--accent-soft)" : "var(--bg-elev)",
      color: value ? "oklch(0.45 0.16 45)" : "var(--fg-muted)",
      fontSize: 12,
      fontWeight: 500,
      transition: "all .12s",
    }}
  >
    <span
      style={{
        width: 14,
        height: 14,
        borderRadius: 3,
        display: "inline-grid",
        placeItems: "center",
        background: value ? "var(--accent)" : "transparent",
        border: value ? "none" : "1px solid var(--border-strong)",
        color: "white",
      }}
    >
      {value && <Icon name="check" size={9} />}
    </span>
    Snap to sentence
  </button>
);
