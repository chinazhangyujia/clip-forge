/* global React, ReactDOM, Icon, Spinner, DownloadChip, StoreProvider, useStore, DesignCanvas, DCSection, DCArtboard */
const { useState, useEffect, useMemo } = React;

/* ---------- Static chip — for the states board (no manager) ---------- */
const StaticChip = ({ phase = 'encoding', progress = 32, stuck = false, hover = false }) => {
  const isDone = phase === 'done';
  const isError = phase === 'error';

  const label = isDone ? 'Done'
    : isError ? 'Failed'
    : progress < 2 ? 'Starting…'
    : phase === 'saving' ? 'Saving…'
    : 'Encoding…';

  const fillBg = isDone ? 'oklch(0.96 0.05 155)'
    : isError ? 'oklch(0.97 0.04 25)'
    : 'var(--accent-soft)';

  const borderC = isDone ? 'oklch(0.85 0.08 155)'
    : isError ? 'oklch(0.88 0.08 25)'
    : 'oklch(0.88 0.08 50)';

  const accent = isDone ? 'var(--green)'
    : isError ? 'var(--red)'
    : 'var(--accent)';

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <div style={{
        height: 36,
        minWidth: 156,
        padding: '0 4px 0 12px',
        borderRadius: 'var(--radius)',
        border: `1px solid ${borderC}`,
        background: fillBg,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        position: 'relative',
        overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', borderRadius: 'inherit' }}>
          <div style={{
            position: 'absolute',
            left: 0, top: 0, bottom: 0,
            width: isDone || isError ? '100%' : `${Math.max(2, progress)}%`,
            background: isDone ? 'oklch(0.93 0.08 155)'
              : isError ? 'oklch(0.94 0.06 25)'
              : 'oklch(0.93 0.06 65)',
          }}/>
          {!isDone && !isError && progress < 2 && (
            <div style={{
              position: 'absolute', inset: 0,
              background: 'linear-gradient(90deg, transparent 0%, oklch(1 0 0 / 0.5) 50%, transparent 100%)',
              animation: 'chipShimmer 1.4s ease-in-out infinite',
            }}/>
          )}
        </div>

        <span style={{ position: 'relative', zIndex: 1, color: accent, display: 'inline-flex' }}>
          {isDone ? <Icon name="check" size={14}/>
            : isError ? <Icon name="alert" size={14}/>
            : <Spinner size={13}/>}
        </span>
        <span style={{
          position: 'relative', zIndex: 1, fontSize: 12.5, fontWeight: 500,
          color: isDone ? 'oklch(0.38 0.13 155)'
            : isError ? 'oklch(0.4 0.16 25)'
            : 'oklch(0.38 0.14 45)',
        }}>{label}</span>

        {!isDone && !isError && (
          <span className="mono" style={{
            position: 'relative', zIndex: 1, marginLeft: 'auto',
            fontSize: 11.5, fontWeight: 500,
            color: 'oklch(0.42 0.13 45)',
            fontVariantNumeric: 'tabular-nums',
            paddingRight: hover ? 0 : 8,
            minWidth: 32, textAlign: 'right',
          }}>{Math.floor(progress)}%</span>
        )}

        {!isDone && !isError && hover && (
          <button style={{
            position: 'relative', zIndex: 1,
            width: 24, height: 24, borderRadius: 6,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            color: 'oklch(0.42 0.13 45)', background: 'oklch(1 0 0 / 0.5)',
          }}>
            <Icon name="x" size={12}/>
          </button>
        )}
      </div>
      {stuck && !isDone && !isError && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0,
          fontSize: 11, color: 'var(--fg-muted)',
          display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
        }}>
          <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 999, background: 'var(--amber)' }}/>
          Still working…
        </div>
      )}
    </div>
  );
};

/* ---------- Header slot mock — same horizontal slot, different states ---------- */
const HeaderSlot = ({ children, sub }) => (
  <div style={{ padding: 24, background: 'var(--bg)' }}>
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 11, color: 'var(--fg-faint)', letterSpacing: 0.06, textTransform: 'uppercase', fontWeight: 600, marginBottom: 8 }}>
        Clip Detail · top right
      </div>
      <div style={{ fontSize: 13, color: 'var(--fg-muted)' }}>{sub}</div>
    </div>
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '14px 16px', background: 'var(--bg-elev)',
      border: '1px dashed var(--border)', borderRadius: 'var(--radius-lg)',
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>The 3-word hook that 100x'd my views</div>
        <div className="mono" style={{ fontSize: 11, color: 'var(--fg-faint)', marginTop: 2 }}>4:00 – 4:34 · 34s · 9:16</div>
      </div>
      {children}
    </div>
  </div>
);

