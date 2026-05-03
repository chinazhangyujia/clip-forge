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
};

export type ClipVariant = "original" | "captions" | "reframe" | "both";

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
};

export type Job = {
  id: string;
  projectId: string;
  label: string;
  stage: keyof Pipeline;
  progress: number;
  status: "running" | "done" | "failed";
};

export type ToastKind = "info" | "success" | "error";

export type Toast = {
  id: string;
  kind?: ToastKind;
  title: string;
  body?: string;
  duration?: number;
};

export type TranscriptLine = { t: number; text: string };

export type ProjectDraft = {
  name: string;
  prompt: string;
  file: ProjectFile | null;
};
