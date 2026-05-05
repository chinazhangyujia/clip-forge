export type StageState = "queued" | "running" | "done" | "failed";

export type Pipeline = {
  transcribe: StageState;
  cut: StageState;
  render: StageState;
  package: StageState;
};

export type ProjectStatus = "Draft" | "Processing" | "Ready" | "Failed";

export type ProjectFile = {
  name: string;
  size: string;
  duration: string;
  durationSec: number;
};

export type Project = {
  id: string;
  name: string;
  status: ProjectStatus;
  clipCount: number;
  updatedAt: number;
  createdAt: number;
  file: ProjectFile | null;
  prompt: string;
  pipeline: Pipeline;
  pipelineError?: string | null;
};

// Burned-in captions were dropped from MVP — the major social platforms
// (TikTok, Douyin, Reels, Shorts) all ship native auto-caption with better
// styling than we'd produce. Vertical reframe (9:16 instructor tracking) is
// still planned, hence kept here as a placeholder variant.
export type ClipVariant = "original" | "reframe";

export type Clip = {
  id: string;
  projectId: string;
  title: string;
  duration: number;
  startSec: number;
  endSec: number;
  variants: ClipVariant[];
  description: string;
  hashtags: string[];
  hookText: string;
  thumbFrame: number;
  original?: { startSec: number; endSec: number };
  staleVariants?: ClipVariant[];
  needsRender?: boolean;
};

export type JobStage = keyof Pipeline | "download";

export type Job = {
  id: string;
  projectId: string;
  label: string;
  stage: JobStage;
  progress: number;
  status: "running" | "done" | "failed";
  // Indeterminate jobs (e.g. download while ffmpeg runs synchronously and we
  // have no progress telemetry) render the bar in shimmer mode instead of
  // showing a width.
  indeterminate?: boolean;
};

export type ToastKind = "info" | "success" | "error";

export type ToastAction = {
  label: string;
  onClick?: () => void;
};

export type Toast = {
  id: string;
  kind?: ToastKind;
  title: string;
  body?: string;
  duration?: number;
  action?: ToastAction;
};

export type TranscriptLine = { t: number; text: string };

// What the backend's transcript.json artifact actually contains:
// faster-whisper segments with absolute source-time start/end.
export type TranscriptSegment = { start: number; end: number; text: string };

export type ProjectDraft = {
  name: string;
  prompt: string;
  file: File;
};
