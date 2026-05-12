/* global React, ReactDOM, Icon, Spinner, StoreProvider, DesignCanvas, DCSection, DCArtboard,
   UnrenderedState, RenderingState, ReadyState, StaleState, PathRow, REVEAL_LABEL, FILE_MANAGER */
const { useState, useEffect, useMemo } = React;

/* ----------------------------------------------------------------------------
   Design canvas for the new file-on-disk affordance on Clip Detail.
   The old "Download" button has been replaced — ClipForge is a desktop app and
   the clip mp4 lives in the user's project working directory. The action
   surface now treats the clip as a file: prepare it, reveal it in the OS file manager.
---------------------------------------------------------------------------- */

const SAMPLE_PATH = '~/ClipForge/Course Module 4 — Hooks That Convert/clips/Three words that 100x\'d my views.mp4';
const SAMPLE_PATH_LONG = '~/ClipForge/AI 时代，语言是最新编程语言/clips/AI 时代，语言是最新编程语言 — opening hook (4_00–4_34).mp4';

/* ---------- Header slot mock — re-creates the Clip Detail top strip ---------- */
const HeaderSlot = ({ children, sub, tall = false }) => (
  <div style={{ padding: 24, background: 'var(--bg)', minHeight: tall ? 280 : 'auto' }}>
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, color: 'var(--fg-faint)', letterSpacing: 0.06, textTransform: 'uppercase', fontWeight: 600, marginBottom: 6 }}>
        Clip Detail · top right slot
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--fg-muted)', lineHeight: 1.5 }}>{sub}</div>
    </div>
    <div style={{
      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20,
      padding: '14px 16px', background: 'var(--bg-elev)',
      border: '1px dashed var(--border)', borderRadius: 'var(--radius-lg)',
    }}>
      <div style={{ minWidth: 0, paddingTop: 4 }}>
        <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' }}>Three words that 100x'd my views</div>
        <div className="mono" style={{ fontSize: 11, color: 'var(--fg-faint)', marginTop: 4 }}>4:00 – 4:34 · 34s · 9:16</div>
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  </div>
);

/* ---------- Small section heading inside an artboard ---------- */
const SectionLabel = ({ kicker, children }) => (
  <div style={{ marginBottom: 18 }}>
    <div style={{ fontSize: 11, color: 'var(--fg-faint)', letterSpacing: 0.06, textTransform: 'uppercase', fontWeight: 600, marginBottom: 6 }}>
      {kicker}
    </div>
    <div style={{ fontSize: 13, color: 'var(--fg-muted)', maxWidth: 540, lineHeight: 1.55 }}>{children}</div>
  </div>
);

/* ---------- Live demo — cycle through the 4 states ---------- */
const LiveDemo = () => {
  // Local rendering-state machine; mirrors what's in ClipFileActions but
  // driven manually so the user can poke each state.
  const [state, setState] = useState('unrendered'); // unrendered | rendering | ready | stale
  const [pulse, setPulse] = useState(0);

  // While "rendering", auto-flip to ready after a couple seconds
  useEffect(() => {
    if (state !== 'rendering') return;
    const t = setTimeout(() => { setState('ready'); setPulse(p => p + 1); }, 2200);
    return () => clearTimeout(t);
  }, [state]);

  const node = useMemo(() => {
    if (state === 'unrendered') return <UnrenderedState onPrepare={() => setState('rendering')}/>;
    if (state === 'rendering')  return <RenderingState/>;
    if (state === 'stale')      return <StaleState fullPath={SAMPLE_PATH} onReprepare={() => setState('rendering')}/>;
    return (
      <ReadyState
        fullPath={SAMPLE_PATH}
        onReveal={() => setPulse(p => p + 1)}
      />
    );
  }, [state, pulse]);

  return (
    <div style={{ background: 'var(--bg)', padding: 24, minHeight: 480, display: 'flex', flexDirection: 'column' }}>
      <SectionLabel kicker="Interactive">Drive the state machine. Each button represents an external trigger (file ready, file deleted, trim bounds changed, etc).</SectionLabel>

      <div style={{
        flex: 1,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20,
        padding: '16px 18px',
        background: 'var(--bg-elev)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        marginBottom: 18,
      }}>
        <div style={{ minWidth: 0, paddingTop: 4 }}>
          <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.01em' }}>Three words that 100x'd my views</div>
          <div className="mono" style={{ fontSize: 11.5, color: 'var(--fg-faint)', marginTop: 5 }}>4:00 – 4:34 · 34s · 9:16 vertical</div>
        </div>
        <div style={{ flexShrink: 0 }}>{node}</div>
      </div>

      <div style={{
        padding: 14, borderRadius: 'var(--radius)',
        background: 'var(--bg-sunken)', border: '1px solid var(--border)',
        display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 12, color: 'var(--fg-muted)', marginRight: 6 }}>State:</span>
        {['unrendered', 'rendering', 'ready', 'stale'].map(s => (
          <button
            key={s}
            onClick={() => setState(s)}
            className={state === s ? 'btn btn-sm btn-primary' : 'btn btn-sm'}
          >
            {s}
          </button>
        ))}
        <span className="mono" style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--fg-faint)' }}>
          current: {state}
        </span>
      </div>
    </div>
  );
};

