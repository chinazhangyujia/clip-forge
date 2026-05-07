/* global React, Icon, Spinner, useStore, useRouter, Link, fmtTime, truncatePath */
const { useState, useEffect, useRef } = React;

const PathDisplay = ({ path, reachable, maxLen = 38, style }) => {
  const display = truncatePath(path, maxLen);
  return (
    <span
      title={path}
      className="mono"
      style={{
        fontSize: 12,
        color: reachable === false ? 'var(--fg-faint)' : 'var(--fg)',
        textDecoration: reachable === false ? 'line-through' : 'none',
        wordBreak: 'break-all',
        ...style,
      }}
    >
      {display}
    </span>
  );
};

const SettingsPopover = ({ onClose }) => {
  const { settings, setDefaultLibrary, setLibraryReachable, pickFolder, pushToast } = useStore();

  const onChange = () => {
    const picked = pickFolder();
    if (!picked) return; // user canceled
    // Simulate ~12% chance the picked folder is unwritable.
    if (Math.random() < 0.12) {
      pushToast({
        kind: 'error',
        title: 'Can\u2019t write to that folder',
        body: `${picked} is read-only or missing permission. Pick a different folder.`,
      });
      return;
    }
    setDefaultLibrary(picked);
    pushToast({ kind: 'success', title: 'Default workspace updated.' });
  };

  return (
    <div className="popover" style={{ width: 360 }}>
      <div className="popover-head">
        <span>Settings</span>
        <button
          className="btn-ghost"
          onClick={() => setLibraryReachable(!settings.libraryReachable)}
          title="Toggle reachable (demo)"
          style={{
            fontSize: 10, color: 'var(--fg-faint)', padding: '2px 6px',
            borderRadius: 4, letterSpacing: 0.04, textTransform: 'none',
          }}
        >
          {settings.libraryReachable ? 'reachable' : 'unreachable'}
        </button>
      </div>
      <div style={{ padding: 16 }}>
        <div style={{
          fontSize: 11, fontWeight: 600, letterSpacing: 0.06,
          textTransform: 'uppercase', color: 'var(--fg-faint)', marginBottom: 4,
        }}>
          Default workspace
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--fg-muted)', marginBottom: 12 }}>
          Where new projects are saved.
        </div>

        <div
          style={{
            display: 'flex', alignItems: 'flex-start', gap: 8,
            padding: '10px 12px',
            background: 'var(--bg-sunken)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            marginBottom: 12,
          }}
        >
          <span style={{ color: 'var(--fg-muted)', flexShrink: 0, marginTop: 1 }}>
            <Icon name="folderThin" size={14}/>
          </span>
          <span
            className="mono"
            title={settings.defaultLibrary}
            style={{
              fontSize: 12, lineHeight: 1.45,
              color: settings.libraryReachable ? 'var(--fg)' : 'var(--fg-faint)',
              textDecoration: settings.libraryReachable ? 'none' : 'line-through',
              wordBreak: 'break-all',
              flex: 1, minWidth: 0,
            }}
          >
            {settings.defaultLibrary}
          </span>
          {!settings.libraryReachable && (
            <span title="This folder isn't reachable" style={{ color: 'var(--amber)', flexShrink: 0, marginTop: 1 }}>
              <Icon name="warn" size={14}/>
            </span>
          )}
        </div>

        <button className="btn" onClick={onChange} style={{ width: '100%', justifyContent: 'center' }}>
          <Icon name="folderThin" size={14}/>
          Change folder…
        </button>

        <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--fg-faint)', lineHeight: 1.5 }}>
          Existing projects stay in their current location. Only new projects use the new default.
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { PathDisplay, SettingsPopover });

