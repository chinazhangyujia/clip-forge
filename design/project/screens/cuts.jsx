/* global React, Icon */
/*
 * Auto-cut surfaces for the Clip Detail view.
 *
 * One reason system, four expressions:
 *   - REASON_META: tokens (label, color family, glyph) for each reason type.
 *   - CutsSummary: one-line meta row above the transcript card.
 *   - CutDivider: horizontal divider between two transcript segments where a cut sits.
 *   - CutTick: vertical tick mark on the player scrubber, with a hover tooltip.
 *
 * Long pause is the only reason actually shipping right now; the visual system
 * is built so adding filler / repeat / low-value later is a data change, not a
 * design change.
 */
const { useState, useRef, useEffect } = React;

/* ---------- Reason tokens ----------
 * Each reason gets a distinct hue (same chroma + lightness so the palette feels
 * like one family) and a distinct glyph. Glyph metaphor leans toward "kind of
 * content removed" rather than scissors — scissors implies the user did it.
 */
const REASON_META = {
  pause: {
    label: 'Long pause',
    plural: 'Long pauses',
    accent: 'oklch(0.62 0.13 240)',     // cool blue
    soft:   'oklch(0.965 0.025 240)',
    border: 'oklch(0.9 0.05 240)',
    fg:     'oklch(0.42 0.12 240)',
    glyph: (
      <g>
        <rect x="8" y="5" width="3" height="14" rx="1" fill="currentColor" stroke="none"/>
        <rect x="13" y="5" width="3" height="14" rx="1" fill="currentColor" stroke="none"/>
      </g>
    ),
  },
  filler: {
    label: 'Filler word',
    plural: 'Filler words',
    accent: 'oklch(0.62 0.13 300)',     // violet
    soft:   'oklch(0.965 0.025 300)',
    border: 'oklch(0.9 0.05 300)',
    fg:     'oklch(0.42 0.12 300)',
    glyph: (
      <g>
        <path d="M5 9.5a4.5 4.5 0 0 1 4.5-4.5h5A4.5 4.5 0 0 1 19 9.5v1A4.5 4.5 0 0 1 14.5 15H10l-3.5 3v-3.5A4.5 4.5 0 0 1 5 10.5z"/>
        <circle cx="9" cy="10" r="0.9" fill="currentColor" stroke="none"/>
        <circle cx="12" cy="10" r="0.9" fill="currentColor" stroke="none"/>
        <circle cx="15" cy="10" r="0.9" fill="currentColor" stroke="none"/>
      </g>
    ),
  },
  repeat: {
    label: 'Repeat phrase',
    plural: 'Repeat phrases',
    accent: 'oklch(0.62 0.13 165)',     // teal
    soft:   'oklch(0.965 0.03 165)',
    border: 'oklch(0.9 0.06 165)',
    fg:     'oklch(0.4 0.12 165)',
    glyph: (
      <g>
        <path d="M5 12a7 7 0 0 1 12-4.9"/>
        <polyline points="17 4 17 8 13 8"/>
        <path d="M19 12a7 7 0 0 1-12 4.9"/>
        <polyline points="7 20 7 16 11 16"/>
      </g>
    ),
  },
  lowvalue: {
    label: 'Low-value',
    plural: 'Low-value',
    accent: 'oklch(0.6 0.04 60)',       // warm gray
    soft:   'oklch(0.965 0.008 60)',
    border: 'oklch(0.9 0.012 60)',
    fg:     'oklch(0.42 0.02 60)',
    glyph: (
      <g>
        {/* dim bulb — unfilled, with sleeping zzz to read as "skipped over" */}
        <path d="M9 14a4 4 0 1 1 6 0c-.5.6-.8 1.2-1 2H10c-.2-.8-.5-1.4-1-2z"/>
        <line x1="10" y1="19" x2="14" y2="19"/>
        <line x1="11" y1="21" x2="13" y2="21"/>
        <path d="M16 5h2.5L16 8h2.5" strokeWidth="1.4"/>
      </g>
    ),
  },
};

const ReasonGlyph = ({ reason, size = 14, ...rest }) => {
  const m = REASON_META[reason];
  if (!m) return null;
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
      {...rest}
    >
      {m.glyph}
    </svg>
  );
};

