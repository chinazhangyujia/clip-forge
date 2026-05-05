import type { Clip, Project, TranscriptSegment } from "./types";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

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
};

export const api = {
  base: BASE,

  listProjects: async (): Promise<Project[]> => {
    return jsonOrThrow(await fetch(`${BASE}/projects`));
  },

  getProject: async (id: string): Promise<Project> => {
    return jsonOrThrow(await fetch(`${BASE}/projects/${id}`));
  },

  listClips: async (projectId: string): Promise<Clip[]> => {
    return jsonOrThrow(await fetch(`${BASE}/projects/${projectId}/clips`));
  },

  createProject: (
    payload: CreateProjectPayload,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<Project> =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${BASE}/projects`);
      const fd = new FormData();
      fd.append("name", payload.name);
      fd.append("prompt", payload.prompt);
      fd.append("file", payload.file);
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
      await fetch(`${BASE}/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }),
    );
  },

  rerunProject: async (id: string): Promise<Project> => {
    return jsonOrThrow(
      await fetch(`${BASE}/projects/${id}/rerun`, { method: "POST" }),
    );
  },

  deleteProject: async (id: string): Promise<void> => {
    const res = await fetch(`${BASE}/projects/${id}`, { method: "DELETE" });
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
      await fetch(`${BASE}/clips/${clipId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bounds),
      }),
    );
  },

  clipDownloadUrl: (clipId: string): string => `${BASE}/clips/${clipId}/download`,

  sourceUrl: (projectId: string): string => `${BASE}/projects/${projectId}/source`,

  artifactUrl: (
    projectId: string,
    name: "transcript.json" | "cuts.json",
  ): string => `${BASE}/projects/${projectId}/artifacts/${name}`,

  fetchTranscript: async (projectId: string): Promise<TranscriptSegment[]> => {
    const res = await fetch(
      `${BASE}/projects/${projectId}/artifacts/transcript.json`,
    );
    if (!res.ok) return [];
    return (await res.json()) as TranscriptSegment[];
  },
};
