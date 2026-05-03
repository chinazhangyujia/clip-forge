/* global React, Icon, Spinner, useStore, useRouter, Link, PROMPT_PRESETS, fmtTime */
const { useState, useEffect, useRef } = React;

const NewProject = () => {
  const { createProject, pushToast } = useStore();
  const { navigate } = useRouter();
  const [step, setStep] = useState(1);
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [activePreset, setActivePreset] = useState(null);

  const startFakeUpload = (f) => {
    setFile(f);
    setUploading(true);
    setProgress(0);
  };

  useEffect(() => {
    if (!uploading) return;
    const t = setInterval(() => {
      setProgress(p => {
        const next = Math.min(100, p + 1.2 + Math.random() * 1.8);
        if (next >= 100) {
          clearInterval(t);
          setUploading(false);
          pushToast({ kind: 'success', title: 'Upload complete', body: file?.name });
        }
        return next;
      });
    }, 220);
    return () => clearInterval(t);
  }, [uploading]);

  const canNext = step === 1 ? (file && !uploading) : step === 2 ? (name.trim() && prompt.trim()) : true;

  const onFinish = () => {
    const id = createProject({ name, prompt, file });
    pushToast({ kind: 'success', title: 'Project created', body: 'Processing has started' });
    navigate(`/projects/${id}`);
  };

  return (
    <div className="page" style={{ maxWidth: 880 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24 }}>
        <Link to="/" className="btn btn-ghost btn-sm" style={{ paddingLeft: 6 }}>
          <Icon name="chevronLeft" size={14}/>
          Projects
        </Link>
      </div>
      <h1 className="page-title" style={{ marginBottom: 4 }}>New project</h1>
      <p className="page-sub" style={{ marginBottom: 32 }}>Walk through three steps. We'll handle the rest.</p>

      <Stepper step={step}/>

      <div className="card" style={{ padding: 28, marginTop: 24 }}>
        {step === 1 && (
          <Step1
            file={file}
            uploading={uploading}
            progress={progress}
            onFile={startFakeUpload}
            onClear={() => { setFile(null); setProgress(0); setUploading(false); }}
          />
        )}
        {step === 2 && (
          <Step2
            name={name} setName={setName}
            prompt={prompt} setPrompt={setPrompt}
            activePreset={activePreset} setActivePreset={setActivePreset}
          />
        )}
        {step === 3 && (
          <Step3 file={file} name={name} prompt={prompt}/>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20 }}>
        <button className="btn" onClick={() => step === 1 ? navigate('/') : setStep(s => s - 1)} disabled={uploading}>
          {step === 1 ? 'Cancel' : 'Back'}
        </button>
        {step < 3 ? (
          <button className="btn btn-primary" onClick={() => setStep(s => s + 1)} disabled={!canNext}>
            Continue
            <Icon name="chevron" size={14}/>
          </button>
        ) : (
          <button className="btn btn-primary btn-lg" onClick={onFinish}>
            <Icon name="sparkle" size={15}/>
            Start processing
          </button>
        )}
      </div>
    </div>
  );
};

