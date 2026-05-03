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
import type {
  Clip,
  Job,
  Pipeline,
  Project,
  ProjectDraft,
  Toast,
} from "./types";
import { generateClips, initialProjects } from "./utils";

type StoreValue = {
  projects: Project[];
  setProjects: React.Dispatch<React.SetStateAction<Project[]>>;
  updateProject: (id: string, patch: Partial<Project>) => void;
  deleteProject: (id: string) => void;
  createProject: (draft: ProjectDraft) => string;

  clipsByProject: Record<string, Clip[]>;
  setClipsByProject: React.Dispatch<
    React.SetStateAction<Record<string, Clip[]>>
  >;

  jobs: Job[];
  setJobs: React.Dispatch<React.SetStateAction<Job[]>>;

  toasts: Toast[];
  pushToast: (toast: Omit<Toast, "id">) => void;
  dismissToast: (id: string) => void;
};

const StoreCtx = createContext<StoreValue | null>(null);

export const useStore = (): StoreValue => {
  const v = useContext(StoreCtx);
  if (!v) throw new Error("useStore must be used inside <StoreProvider>");
  return v;
};

export const StoreProvider = ({ children }: { children: ReactNode }) => {
  // Mock data is initialized on the client only — both `Date.now()` and
  // `Math.random()` would otherwise produce different values during SSR vs
  // hydration, causing mismatch warnings.
  const [projects, setProjects] = useState<Project[]>([]);
  const [clipsByProject, setClipsByProject] = useState<Record<string, Clip[]>>({});
  const [jobs, setJobs] = useState<Job[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    // One-time mock-data load — kept in an effect so initial values stay
    // deterministic during SSR and the random/time-sensitive bits only fire on
    // the client after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProjects(initialProjects());
    setClipsByProject({
      p1: generateClips("p1", 14),
      p2: generateClips("p2", 6),
      p5: generateClips("p5", 9),
      p6: generateClips("p6", 11),
    });
    setJobs([
      {
        id: "j1",
        projectId: "p2",
        label: "Cutting clips",
        stage: "cut",
        progress: 62,
        status: "running",
      },
    ]);
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

  const updateProject = useCallback<StoreValue["updateProject"]>(
    (id, patch) => {
      setProjects((cur) =>
        cur.map((p) =>
          p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p,
        ),
      );
    },
    [],
  );

  const deleteProject = useCallback<StoreValue["deleteProject"]>(
    (id) => {
      setProjects((cur) => cur.filter((p) => p.id !== id));
      setClipsByProject((cur) => {
        const copy = { ...cur };
        delete copy[id];
        return copy;
      });
      pushToast({ kind: "success", title: "Project deleted" });
    },
    [pushToast],
  );

  const createProject = useCallback<StoreValue["createProject"]>((draft) => {
    const id = "p" + Math.random().toString(36).slice(2, 7);
    const proj: Project = {
      id,
      name: draft.name,
      status: "Processing",
      clipCount: 0,
      updatedAt: Date.now(),
      createdAt: Date.now(),
      file: draft.file,
      prompt: draft.prompt,
      pipeline: {
        transcribe: "running",
        cut: "queued",
        render: "queued",
        package: "queued",
      },
    };
    setProjects((cur) => [proj, ...cur]);
    setJobs((cur) => [
      ...cur,
      {
        id: "j" + id,
        projectId: id,
        label: "Transcribing",
        stage: "transcribe",
        progress: 5,
        status: "running",
      },
    ]);
    return id;
  }, []);

  // Tick: advance running jobs and the project's pipeline.
  useEffect(() => {
    const t = setInterval(() => {
      setJobs((prev) => {
        if (prev.length === 0) return prev;
        const advanced = prev.map((j) =>
          j.status !== "running"
            ? j
            : { ...j, progress: Math.min(100, j.progress + 1.5 + Math.random() * 2) },
        );
        const completed: Job[] = [];
        const remaining = advanced.filter((j) => {
          if (j.progress >= 100) {
            completed.push(j);
            return false;
          }
          return true;
        });

        if (completed.length > 0) {
          setProjects((ps) =>
            ps.map((p) => {
              const finishedHere = completed.filter((j) => j.projectId === p.id);
              if (finishedHere.length === 0) return p;
              const order: (keyof Pipeline)[] = ["transcribe", "cut", "render", "package"];
              const np = { ...p.pipeline };
              for (const j of finishedHere) {
                np[j.stage] = "done";
                const nextIdx = order.indexOf(j.stage) + 1;
                const nextStage = order[nextIdx];
                if (nextStage) np[nextStage] = "running";
              }
              const allDone = order.every((s) => np[s] === "done");
              return {
                ...p,
                pipeline: np,
                status: allDone ? "Ready" : "Processing",
                clipCount: allDone ? p.clipCount || 8 : p.clipCount,
                updatedAt: Date.now(),
              };
            }),
          );
          setClipsByProject((cbp) => {
            const next = { ...cbp };
            for (const j of completed) {
              if (j.stage === "package" && !next[j.projectId]) {
                next[j.projectId] = generateClips(j.projectId, 8);
              }
            }
            return next;
          });
        }

        return remaining;
      });
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const value = useMemo<StoreValue>(
    () => ({
      projects,
      setProjects,
      updateProject,
      deleteProject,
      createProject,
      clipsByProject,
      setClipsByProject,
      jobs,
      setJobs,
      toasts,
      pushToast,
      dismissToast,
    }),
    [
      projects,
      clipsByProject,
      jobs,
      toasts,
      updateProject,
      deleteProject,
      createProject,
      pushToast,
      dismissToast,
    ],
  );

  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
};
