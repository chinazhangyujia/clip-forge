"use client";

import { useRef, useState } from "react";
import type { Cut, CutReason } from "@/lib/types";

// One reason system, four expressions:
//   - REASON_META: tokens (label, color family, glyph) per reason
//   - CutsSummary: the meta row above the transcript card
//   - CutDivider: divider between two transcript segments where a cut sits
//   - CutTickRail: the tick marks + hover tooltip on the player scrubber
// Long pause is the only reason currently produced by the backend; the
// other three live in the type system so adding them is a data change.

type ReasonStyle = {
  label: string;
  plural: string;
  accent: string;
  soft: string;
  border: string;
  fg: string;
};

export const REASON_META: Record<CutReason, ReasonStyle> = {
  pause: {
    label: "Long pause",
    plural: "Long pauses",
    accent: "oklch(0.62 0.13 240)",
    soft: "oklch(0.965 0.025 240)",
    border: "oklch(0.9 0.05 240)",
    fg: "oklch(0.42 0.12 240)",
  },
  filler: {
    label: "Filler word",
    plural: "Filler words",
    accent: "oklch(0.62 0.13 300)",
    soft: "oklch(0.965 0.025 300)",
    border: "oklch(0.9 0.05 300)",
    fg: "oklch(0.42 0.12 300)",
  },
  repeat: {
    label: "Repeat phrase",
    plural: "Repeat phrases",
    accent: "oklch(0.62 0.13 165)",
    soft: "oklch(0.965 0.03 165)",
    border: "oklch(0.9 0.06 165)",
    fg: "oklch(0.4 0.12 165)",
  },
  lowvalue: {
    label: "Low-value",
    plural: "Low-value",
    accent: "oklch(0.6 0.04 60)",
    soft: "oklch(0.965 0.008 60)",
    border: "oklch(0.9 0.012 60)",
    fg: "oklch(0.42 0.02 60)",
  },
};

// Glyph metaphor leans toward "kind of content removed" rather than
// scissors — scissors would imply the user did the cut.
export const ReasonGlyph = ({ reason, size = 14 }: { reason: CutReason; size?: number }) => {
  const body = (() => {
    switch (reason) {
      case "pause":
        return (
          <g>
            <rect x="8" y="5" width="3" height="14" rx="1" fill="currentColor" stroke="none" />
            <rect x="13" y="5" width="3" height="14" rx="1" fill="currentColor" stroke="none" />
          </g>
        );
      case "filler":
        return (
          <g>
            <path d="M5 9.5a4.5 4.5 0 0 1 4.5-4.5h5A4.5 4.5 0 0 1 19 9.5v1A4.5 4.5 0 0 1 14.5 15H10l-3.5 3v-3.5A4.5 4.5 0 0 1 5 10.5z" />
            <circle cx="9" cy="10" r="0.9" fill="currentColor" stroke="none" />
            <circle cx="12" cy="10" r="0.9" fill="currentColor" stroke="none" />
            <circle cx="15" cy="10" r="0.9" fill="currentColor" stroke="none" />
          </g>
        );
      case "repeat":
        return (
          <g>
            <path d="M5 12a7 7 0 0 1 12-4.9" />
            <polyline points="17 4 17 8 13 8" />
            <path d="M19 12a7 7 0 0 1-12 4.9" />
            <polyline points="7 20 7 16 11 16" />
          </g>
        );
      case "lowvalue":
        return (
          <g>
            <path d="M9 14a4 4 0 1 1 6 0c-.5.6-.8 1.2-1 2H10c-.2-.8-.5-1.4-1-2z" />
            <line x1="10" y1="19" x2="14" y2="19" />
            <line x1="11" y1="21" x2="13" y2="21" />
            <path d="M16 5h2.5L16 8h2.5" strokeWidth="1.4" />
          </g>
        );
    }
  })();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {body}
    </svg>
  );
};

