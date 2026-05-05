/* global React, Icon, Spinner, useStore */
const { useState, useEffect, useRef, useMemo, useCallback } = React;

/* ---------- Download chip — replaces the Download button while a job is in flight ---------- */

/**
 * Phases:
 *   "saving"   — encoder running, OS dialog already accepted, file streaming to disk
 *   "encoding" — same as saving but slower start (we just keep one label set; spec uses both)
 *   "done"     — brief 1s flash before collapsing back to button
 *
 * The chip occupies the same horizontal slot as the Download button — it's sized to
 * roughly match (132px wide) and shares height + radius. It does NOT layout-shift the
 * surrounding header.
 */
const DownloadChip = ({ job, onCancel }) => {
  const [hover, setHover] = useState(false);
  const isDone = job.phase === 'done';
  const isError = job.phase === 'error';
  const stuck = job.stuck;

  const label = isDone ? 'Done'
    : isError ? 'Failed'
    : job.progress < 2 ? 'Starting…'
    : job.phase === 'saving' ? 'Saving…'
    : 'Encoding…';

  const accent = isDone ? 'var(--green)'
    : isError ? 'var(--red)'
    : 'var(--accent)';

  const fillBg = isDone ? 'oklch(0.96 0.05 155)'
    : isError ? 'oklch(0.97 0.04 25)'
    : 'var(--accent-soft)';

  const borderC = isDone ? 'oklch(0.85 0.08 155)'
    : isError ? 'oklch(0.88 0.08 25)'
    : 'oklch(0.88 0.08 50)';

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
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
        transition: 'border-color .15s, background .15s',
      }}
      role="status"
      aria-live="polite"
    >
      {/* Progress fill — sits behind everything, inside the chip */}
      <div style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
        borderRadius: 'inherit',
      }}>
        <div style={{
          position: 'absolute',
          left: 0, top: 0, bottom: 0,
          width: isDone || isError ? '100%' : `${Math.max(2, job.progress)}%`,
          background: isDone
            ? 'oklch(0.93 0.08 155)'
            : isError
            ? 'oklch(0.94 0.06 25)'
            : 'oklch(0.93 0.06 65)',
          transition: 'width .35s cubic-bezier(.4,.8,.3,1), background .2s',
        }}/>
        {/* Shimmer overlay when indeterminate */}
        {!isDone && !isError && job.progress < 2 && (
          <div style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(90deg, transparent 0%, oklch(1 0 0 / 0.5) 50%, transparent 100%)',
            animation: 'chipShimmer 1.4s ease-in-out infinite',
          }}/>
        )}
      </div>

      {/* Icon */}
      <span style={{
        position: 'relative',
        zIndex: 1,
        color: accent,
        display: 'inline-flex',
        flexShrink: 0,
      }}>
        {isDone ? <Icon name="check" size={14}/>
          : isError ? <Icon name="alert" size={14}/>
          : <Spinner size={13}/>}
      </span>

      {/* Label */}
      <span style={{
        position: 'relative',
        zIndex: 1,
        fontSize: 12.5,
        fontWeight: 500,
        color: isDone ? 'oklch(0.38 0.13 155)'
          : isError ? 'oklch(0.4 0.16 25)'
          : 'oklch(0.38 0.14 45)',
        letterSpacing: '-0.005em',
      }}>
        {label}
      </span>

      {/* Percentage */}
      {!isDone && !isError && (
        <span
          className="mono"
          style={{
            position: 'relative',
            zIndex: 1,
            marginLeft: 'auto',
            fontSize: 11.5,
            fontWeight: 500,
            color: 'oklch(0.42 0.13 45)',
            fontVariantNumeric: 'tabular-nums',
            paddingRight: hover ? 0 : 8,
            transition: 'padding .12s',
            minWidth: 32,
            textAlign: 'right',
          }}
        >
          {Math.floor(job.progress)}%
        </span>
      )}

      {/* Cancel — appears on hover */}
      {!isDone && !isError && (
        <button
          onClick={onCancel}
          aria-label="Cancel download"
          title="Cancel download"
          style={{
            position: 'relative',
            zIndex: 1,
            marginLeft: hover ? 0 : -28,
            opacity: hover ? 1 : 0,
            transition: 'margin .15s, opacity .12s',
            width: 24, height: 24, borderRadius: 6,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            color: 'oklch(0.42 0.13 45)',
            background: 'oklch(1 0 0 / 0.5)',
            flexShrink: 0,
          }}
        >
          <Icon name="x" size={12}/>
        </button>
      )}

      {/* Stuck hint — small line under the chip */}
      {stuck && !isDone && !isError && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 6px)',
          left: 0,
          fontSize: 11,
          color: 'var(--fg-muted)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          whiteSpace: 'nowrap',
        }}>
          <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 999, background: 'var(--amber)' }}/>
          Still working…
        </div>
      )}
    </div>
  );
};

