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
  // Library directory + per-project folder name. Currently the backend stores
  // every project under a single shared workspace; these fields are populated
  // client-side from the current default library + project.id until the
  // backend tracks per-project library_dir.
  library?: string;
  folderId?: string;
};

export type Settings = {
  // Where new projects are saved by default. Sourced from the Tauri shell's
  // get_project_dir command in the desktop bundle; falls back to a stable
  // placeholder string in plain `npm run dev`.
  defaultLibrary: string;
  // Whether `defaultLibrary` is currently usable (writable / mounted). Always
  // true today — wire to a real probe when the backend exposes one.
  libraryReachable: boolean;
};

// One contiguous source-time speech window of a clip. `intervals` is the
// list of these that the renderer concats and the player skips between —
// silences longer than the project threshold are simply absent from the
// list.
export type ClipInterval = { startSec: number; endSec: number };

// One source-time range the auto-cutter removed from the clip, tagged
// with the reason it was taken out. The frontend uses this to render a
// per-reason divider in the transcript and a per-reason tick on the
// scrubber. `reason` is a string (not an enum) so the API can introduce
// new reasons — the client falls back to the catch-all visual style
// when it doesn't recognize the value.
export type ClipRemovedCut = {
  srcStart: number;
  srcEnd: number;
  reason: string;
};

export type Clip = {
  id: string;
  projectId: string;
  title: string;
  // Compact duration: sum of interval lengths (= what the player plays).
  // For legacy clips with a single interval this equals endSec - startSec.
  duration: number;
  // Outer source-time bounds — leftmost interval start / rightmost
  // interval end. Used by the trim panel for the source-time backdrop.
  startSec: number;
  endSec: number;
  // Source-time speech intervals after silence removal. Always >= 1
  // entry; clips with no removable pauses contain the single
  // [(startSec, endSec)] interval.
  intervals: ClipInterval[];
  // Source-time ranges removed inside the clip with reasons (long
  // pause / filler word / …). Empty for legacy clips — `cutsFromClip`
  // falls back to deriving pause cuts from interval gaps in that case.
  removedCuts?: ClipRemovedCut[];
  description: string;
  hashtags: string[];
  hookText: string;
  thumbFrame: number;
  original?: { startSec: number; endSec: number };
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

// Reasons the auto-cutter can remove material from a clip. `pause` and
// `filler` are real (produced by the backend speech mask + per-language
// filler wordlist); `repeat` and `lowvalue` are placeholders for future
// classifiers — the visual system already handles them.
export type CutReason = "pause" | "filler" | "repeat" | "lowvalue";

// One row in the project-wide Auto-cuts report. Carries enough context
// to render the row without a follow-up request: pause cuts ship a
// `pre`/`post` excerpt framing the silence; filler cuts ship the
// removed `word` plus surrounding `pre`/`post` words. `clipId` is null
// when the cut sits in a region the LLM didn't promote into a clip,
// in which case the row is rendered non-navigable.
export type ProjectCut = {
  id: string;
  sourceSec: number;
  sourceEndSec: number;
  removedSec: number;
  reason: string;
  clipId: string | null;
  pre: string;
  post: string;
  word: string | null;
};

// One automatic cut surfaced to the user. `t` is clip-relative compact
// time (0 = first frame the user sees), `afterIdx` is the index in the
// clip-window-visible transcript-segment list after which the cut sits,
// `removedSec` is the source-time duration the cutter took out.
export type Cut = {
  id: string;
  t: number;
  afterIdx: number;
  reason: CutReason;
  removedSec: number;
};

export type ProjectDraft = {
  name: string;
  prompt: string;
  file: File;
  // Optional per-project library override. Currently UI-only — the backend
  // does not yet record library_dir per project, so files always land under
  // the active workspace. Field carried so the override flows through the
  // create-project plumbing once the backend is wired.
  library?: string;
};