/* ---------- Anatomy of the Ready state ---------- */
const ReadyAnatomy = () => {
  const parts = [
    { dot: 'var(--green)', label: 'Confirmation', sub: 'Check chip + "Clip is in your project folder" — green accent, low-key.' },
    { dot: 'var(--fg-muted)', label: 'Path display', sub: 'Mono row showing full path. Truncated mid-string with ellipsis; full path on hover (title attr).' },
    { dot: 'var(--accent)', label: 'Show in ' + FILE_MANAGER, sub: 'Primary — the only action. Opens the OS file manager with the mp4 selected so the user can drag it into their editor.' },
  ];
  return (
    <div style={{ padding: 28, background: 'var(--bg)', minHeight: 480 }}>
      <SectionLabel kicker="Anatomy — Ready state">
        The most important of the four. Visual goal: tell the user "your file exists, here's where, here's what to do with it" — no clicks wasted on confirming intent.
      </SectionLabel>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 28, marginTop: 8 }}>
        <ReadyState
          fullPath={SAMPLE_PATH}
          onReveal={() => {}}
        />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '10px 14px', alignItems: 'baseline', maxWidth: 620, margin: '0 auto' }}>
        {parts.map((p, i) => (
          <React.Fragment key={i}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: p.dot, display: 'inline-block' }}/>
              <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--fg)' }}>{p.label}</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.55 }}>{p.sub}</div>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};

/* ---------- Storyboard — the lifecycle a clip moves through ---------- */
const Lifecycle = () => {
  const beats = [
    { tag: 'On arrival', title: '① Unrendered', node: <UnrenderedState onPrepare={() => {}}/>, note: 'User lands on the clip for the first time. No mp4 on disk.' },
    { tag: 'On click', title: '② Rendering', node: <RenderingState/>, note: 'ffmpeg cuts the clip from the source video into the project folder.' },
    { tag: 'On success', title: '③ Ready', node: <ReadyState fullPath={SAMPLE_PATH} onReveal={()=>{}}/>, note: 'File exists; user reveals it in the OS file manager and the path.' },
    { tag: 'After re-trim', title: '④ Stale', node: <StaleState fullPath={SAMPLE_PATH} onReprepare={()=>{}}/>, note: 'User trimmed; on-disk mp4 reflects the old cut.' },
  ];
  return (
    <div style={{ padding: 28, background: 'var(--bg)' }}>
      <SectionLabel kicker="Lifecycle">
        How a clip moves through the four states. The card stays anchored in the same slot the whole time — no buttons hopping around.
      </SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, marginTop: 12 }}>
        {beats.map((b, i) => (
          <div key={i} style={{
            display: 'grid',
            gridTemplateColumns: '120px 1fr',
            gap: 24,
            alignItems: 'center',
          }}>
            <div>
              <div className="mono" style={{ fontSize: 10.5, color: 'var(--fg-faint)', letterSpacing: 0.04, textTransform: 'uppercase' }}>{b.tag}</div>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)', marginTop: 4 }}>{b.title}</div>
              <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 6, lineHeight: 1.5 }}>{b.note}</div>
            </div>
            <div>{b.node}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

/* ---------- Path-truncation showcase ---------- */
const PathVariants = () => (
  <div style={{ padding: 28, background: 'var(--bg)' }}>
    <SectionLabel kicker="Path display">
      The filename comes from the clip's title, not the internal id. Path truncates mid-string with ellipsis when too long; full path on hover (title attr). UTF-8 / CJK is fine.
    </SectionLabel>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 540 }}>
      <PathRow fullPath="~/Documents/ClipForge/Demo/clips/intro.mp4"/>
      <PathRow fullPath={SAMPLE_PATH}/>
      <PathRow fullPath={SAMPLE_PATH_LONG}/>
      <div style={{ fontSize: 11.5, color: 'var(--fg-faint)', marginTop: 4, lineHeight: 1.5 }}>
        Hover any row to see the un-truncated path as a native tooltip.
      </div>
    </div>
  </div>
);