const ScissorsIcon = ({ size = 13 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="6" cy="7" r="2.5" />
    <circle cx="6" cy="17" r="2.5" />
    <line x1="8" y1="8.5" x2="20" y2="16" />
    <line x1="8" y1="15.5" x2="20" y2="8" />
  </svg>
);

const fmtRemoved = (sec: number): string => `−${sec.toFixed(1)}s`;

// ---------- Divider — sits between two transcript segments ----------
export const CutDivider = ({ cut, active }: { cut: Cut; active: boolean }) => {
  const m = REASON_META[cut.reason];
  return (
    <div
      role="separator"
      aria-label={`${m.label}, ${fmtRemoved(cut.removedSec)} removed`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        margin: "4px 8px 4px 46px",
        padding: "4px 6px",
        borderRadius: 4,
        position: "relative",
        background: active ? m.soft : "transparent",
        transition: "background .25s",
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          padding: "1px 7px 1px 5px",
          borderRadius: 999,
          color: m.fg,
          background: m.soft,
          border: `1px solid ${m.border}`,
          fontSize: 10.5,
          fontWeight: 500,
          letterSpacing: 0.01,
          flexShrink: 0,
        }}
      >
        <span style={{ display: "inline-flex", color: m.accent }}>
          <ReasonGlyph reason={cut.reason} size={11} />
        </span>
        {m.label}
      </span>

      <span
        aria-hidden
        style={{
          flex: 1,
          height: 0,
          borderTop: `1px dashed ${active ? m.border : "var(--border)"}`,
          transition: "border-color .25s",
        }}
      />

      <span
        className="mono"
        style={{
          fontSize: 10.5,
          color: "var(--fg-faint)",
          fontVariantNumeric: "tabular-nums",
          flexShrink: 0,
        }}
      >
        {fmtRemoved(cut.removedSec)}
      </span>
    </div>
  );
};

// ---------- Tick rail + hover tooltip — sits inside the player scrubber ----------
// The rail itself is pointer-events:none so click-to-scrub passes through;
// only the individual tick glyphs grab pointer events for the tooltip.
const CutTick = ({
  cut,
  percent,
  hovered,
  onHover,
  onLeave,
}: {
  cut: Cut;
  percent: number;
  hovered: boolean;
  onHover: (cut: Cut, e: React.PointerEvent) => void;
  onLeave: () => void;
}) => {
  const m = REASON_META[cut.reason];
  return (
    <span
      onPointerEnter={(e) => onHover(cut, e)}
      onPointerLeave={onLeave}
      style={{
        position: "absolute",
        left: `${percent}%`,
        top: "50%",
        transform: "translate(-50%, -50%)",
        width: 10,
        height: 14,
        display: "grid",
        placeItems: "center",
        cursor: "default",
        pointerEvents: "auto",
      }}
    >
      <span
        style={{
          width: hovered ? 4 : 3,
          height: 14,
          borderRadius: 2,
          background: m.accent,
          boxShadow: hovered
            ? `0 0 0 2px oklch(1 0 0 / 0.25), 0 0 0 1px ${m.accent}`
            : "0 0 0 1px oklch(0 0 0 / 0.15)",
          transition: "width .12s, box-shadow .12s",
        }}
      />
    </span>
  );
};

