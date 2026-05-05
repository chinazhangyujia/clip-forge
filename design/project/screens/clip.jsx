/* global React, Icon, Spinner, useStore, useRouter, Link, fmtTime, SAMPLE_TRANSCRIPT, TrimPanel, DownloadControl, useDownloadManager */
const { useState, useEffect, useRef, useMemo } = React;

const ClipDetail = ({ projectId, clipId }) => {
  const { projects, clipsByProject, setClipsByProject, pushToast } = useStore();
  const { navigate } = useRouter();

  const project = projects.find(p => p.id === projectId);
  const clips = clipsByProject[projectId] || [];
  const clip = clips.find(c => c.id === clipId);

  const [variant, setVariant] = useState('original');
  const [playing, setPlaying] = useState(false);
  const [scrub, setScrub] = useState(0);
  const [generating, setGenerating] = useState(null); // 'captions' | 'reframe' | null
  const [genProgress, setGenProgress] = useState(0);
  const [previewBand, setPreviewBand] = useState(null); // {start,end} while dragging trim handles
  const downloadManager = useDownloadManager();

  const updateClip = (patch) => {
    setClipsByProject(cbp => ({
      ...cbp,
      [projectId]: cbp[projectId].map(c => c.id === clipId ? { ...c, ...patch } : c),
    }));
  };

  // Simulated playback
  useEffect(() => {
    if (!playing || !clip) return;
    const t = setInterval(() => {
      setScrub(s => {
        const next = s + 0.1 / (clip.duration);
        if (next >= 1) { setPlaying(false); return 0; }
        return next;
      });
    }, 100);
    return () => clearInterval(t);
  }, [playing, clip]);

  // Simulated generation
  useEffect(() => {
    if (!generating) return;
    setGenProgress(0);
    const t = setInterval(() => {
      setGenProgress(p => {
        const next = p + 1.5 + Math.random() * 2;
        if (next >= 100) {
          clearInterval(t);
          const newVariants = [...new Set([...clip.variants, generating, (clip.variants.includes(generating === 'captions' ? 'reframe' : 'captions') ? 'both' : null)].filter(Boolean))];
          updateClip({ variants: newVariants });
          pushToast({ kind: 'success', title: `${generating === 'captions' ? 'Captions' : 'Reframe'} ready`, body: 'Variant added to this clip' });
          setGenerating(null);
          setVariant(generating);
          return 0;
        }
        return next;
      });
    }, 220);
    return () => clearInterval(t);
  }, [generating]);

  if (!project || !clip) {
    return (
      <div className="page">
        <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--fg-muted)' }}>
          Clip not found.
          <div style={{ marginTop: 16 }}>
            <Link to="/" className="btn">Back to projects</Link>
          </div>
        </div>
      </div>
    );
  }

  const hasCaptions = clip.variants.includes('captions') || clip.variants.includes('both');
  const hasReframe = clip.variants.includes('reframe') || clip.variants.includes('both');
  const hasBoth = clip.variants.includes('both') || (hasCaptions && hasReframe);

  const staleVariants = clip.staleVariants || [];
  const isStale = (key) => staleVariants.includes(key);

  const variants = [
    { key: 'original', label: 'Original', has: true, stale: false },
    { key: 'captions', label: '+ Captions', has: hasCaptions, stale: isStale('captions') },
    { key: 'reframe', label: '+ Vertical reframe', has: hasReframe, stale: isStale('reframe') },
    { key: 'both', label: 'Captions + Reframe', has: hasBoth, stale: isStale('both') || (isStale('captions') && isStale('reframe')) },
  ];

  const anyStale = variants.some(v => v.has && v.stale);

  // Source video duration — use the project file's duration as the trim track range
  const sourceDurationSec = project.file?.durationSec || Math.max(clip.endSec + 600, 600);

  // Sentence boundaries for snap. Source-relative; mapped from the clip-relative
  // SAMPLE_TRANSCRIPT timestamps using the clip's original start.
  const snapBoundaries = useMemo(() => {
    const orig = clip.original?.startSec ?? clip.startSec;
    return SAMPLE_TRANSCRIPT.map(line => orig + line.t).filter(t => t >= 0 && t <= sourceDurationSec);
  }, [clip.id, clip.original, sourceDurationSec]);

  const neighbors = clips.map(c => ({ id: c.id, startSec: c.startSec, endSec: c.endSec }));

  const onSaveTrim = (startSec, endSec) => {
    const original = clip.original || { startSec: clip.startSec, endSec: clip.endSec };
    // Anything that was previously generated becomes stale.
    const newlyStale = clip.variants.filter(v => v !== 'original');
    updateClip({
      startSec,
      endSec,
      duration: Math.round((endSec - startSec) * 10) / 10,
      original,
      staleVariants: Array.from(new Set([...(clip.staleVariants || []), ...newlyStale])),
    });
    if (variant !== 'original' && newlyStale.includes(variant)) {
      // Stay on the variant tab; the stale warning + Regenerate affordance will show inline.
    }
    pushToast({ kind: 'success', title: 'Clip boundaries updated', body: `${fmtTime(startSec)} – ${fmtTime(endSec)} · ${(endSec - startSec).toFixed(1)}s` });
  };

  const regenerate = (key) => {
    // Drop the variant from the existing list and from the stale list, then run generation again.
    setClipsByProject(cbp => ({
      ...cbp,
      [projectId]: cbp[projectId].map(c => c.id === clipId ? {
        ...c,
        variants: c.variants.filter(v => v !== key && !(key === 'captions' && v === 'both') && !(key === 'reframe' && v === 'both')),
        staleVariants: (c.staleVariants || []).filter(v => v !== key),
      } : c),
    }));
    setGenerating(key === 'both' ? 'captions' : key);
  };

  const currentSec = scrub * clip.duration;
  const activeWordIdx = SAMPLE_TRANSCRIPT.findIndex((line, i) => {
    const next = SAMPLE_TRANSCRIPT[i + 1];
    return currentSec >= line.t && (!next || currentSec < next.t);
  });

  return (
    <div className="page" style={{ maxWidth: 1400 }}>
      {/* Breadcrumbs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 13, color: 'var(--fg-muted)' }}>
        <Link to="/" style={{ color: 'var(--fg-muted)' }}>Projects</Link>
        <span style={{ opacity: .5 }}>/</span>
        <Link to={`/projects/${project.id}`} style={{ color: 'var(--fg-muted)' }}>{project.name}</Link>
        <span style={{ opacity: .5 }}>/</span>
        <span style={{ color: 'var(--fg)' }}>Clip</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' }}>
            {clip.title}
          </h1>
          <div style={{ marginTop: 6, fontSize: 13, color: 'var(--fg-muted)', display: 'flex', gap: 14 }}>
            <span className="mono">{fmtTime(clip.startSec)} – {fmtTime(clip.endSec)}</span>
            <span>·</span>
            <span>{clip.duration}s</span>
            <span>·</span>
            <span>9:16 vertical</span>
          </div>
        </div>
        <DownloadControl clip={clip} variants={variants} manager={downloadManager}/>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 24, alignItems: 'flex-start' }}>
        {/* Left: player + transcript */}
        <main>
          <VariantTabs variants={variants} active={variant} setActive={setVariant} onGenerate={(k) => setGenerating(k)} generating={generating}/>
          {anyStale && (
            <StaleWarning variants={variants} onRegenerate={regenerate} generating={generating}/>
          )}
          <TrimPanel
            clip={clip}
            sourceDurationSec={sourceDurationSec}
            neighbors={neighbors}
            snapBoundaries={snapBoundaries}
            isPlaying={playing}
            currentSec={playing ? clip.startSec + scrub * clip.duration : null}
            onPreviewBand={(start, end) => setPreviewBand(start == null ? null : { start, end })}
            onSave={onSaveTrim}
          />
          <Player
            clip={clip}
            variant={variant}
            playing={playing}
            setPlaying={setPlaying}
            scrub={scrub}
            setScrub={setScrub}
          />
          <ActionBar
            hasCaptions={hasCaptions}
            hasReframe={hasReframe}
            generating={generating}
            genProgress={genProgress}
            onGenCaptions={() => setGenerating('captions')}
            onGenReframe={() => setGenerating('reframe')}
          />
          <Transcript
            currentSec={currentSec}
            activeIdx={activeWordIdx}
            previewBand={previewBand}
            clipStart={clip.original?.startSec ?? clip.startSec}
          />
        </main>

        {/* Right: metadata */}
        <aside style={{ position: 'sticky', top: 80, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <MetaCard clip={clip} updateClip={updateClip}/>
        </aside>
      </div>
    </div>
  );
};

const VariantTabs = ({ variants, active, setActive, onGenerate, generating }) => (
  <div style={{
    display: 'flex',
    background: 'var(--bg-sunken)',
    borderRadius: 'var(--radius)',
    padding: 4,
    gap: 2,
    marginBottom: 14,
  }}>
    {variants.map(v => {
      const isActive = active === v.key;
      const dim = !v.has;
      const stale = v.has && v.stale;
      return (
        <button
          key={v.key}
          onClick={() => v.has ? setActive(v.key) : (generating ? null : onGenerate(v.key === 'both' ? 'captions' : v.key))}
          style={{
            flex: 1,
            padding: '8px 12px',
            borderRadius: 6,
            background: isActive ? 'var(--bg-elev)' : 'transparent',
            border: 'none',
            fontSize: 12.5,
            fontWeight: isActive ? 500 : 400,
            color: dim ? 'var(--fg-faint)' : stale ? 'var(--fg-faint)' : isActive ? 'var(--fg)' : 'var(--fg-muted)',
            cursor: dim && generating ? 'not-allowed' : 'pointer',
            boxShadow: isActive ? 'var(--shadow-sm)' : 'none',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            transition: 'all .12s',
            position: 'relative',
            textAlign: 'center',
            whiteSpace: 'nowrap',
            overflow: 'hidden', textOverflow: 'ellipsis',
            opacity: stale ? 0.7 : 1,
          }}
        >
          <span style={{ textDecoration: stale ? 'line-through' : 'none', textDecorationColor: 'var(--fg-faint)' }}>{v.label}</span>
          {dim && (
            <span style={{
              fontSize: 10, padding: '1px 6px', borderRadius: 999,
              background: 'var(--bg-elev)',
              color: 'var(--fg-faint)',
              fontWeight: 500,
              border: '1px solid var(--border)',
            }}>
              Generate
            </span>
          )}
          {stale && (
            <span style={{
              fontSize: 10, padding: '1px 6px', borderRadius: 999,
              background: 'oklch(0.97 0.04 75)',
              color: 'oklch(0.5 0.13 75)',
              fontWeight: 500,
              border: '1px solid oklch(0.9 0.06 75)',
            }}>
              Stale
            </span>
          )}
        </button>
      );
    })}
  </div>
);

const StaleWarning = ({ variants, onRegenerate, generating }) => {
  const stale = variants.filter(v => v.has && v.stale);
  if (stale.length === 0) return null;
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '10px 14px',
      marginBottom: 14,
      borderRadius: 'var(--radius)',
      border: '1px solid oklch(0.9 0.06 75)',
      background: 'oklch(0.98 0.025 75)',
      flexWrap: 'wrap',
    }}>
      <span style={{ color: 'oklch(0.5 0.13 75)', display: 'inline-flex', flexShrink: 0 }}>
        <Icon name="alert" size={14}/>
      </span>
      <span style={{ fontSize: 12.5, color: 'oklch(0.4 0.08 75)', flex: 1, minWidth: 200 }}>
        Captions and reframe were generated for the previous cut. Regenerate to apply the new boundaries.
      </span>
      <div style={{ display: 'flex', gap: 6 }}>
        {stale.map(v => (
          <button
            key={v.key}
            onClick={() => onRegenerate(v.key)}
            disabled={generating}
            className="btn btn-sm"
            style={{
              background: 'var(--bg-elev)',
              borderColor: 'oklch(0.9 0.06 75)',
              color: 'oklch(0.4 0.08 75)',
            }}
          >
            <Icon name="refresh" size={12}/>
            Regenerate {v.key === 'both' ? 'both' : v.key}
          </button>
        ))}
      </div>
    </div>
  );
};

