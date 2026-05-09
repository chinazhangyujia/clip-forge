import type { Clip, ClipInterval, Project, TranscriptLine } from "./types";

// ---------- Compact-time mapping for silence-removed clips ----------
//
// A clip's source-time intervals form its compact timeline: the player
// jumps from intervals[i].endSec to intervals[i+1].startSec (skipping the
// removed silence), and the displayed clip duration equals the sum of
// interval lengths. These helpers translate between the two timelines so
// the Player and TrimPanel can think in compact time while seeking the
// underlying <video> in source time.

export const intervalsCompactDuration = (intervals: ClipInterval[]): number =>
  intervals.reduce((sum, iv) => sum + (iv.endSec - iv.startSec), 0);

// source-time → compact-time. A point inside an interval maps linearly;
// a point in the removed-pause gap snaps to the nearest interval edge in
// compact time.
export const sourceToCompact = (
  sourceSec: number,
  intervals: ClipInterval[],
): number => {
  if (intervals.length === 0) return Math.max(0, sourceSec);
  let acc = 0;
  for (let i = 0; i < intervals.length; i++) {
    const iv = intervals[i];
    if (sourceSec < iv.startSec) {
      if (i === 0) return 0;
      const prev = intervals[i - 1];
      // Pick whichever interval edge is closer in source time.
      return sourceSec - prev.endSec <= iv.startSec - sourceSec ? acc : acc;
    }
    if (sourceSec <= iv.endSec) {
      return acc + (sourceSec - iv.startSec);
    }
    acc += iv.endSec - iv.startSec;
  }
  return acc;
};

// compact-time → source-time. The player uses this when the user scrubs
// the clip; the trim panel uses it when mapping its handle positions
// down to source-time bounds.
export const compactToSource = (
  compactSec: number,
  intervals: ClipInterval[],
): number => {
  if (intervals.length === 0) return Math.max(0, compactSec);
  let acc = 0;
  for (const iv of intervals) {
    const dur = iv.endSec - iv.startSec;
    if (compactSec <= acc + dur) {
      return iv.startSec + (compactSec - acc);
    }
    acc += dur;
  }
  return intervals[intervals.length - 1].endSec;
};

// Given the current source-time position, return the start of the next
// speech interval (so the Player can jump over a removed pause), or null
// if we're already inside the last interval / past the end.
export const nextSpeechSrcTime = (
  sourceSec: number,
  intervals: ClipInterval[],
): number | null => {
  for (const iv of intervals) {
    if (sourceSec < iv.startSec - 0.01) return iv.startSec;
  }
  return null;
};

export const isPastLastInterval = (
  sourceSec: number,
  intervals: ClipInterval[],
): boolean => {
  if (intervals.length === 0) return false;
  return sourceSec >= intervals[intervals.length - 1].endSec - 0.01;
};


export const fmtTime = (s: number): string => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
};

// Human-readable duration: "35.4s" for short clips, "1m 9.9s" for minute-scale,
// "1h 23m" for long sources. Rounds to one decimal of a second to avoid
// floating-point artifacts like "69.89999999999998s".
export const fmtDuration = (s: number): string => {
  if (!isFinite(s) || s <= 0) return "0s";
  const total = Math.round(s * 10) / 10;
  if (total < 60) {
    return Number.isInteger(total) ? `${total}s` : `${total.toFixed(1)}s`;
  }
  const mins = Math.floor(total / 60);
  const remSec = Math.round((total - mins * 60) * 10) / 10;
  if (mins < 60) {
    if (remSec === 0) return `${mins}m`;
    const secStr = Number.isInteger(remSec) ? `${remSec}s` : `${remSec.toFixed(1)}s`;
    return `${mins}m ${secStr}`;
  }
  const hours = Math.floor(mins / 60);
  const restMins = mins % 60;
  return restMins === 0 ? `${hours}h` : `${hours}h ${restMins}m`;
};

export const fmtRelative = (ts: number): string => {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
};

export const PROMPT_PRESETS: Record<string, string> = {
  "Tutorial highlights":
    "Find moments where I teach a concrete technique. Cut into 45–75 second clips, each focused on one teaching point. Start each clip with the setup of the problem, end with the resolution. Skip transitions and small talk.",
  "Q&A moments":
    "Find audience or chat questions and my answer. Cut around the question + the most concise version of the answer. 30–90 seconds. Title each clip with the question.",
  "Hook-first short clips":
    "Cut into 20–45 second clips. Each clip must open with a strong hook — a surprising claim, a question, or a contrarian take. Trim aggressively for pace. Prioritize moments with strong vocal energy.",
};

