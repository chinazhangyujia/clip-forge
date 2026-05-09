import type { Clip, ClipInterval, Project, TranscriptSegment } from "./types";

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

// btoa() only accepts Latin1, so encode UTF-8 bytes manually before base64.
// The metadata header carries Chinese filenames and arbitrary prompts, so we
// can't assume ASCII.
function utf8ToBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
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

      // Pack metadata into a single base64-JSON header so the request body
      // can be the raw file bytes. The backend then streams network →
      // destination file directly, instead of spooling a multi-GB upload to
      // %TEMP% (which on Windows is on C: and runs ENOSPC for big files).
      const metaJson = JSON.stringify({
        name: payload.name,
        prompt: payload.prompt,
        filename: payload.file.name,
        library: payload.library ?? null,
      });
      xhr.setRequestHeader("X-Clipforge-Project-Metadata", utf8ToBase64(metaJson));
      xhr.setRequestHeader("Content-Type", "application/octet-stream");

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
      xhr.send(payload.file);
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

  // 9:16 vertical reframe is rendered asynchronously by a background job.
  // The frontend POSTs to kick off, then polls the regular `listClips`
  // endpoint until `variants` contains "reframe" and it isn't stale.
  generateReframe: async (clipId: string): Promise<Clip> => {
    return jsonOrThrow(
      await fetch(`${baseUrl()}/clips/${clipId}/reframe`, { method: "POST" }),
    );
  },

  // URL for a non-original clip variant. Currently only "reframe" exists.
  // The backend marks this response no-store so a regenerated variant
  // never gets served from a stale WebView cache.
  variantUrl: (clipId: string, variant: "reframe"): string =>
    `${baseUrl()}/clips/${clipId}/variants/${variant}`,

  sourceUrl: (projectId: string): string => `${baseUrl()}/projects/${projectId}/source`,

  artifactUrl: (
    projectId: string,
    name: "transcript.json" | "cuts.json",
  ): string => `${baseUrl()}/projects/${projectId}/artifacts/${name}`,

  // The project's speech mask — list of source-time intervals where there
  // was speech, with the long pauses between them removed. Used by the
  // trim panel as a backdrop so the user can see (and grow into) the
  // speech regions outside their current clip bounds.
  fetchSpeechIntervals: async (projectId: string): Promise<ClipInterval[]> => {
    const res = await fetch(
      `${baseUrl()}/projects/${projectId}/artifacts/speech_intervals.json`,
      { cache: "no-store" },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as {
      intervals?: { src_start: number; src_end: number }[];
    };
    return (data.intervals ?? []).map((iv) => ({
      startSec: iv.src_start,
      endSec: iv.src_end,
    }));
  },

  fetchTranscript: async (projectId: string): Promise<TranscriptSegment[]> => {
    // `cache: "no-store"` defends against a stale 404 cached during the
    // window where the pipeline was still running — without this the
    // transcript panel can show "not finished" indefinitely.
    const res = await fetch(
      `${baseUrl()}/projects/${projectId}/artifacts/transcript.json`,
      { cache: "no-store" },
    );
    if (!res.ok) return [];
    return (await res.json()) as TranscriptSegment[];
  },
};