const Player = ({ clip, variant, playing, setPlaying, scrub, setScrub }) => {
  const seed = clip.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const h1 = (seed * 11) % 360;
  const h2 = (h1 + 60) % 360;
  const isVertical = variant === 'reframe' || variant === 'both';
  const showCaptions = variant === 'captions' || variant === 'both';

  return (
    <div className="card" style={{ overflow: 'hidden', background: 'oklch(0.15 0.02 60)' }}>
      <div style={{
        position: 'relative',
        aspectRatio: isVertical ? '9 / 16' : '16 / 9',
        maxHeight: isVertical ? 560 : 'unset',
        margin: isVertical ? '0 auto' : 0,
        width: isVertical ? 'auto' : '100%',
        background: `linear-gradient(135deg, oklch(0.45 0.13 ${h1}), oklch(0.3 0.14 ${h2}))`,
        transition: 'aspect-ratio .25s',
      }}>
        <div style={{
          position: 'absolute', inset: 0,
          background: 'radial-gradient(120% 80% at 30% 30%, oklch(1 0 0 / 0.15), transparent 60%)',
        }}/>

        {/* Cold-open hook overlay */}
        {scrub < 0.05 && clip.hookText && (
          <div style={{
            position: 'absolute',
            top: '32%', left: '8%', right: '8%',
            color: 'white',
            fontWeight: 800,
            fontSize: isVertical ? 32 : 38,
            letterSpacing: '-0.02em',
            textAlign: 'center',
            textShadow: '0 2px 16px oklch(0 0 0 / 0.5)',
            lineHeight: 1.1,
            animation: 'fadeIn .3s',
          }}>
            {clip.hookText}
          </div>
        )}

        {/* Captions */}
        {showCaptions && scrub > 0.05 && (
          <div style={{
            position: 'absolute', bottom: '15%', left: '8%', right: '8%',
            textAlign: 'center',
          }}>
            <span style={{
              background: 'oklch(0 0 0 / 0.85)',
              color: 'oklch(0.99 0.07 75)',
              padding: '6px 12px',
              borderRadius: 6,
              fontSize: isVertical ? 18 : 22,
              fontWeight: 700,
              letterSpacing: 0.01,
              boxDecorationBreak: 'clone',
              WebkitBoxDecorationBreak: 'clone',
            }}>
              {SAMPLE_TRANSCRIPT[Math.min(SAMPLE_TRANSCRIPT.length - 1, Math.floor(scrub * SAMPLE_TRANSCRIPT.length))]?.text || ''}
            </span>
          </div>
        )}

        {/* Center play */}
        <button
          onClick={() => setPlaying(p => !p)}
          style={{
            position: 'absolute', inset: 0,
            display: 'grid', placeItems: 'center',
            background: 'transparent',
            opacity: playing ? 0 : 1,
            transition: 'opacity .15s',
          }}
        >
          <div style={{
            width: 64, height: 64, borderRadius: 999,
            background: 'oklch(1 0 0 / 0.95)',
            display: 'grid', placeItems: 'center',
            boxShadow: 'var(--shadow-lg)',
            color: 'var(--fg)',
          }}>
            <span style={{ marginLeft: 4 }}><Icon name="play" size={22}/></span>
          </div>
        </button>

        {/* Reframe indicator */}
        {isVertical && (
          <div className="mono" style={{
            position: 'absolute', top: 12, left: 12,
            background: 'oklch(0 0 0 / 0.6)',
            color: 'white', padding: '3px 8px', borderRadius: 4,
            fontSize: 10, letterSpacing: 0.05,
          }}>
            ZOOM &amp; FOLLOW · 9:16
          </div>
        )}
      </div>

      {/* Controls */}
      <div style={{ padding: '10px 14px', background: 'oklch(0.18 0.02 60)', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={() => setPlaying(p => !p)} style={{ color: 'white', display: 'inline-flex' }}>
          <Icon name={playing ? 'pause' : 'play'} size={16}/>
        </button>
        <span className="mono" style={{ color: 'oklch(1 0 0 / 0.7)', fontSize: 11 }}>
          {fmtTime(scrub * clip.duration)} / {fmtTime(clip.duration)}
        </span>
        <div
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            setScrub((e.clientX - rect.left) / rect.width);
          }}
          style={{ flex: 1, height: 4, background: 'oklch(1 0 0 / 0.15)', borderRadius: 999, cursor: 'pointer' }}
        >
          <div style={{ height: '100%', width: `${scrub * 100}%`, background: 'var(--accent)', borderRadius: 999 }}/>
        </div>
      </div>
    </div>
  );
};

