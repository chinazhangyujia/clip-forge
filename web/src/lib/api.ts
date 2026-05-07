import type { Clip, Project, TranscriptSegment } from "./types";

// The backend's base URL. Defaults to NEXT_PUBLIC_API_URL (build-time) or
// http://localhost:8000 (dev). When running inside the Tauri desktop shell,
// `initApi()` replaces this with the runtime port the shell allocated.
let _base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const baseUrl = (): string => _base;

type TauriWindow = { __TAURI_INTERNALS__?: unknown };

export async function initApi(): Promise<void> {
  if (typeof window === "undefined") return;
  const tauri = (window as unknown as TauriWindow).__TAURI_INTERNALS__;
  if (!tauri) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const url = await invoke<string>("get_backend_url");
    _base = url;
  } catch (e) {
    console.error("get_backend_url failed; falling back to default base", e);
  }
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${detail}`);
  }
  return res.json() as Promise<T>;
}

export type CreateProjectPayload = {
  name: string;
  prompt: string;
  file: File;
  // Optional per-project library override. When unset, the backend uses its
  // configured workspace as the parent directory.
  library?: string;
};

export const api = {
  get base() {
    return baseUrl();
  },

  listProjects: async (): Promise<Project[]> => {
    return jsonOrThrow(await fetch(`${baseUrl()}/projects`));
  },

  getProject: async (id: string): Promise<Project> => {
    return jsonOrThrow(await fetch(`${baseUrl()}/projects/${id}`));
  },

  listClips: async (projectId: string): Promise<Clip[]> => {
    return jsonOrThrow(await fetch(`${baseUrl()}/projects/${projectId}/clips`));
  },

  createProject: (
    payload: CreateProjectPayload,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<Project> =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${baseUrl()}/projects`);
      const fd = new FormData();
      fd.append("name", payload.name);
      fd.append("prompt", payload.prompt);
      fd.append("file", payload.file);
      if (payload.library) fd.append("library", payload.library);
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable && onProgress) onProgress(e.loaded, e.total);
      });
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText) as Project);
          } catch {
            reject(new Error("Invalid JSON response from server"));
          }
        } else {
          reject(new Error(`${xhr.status}: ${xhr.responseText}`));
        }
      };
      xhr.onerror = () => reject(new Error("Network error during upload"));
      xhr.onabort = () => reject(new Error("Upload aborted"));
      xhr.send(fd);
    }),

  updateProject: async (
    id: string,
    patch: { name?: string; prompt?: string },
  ): Promise<Project> => {
    return jsonOrThrow(
      await fetch(`${baseUrl()}/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }),
    );
  },

  rerunProject: async (id: string): Promise<Project> => {
    return jsonOrThrow(
      await fetch(`${baseUrl()}/projects/${id}/rerun`, { method: "POST" }),
    );
  },

  deleteProject: async (id: string): Promise<void> => {
    const res = await fetch(`${baseUrl()}/projects/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`${res.status}: ${detail}`);
    }
  },

  updateClipBounds: async (
    clipId: string,
    bounds: { startSec: number; endSec: number },
  ): Promise<Clip> => {
    return jsonOrThrow(
      await fetch(`${baseUrl()}/clips/${clipId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bounds),
      }),
    );
  },

  clipDownloadUrl: (clipId: string): string => `${baseUrl()}/clips/${clipId}/download`,

  sourceUrl: (projectId: string): string => `${baseUrl()}/projects/${projectId}/source`,

  artifactUrl: (
    projectId: string,
    name: "transcript.json" | "cuts.json",
  ): string => `${baseUrl()}/projects/${projectId}/artifacts/${name}`,

  fetchTranscript: async (projectId: string): Promise<TranscriptSegment[]> => {
    const res = await fetch(
      `${baseUrl()}/projects/${projectId}/artifacts/transcript.json`,
    );
    if (!res.ok) return [];
    return (await res.json()) as TranscriptSegment[];
  },
};
