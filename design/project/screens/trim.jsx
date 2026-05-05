/* global React, Icon, fmtTime, SAMPLE_TRANSCRIPT */
const { useState, useEffect, useRef, useMemo, useCallback } = React;

/* ---------- Time formatting & parsing (mm:ss.s) ---------- */
const fmtTrim = (s) => {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${String(m).padStart(2, '0')}:${sec.toFixed(1).padStart(4, '0')}`;
};

const fmtMMSS = (s) => {
  if (!isFinite(s) || s < 0) s = 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
};

const parseTrim = (str) => {
  if (typeof str !== 'string') return null;
  const t = str.trim();
  const m = t.match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const mm = m[1] ? parseInt(m[1], 10) : 0;
  const ss = parseFloat(m[2]);
  if (!isFinite(ss)) return null;
  return mm * 60 + ss;
};

/* ---------- Window sizing ---------- */
// Window spans clipDuration + 2 * margin, where margin = max(clipDuration * 0.5, 15s).
// Clamped to [0, sourceDurationSec]. Centered on the clip.
const computeWindow = (startSec, endSec, sourceDurationSec) => {
  const clipDur = Math.max(0.5, endSec - startSec);
  const margin = Math.max(clipDur * 0.5, 15);
  let winStart = startSec - margin;
  let winEnd = endSec + margin;
  // Clamp to source bounds
  if (winStart < 0) {
    winEnd += -winStart;
    winStart = 0;
  }
  if (winEnd > sourceDurationSec) {
    winStart -= (winEnd - sourceDurationSec);
    winEnd = sourceDurationSec;
  }
  winStart = Math.max(0, winStart);
  winEnd = Math.min(sourceDurationSec, winEnd);
  return { winStart, winEnd, span: winEnd - winStart };
};

/* ---------- The Trim panel ---------- */
const TrimPanel = ({
  clip,
  sourceDurationSec,
  neighbors,
  snapBoundaries,
  isPlaying,
  currentSec,
  onPreviewBand,
  onSave,
}) => {
  const trackRef = useRef(null);
  const [draftStart, setDraftStart] = useState(clip.startSec);
  const [draftEnd, setDraftEnd] = useState(clip.endSec);
  const [snap, setSnap] = useState(true);
  const [drag, setDrag] = useState(null);
  const [inText, setInText] = useState(fmtTrim(clip.startSec));
  const [outText, setOutText] = useState(fmtTrim(clip.endSec));

  // Visible window — initialized from clip, can pan during drag
  const initialWin = useMemo(() => computeWindow(clip.startSec, clip.endSec, sourceDurationSec), [clip.id]);
  const [winStart, setWinStart] = useState(initialWin.winStart);
  const [winSpan, setWinSpan] = useState(initialWin.span);

  // Re-sync window when underlying clip identity changes (different clip loaded)
  useEffect(() => {
    const w = computeWindow(clip.startSec, clip.endSec, sourceDurationSec);
    setWinStart(w.winStart);
    setWinSpan(w.span);
    setDraftStart(clip.startSec);
    setDraftEnd(clip.endSec);
    setInText(fmtTrim(clip.startSec));
    setOutText(fmtTrim(clip.endSec));
  }, [clip.id]);

  // When the saved boundaries change (after Save) recenter the window.
  useEffect(() => {
    setDraftStart(clip.startSec);
    setDraftEnd(clip.endSec);
    setInText(fmtTrim(clip.startSec));
    setOutText(fmtTrim(clip.endSec));
    const w = computeWindow(clip.startSec, clip.endSec, sourceDurationSec);
    setWinStart(w.winStart);
    setWinSpan(w.span);
  }, [clip.startSec, clip.endSec]);

  const winEnd = winStart + winSpan;

  const original = clip.original || { startSec: clip.startSec, endSec: clip.endSec };
  const dirty = Math.abs(draftStart - clip.startSec) > 0.05 || Math.abs(draftEnd - clip.endSec) > 0.05;
  const fromOriginal = Math.abs(draftStart - original.startSec) > 0.05 || Math.abs(draftEnd - original.endSec) > 0.05;

  useEffect(() => {
    if (drag) onPreviewBand?.(draftStart, draftEnd);
    else onPreviewBand?.(null);
    return () => onPreviewBand?.(null);
  }, [drag, draftStart, draftEnd]);

  // View mapping: source-second → fraction of visible track (can be <0 or >1; clamp at render time)
  const viewFrac = (sec) => (sec - winStart) / winSpan;
  const viewPct = (sec) => `${viewFrac(sec) * 100}%`;

  const snapTo = useCallback((sec) => {
    if (!snap) return sec;
    const candidates = [0, sourceDurationSec, ...snapBoundaries];
    let best = sec;
    let bestDist = Infinity;
    const threshold = Math.max(0.5, winSpan * 0.012); // ~1.2% of visible window
    for (const c of candidates) {
      const d = Math.abs(c - sec);
      if (d < bestDist && d <= threshold) { best = c; bestDist = d; }
    }
    return best;
  }, [snap, snapBoundaries, sourceDurationSec, winSpan]);

  // ---------- Drag with auto-pan ----------
  const dragStateRef = useRef(null);

  const startDrag = (kind) => (e) => {
    e.preventDefault();
    setDrag(kind);

    // Snapshot of state mutated by the RAF loop
    const state = {
      kind,
      pointerX: e.clientX,
      // The non-dragged edge's source-time is fixed for the duration of the drag
      fixedOtherEdgeSec: kind === 'in' ? draftEnd : draftStart,
      currentDraftStart: draftStart,
      currentDraftEnd: draftEnd,
      currentWinStart: winStart,
      currentWinSpan: winSpan,
      lastFrameTs: performance.now(),
      raf: null,
      rect: trackRef.current.getBoundingClientRect(),
    };
    dragStateRef.current = state;

    const PAN_EDGE_PX = 36;        // distance from edge where pan kicks in
    const PAN_BASE_PX_PER_SEC = 0; // (no acceleration baseline)

    const computeFromPointer = () => {
      const rect = state.rect;
      const x = state.pointerX - rect.left;
      const clampedX = Math.max(0, Math.min(rect.width, x));
      const ratio = clampedX / rect.width;
      let sec = state.currentWinStart + ratio * state.currentWinSpan;
      sec = snapTo(sec);

      if (state.kind === 'in') {
        sec = Math.max(0, Math.min(sec, state.fixedOtherEdgeSec - 0.5));
        state.currentDraftStart = sec;
        setDraftStart(sec);
        setInText(fmtTrim(sec));
      } else {
        sec = Math.max(state.fixedOtherEdgeSec + 0.5, Math.min(sec, sourceDurationSec));
        state.currentDraftEnd = sec;
        setDraftEnd(sec);
        setOutText(fmtTrim(sec));
      }
    };

    const tick = (ts) => {
      const s = dragStateRef.current;
      if (!s) return;
      const dt = Math.min(64, ts - s.lastFrameTs) / 1000; // seconds; cap to avoid jumps
      s.lastFrameTs = ts;

      const rect = s.rect;
      const xRel = s.pointerX - rect.left; // could be negative or > rect.width

      // Pan speed scales with how far past the edge the cursor is.
      // Inside-edge zone (0..PAN_EDGE_PX) gives gentle pan; past the edge accelerates.
      let panSecPerSec = 0;
      const visiblePerPx = s.currentWinSpan / rect.width;

      if (xRel < PAN_EDGE_PX) {
        // distance into the trigger zone (positive toward beyond-edge)
        const into = PAN_EDGE_PX - xRel; // 0..PAN_EDGE_PX inside, more if past edge
        // Speed: ~half a window per second at edge, scales up past it.
        // Express as visible-fraction per second.
        const fracPerSec = 0.4 + Math.max(0, (xRel < 0 ? -xRel : 0)) * 0.025;
        panSecPerSec = -fracPerSec * s.currentWinSpan * (into / PAN_EDGE_PX);
      } else if (xRel > rect.width - PAN_EDGE_PX) {
        const into = xRel - (rect.width - PAN_EDGE_PX);
        const beyond = Math.max(0, xRel - rect.width);
        const fracPerSec = 0.4 + beyond * 0.025;
        panSecPerSec = fracPerSec * s.currentWinSpan * (into / PAN_EDGE_PX);
      }

      if (panSecPerSec !== 0) {
        let nextWinStart = s.currentWinStart + panSecPerSec * dt;
        // Clamp pan: handle cannot exceed [0, sourceDurationSec]
        // The dragged handle's source-time will follow the cursor; cap pan so the
        // handle doesn't get pushed beyond bounds.
        nextWinStart = Math.max(0, Math.min(sourceDurationSec - s.currentWinSpan, nextWinStart));
        if (nextWinStart !== s.currentWinStart) {
          s.currentWinStart = nextWinStart;
          setWinStart(nextWinStart);
        }
      }

      computeFromPointer();
      s.raf = requestAnimationFrame(tick);
    };

    const move = (ev) => {
      const s = dragStateRef.current;
      if (!s) return;
      s.pointerX = ev.clientX ?? (ev.touches && ev.touches[0] && ev.touches[0].clientX) ?? s.pointerX;
      // re-cache rect in case of layout changes (cheap)
      s.rect = trackRef.current.getBoundingClientRect();
      computeFromPointer();
    };

    const up = () => {
      const s = dragStateRef.current;
      if (s && s.raf) cancelAnimationFrame(s.raf);
      dragStateRef.current = null;
      setDrag(null);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    state.raf = requestAnimationFrame(tick);
  };

  const commitInput = (kind) => {
    const raw = kind === 'in' ? inText : outText;
    const parsed = parseTrim(raw);
    if (parsed == null) {
      if (kind === 'in') setInText(fmtTrim(draftStart));
      else setOutText(fmtTrim(draftEnd));
      return;
    }
    if (kind === 'in') {
      const v = Math.max(0, Math.min(parsed, draftEnd - 0.5));
      setDraftStart(v);
      setInText(fmtTrim(v));
      // If the new value is outside window, recenter
      if (v < winStart || v > winEnd) {
        const w = computeWindow(v, draftEnd, sourceDurationSec);
        setWinStart(w.winStart); setWinSpan(w.span);
      }
    } else {
      const v = Math.max(draftStart + 0.5, Math.min(parsed, sourceDurationSec));
      setDraftEnd(v);
      setOutText(fmtTrim(v));
      if (v < winStart || v > winEnd) {
        const w = computeWindow(draftStart, v, sourceDurationSec);
        setWinStart(w.winStart); setWinSpan(w.span);
      }
    }
  };

  const reset = () => {
    setDraftStart(original.startSec);
    setDraftEnd(original.endSec);
    setInText(fmtTrim(original.startSec));
    setOutText(fmtTrim(original.endSec));
    const w = computeWindow(original.startSec, original.endSec, sourceDurationSec);
    setWinStart(w.winStart); setWinSpan(w.span);
  };

  const cancel = () => {
    setDraftStart(clip.startSec);
    setDraftEnd(clip.endSec);
    setInText(fmtTrim(clip.startSec));
    setOutText(fmtTrim(clip.endSec));
    const w = computeWindow(clip.startSec, clip.endSec, sourceDurationSec);
    setWinStart(w.winStart); setWinSpan(w.span);
  };

  const save = () => onSave(draftStart, draftEnd);

  const duration = draftEnd - draftStart;

  // Visible neighbors: any whose interval intersects [winStart, winEnd]
  const visibleNeighbors = neighbors.filter(n =>
    n.id !== clip.id && n.endSec > winStart && n.startSec < winEnd
  );

  const overlapping = neighbors.some(n =>
    n.id !== clip.id && !(n.endSec <= draftStart || n.startSec >= draftEnd)
  );

  // Snap boundaries inside visible window
  const visibleSnapBoundaries = snapBoundaries.filter(b => b >= winStart && b <= winEnd);

  return (
    <div className="card" style={{ padding: 18, marginBottom: 14 }}>
      {/* Header row */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        marginBottom: 14,
        flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <span style={{
            fontSize: 11, fontWeight: 600,
            letterSpacing: 0.06, textTransform: 'uppercase',
            color: 'var(--fg-faint)',
          }}>Trim</span>
          <span className="mono" style={{
            fontSize: 12.5,
            color: dirty ? 'var(--fg)' : 'var(--fg-muted)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {fmtTrim(draftStart)} → {fmtTrim(draftEnd)}
            <span style={{ color: 'var(--fg-faint)' }}> · </span>
            <span style={{ color: dirty ? 'var(--accent)' : 'var(--fg-muted)', fontWeight: 500 }}>
              {duration.toFixed(1)}s
            </span>
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <TimeInput label="In" value={inText} onChange={setInText} onCommit={() => commitInput('in')}/>
          <TimeInput label="Out" value={outText} onChange={setOutText} onCommit={() => commitInput('out')}/>
          <SnapToggle value={snap} onChange={setSnap}/>
          {fromOriginal && (
            <button
              onClick={reset}
              className="btn btn-sm"
              title="Restore pipeline's original cut"
              style={{ color: 'var(--fg-muted)' }}
            >
              <Icon name="refresh" size={12}/>
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Track */}
      <div style={{ position: 'relative', padding: '14px 9px 24px' }}>
        {/* Window edge labels — absolute source-time at left/right of visible window */}
        <div style={{
          position: 'absolute', left: 9, right: 9, bottom: 4,
          display: 'flex', justifyContent: 'space-between',
          fontFamily: 'var(--font-mono)', fontSize: 10,
          color: 'var(--fg-faint)',
          letterSpacing: 0.02,
          pointerEvents: 'none',
          fontVariantNumeric: 'tabular-nums',
        }}>
          <span>{fmtMMSS(winStart)}</span>
          <span style={{ color: 'var(--fg-faint)', opacity: 0.7 }}>
            window · {fmtMMSS(winSpan)}
          </span>
          <span>{fmtMMSS(winEnd)}</span>
        </div>

        <div
          ref={trackRef}
          style={{
            position: 'relative',
            height: 6,
            background: 'var(--border)',
            borderRadius: 999,
            cursor: 'pointer',
          }}
          onPointerDown={(e) => {
            if (e.target !== trackRef.current) return;
            const rect = trackRef.current.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const sec = winStart + (x / rect.width) * winSpan;
            const distIn = Math.abs(sec - draftStart);
            const distOut = Math.abs(sec - draftEnd);
            const kind = distIn < distOut ? 'in' : 'out';
            if (kind === 'in') {
              const v = snapTo(Math.max(0, Math.min(sec, draftEnd - 0.5)));
              setDraftStart(v); setInText(fmtTrim(v));
            } else {
              const v = snapTo(Math.max(draftStart + 0.5, Math.min(sec, sourceDurationSec)));
              setDraftEnd(v); setOutText(fmtTrim(v));
            }
          }}
        >
          {/* Neighbor clips — context bands behind the active band */}
          {visibleNeighbors.map(n => {
            const left = Math.max(0, viewFrac(n.startSec)) * 100;
            const right = Math.min(1, viewFrac(n.endSec)) * 100;
            const width = Math.max(0, right - left);
            return (
              <div
                key={n.id}
                title={`${fmtMMSS(n.startSec)} – ${fmtMMSS(n.endSec)}`}
                style={{
                  position: 'absolute',
                  top: 0, height: '100%',
                  left: `${left}%`,
                  width: `${width}%`,
                  background: 'var(--fg-faint)',
                  opacity: 0.18,
                  borderRadius: 999,
                  pointerEvents: 'none',
                }}
              />
            );
          })}

          {/* Active band */}
          <div style={{
            position: 'absolute',
            top: 0, height: '100%',
            left: `${Math.max(0, viewFrac(draftStart)) * 100}%`,
            width: `${Math.max(0, (Math.min(1, viewFrac(draftEnd)) - Math.max(0, viewFrac(draftStart)))) * 100}%`,
            background: 'var(--accent)',
            borderRadius: 999,
            boxShadow: drag ? '0 0 0 4px var(--accent-soft)' : 'none',
            transition: drag ? 'none' : 'box-shadow .15s, left .12s, width .12s',
          }}/>

          {/* Original auto-cut bound ticks (only show when within visible window AND when drift exists or as gentle reference) */}
          {[
            { sec: original.startSec, key: 'os' },
            { sec: original.endSec, key: 'oe' },
          ].filter(t => t.sec >= winStart && t.sec <= winEnd).map(t => (
            <div
              key={t.key}
              title={`Original cut · ${fmtTrim(t.sec)}`}
              style={{
                position: 'absolute',
                top: -3, height: 12, width: 1,
                left: `calc(${viewPct(t.sec)} - 0.5px)`,
                background: 'var(--fg-muted)',
                opacity: 0.55,
                pointerEvents: 'none',
                zIndex: 1,
              }}
            />
          ))}

          {/* Snap boundary tick marks */}
          {snap && visibleSnapBoundaries.map((b, i) => (
            <div key={i} style={{
              position: 'absolute',
              top: -2, height: 10, width: 1,
              left: viewPct(b),
              background: 'var(--border-strong)',
              opacity: 0.5,
              pointerEvents: 'none',
            }}/>
          ))}

          {/* Current playback tick */}
          {isPlaying && currentSec != null && currentSec >= winStart && currentSec <= winEnd && (
            <div style={{
              position: 'absolute',
              top: -5, height: 16, width: 2,
              left: `calc(${viewPct(currentSec)} - 1px)`,
              background: 'var(--fg)',
              borderRadius: 2,
              pointerEvents: 'none',
              boxShadow: '0 0 0 2px var(--bg-elev)',
            }}/>
          )}

          {/* Handles */}
          <Handle
            position={viewPct(draftStart)}
            visible={draftStart >= winStart && draftStart <= winEnd}
            active={drag === 'in'}
            onPointerDown={startDrag('in')}
            label={fmtTrim(draftStart)}
            side="left"
          />
          <Handle
            position={viewPct(draftEnd)}
            visible={draftEnd >= winStart && draftEnd <= winEnd}
            active={drag === 'out'}
            onPointerDown={startDrag('out')}
            label={fmtTrim(draftEnd)}
            side="right"
          />
        </div>
      </div>

      {/* Footer */}
      {(dirty || overlapping) && (
        <div style={{
          marginTop: 6,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}>
          <div style={{ fontSize: 12, color: 'var(--fg-muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
            {overlapping ? (
              <>
                <span style={{ color: 'var(--amber)', display: 'inline-flex' }}>
                  <Icon name="alert" size={13}/>
                </span>
                <span>Overlaps with an adjacent clip — that's allowed, just a heads up.</span>
              </>
            ) : dirty ? (
              <>
                <span style={{ display: 'inline-flex', color: 'var(--accent)' }}>
                  <Icon name="info" size={13}/>
                </span>
                <span>Unsaved changes</span>
              </>
            ) : null}
          </div>
          {dirty && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-sm" onClick={cancel}>Cancel</button>
              <button className="btn btn-sm btn-primary" onClick={save}>
                <Icon name="check" size={13}/>
                Save
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/* ---------- Subcomponents ---------- */

const Handle = ({ position, active, visible = true, onPointerDown, label, side }) => (
  <div
    onPointerDown={onPointerDown}
    style={{
      position: 'absolute',
      top: '50%',
      left: position,
      transform: `translate(-50%, -50%) scale(${active ? 1.15 : 1})`,
      width: 14,
      height: 14,
      borderRadius: 999,
      background: 'var(--bg-elev)',
      border: `2px solid var(--accent)`,
      boxShadow: active
        ? '0 0 0 6px var(--accent-soft), var(--shadow-sm)'
        : 'var(--shadow-sm)',
      cursor: 'ew-resize',
      transition: active ? 'none' : 'transform .12s, box-shadow .15s, left .12s',
      zIndex: 2,
      touchAction: 'none',
      opacity: visible ? 1 : 0,
      pointerEvents: visible ? 'auto' : 'none',
    }}
  >
    {active && (
      <div className="mono" style={{
        position: 'absolute',
        top: -28,
        [side === 'left' ? 'left' : 'right']: '50%',
        transform: side === 'left' ? 'translateX(-50%)' : 'translateX(50%)',
        background: 'var(--fg)',
        color: 'var(--bg)',
        padding: '2px 6px',
        borderRadius: 4,
        fontSize: 10.5,
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
      }}>{label}</div>
    )}
  </div>
);

const TimeInput = ({ label, value, onChange, onCommit }) => (
  <label style={{
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    background: 'var(--bg-sunken)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    padding: '0 8px 0 10px',
    height: 28,
  }}>
    <span style={{
      fontSize: 10.5,
      fontWeight: 600,
      letterSpacing: 0.06,
      textTransform: 'uppercase',
      color: 'var(--fg-faint)',
    }}>{label}</span>
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'Escape') e.target.blur();
      }}
      style={{
        width: 64,
        border: 'none',
        outline: 'none',
        background: 'transparent',
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        fontVariantNumeric: 'tabular-nums',
        color: 'var(--fg)',
        padding: '4px 0',
      }}
    />
  </label>
);

const SnapToggle = ({ value, onChange }) => (
  <button
    onClick={() => onChange(!value)}
    title={value ? 'Snapping to sentence boundaries' : 'Frame-precise (no snapping)'}
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      height: 28,
      padding: '0 10px',
      borderRadius: 'var(--radius-sm)',
      border: `1px solid ${value ? 'var(--accent)' : 'var(--border)'}`,
      background: value ? 'var(--accent-soft)' : 'var(--bg-elev)',
      color: value ? 'oklch(0.45 0.16 45)' : 'var(--fg-muted)',
      fontSize: 12,
      fontWeight: 500,
      transition: 'all .12s',
    }}
  >
    <span style={{
      width: 14, height: 14,
      borderRadius: 3,
      display: 'inline-grid',
      placeItems: 'center',
      background: value ? 'var(--accent)' : 'transparent',
      border: value ? 'none' : '1px solid var(--border-strong)',
      color: 'white',
    }}>
      {value && <Icon name="check" size={9}/>}
    </span>
    Snap to sentence
  </button>
);

Object.assign(window, { TrimPanel, fmtTrim, parseTrim });