const DownloadButton = () => (
  <button className="btn btn-primary">
    <Icon name="download" size={14}/> Download <Icon name="chevronDown" size={13}/>
  </button>
);

const VariantsDropdown = () => (
  <div style={{ position: 'relative' }}>
    <DownloadButton/>
    <div className="popover" style={{ width: 240, position: 'absolute', top: 'calc(100% + 6px)', right: 0 }}>
      <div className="popover-head"><span>Available Variants</span></div>
      {[
        { label: 'Original', has: true },
        { label: '+ Captions', has: false },
        { label: '+ Vertical reframe', has: false },
        { label: 'Captions + Reframe', has: false },
      ].map((v, i) => (
        <div key={i} style={{
          display: 'flex', padding: '10px 14px', alignItems: 'center', gap: 10,
          fontSize: 13, opacity: v.has ? 1 : 0.4,
          borderBottom: '1px solid var(--border)',
          background: i === 0 ? 'var(--bg-sunken)' : 'transparent',
        }}>
          <span style={{ color: 'var(--fg-faint)' }}><Icon name={v.has ? 'download' : 'x'} size={13}/></span>
          <span style={{ flex: 1, textAlign: 'left' }}>{v.label}</span>
          <span className="mono" style={{ fontSize: 10, color: 'var(--fg-faint)' }}>MP4</span>
        </div>
      ))}
    </div>
  </div>
);

const OSDialog = () => (
  <div style={{
    position: 'absolute', top: 70, left: '50%', transform: 'translateX(-50%)',
    width: 380, background: 'oklch(0.97 0.005 70)',
    border: '1px solid oklch(0.78 0.008 70)',
    borderRadius: 10, padding: 16,
    boxShadow: '0 24px 60px oklch(0 0 0 / 0.25), 0 8px 16px oklch(0 0 0 / 0.1)',
    zIndex: 10,
  }}>
    <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg)', marginBottom: 4 }}>Save As</div>
    <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 12 }}>Choose where to save the clip.</div>
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '8px 10px', background: 'var(--bg-elev)',
      border: '1px solid var(--border)', borderRadius: 6,
      fontSize: 12.5, fontFamily: 'var(--font-mono)',
    }}>
      <Icon name="folder" size={13}/>
      <span style={{ flex: 1 }}>~/Downloads/p1-c1.mp4</span>
    </div>
    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
      <button className="btn btn-sm">Cancel</button>
      <button className="btn btn-sm btn-primary">Save</button>
    </div>
  </div>
);

/* ---------- Toast mocks ---------- */
const ToastMock = ({ kind = 'success', title, body, action }) => (
  <div className={`toast toast-${kind}`} style={{ position: 'static', minWidth: 320 }}>
    <span className="toast-icon">
      {kind === 'success' ? <Icon name="check" size={18}/>
        : kind === 'error' ? <Icon name="alert" size={18}/>
        : <Icon name="info" size={18}/>}
    </span>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div className="toast-title">{title}</div>
      {body && <div className="toast-body" style={{ wordBreak: 'break-word' }}>{body}</div>}
      {action && (
        <button style={{
          marginTop: 6, fontSize: 12, fontWeight: 500,
          color: kind === 'error' ? 'var(--red)' : kind === 'success' ? 'oklch(0.42 0.13 155)' : 'var(--accent)',
          padding: '3px 8px', marginLeft: -8, borderRadius: 4,
          display: 'inline-flex', alignItems: 'center', gap: 4,
        }}>
          {action} <Icon name="chevron" size={11}/>
        </button>
      )}
    </div>
    <button className="btn-ghost btn-sm btn-icon" style={{ height: 22, width: 22, color: 'var(--fg-faint)' }}>
      <Icon name="x" size={14}/>
    </button>
  </div>
);

