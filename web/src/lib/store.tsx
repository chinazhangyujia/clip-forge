"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api } from "./api";
import type { Clip, Job, Project, ProjectDraft, Settings, Toast } from "./types";

type StoreValue = {
  projects: Project[];
  clipsByProject: Record<string, Clip[]>;
  jobs: Job[];
  toasts: Toast[];
  settings: Settings;

  loadProjects: () => Promise<void>;
  refreshProject: (id: string) => Promise<Project | null>;
  loadClips: (projectId: string) => Promise<void>;

  createProject: (
    draft: ProjectDraft,
    onProgress?: (loaded: number, total: number) => void,
  ) => Promise<Project>;
  updateProject: (
    id: string,
    patch: { name?: string; prompt?: string },
  ) => Promise<void>;
  rerunProject: (id: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;

  updateClipBounds: (
    clipId: string,
    bounds: { startSec: number; endSec: number },
  ) => Promise<Clip | null>;
  updateClipLocally: (clipId: string, patch: Partial<Clip>) => void;

  pushToast: (toast: Omit<Toast, "id">) => void;
  dismissToast: (id: string) => void;

  // Ad-hoc jobs (e.g. clip downloads) that aren't synthesized from a project's
  // pipeline state. Mirrored into `jobs` alongside the pipeline-derived ones.
  addJob: (job: Job) => void;
  updateJob: (id: string, patch: Partial<Job>) => void;
  removeJob: (id: string) => void;

  // Settings — opens a native folder picker via the Tauri shell. Resolves to
  // the chosen path, or null if the user cancelled. In `npm run dev` (no
  // Tauri), returns null and shows a toast (folder picking only works inside
  // the desktop app).
  pickFolder: () => Promise<string | null>;
};

const StoreCtx = createContext<StoreValue | null>(null);

export const useStore = (): StoreValue => {
  const v = useContext(StoreCtx);
  if (!v) throw new Error("useStore must be used inside <StoreProvider>");
  return v;
};

const projectsToJobs = (projects: Project[]): Job[] => {
  // Synthesize a "running" job entry for each Processing project so the
  // jobs popover in TopNav has something useful to display.
  return projects
    .filter((p) => p.status === "Processing")
    .map<Job>((p) => {
      const order: (keyof Project["pipeline"])[] = [
        "transcribe",
        "cut",
        "render",
        "package",
      ];
      const stage = order.find((s) => p.pipeline[s] === "running") ?? "transcribe";
      const labels: Record<keyof Project["pipeline"], string> = {
        transcribe: "Transcribing",
        cut: "Cutting clips",
        render: "Rendering",
        package: "Packaging",
      };
      const doneCount = order.filter((s) => p.pipeline[s] === "done").length;
      const progress = Math.min(95, doneCount * 25 + 12);
      return {
        id: `j-${p.id}`,
        projectId: p.id,
        label: labels[stage],
        stage,
        progress,
        status: "running",
      };
    });
};

// Detect Tauri once. The IPC bridge is only available inside the desktop
// shell; outside we keep the picker as a no-op + toast.
const inTauri = (): boolean =>
  typeof window !== "undefined" &&
  Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);

const FALLBACK_LIBRARY = "~/Library/Application Support/com.clipforge.app/projects";

