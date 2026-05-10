/* global React */
const { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } = React;

/* ---------- Icons (inline, minimal) ---------- */
const Icon = ({ name, size = 16, ...rest }) => {
  const paths = {
    plus: <><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>,
    check: <polyline points="4 12 10 18 20 6"/>,
    x: <><line x1="6" y1="6" x2="18" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/></>,
    upload: <><path d="M12 16V4"/><polyline points="6 10 12 4 18 10"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></>,
    play: <polygon points="6 4 20 12 6 20 6 4" fill="currentColor"/>,
    pause: <><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></>,
    chevron: <polyline points="9 6 15 12 9 18"/>,
    chevronDown: <polyline points="6 9 12 15 18 9"/>,
    chevronLeft: <polyline points="15 6 9 12 15 18"/>,
    refresh: <><polyline points="20 4 20 10 14 10"/><path d="M20 10A8 8 0 1 0 18 16"/></>,
    download: <><path d="M12 4v12"/><polyline points="6 10 12 16 18 10"/><path d="M4 20h16"/></>,
    trash: <><polyline points="3 6 21 6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></>,
    open: <><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/></>,
    edit: <><path d="M4 20h4l10-10-4-4L4 16v4z"/></>,
    sparkle: <><path d="M12 3l1.5 5L18 9.5 13.5 11 12 16l-1.5-5L6 9.5 10.5 8 12 3z"/></>,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></>,
    folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>,
    video: <><rect x="2" y="6" width="14" height="12" rx="2"/><polygon points="22 8 16 12 22 16 22 8" fill="currentColor"/></>,
    captions: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 12h3"/><path d="M14 12h3"/><path d="M7 15h2"/><path d="M11 15h6"/></>,
    crop: <><path d="M6 2v16a2 2 0 0 0 2 2h14"/><path d="M2 6h16a2 2 0 0 1 2 2v14"/></>,
    bell: <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9z"/><path d="M10 21a2 2 0 0 0 4 0"/></>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 8h.01"/><path d="M11 12h1v4h1"/></>,
    alert: <><path d="M12 2L2 20h20L12 2z"/><path d="M12 9v5"/><path d="M12 17h.01"/></>,
    spinner: <circle cx="12" cy="12" r="9" strokeDasharray="40 60" strokeLinecap="round"/>,
    clock: <><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></>,
    image: <><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/></>,
    tag: <><path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9z"/><circle cx="8" cy="8" r="1.5" fill="currentColor"/></>,
    grid: <><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></>,
    moreH: <><circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/></>,
    search: <><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></>,
    gear: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></>,
    folderThin: <path d="M3 7.5a1.5 1.5 0 0 1 1.5-1.5h4l1.5 1.5h9.5a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5h-15a1.5 1.5 0 0 1-1.5-1.5z"/>,
    warn: <><path d="M12 3L2 20h20L12 3z"/><path d="M12 10v5"/><path d="M12 18h.01"/></>,
    externalLink: <><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...rest}>
      {paths[name]}
    </svg>
  );
};

/* ---------- Spinner ---------- */
const Spinner = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: 'spin 0.9s linear infinite' }}>
    <circle cx="12" cy="12" r="9" strokeDasharray="40 60" strokeLinecap="round"/>
  </svg>
);

/* ---------- Status pills ---------- */
const StatusPill = ({ status }) => {
  const cls = `pill pill-${status.toLowerCase()}`;
  return <span className={cls}><span className="dot"/>{status}</span>;
};

/* ---------- App store (single source of truth) ---------- */
const StoreCtx = createContext(null);
const useStore = () => useContext(StoreCtx);

const SAMPLE_TRANSCRIPT = [
  { t: 0,    text: "Alright, welcome back to module four." },
  { t: 2.4,  text: "Today we're going to dive into something I think a lot of you have been waiting for —" },
  { t: 6.8,  text: "how to actually structure a hook that makes someone stop scrolling." },
  { t: 10.2, text: "And I want to start with a story." },
  { t: 12.5, text: "Last year I posted a clip that got, I think, around eleven views in the first hour." },
  { t: 17.4, text: "Same content, same lighting, same me." },
  { t: 20.1, text: "I changed three words at the start. Three." },
  { t: 22.8, text: "And the next version did 1.4 million views in three days." },
  { t: 26.7, text: "So what changed? That's what we're unpacking today." },
];