/* ---------- Jobs popover mock — to confirm download appears in it ---------- */
const JobsPopoverMock = () => (
  <div style={{ position: 'relative', width: 360, margin: '0 auto' }}>
    <div className="popover" style={{ position: 'static', width: 360 }}>
      <div className="popover-head">
        <span>Running Jobs</span>
        <span className="mono" style={{ color: 'var(--fg-faint)' }}>2</span>
      </div>
      <div>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 500, fontSize: 13 }}>Course Module 4 — Hooks That Convert</div>
              <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 2, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                  fontSize: 10, fontWeight: 500, padding: '1px 6px', borderRadius: 3,
                  background: 'var(--accent-soft)', color: 'oklch(0.45 0.16 45)',
                }}>DOWNLOAD</span>
                Downloading clip — The 3-word hook…
              </div>
            </div>
            <span className="mono" style={{ color: 'var(--fg-muted)', fontSize: 12 }}>42%</span>
          </div>
          <div style={{ height: 4, background: 'var(--bg-sunken)', borderRadius: 999, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: '42%', background: 'var(--accent)', borderRadius: 999 }}/>
          </div>
        </div>
        <div style={{ padding: '12px 16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 500, fontSize: 13 }}>Live Q&A — March Cohort</div>
              <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 2 }}>Cutting clips…</div>
            </div>
            <span className="mono" style={{ color: 'var(--fg-muted)', fontSize: 12 }}>62%</span>
          </div>
          <div style={{ height: 4, background: 'var(--bg-sunken)', borderRadius: 999, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: '62%', background: 'var(--accent)', borderRadius: 999 }}/>
          </div>
        </div>
      </div>
    </div>
  </div>
);

/* ---------- Live demo — interactive chip with a launchable simulated download ---------- */
const LiveDemo = () => {
  // We bring in StoreProvider so useDownloadManager can call pushToast. The chip
  // demoed here is decoupled from a specific clip — we run our own little manager.
  const [phase, setPhase] = useState('idle'); // idle | dialog | encoding | done | error | cancelled
  const [progress, setProgress] = useState(0);
  const [stuck, setStuck] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (phase !== 'encoding') return;
    setStuck(false);
    let lastMove = Date.now();
    const t = setInterval(() => {
      setProgress(p => {
        let n = p + 1.3 + Math.random() * 3;
        if (p > 22 && p < 32 && Math.random() < 0.08) n = p; // momentary stall
        if (Date.now() - lastMove > 9000) setStuck(true);
        if (Math.abs(n - p) > 0.3) { lastMove = Date.now(); setStuck(false); }
        if (n >= 100) {
          clearInterval(t);
          setPhase('done');
          setTimeout(() => {
            setPhase('idle');
            setProgress(0);
            setToast({ kind: 'success', title: 'Download ready', body: '~/Downloads/p1-c1.mp4 saved', action: 'Reveal in Finder' });
            setTimeout(() => setToast(null), 5000);
          }, 1000);
          return 100;
        }
        return n;
      });
    }, 220);
    return () => clearInterval(t);
  }, [phase]);

  const start = () => {
    setProgress(0);
    setPhase('dialog');
    setTimeout(() => setPhase('encoding'), 800);
  };
  const cancel = () => {
    setPhase('idle');
    setProgress(0);
    setToast({ kind: 'info', title: 'Download cancelled' });
    setTimeout(() => setToast(null), 3000);
  };
  const fail = () => {
    setPhase('error');
    setTimeout(() => {
      setPhase('idle');
      setProgress(0);
      setToast({ kind: 'error', title: 'Download failed', body: 'ffmpeg exited with code 1', action: 'Retry' });
      setTimeout(() => setToast(null), 6000);
    }, 700);
  };

  return (
    <div style={{ background: 'var(--bg)', padding: 32, minHeight: 480, position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em' }}>The 3-word hook that 100x'd my views</div>
          <div className="mono" style={{ fontSize: 12, color: 'var(--fg-faint)', marginTop: 4 }}>4:00 – 4:34 · 34s · 9:16</div>
        </div>
        <div>
          {(phase === 'idle' || phase === 'dialog') && (
            <div style={{ position: 'relative' }}>
              <button className="btn btn-primary" onClick={start} disabled={phase === 'dialog'}>
                <Icon name="download" size={14}/> Download <Icon name="chevronDown" size={13}/>
              </button>
              {phase === 'dialog' && <OSDialog/>}
            </div>
          )}
          {(phase === 'encoding' || phase === 'done' || phase === 'error') && (
            <StaticChip phase={phase === 'done' ? 'done' : phase === 'error' ? 'error' : (progress > 80 ? 'saving' : 'encoding')} progress={progress} stuck={stuck} hover={false}/>
          )}
        </div>
      </div>

      <div style={{
        marginTop: 32, padding: 16, borderRadius: 'var(--radius)',
        background: 'var(--bg-sunken)', border: '1px solid var(--border)',
        display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 12, color: 'var(--fg-muted)', marginRight: 6 }}>Drive the flow:</span>
        <button className="btn btn-sm" onClick={start} disabled={phase !== 'idle'}>Click "Download → Original"</button>
        <button className="btn btn-sm" onClick={cancel} disabled={phase !== 'encoding'}>Cancel mid-encode</button>
        <button className="btn btn-sm" onClick={fail} disabled={phase !== 'encoding'}>Trigger error</button>
        <button className="btn btn-sm" onClick={() => { setPhase('idle'); setProgress(0); setToast(null); }}>Reset</button>
        <span className="mono" style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--fg-faint)' }}>
          phase: {phase} · progress: {Math.floor(progress)}%
        </span>
      </div>

      {toast && (
        <div style={{ position: 'absolute', bottom: 24, right: 24 }}>
          <ToastMock kind={toast.kind} title={toast.title} body={toast.body} action={toast.action}/>
        </div>
      )}
    </div>
  );
};

