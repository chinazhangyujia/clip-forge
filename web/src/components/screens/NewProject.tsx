"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { PROMPT_PRESETS } from "@/lib/utils";
import { Icon } from "@/lib/icons";

type FileMeta = {
  name: string;
  sizeBytes: number;
  size: string;
  duration: string;
  durationSec: number;
};

const fmtSize = (bytes: number): string => {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return i === 0 ? `${n} ${units[i]}` : `${n.toFixed(1)} ${units[i]}`;
};

const fmtDur = (s: number): string => {
  if (!isFinite(s)) return "—";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
};

const probeDuration = (file: File): Promise<number> =>
  new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.src = url;
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(video.duration || 0);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(0);
    };
  });

export const NewProject = () => {
  const { createProject, pushToast } = useStore();
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [meta, setMeta] = useState<FileMeta | null>(null);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const onPickFile = async (f: File) => {
    setFile(f);
    setMeta({
      name: f.name,
      sizeBytes: f.size,
      size: fmtSize(f.size),
      duration: "…",
      durationSec: 0,
    });
    const dur = await probeDuration(f);
    setMeta({
      name: f.name,
      sizeBytes: f.size,
      size: fmtSize(f.size),
      duration: fmtDur(dur),
      durationSec: dur,
    });
  };

  const clearFile = () => {
    setFile(null);
    setMeta(null);
  };

  const canNext =
    step === 1 ? Boolean(file) : step === 2 ? Boolean(name.trim() && prompt.trim()) : true;

  const onFinish = async () => {
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    setUploadProgress(0);
    try {
      const project = await createProject(
        { name: name.trim(), prompt: prompt.trim(), file },
        (loaded, total) => setUploadProgress(loaded / total),
      );
      pushToast({
        kind: "success",
        title: "Project created",
        body: "Processing has started",
      });
      router.push(`/projects/${project.id}`);
    } catch (e) {
      setUploadError(String(e instanceof Error ? e.message : e));
      setUploading(false);
    }
  };

  return (
    <div className="page" style={{ maxWidth: 880 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 24 }}>
        <Link href="/" className="btn btn-ghost btn-sm" style={{ paddingLeft: 6 }}>
          <Icon name="chevronLeft" size={14} />
          Projects
        </Link>
      </div>
      <h1 className="page-title" style={{ marginBottom: 4 }}>
        New project
      </h1>
      <p className="page-sub" style={{ marginBottom: 32 }}>
        Walk through three steps. We&apos;ll handle the rest.
      </p>

      <Stepper step={step} />

      <div className="card" style={{ padding: 28, marginTop: 24 }}>
        {step === 1 && <Step1 file={file} meta={meta} onFile={onPickFile} onClear={clearFile} />}
        {step === 2 && (
          <Step2
            name={name}
            setName={setName}
            prompt={prompt}
            setPrompt={setPrompt}
            activePreset={activePreset}
            setActivePreset={setActivePreset}
          />
        )}
        {step === 3 && (
          <Step3
            meta={meta}
            name={name}
            prompt={prompt}
            uploading={uploading}
            uploadProgress={uploadProgress}
            uploadError={uploadError}
          />
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 20 }}>
        <button
          className="btn"
          onClick={() => (step === 1 ? router.push("/") : setStep((s) => s - 1))}
          disabled={uploading}
        >
          {step === 1 ? "Cancel" : "Back"}
        </button>
        {step < 3 ? (
          <button className="btn btn-primary" onClick={() => setStep((s) => s + 1)} disabled={!canNext}>
            Continue
            <Icon name="chevron" size={14} />
          </button>
        ) : (
          <button
            className="btn btn-primary btn-lg"
            onClick={onFinish}
            disabled={uploading || !file}
          >
            <Icon name="sparkle" size={15} />
            {uploading ? "Uploading…" : "Start processing"}
          </button>
        )}
      </div>
    </div>
  );
};