const TopNav = ({ crumbs }) => {
  const { jobs, settings } = useStore();
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const ref = useRef(null);
  const settingsRef = useRef(null);
  const running = jobs.filter(j => j.status === 'running');

  useEffect(() => {
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
      if (settingsRef.current && !settingsRef.current.contains(e.target)) setSettingsOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setSettingsOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <header className="topnav">
      <Link to="/" className="logo">
        <span className="logo-mark"></span>
        ClipForge
      </Link>
      {crumbs && crumbs.length > 0 && (
        <nav className="crumbs">
          <span className="sep">/</span>
          {crumbs.map((c, i) => (
            <React.Fragment key={i}>
              {c.to ? <Link to={c.to}>{c.label}</Link> : <span style={{ color: 'var(--fg)' }}>{c.label}</span>}
              {i < crumbs.length - 1 && <span className="sep">/</span>}
            </React.Fragment>
          ))}
        </nav>
      )}
      <div className="spacer"/>
      <div ref={settingsRef} style={{ position: 'relative' }}>
        <button
          className="btn-ghost"
          onClick={() => { setSettingsOpen(o => !o); setOpen(false); }}
          title="Settings"
          aria-label="Settings"
          style={{
            width: 32, height: 32,
            borderRadius: 999,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            color: settingsOpen ? 'var(--fg)' : 'var(--fg-muted)',
            background: settingsOpen ? 'var(--bg-sunken)' : 'transparent',
            border: '1px solid transparent',
            position: 'relative',
          }}
        >
          <Icon name="gear" size={16}/>
          {!settings?.libraryReachable && (
            <span
              title="Default workspace isn't reachable"
              style={{
                position: 'absolute', top: 4, right: 4,
                width: 7, height: 7, borderRadius: 999,
                background: 'var(--amber)',
                border: '1.5px solid var(--bg-elev)',
              }}
            />
          )}
        </button>
        {settingsOpen && <SettingsPopover onClose={() => setSettingsOpen(false)}/>}
      </div>
      <div ref={ref} style={{ position: 'relative' }}>
        <button className="jobs-trigger" onClick={() => { setOpen(o => !o); setSettingsOpen(false); }}>
          {running.length > 0 ? <span className="pulse"/> : <span style={{width:7, height:7, borderRadius:999, background:'var(--border-strong)'}}/>}
          <span>Jobs</span>
          <span className="jobs-count">{running.length}</span>
        </button>
        {open && <JobsPopover onClose={() => setOpen(false)}/>}
      </div>
    </header>
  );
};

const JobsPopover = () => {
  const { jobs, projects } = useStore();
  return (
    <div className="popover">
      <div className="popover-head">
        <span>Running Jobs</span>
        <span className="mono" style={{ color: 'var(--fg-faint)' }}>{jobs.length}</span>
      </div>
      <div style={{ maxHeight: 360, overflowY: 'auto' }}>
        {jobs.length === 0 ? (
          <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--fg-faint)', fontSize: 13 }}>
            <Icon name="check" size={18}/>
            <div style={{ marginTop: 6 }}>No jobs running</div>
          </div>
        ) : jobs.map(j => {
          const proj = projects.find(p => p.id === j.projectId);
          return (
            <Link to={`/projects/${j.projectId}`} key={j.id}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 500, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {proj?.name || 'Project'}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 2 }}>
                      {j.label}…
                    </div>
                  </div>
                  <span className="mono" style={{ color: 'var(--fg-muted)', fontSize: 12 }}>
                    {Math.floor(j.progress)}%
                  </span>
                </div>
                <div style={{ height: 4, background: 'var(--bg-sunken)', borderRadius: 999, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${j.progress}%`, background: 'var(--accent)', borderRadius: 999, transition: 'width .4s' }}/>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
};

const ToastHost = () => {
  const { toasts, dismissToast, pushToast } = useStore();
  return (
    <div className="toasts">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.kind || 'info'}`}>
          <span className="toast-icon">
            {t.kind === 'success' ? <Icon name="check" size={18}/> :
             t.kind === 'error' ? <Icon name="alert" size={18}/> :
             <Icon name="info" size={18}/>}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="toast-title">{t.title}</div>
            {t.body && <div className="toast-body" style={{ wordBreak: 'break-word' }}>{t.body}</div>}
            {t.action && (
              <button
                onClick={() => {
                  if (t.action.onClick) t.action.onClick();
                  if (t.action.retry) {
                    pushToast({ kind: 'info', title: 'Retrying download…', duration: 2500 });
                  }
                  dismissToast(t.id);
                }}
                style={{
                  marginTop: 6,
                  fontSize: 12,
                  fontWeight: 500,
                  color: t.kind === 'error' ? 'var(--red)' : t.kind === 'success' ? 'oklch(0.42 0.13 155)' : 'var(--accent)',
                  padding: '3px 8px',
                  marginLeft: -8,
                  borderRadius: 4,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                {t.action.label}
                <Icon name="chevron" size={11}/>
              </button>
            )}
          </div>
          <button className="btn-ghost btn-sm btn-icon" onClick={() => dismissToast(t.id)} style={{ height: 22, width: 22, color: 'var(--fg-faint)' }}>
            <Icon name="x" size={14}/>
          </button>
        </div>
      ))}
    </div>
  );
};

Object.assign(window, { TopNav, JobsPopover, ToastHost });