/* ---------- Notes block — visible per artboard ---------- */
const Note = ({ children }) => (
  <div style={{
    padding: '10px 14px',
    background: 'var(--bg-sunken)',
    borderRadius: 'var(--radius)',
    fontSize: 12.5, color: 'var(--fg-muted)',
    lineHeight: 1.55,
    border: '1px solid var(--border)',
  }}>
    {children}
  </div>
);

const ChipDemo = ({ title, sub, children }) => (
  <div style={{ padding: 32, background: 'var(--bg)', minHeight: 240 }}>
    <div style={{ fontSize: 11, color: 'var(--fg-faint)', letterSpacing: 0.06, textTransform: 'uppercase', fontWeight: 600, marginBottom: 6 }}>
      {title}
    </div>
    <div style={{ fontSize: 13, color: 'var(--fg-muted)', marginBottom: 28, maxWidth: 360 }}>{sub}</div>
    <div style={{ marginBottom: 36 }}>{children}</div>
  </div>
);

/* ---------- Anatomy callout ---------- */
const Anatomy = () => {
  const parts = [
    { dot: 'var(--accent)', label: 'Spinner', sub: 'Phase signal — replaced by ✓ on done, ⚠ on error' },
    { dot: 'oklch(0.38 0.14 45)', label: 'Label', sub: 'Encoding… → Saving… → Done' },
    { dot: 'oklch(0.93 0.06 65)', label: 'Progress fill', sub: 'Determinate width inside chip; barber-pole shimmer when <2%' },
    { dot: 'var(--fg-muted)', label: 'Mono percentage', sub: 'JetBrains Mono, tabular numerals' },
    { dot: 'oklch(0.42 0.13 45)', label: 'Cancel', sub: 'Slides in on hover; click stops the encode' },
  ];
  return (
    <div style={{ padding: 32, background: 'var(--bg)', minHeight: 320 }}>
      <div style={{ fontSize: 11, color: 'var(--fg-faint)', letterSpacing: 0.06, textTransform: 'uppercase', fontWeight: 600, marginBottom: 6 }}>
        Anatomy
      </div>
      <div style={{ fontSize: 13, color: 'var(--fg-muted)', marginBottom: 24, maxWidth: 480 }}>
        Same 36px height, same border-radius, same horizontal slot as the Download button. Progress fills left→right inside the chip itself.
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 28 }}>
        <StaticChip phase="encoding" progress={52} hover={true}/>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '10px 14px', alignItems: 'baseline' }}>
        {parts.map((p, i) => (
          <React.Fragment key={i}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: p.dot, display: 'inline-block' }}/>
              <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg)' }}>{p.label}</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.5 }}>{p.sub}</div>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};