const Stepper = ({ step }) => {
  const steps = ['Upload material', 'Cutting instructions', 'Review'];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
      {steps.map((label, i) => {
        const n = i + 1;
        const active = step === n;
        const done = step > n;
        return (
          <React.Fragment key={n}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 26, height: 26, borderRadius: 999,
                display: 'grid', placeItems: 'center',
                fontSize: 12, fontWeight: 600,
                background: active ? 'var(--accent)' : done ? 'var(--accent-soft)' : 'var(--bg-elev)',
                color: active ? 'white' : done ? 'oklch(0.45 0.16 45)' : 'var(--fg-faint)',
                border: active ? '1px solid var(--accent)' : `1px solid ${done ? 'var(--accent-soft)' : 'var(--border)'}`,
                transition: 'all .2s',
              }}>
                {done ? <Icon name="check" size={13}/> : n}
              </div>
              <span style={{
                fontSize: 13.5,
                fontWeight: active ? 500 : 400,
                color: active ? 'var(--fg)' : done ? 'var(--fg-muted)' : 'var(--fg-faint)',
              }}>{label}</span>
            </div>
            {i < steps.length - 1 && (
              <div style={{
                flex: 1, height: 1, margin: '0 16px',
                background: done ? 'var(--accent-soft)' : 'var(--border)',
              }}/>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

const Step1 = ({ file, uploading, progress, onFile, onClear }) => {
  const inputRef = useRef(null);
  const [drag, setDrag] = useState(false);

  const handleFile = (f) => {
    if (!f) return;
    // Synthesize file metadata
    const sizeGB = (8 + Math.random() * 8).toFixed(1);
    onFile({
      name: f.name || 'lecture-recording.mp4',
      size: `${sizeGB} GB`,
      duration: '3:12:48',
      durationSec: 11568,
    });
  };

  if (file) {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: 16, background: 'var(--bg-sunken)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
          <div style={{
            width: 64, height: 64, borderRadius: 8,
            background: 'linear-gradient(135deg, oklch(0.55 0.12 280), oklch(0.4 0.13 320))',
            display: 'grid', placeItems: 'center',
            color: 'white',
            flexShrink: 0,
          }}>
            <Icon name="video" size={24}/>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 500, marginBottom: 2, fontSize: 14 }}>{file.name}</div>
            <div style={{ fontSize: 12.5, color: 'var(--fg-muted)', display: 'flex', gap: 12 }}>
              <span>{file.size}</span>
              <span>•</span>
              <span>{file.duration}</span>
              <span>•</span>
              <span>~{Math.ceil(parseFloat(file.size) * 2.5)} chunks</span>
            </div>
          </div>
          {!uploading && (
            <button className="btn btn-sm btn-ghost" onClick={onClear} style={{ color: 'var(--fg-muted)' }}>
              <Icon name="x" size={14}/>
              Remove
            </button>
          )}
        </div>

        {uploading && (
          <div style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13 }}>
              <span style={{ color: 'var(--fg-muted)' }}>
                Uploading chunks · <span className="mono">{Math.floor(parseFloat(file.size) * 2.5 * progress / 100)}</span> / <span className="mono">{Math.ceil(parseFloat(file.size) * 2.5)}</span>
              </span>
              <span className="mono" style={{ color: 'var(--accent)', fontWeight: 500 }}>{Math.floor(progress)}%</span>
            </div>
            <div style={{ height: 6, background: 'var(--bg-sunken)', borderRadius: 999, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${progress}%`, background: 'var(--accent)', borderRadius: 999, transition: 'width .25s' }}/>
            </div>
            <div style={{ fontSize: 12, color: 'var(--fg-faint)', marginTop: 8 }}>
              Resumable — safe to leave this tab. Connection will auto-recover.
            </div>
          </div>
        )}

        {!uploading && progress >= 100 && (
          <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--green)' }}>
            <Icon name="check" size={16}/>
            Upload complete
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files[0];
          handleFile(f);
        }}
        onClick={() => inputRef.current?.click()}
        style={{
          border: `2px dashed ${drag ? 'var(--accent)' : 'var(--border-strong)'}`,
          background: drag ? 'var(--accent-soft)' : 'var(--bg-sunken)',
          borderRadius: 'var(--radius-lg)',
          padding: '64px 24px',
          textAlign: 'center',
          cursor: 'pointer',
          transition: 'all .15s',
        }}
      >
        <div style={{
          width: 56, height: 56, margin: '0 auto 16px',
          borderRadius: 14,
          background: 'var(--bg-elev)',
          border: '1px solid var(--border)',
          display: 'grid', placeItems: 'center',
          color: 'var(--accent)',
        }}>
          <Icon name="upload" size={22}/>
        </div>
        <div style={{ fontSize: 15.5, fontWeight: 500, marginBottom: 4 }}>
          Drop your source material here
        </div>
        <div style={{ color: 'var(--fg-muted)', fontSize: 13 }}>
          One video file for now — MP4, MOV up to 20 GB. Audio, slides &amp; multi-file projects coming soon.
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          style={{ display: 'none' }}
          onChange={(e) => handleFile(e.target.files[0])}
        />
      </div>
      <div style={{ marginTop: 16, padding: 14, background: 'var(--bg-sunken)', borderRadius: 'var(--radius)', display: 'flex', gap: 10, fontSize: 12.5, color: 'var(--fg-muted)' }}>
        <span style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }}><Icon name="info" size={14}/></span>
        <span>5–20 GB files supported with resumable, chunked upload. You can close this tab and resume later.</span>
      </div>
    </div>
  );
};

const Step2 = ({ name, setName, prompt, setPrompt, activePreset, setActivePreset }) => {
  const presets = Object.keys(PROMPT_PRESETS);
  return (
    <div>
      <label style={{ display: 'block', marginBottom: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Project name</div>
        <input
          className="input input-lg"
          placeholder="e.g. Course Module 4 — Hooks"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>How should we cut this video?</div>
        <span style={{ fontSize: 12, color: 'var(--fg-faint)' }}>{prompt.length} chars</span>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {presets.map(p => (
          <button
            key={p}
            className={`chip ${activePreset === p ? 'chip-active' : ''}`}
            onClick={() => {
              setPrompt(PROMPT_PRESETS[p]);
              setActivePreset(p);
            }}
          >
            <Icon name="sparkle" size={12}/>
            {p}
          </button>
        ))}
      </div>

      <textarea
        className="textarea"
        rows={8}
        value={prompt}
        onChange={(e) => { setPrompt(e.target.value); setActivePreset(null); }}
        placeholder="Cut into 30–90 second clips around each distinct teaching point. Prioritize moments with strong hooks."
        style={{ minHeight: 180, fontSize: 14 }}
      />

      <div style={{ marginTop: 16, padding: 14, background: 'var(--accent-soft)', borderRadius: 'var(--radius)', fontSize: 12.5, color: 'oklch(0.42 0.14 45)', display: 'flex', gap: 10 }}>
        <span style={{ flexShrink: 0, marginTop: 1 }}><Icon name="sparkle" size={14}/></span>
        <span>Be specific. The clearer your instructions, the better the cuts. You can always re-run with a new prompt.</span>
      </div>
    </div>
  );
};

const Step3 = ({ file, name, prompt }) => {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.06, textTransform: 'uppercase', color: 'var(--fg-faint)', marginBottom: 12 }}>
        Project
      </div>
      <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em', marginBottom: 24 }}>
        {name || 'Untitled project'}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
        <SummaryRow label="Source material" value={file?.name || '—'} mono/>
        <SummaryRow label="Size" value={file?.size || '—'} mono/>
        <SummaryRow label="Duration" value={file?.duration || '—'} mono/>
        <SummaryRow label="Format" value="MP4 (H.264)" mono/>
      </div>

      <div>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.06, textTransform: 'uppercase', color: 'var(--fg-faint)', marginBottom: 8 }}>
          Cutting instructions
        </div>
        <div style={{
          padding: 14, background: 'var(--bg-sunken)',
          borderRadius: 'var(--radius)', border: '1px solid var(--border)',
          fontSize: 13.5, lineHeight: 1.6, whiteSpace: 'pre-wrap',
        }}>
          {prompt || <span style={{ color: 'var(--fg-faint)' }}>No instructions provided</span>}
        </div>
      </div>

      <div style={{ marginTop: 20, padding: 16, background: 'var(--bg-sunken)', borderRadius: 'var(--radius)', display: 'flex', gap: 12 }}>
        <span style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 2 }}><Icon name="clock" size={16}/></span>
        <div style={{ fontSize: 13 }}>
          <div style={{ fontWeight: 500, marginBottom: 2 }}>Estimated time: ~12–18 minutes</div>
          <div style={{ color: 'var(--fg-muted)' }}>Transcribe → Cut → Render → Package metadata. You can leave this page; we'll keep working in the background.</div>
        </div>
      </div>
    </div>
  );
};

const SummaryRow = ({ label, value, mono }) => (
  <div>
    <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.06, textTransform: 'uppercase', color: 'var(--fg-faint)', marginBottom: 4 }}>
      {label}
    </div>
    <div style={{ fontSize: 13.5, fontFamily: mono ? 'var(--font-mono)' : 'inherit' }}>
      {value}
    </div>
  </div>
);

Object.assign(window, { NewProject });