const Stepper = ({ step }: { step: number }) => {
  const steps = ["Upload material", "Cutting instructions", "Review"];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
      {steps.map((label, i) => {
        const n = i + 1;
        const active = step === n;
        const done = step > n;
        return (
          <Fragment key={n}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 999,
                  display: "grid",
                  placeItems: "center",
                  fontSize: 12,
                  fontWeight: 600,
                  background: active ? "var(--accent)" : done ? "var(--accent-soft)" : "var(--bg-elev)",
                  color: active ? "white" : done ? "oklch(0.45 0.16 45)" : "var(--fg-faint)",
                  border: active
                    ? "1px solid var(--accent)"
                    : `1px solid ${done ? "var(--accent-soft)" : "var(--border)"}`,
                  transition: "all .2s",
                }}
              >
                {done ? <Icon name="check" size={13} /> : n}
              </div>
              <span
                style={{
                  fontSize: 13.5,
                  fontWeight: active ? 500 : 400,
                  color: active ? "var(--fg)" : done ? "var(--fg-muted)" : "var(--fg-faint)",
                }}
              >
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div
                style={{
                  flex: 1,
                  height: 1,
                  margin: "0 16px",
                  background: done ? "var(--accent-soft)" : "var(--border)",
                }}
              />
            )}
          </Fragment>
        );
      })}
    </div>
  );
};

const Step1 = ({
  file,
  meta,
  onFile,
  onClear,
}: {
  file: File | null;
  meta: FileMeta | null;
  onFile: (f: File) => void;
  onClear: () => void;
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  if (file && meta) {
    return (
      <div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            padding: 16,
            background: "var(--bg-sunken)",
            borderRadius: "var(--radius)",
            border: "1px solid var(--border)",
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 8,
              background: "linear-gradient(135deg, oklch(0.55 0.12 280), oklch(0.4 0.13 320))",
              display: "grid",
              placeItems: "center",
              color: "white",
              flexShrink: 0,
            }}
          >
            <Icon name="video" size={24} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 500, marginBottom: 2, fontSize: 14 }}>{meta.name}</div>
            <div style={{ fontSize: 12.5, color: "var(--fg-muted)", display: "flex", gap: 12 }}>
              <span>{meta.size}</span>
              <span>•</span>
              <span>{meta.duration}</span>
            </div>
          </div>
          <button className="btn btn-sm btn-ghost" onClick={onClear} style={{ color: "var(--fg-muted)" }}>
            <Icon name="x" size={14} />
            Remove
          </button>
        </div>

        <div
          style={{
            marginTop: 16,
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
            color: "var(--green)",
          }}
        >
          <Icon name="check" size={16} />
          File selected — upload happens when you start processing
        </div>
      </div>
    );
  }

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files[0];
          if (f) onFile(f);
        }}
        onClick={() => inputRef.current?.click()}
        style={{
          border: `2px dashed ${drag ? "var(--accent)" : "var(--border-strong)"}`,
          background: drag ? "var(--accent-soft)" : "var(--bg-sunken)",
          borderRadius: "var(--radius-lg)",
          padding: "64px 24px",
          textAlign: "center",
          cursor: "pointer",
          transition: "all .15s",
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            margin: "0 auto 16px",
            borderRadius: 14,
            background: "var(--bg-elev)",
            border: "1px solid var(--border)",
            display: "grid",
            placeItems: "center",
            color: "var(--accent)",
          }}
        >
          <Icon name="upload" size={22} />
        </div>
        <div style={{ fontSize: 15.5, fontWeight: 500, marginBottom: 4 }}>
          Drop your source material here
        </div>
        <div style={{ color: "var(--fg-muted)", fontSize: 13 }}>
          One video file — MP4, MOV. The file lives on your machine; only the LLM cutting prompt
          touches the cloud.
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
          }}
        />
      </div>
    </div>
  );
};