const PROMPT_PRESETS = {
  "Tutorial highlights": "Find moments where I teach a concrete technique. Cut into 45–75 second clips, each focused on one teaching point. Start each clip with the setup of the problem, end with the resolution. Skip transitions and small talk.",
  "Q&A moments": "Find audience or chat questions and my answer. Cut around the question + the most concise version of the answer. 30–90 seconds. Title each clip with the question.",
  "Hook-first short clips": "Cut into 20–45 second clips. Each clip must open with a strong hook — a surprising claim, a question, or a contrarian take. Trim aggressively for pace. Prioritize moments with strong vocal energy.",
};

const DEFAULT_LIBRARY_SEED = '/Users/maya/ClipForge/Library';

const initialProjects = () => ([
  {
    id: 'p1',
    name: 'Course Module 4 — Hooks That Convert',
    status: 'Ready',
    clipCount: 14,
    updatedAt: Date.now() - 1000 * 60 * 60 * 3,
    file: { name: 'module-4-hooks-final.mp4', size: '8.4 GB', duration: '3:12:48', durationSec: 11568 },
    prompt: PROMPT_PRESETS["Hook-first short clips"],
    pipeline: { transcribe: 'done', cut: 'done', render: 'done', package: 'done' },
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 2,
    library: DEFAULT_LIBRARY_SEED,
    folderId: 'p_a14b9e02',
  },
  {
    id: 'p2',
    name: 'Live Q&A — March Cohort',
    status: 'Processing',
    clipCount: 6,
    updatedAt: Date.now() - 1000 * 60 * 7,
    file: { name: 'march-qa-session.mp4', size: '12.1 GB', duration: '2:48:02', durationSec: 10082 },
    prompt: PROMPT_PRESETS["Q&A moments"],
    pipeline: { transcribe: 'done', cut: 'running', render: 'queued', package: 'queued' },
    createdAt: Date.now() - 1000 * 60 * 60 * 6,
    library: '/Volumes/External SSD/clipforge',
    folderId: 'p_3f7c1d50',
  },
  {
    id: 'p3',
    name: 'Onboarding Lecture — v2',
    status: 'Draft',
    clipCount: 0,
    updatedAt: Date.now() - 1000 * 60 * 60 * 22,
    file: null,
    prompt: '',
    pipeline: { transcribe: 'queued', cut: 'queued', render: 'queued', package: 'queued' },
    createdAt: Date.now() - 1000 * 60 * 60 * 22,
    library: DEFAULT_LIBRARY_SEED,
    folderId: 'p_88c2ee41',
  },
  {
    id: 'p4',
    name: 'Workshop — Pricing Frameworks',
    status: 'Failed',
    clipCount: 0,
    updatedAt: Date.now() - 1000 * 60 * 60 * 30,
    file: { name: 'workshop-pricing.mp4', size: '6.7 GB', duration: '2:14:09', durationSec: 8049 },
    prompt: PROMPT_PRESETS["Tutorial highlights"],
    pipeline: { transcribe: 'done', cut: 'failed', render: 'queued', package: 'queued' },
    createdAt: Date.now() - 1000 * 60 * 60 * 36,
    library: DEFAULT_LIBRARY_SEED,
    folderId: 'p_5d99a217',
  },
  {
    id: 'p5',
    name: 'Founder Interview — Sasha L.',
    status: 'Ready',
    clipCount: 9,
    updatedAt: Date.now() - 1000 * 60 * 60 * 24 * 4,
    file: { name: 'sasha-interview.mp4', size: '5.2 GB', duration: '1:48:33', durationSec: 6513 },
    prompt: PROMPT_PRESETS["Q&A moments"],
    pipeline: { transcribe: 'done', cut: 'done', render: 'done', package: 'done' },
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 5,
    library: DEFAULT_LIBRARY_SEED,
    folderId: 'p_b620e3f8',
  },
  {
    id: 'p6',
    name: 'Course Module 5 — Story Structure',
    status: 'Ready',
    clipCount: 11,
    updatedAt: Date.now() - 1000 * 60 * 60 * 24 * 7,
    file: { name: 'module-5-story.mp4', size: '9.8 GB', duration: '3:31:14', durationSec: 12674 },
    prompt: PROMPT_PRESETS["Tutorial highlights"],
    pipeline: { transcribe: 'done', cut: 'done', render: 'done', package: 'done' },
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 9,
    library: DEFAULT_LIBRARY_SEED,
    folderId: 'p_c4f1071d',
  },
]);

const CLIP_TITLES = [
  "The 3-word hook that 100x'd my views",
  "Why most course intros lose the room",
  "If you can't say it in 8 seconds, cut it",
  "The contrarian take rule (with example)",
  "How I rewrite an opening 4 times before posting",
  "One question that fixes a flat clip",
  "Why I stopped saying 'today we're going to'",
  "The frame test — does this earn 2 seconds?",
  "Setup, stakes, payoff — in 30 seconds",
  "When to break the rule (and how)",
  "A post that did 1.4M with no edit",
  "The hook I steal from journalists",
  "How to make a teaching moment feel like a story",
  "Why your first sentence is a contract",
];

