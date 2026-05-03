/* global React, ReactDOM, StoreProvider, RouterProvider, useRouter, useStore, TopNav, ToastHost, ProjectsHome, NewProject, ProjectDetail, ClipDetail, useTweaks, TweaksPanel, TweakSection, TweakColor, TweakRadio, TweakSelect, TweakToggle */
const { useEffect } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "#ed7a42",
  "density": "balanced",
  "pipelineState": "auto",
  "showEmpty": false
}/*EDITMODE-END*/;

const Routes = () => {
  const { path } = useRouter();

  // /projects/:id/clips/:clipId
  const clipMatch = path.match(/^\/projects\/([^/]+)\/clips\/([^/]+)$/);
  if (clipMatch) {
    return <>
      <TopNav crumbs={[{ label: 'Projects', to: '/' }, { label: 'Clip' }]}/>
      <ClipDetail projectId={clipMatch[1]} clipId={clipMatch[2]}/>
    </>;
  }

  const detailMatch = path.match(/^\/projects\/([^/]+)$/);
  if (detailMatch && detailMatch[1] !== 'new') {
    return <>
      <TopNav/>
      <ProjectDetail projectId={detailMatch[1]}/>
    </>;
  }

  if (path === '/projects/new') {
    return <>
      <TopNav crumbs={[{ label: 'New project' }]}/>
      <NewProject/>
    </>;
  }

  return <>
    <TopNav/>
    <ProjectsHome/>
  </>;
};

const TweaksApp = () => {
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const { projects, setProjects, updateProject } = useStore();

  // Apply accent
  useEffect(() => {
    const hex = tweaks.accent;
    document.documentElement.style.setProperty('--accent', hex);
    // derive hover and soft from hex via filter approach — quick lighten/darken
    document.documentElement.style.setProperty('--accent-hover', shade(hex, -10));
    document.documentElement.style.setProperty('--accent-soft', tint(hex, 88));
  }, [tweaks.accent]);

  // Apply density
  useEffect(() => {
    document.documentElement.dataset.density = tweaks.density;
  }, [tweaks.density]);

  // Apply pipelineState override
  useEffect(() => {
    if (tweaks.pipelineState === 'auto') return;
    setProjects(ps => ps.map(p => {
      if (p.status === 'Ready') return p; // don't override completed
      let pipeline = { ...p.pipeline };
      let status = p.status;
      if (tweaks.pipelineState === 'running') {
        pipeline = { transcribe: 'done', cut: 'running', render: 'queued', package: 'queued' };
        status = 'Processing';
      } else if (tweaks.pipelineState === 'failed') {
        pipeline = { transcribe: 'done', cut: 'failed', render: 'queued', package: 'queued' };
        status = 'Failed';
      } else if (tweaks.pipelineState === 'done') {
        pipeline = { transcribe: 'done', cut: 'done', render: 'done', package: 'done' };
        status = 'Ready';
      }
      return { ...p, pipeline, status };
    }));
  }, [tweaks.pipelineState]);

  // Apply empty state
  useEffect(() => {
    if (tweaks.showEmpty) {
      window.__savedProjects = window.__savedProjects || projects;
      setProjects([]);
    } else if (window.__savedProjects && projects.length === 0) {
      setProjects(window.__savedProjects);
      window.__savedProjects = null;
    }
  }, [tweaks.showEmpty]);

  return (
    <TweaksPanel title="Tweaks">
      <TweakSection title="Brand">
        <TweakColor label="Accent color" value={tweaks.accent} onChange={(v) => setTweak('accent', v)}
          swatches={['#ed7a42', '#3478f6', '#22a974', '#9c5af0', '#e63946', '#1a1a1a']}/>
      </TweakSection>
      <TweakSection title="Layout">
        <TweakRadio label="Density" value={tweaks.density} onChange={(v) => setTweak('density', v)}
          options={[{value: 'compact', label: 'Compact'}, {value: 'balanced', label: 'Balanced'}, {value: 'comfy', label: 'Comfy'}]}/>
      </TweakSection>
      <TweakSection title="State">
        <TweakSelect label="Pipeline state" value={tweaks.pipelineState} onChange={(v) => setTweak('pipelineState', v)}
          options={[
            { value: 'auto', label: 'Auto (mix of states)' },
            { value: 'running', label: 'Force running' },
            { value: 'done', label: 'Force done' },
            { value: 'failed', label: 'Force failed' },
          ]}/>
        <TweakToggle label="Empty projects state" value={tweaks.showEmpty} onChange={(v) => setTweak('showEmpty', v)}/>
      </TweakSection>
    </TweaksPanel>
  );
};

// Color helpers
const hexToRgb = (h) => {
  const m = h.replace('#', '').match(/.{2}/g);
  if (!m) return [0, 0, 0];
  return m.map(x => parseInt(x, 16));
};
const rgbToHex = (r, g, b) => '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const shade = (hex, amt) => {
  const [r, g, b] = hexToRgb(hex);
  const f = 1 + amt / 100;
  return rgbToHex(r * f, g * f, b * f);
};
const tint = (hex, pct) => {
  const [r, g, b] = hexToRgb(hex);
  const f = pct / 100;
  return rgbToHex(r + (255 - r) * f, g + (255 - g) * f, b + (255 - b) * f);
};

const App = () => (
  <StoreProvider>
    <RouterProvider>
      <div className="app">
        <Routes/>
        <ToastHost/>
        <TweaksApp/>
      </div>
    </RouterProvider>
  </StoreProvider>
);

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App/>);