const Step2 = ({
  name,
  setName,
  prompt,
  setPrompt,
  activePreset,
  setActivePreset,
}: {
  name: string;
  setName: (v: string) => void;
  prompt: string;
  setPrompt: (v: string) => void;
  activePreset: string | null;
  setActivePreset: (v: string | null) => void;
}) => {
  const presets = Object.keys(PROMPT_PRESETS);
  return (
    <div>
      <label style={{ display: "block", marginBottom: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Project name</div>
        <input
          className="input input-lg"
          placeholder="e.g. Course Module 4 — Hooks"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      <div style={{ marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>How should we cut this video?</div>
        <span style={{ fontSize: 12, color: "var(--fg-faint)" }}>{prompt.length} chars</span>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {presets.map((p) => (
          <button
            key={p}
            className={`chip ${activePreset === p ? "chip-active" : ""}`}
            onClick={() => {
              setPrompt(PROMPT_PRESETS[p]);
              setActivePreset(p);
            }}
          >
            <Icon name="sparkle" size={12} />
            {p}
          </button>
        ))}
      </div>

      <textarea
        className="textarea"
        rows={8}
        value={prompt}
        onChange={(e) => {
          setPrompt(e.target.value);
          setActivePreset(null);
        }}
        placeholder="Cut into 30–90 second clips around each distinct teaching point. Prioritize moments with strong hooks."
        style={{ minHeight: 180, fontSize: 14 }}
      />

      <div
        style={{
          marginTop: 16,
          padding: 14,
          background: "var(--accent-soft)",
          borderRadius: "var(--radius)",
          fontSize: 12.5,
          color: "oklch(0.42 0.14 45)",
          display: "flex",
          gap: 10,
        }}
      >
        <span style={{ flexShrink: 0, marginTop: 1 }}>
          <Icon name="sparkle" size={14} />
        </span>
        <span>Be specific. The clearer your instructions, the better the cuts. You can always re-run with a new prompt.</span>
      </div>
    </div>
  );
};

const Step3 = ({
  meta,
  name,
  prompt,
  uploading,
  uploadProgress,
  uploadError,
}: {
  meta: FileMeta | null;
  name: string;
  prompt: string;
  uploading: boolean;
  uploadProgress: number;
  uploadError: string | null;
}) => (
  <div>
    <div
      style={{
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: 0.06,
        textTransform: "uppercase",
        color: "var(--fg-faint)",
        marginBottom: 12,
      }}
    >
      Project
    </div>
    <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em", marginBottom: 24 }}>
      {name || "Untitled project"}
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
      <SummaryRow label="Source material" value={meta?.name || "—"} mono />
      <SummaryRow label="Size" value={meta?.size || "—"} mono />
      <SummaryRow label="Duration" value={meta?.duration || "—"} mono />
      <SummaryRow label="Format" value="Local file" mono />
    </div>

    <div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: 0.06,
          textTransform: "uppercase",
          color: "var(--fg-faint)",
          marginBottom: 8,
        }}
      >
        Cutting instructions
      </div>
      <div
        style={{
          padding: 14,
          background: "var(--bg-sunken)",
          borderRadius: "var(--radius)",
          border: "1px solid var(--border)",
          fontSize: 13.5,
          lineHeight: 1.6,
          whiteSpace: "pre-wrap",
        }}
      >
        {prompt || <span style={{ color: "var(--fg-faint)" }}>No instructions provided</span>}
      </div>
    </div>

    {uploading && (
      <div style={{ marginTop: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 13 }}>
          <span style={{ color: "var(--fg-muted)" }}>Uploading source</span>
          <span className="mono" style={{ color: "var(--accent)", fontWeight: 500 }}>
            {Math.floor(uploadProgress * 100)}%
          </span>
        </div>
        <div style={{ height: 6, background: "var(--bg-sunken)", borderRadius: 999, overflow: "hidden" }}>
          <div
            style={{
              height: "100%",
              width: `${uploadProgress * 100}%`,
              background: "var(--accent)",
              borderRadius: 999,
              transition: "width .25s",
            }}
          />
        </div>
      </div>
    )}

    {uploadError && (
      <div
        style={{
          marginTop: 20,
          padding: 14,
          background: "oklch(0.97 0.04 25)",
          border: "1px solid oklch(0.9 0.06 25)",
          borderRadius: "var(--radius)",
          fontSize: 13,
          color: "var(--red)",
          display: "flex",
          gap: 10,
        }}
      >
        <span style={{ flexShrink: 0, marginTop: 1 }}>
          <Icon name="alert" size={14} />
        </span>
        <span>{uploadError}</span>
      </div>
    )}

    {!uploading && !uploadError && (
      <div
        style={{
          marginTop: 20,
          padding: 16,
          background: "var(--bg-sunken)",
          borderRadius: "var(--radius)",
          display: "flex",
          gap: 12,
        }}
      >
        <span style={{ color: "var(--accent)", flexShrink: 0, marginTop: 2 }}>
          <Icon name="clock" size={16} />
        </span>
        <div style={{ fontSize: 13 }}>
          <div style={{ fontWeight: 500, marginBottom: 2 }}>What happens next</div>
          <div style={{ color: "var(--fg-muted)" }}>
            Upload → Transcribe → Cut → Render. The first transcribe may take a few minutes
            (it loads a Whisper model). You can leave this page and check back.
          </div>
        </div>
      </div>
    )}
  </div>
);

const SummaryRow = ({ label, value, mono }: { label: string; value: string; mono?: boolean }) => (
  <div>
    <div
      style={{
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: 0.06,
        textTransform: "uppercase",
        color: "var(--fg-faint)",
        marginBottom: 4,
      }}
    >
      {label}
    </div>
    <div style={{ fontSize: 13.5, fontFamily: mono ? "var(--font-mono-jb), ui-monospace, monospace" : "inherit" }}>
      {value}
    </div>
  </div>
);