/* ---------- Platform copy table ---------- */
const PlatformCopy = () => {
  const rows = [
    { state: 'Unrendered', mac: '"Prepare clip"',                               win: '"Prepare clip"' },
    { state: 'Rendering',  mac: '"Preparing clip…"',                            win: '"Preparing clip…"' },
    { state: 'Ready',      mac: '"Show in Finder"',                             win: '"Show in File Explorer"' },
    { state: 'Stale',      mac: '"Re-prepare clip"',                            win: '"Re-prepare clip"' },
  ];
  return (
    <div style={{ padding: 28, background: 'var(--bg)', minHeight: 360 }}>
      <SectionLabel kicker="Copy">
        Only one label flips on platform — the reveal action. Detect via <span className="mono" style={{ background: 'var(--bg-sunken)', padding: '1px 5px', borderRadius: 3, fontSize: 11 }}>navigator.platform</span>. Don't translate "Re-prepare" / "Prepare" — they're intentional.
      </SectionLabel>
      <table style={{ width: '100%', maxWidth: 580, borderCollapse: 'collapse', fontSize: 12.5 }}>
        <thead>
          <tr style={{ textAlign: 'left' }}>
            <th style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', fontWeight: 500, color: 'var(--fg-muted)' }}>State</th>
            <th style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', fontWeight: 500, color: 'var(--fg-muted)' }}>macOS</th>
            <th style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', fontWeight: 500, color: 'var(--fg-muted)' }}>Windows</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', color: 'var(--fg-muted)' }}>{r.state}</td>
              <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)', color: 'var(--fg)' }}>{r.mac}</td>
              <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)', color: 'var(--fg)' }}>{r.win}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/* ---------- Notes block ---------- */
const Note = ({ kind = 'note', children }) => (
  <div style={{
    padding: '12px 14px',
    background: kind === 'kill' ? 'oklch(0.98 0.025 25)' : 'var(--bg-sunken)',
    borderRadius: 'var(--radius)',
    fontSize: 12.5, color: 'var(--fg-muted)',
    lineHeight: 1.6,
    border: '1px solid ' + (kind === 'kill' ? 'oklch(0.92 0.04 25)' : 'var(--border)'),
    display: 'flex', gap: 10, alignItems: 'flex-start',
  }}>
    <span style={{
      fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 999,
      background: kind === 'kill' ? 'oklch(0.94 0.06 25)' : 'var(--bg-elev)',
      color: kind === 'kill' ? 'var(--red)' : 'var(--fg-muted)',
      letterSpacing: 0.04, textTransform: 'uppercase',
      flexShrink: 0, marginTop: 1,
    }}>
      {kind === 'kill' ? 'Removed' : 'Note'}
    </span>
    <div style={{ flex: 1 }}>{children}</div>
  </div>
);

