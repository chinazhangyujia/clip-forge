/* global React, Icon, Spinner, useStore */
/* ---------- ClipFileActions — file-on-disk affordance for Clip Detail header ----------

   ClipForge is a desktop app. Once a clip is rendered, its mp4 lives in the user's
   project working directory. This component replaces the old "Download" button
   with a mental model of "here's the file on disk, here's what you can do with it."

   States:
     1) unrendered — no mp4 exists yet. Primary: "Prepare clip".
     2) rendering — ffmpeg running. Indeterminate progress, "Preparing clip…".
     3) ready     — mp4 exists, in sync with current trim bounds. Shows path +
                    Show in Finder / Save a copy / Copy path.
     4) stale     — mp4 exists but bounds changed since render. Amber warning +
                    Re-prepare clip; still shows path to the stale file.
*/

const { useState, useEffect, useRef, useMemo } = React;

/* Platform detection — mac vs windows label flip */
const isWindows = typeof navigator !== 'undefined' && /Win/i.test(navigator.platform || navigator.userAgent || '');
const REVEAL_LABEL = isWindows ? 'Show in File Explorer' : 'Show in Finder';
const FILE_MANAGER = isWindows ? 'File Explorer' : 'Finder';

/* ---------- Truncate a path with ellipsis from the middle ---------- */
const truncatePath = (path, max = 56) => {
  if (path.length <= max) return path;
  const head = Math.floor((max - 1) / 2);
  const tail = max - 1 - head;
  return path.slice(0, head) + '…' + path.slice(-tail);
};

/* ---------- Friendly filename from clip title ---------- */
const fileNameFor = (clip) => {
  const safe = (clip.title || clip.id).replace(/[/\\:*?"<>|]/g, '').trim() || clip.id;
  return `${safe}.mp4`;
};

/* ---------- The path display row — mono, truncated, with tooltip ---------- */
const PathRow = ({ fullPath, muted = false }) => {
  return (
    <div
      title={fullPath}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 10px',
        background: 'var(--bg-sunken)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        color: muted ? 'var(--fg-faint)' : 'var(--fg)',
        minWidth: 0,
        opacity: muted ? 0.85 : 1,
      }}
    >
      <span style={{ color: muted ? 'var(--fg-faint)' : 'var(--fg-muted)', display: 'inline-flex', flexShrink: 0 }}>
        <Icon name="folder" size={13}/>
      </span>
      <span style={{
        flex: 1,
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        textDecoration: muted ? 'line-through' : 'none',
        textDecorationColor: 'oklch(0.78 0.008 70)',
      }}>
        {fullPath}
      </span>
    </div>
  );
};

/* ---------- State 1: Unrendered ---------- */
const UnrenderedState = ({ onPrepare }) => (
  <div className="card" style={{
    padding: 14,
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    minWidth: 340,
  }}>
    <div style={{
      width: 36, height: 36, borderRadius: 'var(--radius-sm)',
      background: 'var(--bg-sunken)',
      border: '1px dashed var(--border-strong)',
      display: 'grid', placeItems: 'center',
      color: 'var(--fg-faint)',
      flexShrink: 0,
    }}>
      <Icon name="file" size={16}/>
    </div>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg)' }}>
        Clip not in your project folder yet
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginTop: 2, lineHeight: 1.45 }}>
        We'll cut this clip from the source video and place the mp4 in your project folder.
      </div>
    </div>
    <button className="btn btn-primary" onClick={onPrepare} style={{ flexShrink: 0 }}>
      <Icon name="sparkle" size={14}/>
      Prepare clip
    </button>
  </div>
);

/* ---------- State 2: Rendering ---------- */
const RenderingState = ({ label = 'Preparing clip…' }) => (
  <div className="card" style={{
    padding: 14,
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    minWidth: 340,
    background: 'var(--accent-soft)',
    borderColor: 'oklch(0.88 0.08 50)',
  }}>
    <div style={{
      width: 36, height: 36, borderRadius: 'var(--radius-sm)',
      background: 'var(--bg-elev)',
      border: '1px solid oklch(0.88 0.08 50)',
      display: 'grid', placeItems: 'center',
      color: 'var(--accent)',
      flexShrink: 0,
    }}>
      <Spinner size={16}/>
    </div>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 500, color: 'oklch(0.38 0.14 45)' }}>
        {label}
      </div>
      <div style={{
        marginTop: 6,
        height: 3,
        background: 'oklch(1 0 0 / 0.6)',
        borderRadius: 999,
        overflow: 'hidden',
        position: 'relative',
      }}>
        <div style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(90deg, transparent 0%, var(--accent) 50%, transparent 100%)',
          animation: 'chipShimmer 1.6s ease-in-out infinite',
        }}/>
      </div>
      <div style={{ fontSize: 11, color: 'oklch(0.5 0.13 45)', marginTop: 4 }}>
        ffmpeg is rendering to your project folder.
      </div>
    </div>
  </div>
);