const ActionBar = ({ hasCaptions, hasReframe, generating, genProgress, onGenCaptions, onGenReframe }) => {
  const status = generating === 'captions' ? 'Aligning words to audio…' :
                 generating === 'reframe' ? 'Detecting instructor…' : null;
  return (
    <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
      <ActionButton
        label="Generate burned-in captions"
        icon="captions"
        active={generating === 'captions'}
        progress={genProgress}
        status={status}
        done={hasCaptions}
        onClick={onGenCaptions}
        disabled={generating || hasCaptions}
      />
      <ActionButton
        label="Generate vertical reframe"
        icon="crop"
        active={generating === 'reframe'}
        progress={genProgress}
        status={status}
        done={hasReframe}
        onClick={onGenReframe}
        disabled={generating || hasReframe}
      />
    </div>
  );
};

const ActionButton = ({ label, icon, active, progress, status, done, onClick, disabled }) => {
  if (active) {
    return (
      <div className="card" style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ color: 'var(--accent)' }}><Spinner size={16}/></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500 }}>{status} <span className="mono" style={{ color: 'var(--accent)' }}>{Math.floor(progress)}%</span></div>
          <div style={{ marginTop: 6, height: 3, background: 'var(--bg-sunken)', borderRadius: 999, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${progress}%`, background: 'var(--accent)', borderRadius: 999, transition: 'width .25s' }}/>
          </div>
        </div>
      </div>
    );
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={done ? 'btn' : 'btn btn-primary'}
      style={{
        height: 'auto',
        padding: 14,
        justifyContent: 'flex-start',
        opacity: disabled && !done ? .55 : 1,
      }}
    >
      <span style={{ flexShrink: 0 }}><Icon name={done ? 'check' : icon} size={16}/></span>
      <span style={{ flex: 1, textAlign: 'left' }}>
        {done ? `${label.replace('Generate ', '').replace(/^./, c => c.toUpperCase())} ready` : label}
      </span>
    </button>
  );
};

const Transcript = ({ currentSec, activeIdx, previewBand, clipStart }) => (
  <div className="card" style={{ marginTop: 20, padding: 20 }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
      <div>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Transcript</h3>
        <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--fg-muted)' }}>
          {previewBand ? 'Previewing new boundaries…' : 'Highlights as the clip plays'}
        </p>
      </div>
      <span style={{ fontSize: 11, color: 'var(--fg-faint)' }}>Read-only</span>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {SAMPLE_TRANSCRIPT.map((line, i) => {
        const isActive = i === activeIdx;
        // Map transcript timestamp (clip-relative) into source-relative seconds for preview comparison
        const absT = (clipStart || 0) + line.t;
        let inPreview = true;
        let onPreviewEdge = false;
        if (previewBand) {
          inPreview = absT >= previewBand.start && absT <= previewBand.end;
          // Highlight the lines closest to the new edges so the user sees the new in/out
          if (inPreview) {
            const distStart = Math.abs(absT - previewBand.start);
            const distEnd = Math.abs(absT - previewBand.end);
            onPreviewEdge = distStart < 3 || distEnd < 3;
          }
        }
        const dimmed = previewBand && !inPreview;
        const highlighted = previewBand && inPreview;
        return (
          <div key={i} style={{
            display: 'flex', gap: 14,
            padding: '7px 10px',
            borderRadius: 6,
            background: highlighted
              ? 'var(--accent-soft)'
              : isActive ? 'var(--accent-soft)' : 'transparent',
            opacity: dimmed ? 0.35 : 1,
            transition: 'background .15s, opacity .15s',
            borderLeft: onPreviewEdge ? '2px solid var(--accent)' : '2px solid transparent',
            paddingLeft: 8,
          }}>
            <span className="mono" style={{
              color: highlighted || isActive ? 'oklch(0.5 0.16 45)' : 'var(--fg-faint)',
              fontSize: 11,
              flexShrink: 0,
              width: 36,
              paddingTop: 2,
              fontWeight: (highlighted || isActive) ? 500 : 400,
            }}>
              {fmtTime(line.t)}
            </span>
            <span style={{
              fontSize: 13.5, lineHeight: 1.55,
              color: highlighted || isActive ? 'var(--fg)' : 'var(--fg-muted)',
              fontWeight: (highlighted || isActive) ? 500 : 400,
            }}>
              {line.text}
            </span>
          </div>
        );
      })}
    </div>
  </div>
);

const MetaCard = ({ clip, updateClip }) => {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.06, textTransform: 'uppercase', color: 'var(--fg-faint)', marginBottom: 14 }}>
        Clip metadata
      </div>
      <EditableField
        label="Title"
        value={clip.title}
        onSave={(v) => updateClip({ title: v })}
      />
      <EditableField
        label="Description"
        value={clip.description}
        multiline
        onSave={(v) => updateClip({ description: v })}
      />
      <HashtagField hashtags={clip.hashtags} onChange={(v) => updateClip({ hashtags: v })}/>
      <EditableField
        label="Cold-open hook"
        sub="Overlay over first 1.5s"
        value={clip.hookText}
        onSave={(v) => updateClip({ hookText: v })}
      />
      <ThumbField clip={clip} onRegenerate={() => updateClip({ thumbFrame: Math.floor(Math.random() * 100) })}/>
    </div>
  );
};

const EditableField = ({ label, sub, value, multiline, onSave }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [regenerating, setRegenerating] = useState(false);

  useEffect(() => { setDraft(value); }, [value]);

  const regen = () => {
    setRegenerating(true);
    setTimeout(() => {
      const altered = label === 'Title'
        ? "Three words that 100x'd my views (a small teaching story)"
        : label === 'Description'
        ? "A short, punchy clip pulled from a longer talk. Watch for the moment a 3-word change unlocks 1.4M views."
        : label === 'Cold-open hook'
        ? "I changed three words."
        : value + ' (regenerated)';
      onSave(altered);
      setRegenerating(false);
    }, 900);
  };

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <div>
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.06, textTransform: 'uppercase', color: 'var(--fg-faint)' }}>
            {label}
          </span>
          {sub && <span style={{ fontSize: 10.5, color: 'var(--fg-faint)', marginLeft: 6, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>· {sub}</span>}
        </div>
        <button
          onClick={regen}
          disabled={regenerating}
          title="Regenerate"
          style={{ padding: 3, color: regenerating ? 'var(--accent)' : 'var(--fg-faint)', borderRadius: 4 }}
        >
          {regenerating ? <Spinner size={11}/> : <Icon name="sparkle" size={12}/>}
        </button>
      </div>
      {editing ? (
        multiline ? (
          <textarea
            className="textarea"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => { onSave(draft); setEditing(false); }}
            autoFocus
            rows={3}
            style={{ fontSize: 13 }}
          />
        ) : (
          <input
            className="input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => { onSave(draft); setEditing(false); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { onSave(draft); setEditing(false); } }}
            autoFocus
            style={{ fontSize: 13, padding: '6px 8px' }}
          />
        )
      ) : (
        <div
          onClick={() => setEditing(true)}
          style={{
            fontSize: 13, lineHeight: 1.5,
            padding: '6px 8px', margin: '0 -8px',
            borderRadius: 5,
            cursor: 'text',
            transition: 'background .12s',
            color: 'var(--fg)',
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-sunken)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
        >
          {value}
        </div>
      )}
    </div>
  );
};

const HashtagField = ({ hashtags, onChange }) => {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  const add = () => {
    const v = draft.trim().replace(/^#/, '');
    if (v) onChange([...hashtags, v]);
    setDraft('');
    setAdding(false);
  };

  const remove = (i) => onChange(hashtags.filter((_, idx) => idx !== i));

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.06, textTransform: 'uppercase', color: 'var(--fg-faint)' }}>
          Hashtags
        </span>
        <button title="Regenerate" style={{ padding: 3, color: 'var(--fg-faint)', borderRadius: 4 }}>
          <Icon name="sparkle" size={12}/>
        </button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {hashtags.map((h, i) => (
          <span key={i} style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '3px 4px 3px 8px',
            background: 'var(--bg-sunken)',
            border: '1px solid var(--border)',
            borderRadius: 999,
            fontSize: 12,
            fontFamily: 'var(--font-mono)',
          }}>
            #{h}
            <button onClick={() => remove(i)} style={{ display: 'inline-flex', color: 'var(--fg-faint)', padding: 2, borderRadius: 999 }}>
              <Icon name="x" size={11}/>
            </button>
          </span>
        ))}
        {adding ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={add}
            onKeyDown={(e) => { if (e.key === 'Enter') add(); if (e.key === 'Escape') { setDraft(''); setAdding(false); } }}
            placeholder="tag"
            style={{
              border: '1px dashed var(--border-strong)',
              background: 'transparent',
              padding: '2px 8px',
              borderRadius: 999,
              fontSize: 12,
              fontFamily: 'var(--font-mono)',
              outline: 'none',
              width: 80,
            }}
          />
        ) : (
          <button onClick={() => setAdding(true)} style={{
            padding: '3px 10px',
            border: '1px dashed var(--border-strong)',
            borderRadius: 999,
            fontSize: 12,
            color: 'var(--fg-faint)',
            background: 'transparent',
          }}>
            + add
          </button>
        )}
      </div>
    </div>
  );
};

const ThumbField = ({ clip, onRegenerate }) => {
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.06, textTransform: 'uppercase', color: 'var(--fg-faint)' }}>
          Thumbnail
        </span>
        <button onClick={regen} disabled={regenerating} title="Pick another frame" style={{ padding: 3, color: regenerating ? 'var(--accent)' : 'var(--fg-faint)', borderRadius: 4 }}>
          {regenerating ? <Spinner size={11}/> : <Icon name="refresh" size={12}/>}
        </button>
      </div>
      <div style={{
        aspectRatio: '9 / 16',
        maxHeight: 160,
        width: 90,
        borderRadius: 6,
        background: `linear-gradient(135deg, oklch(0.5 0.13 ${h1}), oklch(0.35 0.14 ${h2}))`,
        position: 'relative',
        overflow: 'hidden',
        opacity: regenerating ? 0.5 : 1,
        transition: 'opacity .2s',
      }}>
        <div style={{
          position: 'absolute', inset: 0,
          background: 'radial-gradient(120% 80% at 30% 30%, oklch(1 0 0 / 0.18), transparent 55%)',
        }}/>
        <span className="mono" style={{
          position: 'absolute', bottom: 6, right: 6,
          fontSize: 9, color: 'oklch(1 0 0 / 0.85)',
        }}>frame {clip.thumbFrame}</span>
      </div>
    </div>
  );
};

const DownloadDropdown = ({ variants, open, setOpen }) => {
  const ref = useRef(null);
  useEffect(() => {
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="btn btn-primary" onClick={() => setOpen(o => !o)}>
        <Icon name="download" size={14}/>
        Download
        <Icon name="chevronDown" size={13}/>
      </button>
      {open && (
        <div className="popover" style={{ width: 240 }}>
          <div className="popover-head">
            <span>Available Variants</span>
          </div>
          {variants.map(v => (
            <button
              key={v.key}
              disabled={!v.has}
              onClick={() => setOpen(false)}
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

Object.assign(window, { ClipDetail });