/* Format a removed-time delta. Always negative-prefixed, one decimal. */
const fmtRemoved = (sec) => `−${sec.toFixed(1)}s`;

/* ---------- Divider — sits between two transcript segments ---------- */
const CutDivider = ({ cut, active }) => {
  const m = REASON_META[cut.reason];
  return (
    <div
      role="separator"
      aria-label={`${m.label}, ${fmtRemoved(cut.removedSec)} removed`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        margin: '4px 8px 4px 46px',         // align under the timestamp gutter
        padding: '4px 6px',
        borderRadius: 4,
        position: 'relative',
        background: active ? m.soft : 'transparent',
        transition: 'background .25s',
      }}
    >
      {/* Reason chip — icon + label, color-coded */}
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          padding: '1px 7px 1px 5px',
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
        <span style={{ display: 'inline-flex', color: m.accent }}>
          <ReasonGlyph reason={cut.reason} size={11}/>
        </span>
        {m.label}
      </span>

      {/* Connector — dashed hairline so it reads as meta-content, not a transcript line */}
      <span
        aria-hidden="true"
        style={{
          flex: 1,
          height: 0,
          borderTop: `1px dashed ${active ? m.border : 'var(--border)'}`,
          transition: 'border-color .25s',
        }}
      />

      {/* Removed-duration tag */}
      <span
        className="mono"
        style={{
          fontSize: 10.5,
          color: 'var(--fg-faint)',
          fontVariantNumeric: 'tabular-nums',
          flexShrink: 0,
        }}
      >
        {fmtRemoved(cut.removedSec)}
      </span>
    </div>
  );
};

/* ---------- Tick — sits on the player scrubber ----------
 * Pure visual; pointerEvents on the rail are forwarded to the underlying scrubber
 * so the user can still click-to-seek through the tick. The tooltip is rendered
 * by a parent on hover (CutTickRail) so we get one shared positioner.
 */
const CutTick = ({ cut, percent, onHover, onLeave, hovered }) => {
  const m = REASON_META[cut.reason];
  return (
    <span
      onMouseEnter={(e) => onHover(cut, e)}
      onMouseLeave={onLeave}
      style={{
        position: 'absolute',
        left: `${percent}%`,
        top: '50%',
        transform: 'translate(-50%, -50%)',
        width: 10,
        height: 14,
        display: 'grid',
        placeItems: 'center',
        cursor: 'default',
        pointerEvents: 'auto',
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
            : '0 0 0 1px oklch(0 0 0 / 0.15)',
          transition: 'width .12s, box-shadow .12s',
        }}
      />
    </span>
  );
};

/* Container for ticks + tooltip. Renders inside the player scrubber rail
 * (positioned absolutely to fill it). Forwards rail clicks to the parent's
 * scrub handler — only the tick glyphs themselves grab pointer events. */
const CutTickRail = ({ cuts, durationSec }) => {
  const [hovered, setHovered] = useState(null); // { cut, x }
  const railRef = useRef(null);

  const onHover = (cut, e) => {
    const rect = railRef.current.getBoundingClientRect();
    setHovered({ cut, x: e.clientX - rect.left });
  };

  return (
    <span
      ref={railRef}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',  // ticks re-enable per element
      }}
    >
      {cuts.map(cut => {
        const pct = Math.max(0, Math.min(100, (cut.t / durationSec) * 100));
        return (
          <CutTick
            key={cut.id}
            cut={cut}
            percent={pct}
            onHover={onHover}
            onLeave={() => setHovered(null)}
            hovered={hovered?.cut.id === cut.id}
          />
        );
      })}
      {hovered && (
        <CutTickTooltip
          cut={hovered.cut}
          x={(hovered.cut.t / durationSec) * 100}
        />
      )}
    </span>
  );
};