/* ---------- Main canvas ---------- */
const App = () => (
  <DesignCanvas title="Clip Detail · File-on-disk actions" subtitle="ClipForge is a desktop app. The clip mp4 lives in the user's project folder. The old 'Download' button pretended we were a website — this replaces it.">

    <DCSection id="live" title="Interactive demo" subtitle="Cycle through the four states">
      <DCArtboard id="live-demo" label="Live · cycle states" width={820} height={520}>
        <LiveDemo/>
      </DCArtboard>
      <DCArtboard id="anatomy" label="Anatomy · Ready state" width={680} height={520}>
        <ReadyAnatomy/>
      </DCArtboard>
    </DCSection>

    <DCSection id="lifecycle" title="Lifecycle" subtitle="① Unrendered → ② Rendering → ③ Ready → (re-trim) → ④ Stale → ② Rendering → ③ Ready">
      <DCArtboard id="lifecycle" label="Lifecycle storyboard" width={780} height={760}>
        <Lifecycle/>
      </DCArtboard>
    </DCSection>

    <DCSection id="header-slots" title="In context — Clip Detail header" subtitle="Same anchor, same prominence. Card width adapts to state; nothing else on the page moves.">
      <DCArtboard id="slot-unrendered" label="① Unrendered" width={680} height={320}>
        <HeaderSlot sub="First time the user opens this clip. The action surface tells them what would happen + a primary CTA.">
          <UnrenderedState onPrepare={()=>{}}/>
        </HeaderSlot>
      </DCArtboard>

      <DCArtboard id="slot-rendering" label="② Rendering" width={680} height={320}>
        <HeaderSlot sub="ffmpeg is running. Same slot, indeterminate shimmer (we have no progress telemetry).">
          <RenderingState/>
        </HeaderSlot>
      </DCArtboard>

      <DCArtboard id="slot-ready" label="③ Ready" width={740} height={340}>
        <HeaderSlot sub="The most important state. Confirmation + path + actions all live here — no popovers, no toasts to acknowledge.">
          <ReadyState fullPath={SAMPLE_PATH} onReveal={()=>{}}/>
        </HeaderSlot>
      </DCArtboard>

      <DCArtboard id="slot-stale" label="④ Stale" width={740} height={340}>
        <HeaderSlot sub="User trimmed after rendering. Amber accent. Stale path still shown — a user who's OK with the old cut can still get to it.">
          <StaleState fullPath={SAMPLE_PATH} onReprepare={()=>{}}/>
        </HeaderSlot>
      </DCArtboard>
    </DCSection>

    <DCSection id="paths" title="Path display" subtitle="Filename comes from the clip's title">
      <DCArtboard id="path-truncation" label="Truncation & long paths" width={680} height={300}>
        <PathVariants/>
      </DCArtboard>
      <DCArtboard id="platform-copy" label="Platform-specific copy" width={680} height={360}>
        <PlatformCopy/>
      </DCArtboard>
    </DCSection>

    <DCSection id="notes" title="Decisions & out-of-scope" subtitle="">
      <DCArtboard id="kept" label="Kept" width={760} height={340}>
        <div style={{ padding: 28, background: 'var(--bg)', display: 'grid', gap: 12 }}>
          <Note><b style={{ color: 'var(--fg)' }}>Same slot, same anchor.</b> Top-right of Clip Detail. The card width changes by state but the page layout doesn't shift.</Note>
          <Note><b style={{ color: 'var(--fg)' }}>Title-derived filename.</b> The mp4 is named after the clip's title, not the internal id. So a Mandarin clip ends up on disk as <span className="mono" style={{ background: 'var(--bg-sunken)', padding: '1px 5px', borderRadius: 3 }}>AI 时代…mp4</span> — recognizable in Finder.</Note>
          <Note><b style={{ color: 'var(--fg)' }}>Stale ≠ broken.</b> Stale state still surfaces the on-disk path, muted with a strike-through, so the user can grab the old cut if that's what they want.</Note>
          <Note><b style={{ color: 'var(--fg)' }}>One platform flip.</b> Only the reveal label changes copy — "Show in Finder" / "Show in File Explorer".</Note>
        </div>
      </DCArtboard>
      <DCArtboard id="removed" label="Removed" width={760} height={340}>
        <div style={{ padding: 28, background: 'var(--bg)', display: 'grid', gap: 12 }}>
          <Note kind="kill">The <b>Encoding… → Saving… → Done</b> chip. No HTTP round-trip means no transfer to narrate.</Note>
          <Note kind="kill">The <b>"Still working…"</b> stuck hint. We render locally; if ffmpeg hangs that's a real bug, not a UI state.</Note>
          <Note kind="kill">The <b>error toast with "Copy error details"</b> button + the diagnostic modal. Surface as a normal failure in the Jobs popover when it does happen.</Note>
          <Note kind="kill">The <b>variants dropdown</b> on this control. "Original" is the only file the affordance manages; captions / vertical reframe stay in the variant tabs below the player.</Note>
        </div>
      </DCArtboard>
      <DCArtboard id="oos" label="Out of scope" width={760} height={300}>
        <div style={{ padding: 28, background: 'var(--bg)', display: 'grid', gap: 12 }}>
          <Note><b style={{ color: 'var(--fg)' }}>Bulk "Show all ready clips in Finder".</b> Project-level concern, separate flow.</Note>
          <Note><b style={{ color: 'var(--fg)' }}>A "Downloads" or "Exports" list.</b> The project folder is the list.</Note>
          <Note><b style={{ color: 'var(--fg)' }}>"Send to Premiere" / share sheets.</b> Native drag-out from the file manager covers this.</Note>
          <Note><b style={{ color: 'var(--fg)' }}>Cleaning up old files on clip delete.</b> Separate concern.</Note>
        </div>
      </DCArtboard>
    </DCSection>
  </DesignCanvas>
);

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App/>);