const generateClips = (projectId, count) => {
  const arr = [];
  let cursor = 240; // start 4 min in
  for (let i = 0; i < count; i++) {
    const dur = 28 + Math.floor(Math.random() * 60);
    const start = cursor;
    cursor += dur + 60 + Math.floor(Math.random() * 600);
    const variants = ['original'];
    const r = Math.random();
    if (r > 0.3) variants.push('captions');
    if (r > 0.55) variants.push('reframe');
    if (r > 0.75) variants.push('both');
    arr.push({
      id: `${projectId}-c${i+1}`,
      projectId,
      title: CLIP_TITLES[i % CLIP_TITLES.length],
      duration: dur,
      startSec: start,
      endSec: start + dur,
      variants,
      description: "A short, hook-first clip pulled automatically from the source recording. Edit this description before posting.",
      hashtags: ['CourseCreator', 'Teaching', 'ContentTips', 'Hooks'],
      hookText: "Three words. That's all it took.",
      thumbFrame: Math.floor(Math.random() * 100),
    });
  }
  return arr;
};

const fmtTime = (s) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  return `${m}:${String(sec).padStart(2,'0')}`;
};

const fmtRelative = (ts) => {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
};

/* ---------- Workspace path helpers ---------- */
const DEFAULT_LIBRARY = '/Users/maya/ClipForge/Library';

// Sample folders the fake "OS folder picker" cycles through, so the user can see
// the UI handle a few different shapes (short, long, external drive).
const FAKE_PICK_FOLDERS = [
  '/Volumes/External SSD/clipforge',
  '/Users/maya/Movies/ClipForge',
  '/Volumes/Drobo/Studio/Recordings/Course Material/2026 Q2/clipforge-library',
  '/Users/maya/Desktop/Workspace/cf',
];

const truncatePath = (path, max = 40) => {
  if (!path || path.length <= max) return path;
  const head = path.slice(0, Math.ceil(max / 2) - 2);
  const tail = path.slice(-(Math.floor(max / 2) - 2));
  return `${head}…${tail}`;
};

const projectFolderId = (id) => `p_${id.replace(/^p/, '').padEnd(8, '0').slice(0, 8)}`;

Object.assign(window, { DEFAULT_LIBRARY, FAKE_PICK_FOLDERS, truncatePath, projectFolderId });