const CutTickTooltip = ({ cut, x }) => {
  const m = REASON_META[cut.reason];
  return (
    <span
      style={{
        position: 'absolute',
        left: `${x}%`,
        bottom: 'calc(100% + 10px)',
        transform: 'translateX(-50%)',
        background: 'oklch(0.18 0.01 60)',
        color: 'oklch(0.99 0 0)',
        padding: '6px 9px 6px 7px',
        borderRadius: 6,
        whiteSpace: 'nowrap',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        fontSize: 11.5,
        fontWeight: 500,
        boxShadow: '0 6px 18px oklch(0 0 0 / 0.25)',
        pointerEvents: 'none',
        zIndex: 5,
      }}
    >
      <span style={{ display: 'inline-flex', color: m.accent }}>
        <ReasonGlyph reason={cut.reason} size={12}/>
      </span>
      {m.label}
      <span
        className="mono"
        style={{
          color: 'oklch(1 0 0 / 0.55)',
          fontWeight: 400,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {fmtRemoved(cut.removedSec)}
      </span>
      {/* Pointer */}
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: '100%',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 0,
          height: 0,
          borderLeft: '5px solid transparent',
          borderRight: '5px solid transparent',
          borderTop: '5px solid oklch(0.18 0.01 60)',
        }}
      />
    </span>
  );
};

/* ---------- Summary row — above the transcript card ----------
 * Layout per spec:
 *   Multi-reason: "3 cuts removed 7.6s" + per-reason chips
 *   Single-reason: collapses to "3 long pauses · −7.6s" (no separate chips)
 *   Zero cuts:     row hidden entirely (handled by parent — return null here too)
 */
const CutsSummary = ({ cuts }) => {
  if (!cuts || cuts.length === 0) return null;

  const totalRemoved = cuts.reduce((sum, c) => sum + c.removedSec, 0);
  const byReason = cuts.reduce((acc, c) => {
    acc[c.reason] = (acc[c.reason] || 0) + 1;
    return acc;
  }, {});
  const reasonKeys = Object.keys(byReason);
  const single = reasonKeys.length === 1;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
        padding: '10px 14px',
        margin: '20px 0 -2px',                // sits flush above the transcript card
        background: 'var(--bg-sunken)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        fontSize: 12.5,
        color: 'var(--fg-muted)',
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          color: 'var(--fg)',
          fontWeight: 500,
        }}
      >
        <span style={{ color: 'var(--fg-muted)', display: 'inline-flex' }}>
          <ScissorsIcon size={13}/>
        </span>
        {single
          ? <>
              {cuts.length} {cuts.length === 1 ? REASON_META[reasonKeys[0]].label.toLowerCase() : REASON_META[reasonKeys[0]].plural.toLowerCase()}
              <span style={{ color: 'var(--fg-faint)', fontWeight: 400 }}> · </span>
              <span className="mono" style={{ fontWeight: 500, fontVariantNumeric: 'tabular-nums', color: 'var(--fg)' }}>
                {fmtRemoved(totalRemoved)}
              </span>
            </>
          : <>
              {cuts.length} cuts removed{' '}
              <span className="mono" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {totalRemoved.toFixed(1)}s
              </span>
            </>
        }
      </span>

      {!single && (
        <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 6 }}>
          {reasonKeys.map(reason => (
            <SummaryChip key={reason} reason={reason} count={byReason[reason]}/>
          ))}
        </span>
      )}
    </div>
  );
};

const SummaryChip = ({ reason, count }) => {
  const m = REASON_META[reason];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        height: 22,
        padding: '0 9px 0 7px',
        borderRadius: 999,
        background: m.soft,
        border: `1px solid ${m.border}`,
        color: m.fg,
        fontSize: 11.5,
        fontWeight: 500,
        letterSpacing: 0.01,
      }}
    >
      <span style={{ display: 'inline-flex', color: m.accent }}>
        <ReasonGlyph reason={reason} size={11}/>
      </span>
      {count} {count === 1 ? m.label.toLowerCase() : m.plural.toLowerCase()}
    </span>
  );
};

/* Small scissors glyph for the summary leading icon. Inline rather than added
 * to the global Icon so this module stays self-contained. */
const ScissorsIcon = ({ size = 13 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="6" cy="7" r="2.5"/>
    <circle cx="6" cy="17" r="2.5"/>
    <line x1="8" y1="8.5" x2="20" y2="16"/>
    <line x1="8" y1="15.5" x2="20" y2="8"/>
  </svg>
);

Object.assign(window, {
  REASON_META,
  ReasonGlyph,
  CutDivider,
  CutTickRail,
  CutsSummary,
  fmtRemoved,
});