/* ---------- State 3: Ready ---------- */
const ReadyState = ({ fullPath, onReveal }) => {
  return (
    <div className="card" style={{
      padding: 14,
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      minWidth: 380,
      maxWidth: 460,
    }}>
      {/* Status confirmation row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          display: 'inline-flex',
          width: 18, height: 18, borderRadius: 999,
          background: 'oklch(0.96 0.05 155)',
          border: '1px solid oklch(0.85 0.08 155)',
          color: 'var(--green)',
          alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <Icon name="check" size={11}/>
        </span>
        <span style={{
          fontSize: 12.5,
          fontWeight: 500,
          color: 'oklch(0.42 0.13 155)',
        }}>
          Clip is in your project folder
        </span>
      </div>

      {/* Path row */}
      <PathRow fullPath={fullPath}/>

      {/* Action row */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="btn btn-primary" onClick={onReveal} style={{ flex: 1 }}>
          <Icon name="folder" size={14}/>
          {REVEAL_LABEL}
        </button>
      </div>
    </div>
  );
};

/* ---------- State 4: Stale ---------- */
const StaleState = ({ fullPath, onReprepare, rendering }) => (
  <div className="card" style={{
    padding: 14,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    minWidth: 380,
    maxWidth: 460,
    background: 'oklch(0.985 0.025 75)',
    borderColor: 'oklch(0.9 0.06 75)',
  }}>
    {/* Warning row */}
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
      <span style={{
        display: 'inline-flex',
        width: 18, height: 18, borderRadius: 999,
        background: 'oklch(0.97 0.04 75)',
        border: '1px solid oklch(0.9 0.06 75)',
        color: 'oklch(0.5 0.13 75)',
        alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
        marginTop: 1,
      }}>
        <Icon name="alert" size={11}/>
      </span>
      <span style={{
        fontSize: 12.5,
        fontWeight: 500,
        color: 'oklch(0.4 0.13 75)',
        lineHeight: 1.45,
      }}>
        Bounds changed since last render — the file in your project folder reflects the older cut.
      </span>
    </div>

    {/* Stale path — muted */}
    <PathRow fullPath={fullPath} muted/>

    {/* Action row */}
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <button
        className="btn btn-primary"
        onClick={onReprepare}
        disabled={rendering}
        style={{ flex: 1 }}
      >
        {rendering ? <Spinner size={14}/> : <Icon name="refresh" size={14}/>}
        {rendering ? 'Re-preparing…' : 'Re-prepare clip'}
      </button>
    </div>
  </div>
);

/* ---------- Path builder ---------- */
const buildFullPath = (project, clip) => {
  const root = project?.workingDir || `~/ClipForge/${(project?.name || 'Project').replace(/[/\\:*?"<>|]/g, '-')}`;
  return `${root}/clips/${fileNameFor(clip)}`;
};

/* ---------- Determine state from clip data ---------- */
const deriveState = (clip, localRendering) => {
  if (localRendering) return 'rendering';
  if (!clip.rendered) return 'unrendered';
  const rb = clip.renderedBounds;
  if (rb && (rb.startSec !== clip.startSec || rb.endSec !== clip.endSec)) return 'stale';
  return 'ready';
};

/* ---------- ClipFileActions — the integrated control used on Clip Detail ---------- */
const ClipFileActions = ({ clip, project, updateClip, pushToast }) => {
  const [rendering, setRendering] = useState(false);

  const state = deriveState(clip, rendering);
  const fullPath = useMemo(() => buildFullPath(project, clip), [project, clip]);

  // Simulated render — the real implementation kicks ffmpeg off in the background.
  const startRender = () => {
    setRendering(true);
    setTimeout(() => {
      setRendering(false);
      updateClip({
        rendered: true,
        renderedBounds: { startSec: clip.startSec, endSec: clip.endSec },
      });
      pushToast?.({
        kind: 'success',
        title: 'Clip is ready',
        body: `Saved to ${fileNameFor(clip)} in your project folder`,
        duration: 4500,
      });
    }, 2200);
  };

  const onReveal = () => {
    pushToast?.({
      kind: 'info',
      title: `Revealed in ${FILE_MANAGER}`,
      body: fileNameFor(clip),
      duration: 2500,
    });
  };

  if (state === 'rendering') return <RenderingState/>;
  if (state === 'unrendered') return <UnrenderedState onPrepare={startRender}/>;
  if (state === 'stale')      return <StaleState fullPath={fullPath} onReprepare={startRender} rendering={rendering}/>;
  return <ReadyState fullPath={fullPath} onReveal={onReveal}/>;
};

Object.assign(window, {
  ClipFileActions,
  UnrenderedState,
  RenderingState,
  ReadyState,
  StaleState,
  PathRow,
  fileNameFor,
  buildFullPath,
  truncatePath,
  REVEAL_LABEL,
  FILE_MANAGER,
});
