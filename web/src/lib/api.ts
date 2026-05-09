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

// Build a self-contained diagnostic block for the project-upload failure flow.
// The desktop user is non-technical — the goal is one clean blob they can
// copy and paste back to us. Everything load-bearing for debugging
// (URL the WebView called, file metadata, server-side __cause__ if the
// backend exception handler unwrapped it) goes into this block.
function formatUploadError(args: {
  url: string;
  status: number;
  statusText: string;
  responseText: string;
  file: File;
  library?: string;
}): string {
  const { url, status, statusText, responseText, file, library } = args;
  let serverDetail = responseText || "(empty body)";
  let causeBlock = "";
  let tracebackBlock = "";
  let envBlock = "";
  try {
    const parsed = JSON.parse(responseText) as {
      detail?: string;
      cause?: string;
      cause_type?: string | null;
      traceback?: string;
      env?: Record<string, unknown>;
    };
    if (parsed.detail) serverDetail = parsed.detail;
    if (parsed.cause) {
      causeBlock = `\nUnderlying cause${
        parsed.cause_type ? ` (${parsed.cause_type})` : ""
      }:\n${parsed.cause}`;
    }
    if (parsed.traceback) {
      tracebackBlock = `\nTraceback:\n${parsed.traceback}`;
    }
    if (parsed.env) {
      const envLines = Object.entries(parsed.env)
        .map(([k, v]) => `  ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
        .join("\n");
      envBlock = `\nBackend environment:\n${envLines}`;
    }
  } catch {
    // Body wasn't JSON — fall back to the raw text.
  }
  const lines = [
    "ClipForge — upload failed",
    `URL:        ${url}`,
    `Status:     ${status} ${statusText}`,
    `File:       ${file.name}`,
    `Size:       ${file.size} bytes`,
    `Type:       ${file.type || "(unknown)"}`,
    library ? `Library:    ${library}` : "Library:    (default workspace)",
    `User agent: ${typeof navigator !== "undefined" ? navigator.userAgent : "(server)"}`,
    "",
    "Server detail:",
    serverDetail,
  ];
  if (causeBlock) lines.push(causeBlock);
  if (tracebackBlock) lines.push(tracebackBlock);
  if (envBlock) lines.push(envBlock);
  return lines.join("\n");
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
      const url = `${baseUrl()}/projects`;
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
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
          reject(new Error(formatUploadError({
            url,
            status: xhr.status,
            statusText: xhr.statusText,
            responseText: xhr.responseText,
            file: payload.file,
            library: payload.library,
          })));
        }
      };
      xhr.onerror = () =>
        reject(new Error(formatUploadError({
          url,
          status: 0,
          statusText: "Network error",
          responseText: "(no response — request never reached the backend)",
          file: payload.file,
          library: payload.library,
        })));
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