const StoreProvider = ({ children }) => {
  const [projects, setProjects] = useState(initialProjects);
  const [settings, setSettings] = useState({
    defaultLibrary: DEFAULT_LIBRARY,
    libraryReachable: true,
  });
  const pickCursorRef = useRef(0);

  const pickFolder = useCallback(() => {
    // Simulate native folder picker. ~70% of the time returns a fresh path,
    // small chance returns null (user canceled).
    if (Math.random() < 0.12) return null;
    const idx = pickCursorRef.current % FAKE_PICK_FOLDERS.length;
    pickCursorRef.current += 1;
    return FAKE_PICK_FOLDERS[idx];
  }, []);

  const setDefaultLibrary = useCallback((path) => {
    setSettings(s => ({ ...s, defaultLibrary: path, libraryReachable: true }));
  }, []);
  const setLibraryReachable = useCallback((reachable) => {
    setSettings(s => ({ ...s, libraryReachable: reachable }));
  }, []);
  const [clipsByProject, setClipsByProject] = useState(() => ({
    p1: generateClips('p1', 14),
    p2: generateClips('p2', 6),
    p5: generateClips('p5', 9),
    p6: generateClips('p6', 11),
  }));
  const [jobs, setJobs] = useState([
    { id: 'j1', projectId: 'p2', label: 'Cutting clips', stage: 'cut', progress: 62, status: 'running' },
  ]);
  const [toasts, setToasts] = useState([]);

  const pushToast = useCallback((toast) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(t => [...t, { ...toast, id }]);
    setTimeout(() => {
      setToasts(t => t.filter(x => x.id !== id));
    }, toast.duration || 4200);
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts(t => t.filter(x => x.id !== id));
  }, []);

  const updateProject = useCallback((id, patch) => {
    setProjects(ps => ps.map(p => p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p));
  }, []);

  const deleteProject = useCallback((id) => {
    setProjects(ps => ps.filter(p => p.id !== id));
    setClipsByProject(c => {
      const copy = { ...c };
      delete copy[id];
      return copy;
    });
    pushToast({ kind: 'success', title: 'Project deleted' });
  }, [pushToast]);

  const createProject = useCallback((draft) => {
    const id = 'p' + Math.random().toString(36).slice(2, 7);
    const folderId = 'p_' + Math.random().toString(36).slice(2, 10);
    const proj = {
      id,
      name: draft.name,
      status: 'Processing',
      clipCount: 0,
      updatedAt: Date.now(),
      createdAt: Date.now(),
      file: draft.file,
      prompt: draft.prompt,
      pipeline: { transcribe: 'running', cut: 'queued', render: 'queued', package: 'queued' },
      library: draft.library || DEFAULT_LIBRARY,
      folderId,
    };
    setProjects(ps => [proj, ...ps]);
    setJobs(js => [...js, { id: 'j' + id, projectId: id, label: 'Transcribing', stage: 'transcribe', progress: 5, status: 'running' }]);
    return id;
  }, []);

  // Tick: advance running jobs, pipeline, etc.
  useEffect(() => {
    const t = setInterval(() => {
      setJobs(prev => {
        if (prev.length === 0) return prev;
        return prev.map(j => {
          if (j.status !== 'running') return j;
          const next = Math.min(100, j.progress + 1.5 + Math.random() * 2);
          return { ...j, progress: next };
        }).filter(j => {
          if (j.progress >= 100) {
            // advance project pipeline
            setProjects(ps => ps.map(p => {
              if (p.id !== j.projectId) return p;
              const order = ['transcribe', 'cut', 'render', 'package'];
              const np = { ...p.pipeline, [j.stage]: 'done' };
              const nextIdx = order.indexOf(j.stage) + 1;
              const nextStage = order[nextIdx];
              if (nextStage) np[nextStage] = 'running';
              const allDone = order.every(s => np[s] === 'done');
              return { ...p, pipeline: np, status: allDone ? 'Ready' : 'Processing', clipCount: allDone ? (p.clipCount || 8) : p.clipCount, updatedAt: Date.now() };
            }));
            // generate clips when packaging done
            setClipsByProject(cbp => {
              if (j.stage === 'package' && !cbp[j.projectId]) {
                return { ...cbp, [j.projectId]: generateClips(j.projectId, 8) };
              }
              return cbp;
            });
            return false;
          }
          return true;
        });
      });
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const value = useMemo(() => ({
    projects, setProjects, updateProject, deleteProject, createProject,
    clipsByProject, setClipsByProject,
    jobs, setJobs,
    toasts, pushToast, dismissToast,
    settings, setDefaultLibrary, setLibraryReachable, pickFolder,
  }), [projects, clipsByProject, jobs, toasts, settings, updateProject, deleteProject, createProject, pushToast, dismissToast, setDefaultLibrary, setLibraryReachable, pickFolder]);

  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
};

/* ---------- Router (hash) ---------- */
const RouterCtx = createContext(null);
const useRouter = () => useContext(RouterCtx);

const parseHash = () => {
  const h = window.location.hash.replace(/^#/, '') || '/';
  return h;
};

const RouterProvider = ({ children }) => {
  const [path, setPath] = useState(parseHash());
  useEffect(() => {
    const onHash = () => setPath(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const navigate = useCallback((p) => {
    window.location.hash = p;
  }, []);
  return <RouterCtx.Provider value={{ path, navigate }}>{children}</RouterCtx.Provider>;
};

const Link = ({ to, children, ...rest }) => {
  const { navigate } = useRouter();
  return (
    <a href={`#${to}`} onClick={(e) => { e.preventDefault(); navigate(to); }} {...rest}>
      {children}
    </a>
  );
};

/* ---------- Auto-cut generation (project-wide, source-time) ----------
 * One source video → many cuts spread across its full duration. Some land in
 * regions that became clips (clipId set), some don't (clipId null — surfaced
 * but not navigable on the report).
 *
 * Pause cuts carry "before/after" excerpts framing the silence.
 * Filler cuts carry one surrounding excerpt with the offending token marked.
 */
const PAUSE_CONTEXTS = [
  ["…and that's the part most people skim past.", "Now if you look at how the framework actually fits together…"],
  ["…I think the real question is, why now?", "Honestly, the answer surprised me when I worked it out…"],
  ["…you can see it works on a small set.", "But what about the long tail — does the same logic hold?"],
  ["…the first three seconds are a contract with the viewer.", "Break the contract and they're gone, no second chance…"],
  ["…that's basically the whole insight in one sentence.", "Let me show you what that looks like in practice…"],
  ["…we ran this experiment three times to be sure.", "Each time the same pattern showed up, which is what convinced me…"],
  ["…most creators copy the format and miss the principle.", "The principle is the part that actually transfers between platforms…"],
  ["…there's a version of this that doesn't work, by the way.", "I want to walk you through that one too, so you can avoid it…"],
  ["…I used to think length was the lever, but it isn't.", "The lever is whether the first frame earns the second one…"],
  ["…honestly, this is the slide I almost cut from the deck.", "But it ended up being the one people quoted back to me the most…"],
  ["…here's where it gets a little counterintuitive.", "Stay with me, because the payoff lands in a minute…"],
  ["…we'll come back to that point at the end.", "For now, just hold it loosely while we look at the next piece…"],
  ["…the data on this is honestly all over the place.", "But the direction is consistent enough that I'd bet on it…"],
  ["…I don't want to pretend I figured this out fast.", "It took maybe a year of bad takes before the pattern got obvious…"],
  ["…and that's a really common failure mode.", "If you've ever felt this, you're not doing anything wrong, the format is…"],
];

const FILLER_CONTEXTS = [
  { pre: "I think we should",                     word: "um",   post: "start with the basics, because everything builds on that." },
  { pre: "And so when you look at the data, you",  word: "uh",   post: "see this really clear pattern in the first thirty seconds." },
  { pre: "The thing that surprised me was,",       word: "like", post: "how consistent the response was across totally different audiences." },
  { pre: "If we run it again next quarter,",       word: "um",   post: "I'd want to lock down the script before we touch the framing." },
  { pre: "What I keep coming back to is",          word: "uh",   post: "the question of who you're actually making this for in the first place." },
  { pre: "You can almost always tell within,",     word: "um",   post: "two or three seconds whether someone's going to keep watching or bounce." },
  { pre: "I had a clip last year that was,",       word: "you know", post: "objectively pretty rough, and it still outperformed everything else that month." },
  { pre: "Most of the time the fix isn't,",        word: "uh",   post: "more production polish — it's a rewrite of the opening line." },
  { pre: "When you read it back out loud,",        word: "um",   post: "you can hear which sentences are real and which ones are filler." },
  { pre: "The reason that matters is",             word: "like", post: "every word before the hook is borrowed time you have to pay back." },
  { pre: "I want to be honest with you,",          word: "um",   post: "I don't have a clean answer for that one yet — still figuring it out." },
  { pre: "And then the next question becomes,",    word: "uh",   post: "okay, but what does that look like on a Tuesday at nine in the morning?" },
];

/* Cheap deterministic PRNG — same project always produces the same cut report. */
const seededRand = (seed) => {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
};

const generateProjectCuts = (project, clips = []) => {
  if (!project?.file?.durationSec) return [];
  const dur = project.file.durationSec;
  const seedNum = project.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const rand = seededRand(seedNum);

  // ~one cut every 60-90s of source for a natural cadence; clamp to 18-90.
  const target = Math.max(18, Math.min(90, Math.round(dur / 75)));
  const cuts = [];
  let cursor = 30 + rand() * 90;
  for (let i = 0; i < target && cursor < dur - 20; i++) {
    const reason = rand() < 0.66 ? 'pause' : 'filler';
    let removedSec, pre, post, word = null;
    if (reason === 'pause') {
      removedSec = Math.round((1.6 + rand() * 3.6) * 10) / 10;
      const ctx = PAUSE_CONTEXTS[Math.floor(rand() * PAUSE_CONTEXTS.length)];
      pre = ctx[0]; post = ctx[1];
    } else {
      removedSec = Math.round((0.2 + rand() * 0.4) * 10) / 10;
      const ctx = FILLER_CONTEXTS[Math.floor(rand() * FILLER_CONTEXTS.length)];
      pre = ctx.pre; post = ctx.post; word = ctx.word;
    }
    // Find which clip (if any) contains this source moment
    const containing = clips.find(c => cursor >= c.startSec && cursor <= c.endSec);
    cuts.push({
      id: `${project.id}-cut${i + 1}`,
      sourceSec: Math.round(cursor * 10) / 10,
      reason,
      removedSec,
      pre, post, word,
      clipId: containing?.id || null,
    });
    // Advance cursor — denser around clip regions, sparser elsewhere
    const gap = 25 + rand() * 110;
    cursor += gap;
  }
  return cuts;
};

Object.assign(window, {
  Icon, Spinner, StatusPill, StoreProvider, useStore, RouterProvider, useRouter, Link,
  fmtTime, fmtRelative, PROMPT_PRESETS, generateClips, generateProjectCuts, SAMPLE_TRANSCRIPT,
});