/* ---------- Download manager — orchestrates the simulated download lifecycle ---------- */

/**
 * State shape:
 *   downloads[clipId] = {
 *     clipId, projectId, variant, label,    // identity
 *     phase: 'os-prompt' | 'encoding' | 'saving' | 'done' | 'error' | 'cancelled',
 *     progress: 0..100,
 *     stuck: boolean,                        // set after ~10s with no movement
 *     error?: string,
 *     savePath?: string,
 *     jobId,                                 // matches an entry in store.jobs while running
 *   }
 *
 * Hook returns: { startDownload(clip, variantKey), cancelDownload(clipId), getDownload(clipId) }
 */
const useDownloadManager = () => {
  const { setJobs, pushToast, dismissToast } = useStore();
  const [downloads, setDownloads] = useState({});
  const intervalsRef = useRef({});

  const clearInterval_ = (clipId) => {
    if (intervalsRef.current[clipId]) {
      clearInterval(intervalsRef.current[clipId]);
      delete intervalsRef.current[clipId];
    }
  };

  const removeJob = useCallback((jobId) => {
    setJobs(js => js.filter(j => j.id !== jobId));
  }, [setJobs]);

  const finishDownload = useCallback((clipId, jobId, savePath, clipTitle) => {
    setDownloads(d => ({ ...d, [clipId]: { ...d[clipId], phase: 'done', progress: 100 } }));
    // brief 1s success flash, then collapse and toast
    setTimeout(() => {
      setDownloads(d => {
        const next = { ...d };
        delete next[clipId];
        return next;
      });
      removeJob(jobId);
      pushToast({
        kind: 'success',
        title: 'Download ready',
        body: `${savePath} saved`,
        action: { label: 'Reveal in Finder', onClick: () => {} },
        duration: 5000,
      });
    }, 1000);
  }, [pushToast, removeJob]);

  const startDownload = useCallback((clip, variantKey, variantLabel) => {
    // Duplicate-click guard
    if (downloads[clip.id]) return;

    const projectId = clip.projectId;
    const jobId = `dl-${clip.id}-${Date.now()}`;
    const filename = `${clip.id}${variantKey === 'original' ? '' : '_' + variantKey}.mp4`;
    const savePath = `~/Downloads/${filename}`;

    // PHASE 1 — OS save-location prompt. We surface this synchronously, before
    // creating the chip. If the user cancels here, nothing visible changes.
    // (Simulated: skip prompt and proceed instantly. The real implementation
    // would show the OS Save As dialog here.)

    // PHASE 2 — chip appears, encoding starts
    setDownloads(d => ({
      ...d,
      [clip.id]: {
        clipId: clip.id,
        projectId,
        variant: variantKey,
        variantLabel,
        clipTitle: clip.title,
        phase: 'encoding',
        progress: 0,
        stuck: false,
        savePath,
        jobId,
        startedAt: Date.now(),
      },
    }));

    // Mirror in Jobs popover
    setJobs(js => [...js, {
      id: jobId,
      projectId,
      kind: 'download',
      label: `Downloading clip — ${clip.title}`,
      stage: 'download',
      progress: 0,
      status: 'running',
    }]);

    // Simulate progress
    let lastTickAt = Date.now();
    let lastProgress = 0;
    const interval = setInterval(() => {
      setDownloads(d => {
        const cur = d[clip.id];
        if (!cur || cur.phase === 'cancelled' || cur.phase === 'error' || cur.phase === 'done') {
          clearInterval_(clip.id);
          return d;
        }

        // Slight randomness; transition to "saving" past 80%
        let nextProgress = cur.progress + (1 + Math.random() * 4);
        // Random "stuck" simulation: occasionally pause early on
        if (cur.progress > 18 && cur.progress < 30 && Math.random() < 0.06) {
          nextProgress = cur.progress;
        }

        const nextPhase = nextProgress > 80 ? 'saving' : 'encoding';
        const elapsedSinceMove = Date.now() - lastTickAt;
        if (Math.abs(nextProgress - lastProgress) > 0.3) {
          lastTickAt = Date.now();
          lastProgress = nextProgress;
        }
        const stuck = elapsedSinceMove > 10000;

        if (nextProgress >= 100) {
          clearInterval_(clip.id);
          finishDownload(clip.id, jobId, savePath, clip.title);
          return { ...d, [clip.id]: { ...cur, progress: 100, phase: 'done' } };
        }

        // Mirror progress to job
        setJobs(js => js.map(j => j.id === jobId ? { ...j, progress: nextProgress } : j));

        return { ...d, [clip.id]: { ...cur, progress: nextProgress, phase: nextPhase, stuck } };
      });
    }, 220);
    intervalsRef.current[clip.id] = interval;
  }, [downloads, setJobs, finishDownload]);

  const cancelDownload = useCallback((clipId) => {
    clearInterval_(clipId);
    setDownloads(d => {
      const cur = d[clipId];
      if (!cur) return d;
      removeJob(cur.jobId);
      const next = { ...d };
      delete next[clipId];
      pushToast({ kind: 'info', title: 'Download cancelled', duration: 3000 });
      return next;
    });
  }, [pushToast, removeJob]);

  const failDownload = useCallback((clipId, errorMsg) => {
    clearInterval_(clipId);
    setDownloads(d => {
      const cur = d[clipId];
      if (!cur) return d;
      return { ...d, [clipId]: { ...cur, phase: 'error', error: errorMsg } };
    });
    setTimeout(() => {
      setDownloads(d => {
        const cur = d[clipId];
        if (!cur) return d;
        removeJob(cur.jobId);
        const next = { ...d };
        delete next[clipId];
        return next;
      });
    }, 800);
    pushToast({
      kind: 'error',
      title: 'Download failed',
      body: errorMsg,
      action: { label: 'Retry', clipId, retry: true },
      duration: 6000,
    });
  }, [pushToast, removeJob]);

  // Cleanup all intervals on unmount
  useEffect(() => () => {
    Object.values(intervalsRef.current).forEach(clearInterval);
  }, []);

  return { downloads, startDownload, cancelDownload, failDownload };
};