export const StoreProvider = ({ children }: { children: ReactNode }) => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [clipsByProject, setClipsByProject] = useState<Record<string, Clip[]>>({});
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [extraJobs, setExtraJobs] = useState<Job[]>([]);
  const [settings, setSettings] = useState<Settings>({
    defaultLibrary: FALLBACK_LIBRARY,
    libraryReachable: true,
  });

  const addJob = useCallback<StoreValue["addJob"]>((job) => {
    setExtraJobs((cur) => [...cur, job]);
  }, []);
  const updateJob = useCallback<StoreValue["updateJob"]>((id, patch) => {
    setExtraJobs((cur) => cur.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  }, []);
  const removeJob = useCallback<StoreValue["removeJob"]>((id) => {
    setExtraJobs((cur) => cur.filter((j) => j.id !== id));
  }, []);

  const pushToast = useCallback<StoreValue["pushToast"]>((toast) => {
    const id = Math.random().toString(36).slice(2);
    const t: Toast = { ...toast, id };
    setToasts((cur) => [...cur, t]);
    setTimeout(() => {
      setToasts((cur) => cur.filter((x) => x.id !== id));
    }, toast.duration ?? 4200);
  }, []);

  const dismissToast = useCallback<StoreValue["dismissToast"]>((id) => {
    setToasts((cur) => cur.filter((x) => x.id !== id));
  }, []);

  const replaceProject = useCallback((p: Project) => {
    setProjects((cur) => {
      const idx = cur.findIndex((x) => x.id === p.id);
      if (idx === -1) return [p, ...cur];
      const next = cur.slice();
      next[idx] = p;
      return next;
    });
  }, []);

  const loadProjects = useCallback(async () => {
    try {
      const ps = await api.listProjects();
      setProjects(ps);
    } catch (e) {
      pushToast({
        kind: "error",
        title: "Could not load projects",
        body: String(e instanceof Error ? e.message : e),
      });
    }
  }, [pushToast]);

  const refreshProject = useCallback<StoreValue["refreshProject"]>(
    async (id) => {
      try {
        const p = await api.getProject(id);
        replaceProject(p);
        return p;
      } catch {
        return null;
      }
    },
    [replaceProject],
  );

  const loadClips = useCallback<StoreValue["loadClips"]>(async (projectId) => {
    try {
      const cs = await api.listClips(projectId);
      setClipsByProject((cur) => ({ ...cur, [projectId]: cs }));
    } catch (e) {
      console.error("Failed to load clips", e);
    }
  }, []);

  const createProject = useCallback<StoreValue["createProject"]>(
    async (draft, onProgress) => {
      const p = await api.createProject(
        {
          name: draft.name,
          prompt: draft.prompt,
          file: draft.file,
          library: draft.library,
        },
        onProgress,
      );
      setProjects((cur) => [p, ...cur.filter((x) => x.id !== p.id)]);
      return p;
    },
    [],
  );

  const updateProject = useCallback<StoreValue["updateProject"]>(
    async (id, patch) => {
      try {
        const p = await api.updateProject(id, patch);
        replaceProject(p);
      } catch (e) {
        pushToast({
          kind: "error",
          title: "Update failed",
          body: String(e instanceof Error ? e.message : e),
        });
      }
    },
    [replaceProject, pushToast],
  );

  const rerunProject = useCallback<StoreValue["rerunProject"]>(
    async (id) => {
      try {
        const p = await api.rerunProject(id);
        replaceProject(p);
        setClipsByProject((cur) => {
          const copy = { ...cur };
          delete copy[id];
          return copy;
        });
        pushToast({
          kind: "info",
          title: "Pipeline re-running",
          body: "Transcribing source again",
        });
      } catch (e) {
        pushToast({
          kind: "error",
          title: "Rerun failed",
          body: String(e instanceof Error ? e.message : e),
        });
      }
    },
    [replaceProject, pushToast],
  );

  const deleteProject = useCallback<StoreValue["deleteProject"]>(
    async (id) => {
      try {
        await api.deleteProject(id);
        setProjects((cur) => cur.filter((p) => p.id !== id));
        setClipsByProject((cur) => {
          const copy = { ...cur };
          delete copy[id];
          return copy;
        });
        pushToast({ kind: "success", title: "Project deleted" });
      } catch (e) {
        pushToast({
          kind: "error",
          title: "Delete failed",
          body: String(e instanceof Error ? e.message : e),
        });
      }
    },
    [pushToast],
  );

  const updateClipLocally = useCallback<StoreValue["updateClipLocally"]>(
    (clipId, patch) => {
      setClipsByProject((cbp) => {
        const next: Record<string, Clip[]> = {};
        for (const [pid, clips] of Object.entries(cbp)) {
          next[pid] = clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c));
        }
        return next;
      });
    },
    [],
  );

  const updateClipBounds = useCallback<StoreValue["updateClipBounds"]>(
    async (clipId, bounds) => {
      try {
        const updated = await api.updateClipBounds(clipId, bounds);
        setClipsByProject((cbp) => {
          const next: Record<string, Clip[]> = {};
          for (const [pid, clips] of Object.entries(cbp)) {
            next[pid] = clips.map((c) => (c.id === clipId ? updated : c));
          }
          return next;
        });
        return updated;
      } catch (e) {
        pushToast({
          kind: "error",
          title: "Save failed",
          body: String(e instanceof Error ? e.message : e),
        });
        return null;
      }
    },
    [pushToast],
  );

  // Initial load — fire-and-forget; caller's setState is intentional.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadProjects();
  }, [loadProjects]);

  // On mount inside Tauri, read the current default library from the shell
  // so the Settings popover and Saving-to row reflect reality.
  useEffect(() => {
    if (!inTauri()) return;
    let mounted = true;
    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const dir = await invoke<string>("get_project_dir");
        if (mounted) {
          setSettings((s) => ({ ...s, defaultLibrary: dir }));
        }
      } catch (e) {
        console.error("get_project_dir failed", e);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const pickFolder = useCallback<StoreValue["pickFolder"]>(async () => {
    if (!inTauri()) {
      pushToast({
        kind: "info",
        title: "Folder picker only works in the desktop app",
        body: "Run the bundled ClipForge.app to change the workspace.",
      });
      return null;
    }
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const picked = await invoke<string | null>("pick_project_dir");
      if (picked) {
        setSettings((s) => ({ ...s, defaultLibrary: picked }));
      }
      return picked;
    } catch (e) {
      pushToast({
        kind: "error",
        title: "Couldn't open folder picker",
        body: String(e instanceof Error ? e.message : e),
      });
      return null;
    }
  }, [pushToast]);

  const jobs = useMemo(
    () => [...projectsToJobs(projects), ...extraJobs],
    [projects, extraJobs],
  );

  const value = useMemo<StoreValue>(
    () => ({
      projects,
      clipsByProject,
      jobs,
      toasts,
      settings,
      loadProjects,
      refreshProject,
      loadClips,
      createProject,
      updateProject,
      rerunProject,
      deleteProject,
      updateClipBounds,
      updateClipLocally,
      pushToast,
      dismissToast,
      addJob,
      updateJob,
      removeJob,
      pickFolder,
    }),
    [
      projects,
      clipsByProject,
      jobs,
      toasts,
      settings,
      loadProjects,
      refreshProject,
      loadClips,
      createProject,
      updateProject,
      rerunProject,
      deleteProject,
      updateClipBounds,
      updateClipLocally,
      pushToast,
      dismissToast,
      addJob,
      updateJob,
      removeJob,
      pickFolder,
    ],
  );

  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
};
