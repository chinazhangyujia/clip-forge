/* global React, Icon, Spinner, useStore, useRouter, Link, fmtTime */
const { useState, useEffect, useRef } = React;

const TopNav = ({ crumbs }) => {
  const { jobs } = useStore();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const running = jobs.filter(j => j.status === 'running');

  useEffect(() => {
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
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
      <div ref={ref} style={{ position: 'relative' }}>
        <button className="jobs-trigger" onClick={() => setOpen(o => !o)}>
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