const CutTickTooltip = ({ cut, x }: { cut: Cut; x: number }) => {
  const m = REASON_META[cut.reason];
  return (
    <span
      style={{
        position: "absolute",
        left: `${x}%`,
        bottom: "calc(100% + 10px)",
        transform: "translateX(-50%)",
        background: "oklch(0.18 0.01 60)",
        color: "oklch(0.99 0 0)",
        padding: "6px 9px 6px 7px",
        borderRadius: 6,
        whiteSpace: "nowrap",
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        fontSize: 11.5,
        fontWeight: 500,
        boxShadow: "0 6px 18px oklch(0 0 0 / 0.25)",
        pointerEvents: "none",
        zIndex: 5,
      }}
    >
      <span style={{ display: "inline-flex", color: m.accent }}>
        <ReasonGlyph reason={cut.reason} size={12} />
      </span>
      {m.label}
      <span
        className="mono"
        style={{
          color: "oklch(1 0 0 / 0.55)",
          fontWeight: 400,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {fmtRemoved(cut.removedSec)}
      </span>
      <span
        aria-hidden
        style={{
          position: "absolute",
          top: "100%",
          left: "50%",
          transform: "translateX(-50%)",
          width: 0,
          height: 0,
          borderLeft: "5px solid transparent",
          borderRight: "5px solid transparent",
          borderTop: "5px solid oklch(0.18 0.01 60)",
        }}
      />
    </span>
  );
};

export const CutTickRail = ({
  cuts,
  durationSec,
}: {
  cuts: Cut[];
  durationSec: number;
}) => {
  const [hovered, setHovered] = useState<string | null>(null);
  const railRef = useRef<HTMLSpanElement | null>(null);
  if (cuts.length === 0 || durationSec <= 0) return null;
  return (
    <span
      ref={railRef}
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
      }}
    >
      {cuts.map((cut) => {
        const pct = Math.max(0, Math.min(100, (cut.t / durationSec) * 100));
        return (
          <CutTick
            key={cut.id}
            cut={cut}
            percent={pct}
            hovered={hovered === cut.id}
            onHover={() => setHovered(cut.id)}
            onLeave={() => setHovered(null)}
          />
        );
      })}
      {hovered != null &&
        (() => {
          const cut = cuts.find((c) => c.id === hovered);
          if (!cut) return null;
          return (
            <CutTickTooltip cut={cut} x={(cut.t / durationSec) * 100} />
          );
        })()}
    </span>
  );
};

// ---------- Summary row — above the transcript card ----------
// Multi-reason: "3 cuts removed 7.6s" + per-reason chips
// Single-reason: collapses to "3 long pauses · −7.6s"
// Zero cuts: returns null (parent doesn't render the row)
export const CutsSummary = ({ cuts }: { cuts: Cut[] }) => {
  if (!cuts || cuts.length === 0) return null;

  const totalRemoved = cuts.reduce((sum, c) => sum + c.removedSec, 0);
  const byReason = cuts.reduce<Record<string, number>>((acc, c) => {
    acc[c.reason] = (acc[c.reason] || 0) + 1;
    return acc;
  }, {});
  const reasonKeys = Object.keys(byReason) as CutReason[];
  const single = reasonKeys.length === 1;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        padding: "10px 14px",
        margin: "20px 0 -2px",
        background: "var(--bg-sunken)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        fontSize: 12.5,
        color: "var(--fg-muted)",
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          color: "var(--fg)",
          fontWeight: 500,
        }}
      >
        <span style={{ color: "var(--fg-muted)", display: "inline-flex" }}>
          <ScissorsIcon size={13} />
        </span>
        {single ? (
          <>
            {cuts.length}{" "}
            {cuts.length === 1
              ? REASON_META[reasonKeys[0]].label.toLowerCase()
              : REASON_META[reasonKeys[0]].plural.toLowerCase()}
            <span style={{ color: "var(--fg-faint)", fontWeight: 400 }}>
              {" "}
              ·{" "}
            </span>
            <span
              className="mono"
              style={{
                fontWeight: 500,
                fontVariantNumeric: "tabular-nums",
                color: "var(--fg)",
              }}
            >
              {fmtRemoved(totalRemoved)}
            </span>
          </>
        ) : (
          <>
            {cuts.length} cuts removed{" "}
            <span className="mono" style={{ fontVariantNumeric: "tabular-nums" }}>
              {totalRemoved.toFixed(1)}s
            </span>
          </>
        )}
      </span>

      {!single && (
        <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 6 }}>
          {reasonKeys.map((reason) => (
            <SummaryChip key={reason} reason={reason} count={byReason[reason]} />
          ))}
        </span>
      )}
    </div>
  );
};

const SummaryChip = ({ reason, count }: { reason: CutReason; count: number }) => {
  const m = REASON_META[reason];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        height: 22,
        padding: "0 9px 0 7px",
        borderRadius: 999,
        background: m.soft,
        border: `1px solid ${m.border}`,
        color: m.fg,
        fontSize: 11.5,
        fontWeight: 500,
        letterSpacing: 0.01,
      }}
    >
      <span style={{ display: "inline-flex", color: m.accent }}>
        <ReasonGlyph reason={reason} size={11} />
      </span>
      {count}{" "}
      {count === 1 ? m.label.toLowerCase() : m.plural.toLowerCase()}
    </span>
  );
};