export const SAMPLE_TRANSCRIPT: TranscriptLine[] = [
  { t: 0, text: "Alright, welcome back to module four." },
  { t: 2.4, text: "Today we're going to dive into something I think a lot of you have been waiting for —" },
  { t: 6.8, text: "how to actually structure a hook that makes someone stop scrolling." },
  { t: 10.2, text: "And I want to start with a story." },
  { t: 12.5, text: "Last year I posted a clip that got, I think, around eleven views in the first hour." },
  { t: 17.4, text: "Same content, same lighting, same me." },
  { t: 20.1, text: "I changed three words at the start. Three." },
  { t: 22.8, text: "And the next version did 1.4 million views in three days." },
  { t: 26.7, text: "So what changed? That's what we're unpacking today." },
];

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

export const generateClips = (projectId: string, count: number): Clip[] => {
  const arr: Clip[] = [];
  let cursor = 240;
  for (let i = 0; i < count; i++) {
    const dur = 28 + Math.floor(Math.random() * 60);
    const start = cursor;
    cursor += dur + 60 + Math.floor(Math.random() * 600);
    const variants: Clip["variants"] = ["original"];
    if (Math.random() > 0.5) variants.push("reframe");
    arr.push({
      id: `${projectId}-c${i + 1}`,
      projectId,
      title: CLIP_TITLES[i % CLIP_TITLES.length],
      duration: dur,
      startSec: start,
      endSec: start + dur,
      variants,
      description:
        "A short, hook-first clip pulled automatically from the source recording. Edit this description before posting.",
      hashtags: ["CourseCreator", "Teaching", "ContentTips", "Hooks"],
      hookText: "Three words. That's all it took.",
      thumbFrame: Math.floor(Math.random() * 100),
    });
  }
  return arr;
};

export const initialProjects = (): Project[] => [
  {
    id: "p1",
    name: "Course Module 4 — Hooks That Convert",
    status: "Ready",
    clipCount: 14,
    updatedAt: Date.now() - 1000 * 60 * 60 * 3,
    file: { name: "module-4-hooks-final.mp4", size: "8.4 GB", duration: "3:12:48", durationSec: 11568 },
    prompt: PROMPT_PRESETS["Hook-first short clips"],
    pipeline: { transcribe: "done", cut: "done", render: "done", package: "done" },
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 2,
  },
  {
    id: "p2",
    name: "Live Q&A — March Cohort",
    status: "Processing",
    clipCount: 6,
    updatedAt: Date.now() - 1000 * 60 * 7,
    file: { name: "march-qa-session.mp4", size: "12.1 GB", duration: "2:48:02", durationSec: 10082 },
    prompt: PROMPT_PRESETS["Q&A moments"],
    pipeline: { transcribe: "done", cut: "running", render: "queued", package: "queued" },
    createdAt: Date.now() - 1000 * 60 * 60 * 6,
  },
  {
    id: "p3",
    name: "Onboarding Lecture — v2",
    status: "Draft",
    clipCount: 0,
    updatedAt: Date.now() - 1000 * 60 * 60 * 22,
    file: null,
    prompt: "",
    pipeline: { transcribe: "queued", cut: "queued", render: "queued", package: "queued" },
    createdAt: Date.now() - 1000 * 60 * 60 * 22,
  },
  {
    id: "p4",
    name: "Workshop — Pricing Frameworks",
    status: "Failed",
    clipCount: 0,
    updatedAt: Date.now() - 1000 * 60 * 60 * 30,
    file: { name: "workshop-pricing.mp4", size: "6.7 GB", duration: "2:14:09", durationSec: 8049 },
    prompt: PROMPT_PRESETS["Tutorial highlights"],
    pipeline: { transcribe: "done", cut: "failed", render: "queued", package: "queued" },
    createdAt: Date.now() - 1000 * 60 * 60 * 36,
  },
  {
    id: "p5",
    name: "Founder Interview — Sasha L.",
    status: "Ready",
    clipCount: 9,
    updatedAt: Date.now() - 1000 * 60 * 60 * 24 * 4,
    file: { name: "sasha-interview.mp4", size: "5.2 GB", duration: "1:48:33", durationSec: 6513 },
    prompt: PROMPT_PRESETS["Q&A moments"],
    pipeline: { transcribe: "done", cut: "done", render: "done", package: "done" },
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 5,
  },
  {
    id: "p6",
    name: "Course Module 5 — Story Structure",
    status: "Ready",
    clipCount: 11,
    updatedAt: Date.now() - 1000 * 60 * 60 * 24 * 7,
    file: { name: "module-5-story.mp4", size: "9.8 GB", duration: "3:31:14", durationSec: 12674 },
    prompt: PROMPT_PRESETS["Tutorial highlights"],
    pipeline: { transcribe: "done", cut: "done", render: "done", package: "done" },
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 9,
  },
];