/* ---------- Drop-in download control — renders dropdown OR chip ---------- */

const DownloadControl = ({ clip, variants, manager }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const job = manager.downloads[clip.id];

  useEffect(() => {
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  if (job) {
    return (
      <DownloadChip
        job={job}
        onCancel={() => manager.cancelDownload(clip.id)}
      />
    );
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="btn btn-primary" onClick={() => setOpen(o => !o)}>
        <Icon name="download" size={14}/>
        Download
        <Icon name="chevronDown" size={13}/>
      </button>
      {open && (
        <div className="popover" style={{ width: 240 }}>
          <div className="popover-head"><span>Available Variants</span></div>
          {variants.map(v => (
            <button
              key={v.key}
              disabled={!v.has}
              onClick={() => {
                if (!v.has) return;
                setOpen(false);
                manager.startDownload(clip, v.key, v.label);
              }}
              style={{
                display: 'flex', width: '100%',
                padding: '10px 14px',
                alignItems: 'center', gap: 10,
                fontSize: 13,
                opacity: v.has ? 1 : 0.4,
                cursor: v.has ? 'pointer' : 'not-allowed',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <span style={{ color: 'var(--fg-faint)' }}><Icon name={v.has ? 'download' : 'x'} size={13}/></span>
              <span style={{ flex: 1, textAlign: 'left' }}>{v.label}</span>
              <span className="mono" style={{ fontSize: 10, color: 'var(--fg-faint)' }}>MP4</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

Object.assign(window, { DownloadChip, DownloadControl, useDownloadManager });