/* ---------- Storyboard — sequential timeline of states ---------- */
const Timeline = () => {
  const beats = [
    { t: '0ms', state: 'A — Idle', node: <DownloadButton/>, note: 'Download button + variants dropdown.' },
    { t: '+0ms (click)', state: 'B → save dialog', node: <div style={{ position: 'relative' }}><DownloadButton/></div>, note: 'OS Save As surfaces immediately, before encoding.' },
    { t: '+100ms', state: 'C — Chip appears', node: <StaticChip phase="encoding" progress={2}/>, note: 'Indeterminate shimmer for the first second.' },
    { t: '+2s', state: 'D — Encoding', node: <StaticChip phase="encoding" progress={32}/>, note: 'Determinate progress fill driven by ffmpeg.' },
    { t: '+9s', state: 'D — Saving', node: <StaticChip phase="saving" progress={87}/>, note: 'Past 80%, label flips to "Saving…".' },
    { t: '+11s', state: 'E — Done', node: <StaticChip phase="done"/>, note: '~1s success flash, then collapses.' },
    { t: '+12s', state: 'A — Idle', node: <DownloadButton/>, note: 'Toast confirms; button is back.' },
  ];
  return (
    <div style={{ padding: 32, background: 'var(--bg)' }}>
      <div style={{ fontSize: 11, color: 'var(--fg-faint)', letterSpacing: 0.06, textTransform: 'uppercase', fontWeight: 600, marginBottom: 6 }}>
        Happy-path timeline
      </div>
      <div style={{ fontSize: 13, color: 'var(--fg-muted)', marginBottom: 24, maxWidth: 540 }}>
        The chip lives in the same slot as the Download button — no layout shift. Phases are signalled by label + fill width + (briefly) color.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 12 }}>
        {beats.map((b, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
            <div className="mono" style={{ fontSize: 10.5, color: 'var(--fg-faint)' }}>{b.t}</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg)', letterSpacing: '-0.005em' }}>{b.state}</div>
            <div style={{ minHeight: 40, display: 'flex', alignItems: 'center' }}>{b.node}</div>
            <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', lineHeight: 1.5 }}>{b.note}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

/* ---------- Main canvas ---------- */
const App = () => (
  <DesignCanvas title="Download progress feedback" subtitle="Clip Detail · Download flow · States A → G">
    <DCSection id="live" title="Interactive demo" subtitle="Drive the chip through each phase">
      <DCArtboard id="live-demo" label="Live · click Download to start" width={760} height={520}>
        <LiveDemo/>
      </DCArtboard>
      <DCArtboard id="anatomy" label="Anatomy" width={620} height={520}>
        <Anatomy/>
      </DCArtboard>
    </DCSection>

    <DCSection id="storyboard" title="Happy path timeline" subtitle="A → B → C → D → E → A — same horizontal slot throughout">
      <DCArtboard id="timeline" label="Timeline" width={1400} height={300}>
        <Timeline/>
      </DCArtboard>
    </DCSection>

    <DCSection id="states" title="States" subtitle="Each frame is the Clip Detail header, top-right">
      <DCArtboard id="state-a" label="A · Idle" width={560} height={260}>
        <HeaderSlot sub="Download button shows the variants dropdown.">
          <DownloadButton/>
        </HeaderSlot>
      </DCArtboard>

      <DCArtboard id="state-a-open" label="A · Variants open" width={560} height={420}>
        <HeaderSlot sub="Original is enabled. Other variants dimmed (already designed).">
          <VariantsDropdown/>
        </HeaderSlot>
      </DCArtboard>

      <DCArtboard id="state-b" label="B · Variant clicked → OS dialog" width={560} height={420}>
        <div style={{ position: 'relative', height: '100%' }}>
          <HeaderSlot sub="Native Save As surfaces first. If cancelled, chip never appears — button stays.">
            <DownloadButton/>
          </HeaderSlot>
          <OSDialog/>
        </div>
      </DCArtboard>

      <DCArtboard id="state-d-early" label="D · Encoding · early (indeterminate)" width={560} height={260}>
        <HeaderSlot sub="First ~1s before ffmpeg reports progress: barber-pole shimmer over the bar.">
          <StaticChip phase="encoding" progress={1}/>
        </HeaderSlot>
      </DCArtboard>

      <DCArtboard id="state-d" label="D · Encoding · 42%" width={560} height={260}>
        <HeaderSlot sub="Determinate fill, mono percentage. Same slot, same width as the button.">
          <StaticChip phase="encoding" progress={42}/>
        </HeaderSlot>
      </DCArtboard>

      <DCArtboard id="state-d-hover" label="D · Hover · cancel revealed" width={560} height={260}>
        <HeaderSlot sub="Cancel X slides in on hover. Percentage stays put.">
          <StaticChip phase="encoding" progress={42} hover={true}/>
        </HeaderSlot>
      </DCArtboard>

      <DCArtboard id="state-d-saving" label="D · Saving · 87%" width={560} height={260}>
        <HeaderSlot sub="Past 80%, label flips to 'Saving…' to mirror what the user sees on disk.">
          <StaticChip phase="saving" progress={87}/>
        </HeaderSlot>
      </DCArtboard>

      <DCArtboard id="state-d-stuck" label="Edge · Stuck (>10s no movement)" width={560} height={300}>
        <HeaderSlot sub="Subtle 'Still working…' hint below the chip — calm, not alarming.">
          <StaticChip phase="encoding" progress={28} stuck={true}/>
        </HeaderSlot>
      </DCArtboard>

      <DCArtboard id="state-e" label="E · Done flash (1s)" width={560} height={260}>
        <HeaderSlot sub="Brief green success flash, then collapse to Download button + toast.">
          <StaticChip phase="done"/>
        </HeaderSlot>
      </DCArtboard>

      <DCArtboard id="state-f" label="F · Failure" width={560} height={260}>
        <HeaderSlot sub="Chip flashes error, collapses. Error toast carries Retry.">
          <StaticChip phase="error"/>
        </HeaderSlot>
      </DCArtboard>
    </DCSection>

    <DCSection id="toasts" title="Confirmation & error toasts" subtitle="Use the existing toast system, top-right">
      <DCArtboard id="toast-success" label="Success" width={420} height={180}>
        <div style={{ padding: 32, background: 'var(--bg)', display: 'grid', placeItems: 'center', minHeight: '100%' }}>
          <ToastMock kind="success" title="Download ready" body="~/Downloads/p1-c1.mp4 saved" action="Reveal in Finder"/>
        </div>
      </DCArtboard>
      <DCArtboard id="toast-error" label="Error" width={420} height={180}>
        <div style={{ padding: 32, background: 'var(--bg)', display: 'grid', placeItems: 'center', minHeight: '100%' }}>
          <ToastMock kind="error" title="Download failed" body="ffmpeg exited with code 1 — codec not found" action="Retry"/>
        </div>
      </DCArtboard>
      <DCArtboard id="toast-cancel" label="Cancelled" width={420} height={180}>
        <div style={{ padding: 32, background: 'var(--bg)', display: 'grid', placeItems: 'center', minHeight: '100%' }}>
          <ToastMock kind="info" title="Download cancelled"/>
        </div>
      </DCArtboard>
    </DCSection>

    <DCSection id="jobs" title="Jobs popover (existing)" subtitle="Confirms the download appears in the global job list — not redesigned">
      <DCArtboard id="jobs-popover" label="Jobs popover with download" width={440} height={280}>
        <div style={{ padding: 32, background: 'var(--bg)', minHeight: '100%' }}>
          <JobsPopoverMock/>
        </div>
      </DCArtboard>
    </DCSection>

    <DCSection id="notes" title="Decisions & out-of-scope" subtitle="">
      <DCArtboard id="decisions" label="Notes" width={760} height={420}>
        <div style={{ padding: 32, background: 'var(--bg)', display: 'grid', gap: 12 }}>
          <Note><b style={{ color: 'var(--fg)' }}>Same slot, same height.</b> The chip is 36px tall with min-width 156px — close to the Download button — so the header doesn't reflow when it appears.</Note>
          <Note><b style={{ color: 'var(--fg)' }}>OS dialog before chip.</b> The save-location prompt fires synchronously on variant click. If dismissed, no chip appears — the button just sits there.</Note>
          <Note><b style={{ color: 'var(--fg)' }}>Duplicate clicks are no-ops.</b> While a chip is up, the button is gone, so re-clicking the variant is impossible. If the user navigates away and back, the chip returns from manager state.</Note>
          <Note><b style={{ color: 'var(--fg)' }}>Background.</b> Each clip's chip is keyed on clipId. A user can run multiple downloads across Clip Detail pages — each clip has its own chip; all of them appear in the Jobs popover.</Note>
          <Note><b style={{ color: 'var(--fg)' }}>Out of scope.</b> Variant generation other than Original, queueing/pause/resume, persisting downloads across reload, default-save-location memory, batch download.</Note>
        </div>
      </DCArtboard>
    </DCSection>
  </DesignCanvas>
);

// We don't actually need StoreProvider here since LiveDemo manages its own toast.
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App/>);
