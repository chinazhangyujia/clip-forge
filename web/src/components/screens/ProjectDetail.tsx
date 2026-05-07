"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { api } from "@/lib/api";
import { fmtDuration, fmtRelative, fmtTime } from "@/lib/utils";
import { Icon, Spinner } from "@/lib/icons";
import { StatusPill } from "@/components/StatusPill";
import type { Clip, Pipeline, Project, ProjectFile, StageState } from "@/lib/types";

export const ProjectDetail = ({ projectId }: { projectId: string }) => {
  const { projects, clipsByProject, refreshProject, loadClips, updateProject, rerunProject, pushToast, settings } =
    useStore();
  const router = useRouter();
  const project = projects.find((p) => p.id === projectId);

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [editingPrompt, setEditingPrompt] = useState(false);
  const [promptDraft, setPromptDraft] = useState("");
  const [workingOpen, setWorkingOpen] = useState(false);

  // Refresh the project once on mount so a deep-link reload sees current state.
  useEffect(() => {
    refreshProject(projectId);
  }, [projectId, refreshProject]);

  // Poll while the pipeline is running.
  const projectStatus = project?.status;
  useEffect(() => {
    if (projectStatus !== "Processing") return;
    const t = setInterval(() => {
      refreshProject(projectId);
    }, 2000);
    return () => clearInterval(t);
  }, [projectStatus, projectId, refreshProject]);

  // Load clips whenever the project is in a state that has them.
  useEffect(() => {
    if (projectStatus === "Ready" || projectStatus === "Failed") {
      loadClips(projectId);
    }
  }, [projectStatus, projectId, loadClips]);

  const startEditingName = () => {
    if (!project) return;
    setNameDraft(project.name);
    setEditingName(true);
  };
  const startEditingPrompt = () => {
    if (!project) return;
    setPromptDraft(project.prompt || "");
    setEditingPrompt(true);
  };

  if (!project) {
    return (
      <div className="page">
        <div className="card" style={{ padding: 32, textAlign: "center", color: "var(--fg-muted)" }}>
          Project not found.
          <div style={{ marginTop: 16 }}>
            <Link href="/" className="btn">
              Back to projects
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const clips = clipsByProject[project.id] || [];

  const saveName = async () => {
    setEditingName(false);
    if (nameDraft.trim() && nameDraft !== project.name) {
      await updateProject(project.id, { name: nameDraft.trim() });
      pushToast({ kind: "success", title: "Project renamed" });
    }
  };

  const savePrompt = async () => {
    setEditingPrompt(false);
    if (promptDraft !== project.prompt) {
      await updateProject(project.id, { prompt: promptDraft });
      pushToast({ kind: "success", title: "Prompt updated" });
    }
  };

  const rerun = async () => {
    await rerunProject(project.id);
  };

  return (
    <div className="page" style={{ maxWidth: 1400 }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 28,
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
            <Link href="/" className="btn btn-ghost btn-sm" style={{ paddingLeft: 6, marginLeft: -6, color: "var(--fg-muted)" }}>
              <Icon name="chevronLeft" size={14} />
              Projects
            </Link>
          </div>
          {editingName ? (
            <input
              className="input"
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveName();
                if (e.key === "Escape") {
                  setNameDraft(project.name);
                  setEditingName(false);
                }
              }}
              style={{ fontSize: 24, fontWeight: 600, height: "auto", padding: "4px 8px", letterSpacing: "-0.02em" }}
            />
          ) : (
            <h1
              className="page-title"
              onClick={startEditingName}
              style={{
                cursor: "text",
                padding: "4px 8px",
                margin: "0 0 0 -8px",
                borderRadius: 6,
                transition: "background .12s",
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-sunken)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              {project.name}
              <span style={{ color: "var(--fg-faint)", opacity: 0.5 }}>
                <Icon name="edit" size={14} />
              </span>
            </h1>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
            <StatusPill status={project.status} />
            <span style={{ fontSize: 13, color: "var(--fg-muted)" }}>
              {clips.length} clip{clips.length === 1 ? "" : "s"} · updated {fmtRelative(project.updatedAt)}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={rerun}>
            <Icon name="refresh" size={14} />
            Re-run pipeline
          </button>
        </div>
      </div>

      {project.status === "Failed" && project.pipelineError && (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
            padding: "12px 16px",
            marginBottom: 20,
            borderRadius: "var(--radius)",
            border: "1px solid oklch(0.9 0.06 25)",
            background: "oklch(0.97 0.04 25)",
          }}
        >
          <span style={{ color: "var(--red)", flexShrink: 0, marginTop: 1 }}>
            <Icon name="alert" size={16} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: "var(--fg)" }}>
              Pipeline failed
            </div>
            <div
              className="mono"
              style={{
                fontSize: 12,
                color: "var(--fg-muted)",
                marginTop: 4,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {project.pipelineError}
            </div>
            <div style={{ fontSize: 12, color: "var(--fg-faint)", marginTop: 6 }}>
              Hit{" "}
              <span style={{ fontWeight: 500, color: "var(--fg-muted)" }}>
                Re-run pipeline
              </span>{" "}
              once you&apos;ve fixed the issue. The transcript is cached, so re-runs
              skip transcribing and start from the failed stage.
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: 24, alignItems: "flex-start" }}>
        <aside style={{ position: "sticky", top: 80, display: "flex", flexDirection: "column", gap: 16 }}>
          <SourceMaterials
            projectId={project.id}
            file={project.file}
            project={project}
            libraryReachable={settings.libraryReachable}
            settings={settings}
            onOpen={async () => {
              const lib = project.library ?? settings.defaultLibrary;
              const folderId = project.folderId ?? project.id;
              const fullPath = `${lib}/${folderId}/`;
              try {
                await navigator.clipboard.writeText(fullPath);
                pushToast({
                  kind: "success",
                  title: "Path copied",
                  body: "Paste into Finder (⌘⇧G) or File Explorer's address bar.",
                });
              } catch {
                pushToast({
                  kind: "info",
                  title: "Project folder",
                  body: fullPath,
                });
              }
            }}
          />
          <PromptCard
            project={project}
            editingPrompt={editingPrompt}
            promptDraft={promptDraft}
            setPromptDraft={setPromptDraft}
            onEditPrompt={startEditingPrompt}
            onSavePrompt={savePrompt}
            onCancelPrompt={() => {
              setPromptDraft(project.prompt || "");
              setEditingPrompt(false);
            }}
          />
          <PipelineCard pipeline={project.pipeline} />
        </aside>

        <main>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, letterSpacing: "-0.01em" }}>Clips</h2>
              <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--fg-muted)" }}>
                {clips.length === 0
                  ? "No clips yet — generated when the pipeline finishes."
                  : `${clips.length} clips generated from this source`}
              </p>
            </div>
            {clips.length > 0 && (
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-sm">
                  <Icon name="grid" size={13} />
                  All
                </button>
                <button className="btn btn-sm">
                  <Icon name="download" size={13} />
                  Download all
                </button>
              </div>
            )}
          </div>

          {clips.length === 0 ? (
            <ClipsLoading project={project} />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
              {clips.map((c) => (
                <ClipCard key={c.id} clip={c} onClick={() => router.push(`/clip?project=${project.id}&clip=${c.id}`)} />
              ))}
            </div>
          )}

          <div style={{ marginTop: 32 }}>
            <button
              onClick={() => setWorkingOpen((o) => !o)}
              style={{
                width: "100%",
                padding: "14px 16px",
                background: "var(--bg-sunken)",
                border: "1px solid var(--border)",
                borderRadius: workingOpen ? "var(--radius) var(--radius) 0 0" : "var(--radius)",
                display: "flex",
                alignItems: "center",
                gap: 10,
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
                transition: "background .12s",
              }}
            >
              <span
                style={{
                  transform: workingOpen ? "rotate(90deg)" : "rotate(0deg)",
                  transition: "transform .15s",
                  display: "inline-flex",
                  color: "var(--fg-faint)",
                }}
              >
                <Icon name="chevron" size={14} />
              </span>
              <span style={{ color: "var(--fg-muted)" }}>
                <Icon name="folder" size={14} />
              </span>
              Working directory
              <span
                className="mono"
                title={`${project.library ?? settings.defaultLibrary}/${project.folderId ?? project.id}/`}
                style={{
                  marginLeft: "auto",
                  color: "var(--fg-faint)",
                  fontSize: 11,
                  maxWidth: 280,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  direction: "rtl",
                  textAlign: "right",
                }}
              >
                <bdi style={{ direction: "ltr", unicodeBidi: "embed" }}>
                  {project.library ?? settings.defaultLibrary}/{project.folderId ?? project.id}/
                </bdi>
              </span>
            </button>
            {workingOpen && <WorkingDir project={project} clips={clips} />}
          </div>
        </main>
      </div>
    </div>
  );
};

const SourceMaterials = ({
  projectId,
  file,
  project,
  libraryReachable,
  settings,
  onOpen,
}: {
  projectId: string;
  file: ProjectFile | null;
  project: Project;
  libraryReachable: boolean;
  settings: { defaultLibrary: string };
  onOpen: () => void;
}) => {
  const library = project.library ?? settings.defaultLibrary;
  const folderId = project.folderId ?? project.id;
  const fullPath = `${library}/${folderId}/`;
  return (
  <div className="card" style={{ overflow: "hidden" }}>
    <div
      style={{
        padding: "12px 14px 10px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: 0.06,
          textTransform: "uppercase",
          color: "var(--fg-faint)",
        }}
      >
        Source materials
      </div>
      <span className="mono" style={{ fontSize: 10.5, color: "var(--fg-faint)" }}>
        1 / 1
      </span>
    </div>
    <div
      style={{
        aspectRatio: "16 / 9",
        position: "relative",
        background: "oklch(0.08 0.005 60)",
      }}
    >
      {file ? (
        <video
          src={api.sourceUrl(projectId)}
          controls
          playsInline
          preload="metadata"
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            background: "black",
          }}
        />
      ) : (
        <div
          className="placeholder-img"
          style={{ width: "100%", height: "100%" }}
        >
          no source uploaded
        </div>
      )}
    </div>
    <div style={{ padding: "10px 14px", borderTop: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 0" }}>
        <span
          style={{
            width: 22,
            height: 22,
            borderRadius: 5,
            background: "var(--accent-soft)",
            color: "oklch(0.45 0.16 45)",
            display: "grid",
            placeItems: "center",
            flexShrink: 0,
          }}
        >
          <Icon name="video" size={12} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            className="mono"
            style={{
              fontSize: 11.5,
              color: "var(--fg)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {file?.name || "source.mp4"}
          </div>
          <div style={{ fontSize: 10.5, color: "var(--fg-faint)", display: "flex", gap: 8 }}>
            <span>{file?.size || "—"}</span>
            <span>·</span>
            <span>{file?.duration || "—"}</span>
          </div>
        </div>
      </div>
    </div>
    <button
      title="Coming soon: add audio, slides, transcripts, or more videos"
      style={{
        width: "100%",
        padding: "10px 14px",
        borderTop: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 12,
        color: "var(--fg-faint)",
        background: "var(--bg-sunken)",
        cursor: "not-allowed",
      }}
      disabled
    >
      <Icon name="plus" size={12} />
      <span>Add another material</span>
      <span
        style={{
          marginLeft: "auto",
          fontSize: 10,
          padding: "1px 6px",
          borderRadius: 999,
          background: "var(--bg-elev)",
          border: "1px solid var(--border)",
          color: "var(--fg-faint)",
          fontWeight: 500,
          letterSpacing: 0.04,
        }}
      >
        SOON
      </span>
    </button>
    <div
      style={{
        padding: "8px 10px 8px 14px",
        borderTop: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "var(--bg-sunken)",
      }}
      title={fullPath}
    >
      <span style={{ color: "var(--fg-muted)", flexShrink: 0 }}>
        <Icon name="folderThin" size={13} />
      </span>
      <span
        className="mono"
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 11,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: libraryReachable ? "var(--fg-muted)" : "var(--fg-faint)",
          textDecoration: libraryReachable ? "none" : "line-through",
          direction: "rtl",
          textAlign: "left",
        }}
      >
        <bdi style={{ direction: "ltr", unicodeBidi: "embed" }}>{fullPath}</bdi>
      </span>
      {!libraryReachable && (
        <span title="Folder unreachable" style={{ color: "var(--amber)", flexShrink: 0 }}>
          <Icon name="warn" size={12} />
        </span>
      )}
      <button
        className="btn-ghost"
        onClick={libraryReachable ? onOpen : undefined}
        title={libraryReachable ? "Copy path" : "Folder unreachable"}
        style={{
          width: 24,
          height: 24,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 4,
          color: libraryReachable ? "var(--fg-muted)" : "var(--fg-faint)",
          cursor: libraryReachable ? "pointer" : "default",
          opacity: libraryReachable ? 1 : 0.5,
          flexShrink: 0,
        }}
      >
        <Icon name="externalLink" size={12} />
      </button>
    </div>
  </div>
  );
};

const PromptCard = ({
  project,
  editingPrompt,
  promptDraft,
  setPromptDraft,
  onEditPrompt,
  onSavePrompt,
  onCancelPrompt,
}: {
  project: Project;
  editingPrompt: boolean;
  promptDraft: string;
  setPromptDraft: (v: string) => void;
  onEditPrompt: () => void;
  onSavePrompt: () => void;
  onCancelPrompt: () => void;
}) => (
  <div className="card" style={{ padding: 16 }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: 0.06,
          textTransform: "uppercase",
          color: "var(--fg-faint)",
        }}
      >
        Cutting prompt
      </div>
      {!editingPrompt && (
        <button
          className="btn-ghost"
          onClick={onEditPrompt}
          style={{ fontSize: 11.5, color: "var(--fg-muted)", padding: "2px 6px", borderRadius: 4 }}
        >
          Edit
        </button>
      )}
    </div>
    {editingPrompt ? (
      <div>
        <textarea
          className="textarea"
          value={promptDraft}
          onChange={(e) => setPromptDraft(e.target.value)}
          rows={6}
          style={{ fontSize: 13, minHeight: 120 }}
          autoFocus
        />
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <button className="btn btn-sm btn-primary" onClick={onSavePrompt}>
            Save
          </button>
          <button className="btn btn-sm" onClick={onCancelPrompt}>
            Cancel
          </button>
        </div>
      </div>
    ) : (
      <div
        style={{
          fontSize: 12.5,
          color: "var(--fg-muted)",
          lineHeight: 1.55,
          background: "var(--bg-sunken)",
          padding: 10,
          borderRadius: "var(--radius-sm)",
          whiteSpace: "pre-wrap",
        }}
      >
        {project.prompt || <em style={{ color: "var(--fg-faint)" }}>No prompt</em>}
      </div>
    )}
  </div>
);

const PipelineCard = ({ pipeline }: { pipeline: Pipeline }) => {
  const stages: { key: keyof Pipeline; label: string; sub: string }[] = [
    { key: "transcribe", label: "Transcribe", sub: "faster-whisper" },
    { key: "cut", label: "Cut", sub: "Claude proposes boundaries" },
    { key: "render", label: "Render", sub: "Encode each clip" },
    { key: "package", label: "Package metadata", sub: "Titles, hashtags, hooks" },
  ];
  return (
    <div className="card" style={{ padding: 16 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: 0.06,
          textTransform: "uppercase",
          color: "var(--fg-faint)",
          marginBottom: 16,
        }}
      >
        Pipeline status
      </div>
      <div style={{ position: "relative" }}>
        <div
          style={{
            position: "absolute",
            left: 11,
            top: 11,
            bottom: 11,
            width: 2,
            background: "var(--border)",
            borderRadius: 999,
          }}
        />
        {stages.map((s, i) => (
          <PipelineStage key={s.key} stage={s} state={pipeline[s.key]} last={i === stages.length - 1} />
        ))}
      </div>
    </div>
  );
};

const PipelineStage = ({
  stage,
  state,
  last,
}: {
  stage: { key: keyof Pipeline; label: string; sub: string };
  state: StageState;
  last: boolean;
}) => {
  const stateConfig: Record<StageState, { color: string; bg: string; label: string; icon: "clock" | "spinner" | "check" | "alert" }> = {
    queued: { color: "var(--fg-faint)", bg: "var(--bg-elev)", label: "Queued", icon: "clock" },
    running: { color: "var(--accent)", bg: "var(--accent-soft)", label: "Running", icon: "spinner" },
    done: { color: "var(--green)", bg: "oklch(0.96 0.05 155)", label: "Done", icon: "check" },
    failed: { color: "var(--red)", bg: "oklch(0.97 0.04 25)", label: "Failed", icon: "alert" },
  };
  const cfg = stateConfig[state];

  return (
    <div style={{ display: "flex", gap: 14, paddingBottom: last ? 0 : 16, position: "relative" }}>
      <div
        style={{
          width: 24,
          height: 24,
          borderRadius: 999,
          background: cfg.bg,
          border: `1.5px solid ${state === "done" ? cfg.color : "var(--border-strong)"}`,
          display: "grid",
          placeItems: "center",
          color: cfg.color,
          flexShrink: 0,
          zIndex: 1,
          position: "relative",
        }}
      >
        {state === "running" ? <Spinner size={12} /> : <Icon name={cfg.icon} size={12} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>{stage.label}</span>
          <span style={{ fontSize: 11, color: cfg.color, fontWeight: 500 }}>{cfg.label}</span>
        </div>
        <div style={{ fontSize: 11.5, color: "var(--fg-faint)", marginTop: 2 }}>{stage.sub}</div>
        {state === "running" && (
          <div style={{ height: 3, background: "var(--bg-sunken)", borderRadius: 999, overflow: "hidden", marginTop: 8 }}>
            <div
              style={{
                height: "100%",
                width: "60%",
                background: "var(--accent)",
                borderRadius: 999,
                animation: "shimmerProgress 2.4s ease-in-out infinite",
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
};

const ClipCard = ({ clip, onClick }: { clip: Clip; onClick: () => void }) => {
  const [hover, setHover] = useState(false);
  const hasReframe = clip.variants.includes("reframe");

  return (
    <div
      className="card"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        cursor: "pointer",
        overflow: "hidden",
        transition: "all .15s",
        borderColor: hover ? "var(--border-strong)" : "var(--border)",
        boxShadow: hover ? "var(--shadow)" : "var(--shadow-sm)",
        transform: hover ? "translateY(-1px)" : "none",
      }}
    >
      <ClipThumb clip={clip} hover={hover} />
      <div style={{ padding: 12 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            lineHeight: 1.35,
            marginBottom: 8,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            minHeight: 35,
          }}
        >
          {clip.title}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 11,
            color: "var(--fg-muted)",
            marginBottom: 10,
          }}
        >
          <span className="mono">
            {fmtTime(clip.startSec)} – {fmtTime(clip.endSec)}
          </span>
          <span className="mono">{fmtDuration(clip.duration)}</span>
        </div>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          <VariantChip active={hasReframe} label="Reframe" />
        </div>
      </div>
    </div>
  );
};

const VariantChip = ({ active, label }: { active: boolean; label: string }) => (
  <span
    style={{
      fontSize: 10,
      padding: "2px 7px",
      borderRadius: 4,
      background: active ? "var(--accent-soft)" : "var(--bg-sunken)",
      color: active ? "oklch(0.45 0.16 45)" : "var(--fg-faint)",
      fontWeight: 500,
      border: `1px solid ${active ? "oklch(0.85 0.07 50)" : "var(--border)"}`,
    }}
  >
    {active && "✓ "}
    {label}
  </span>
);

const ClipThumb = ({ clip, hover }: { clip: Clip; hover: boolean }) => {
  const seed = clip.id.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const h1 = (seed * 11) % 360;
  const h2 = (h1 + 60) % 360;
  return (
    <div
      style={{
        aspectRatio: "16 / 9",
        background: `linear-gradient(135deg, oklch(0.5 0.13 ${h1}), oklch(0.35 0.14 ${h2}))`,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "radial-gradient(120% 80% at 30% 30%, oklch(1 0 0 / 0.18), transparent 55%)",
        }}
      />
      <div
        className="mono"
        style={{
          position: "absolute",
          top: 8,
          left: 8,
          fontSize: 10,
          color: "oklch(1 0 0 / 0.85)",
          background: "oklch(0 0 0 / 0.4)",
          padding: "2px 6px",
          borderRadius: 3,
        }}
      >
        {fmtDuration(clip.duration)}
      </div>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          placeItems: "center",
          opacity: hover ? 1 : 0.85,
          transition: "opacity .15s",
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 999,
            background: "oklch(1 0 0 / 0.92)",
            display: "grid",
            placeItems: "center",
            color: "var(--fg)",
            transform: hover ? "scale(1.08)" : "scale(1)",
            transition: "transform .15s",
          }}
        >
          <span style={{ marginLeft: 2 }}>
            <Icon name="play" size={14} />
          </span>
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: 2,
          background: "oklch(1 0 0 / 0.2)",
        }}
      >
        <div
          style={{
            height: "100%",
            width: hover ? "70%" : "12%",
            background: "var(--accent)",
            transition: "width .8s ease-out",
          }}
        />
      </div>
    </div>
  );
};

const ClipsLoading = ({ project }: { project: Project }) => {
  const isProcessing = project.status === "Processing";
  const isFailed = project.status === "Failed";
  return (
    <div className="card" style={{ padding: 48, textAlign: "center" }}>
      <div
        style={{
          width: 64,
          height: 64,
          margin: "0 auto 16px",
          borderRadius: 16,
          background: isFailed ? "oklch(0.97 0.04 25)" : "var(--accent-soft)",
          display: "grid",
          placeItems: "center",
          color: isFailed ? "var(--red)" : "var(--accent)",
        }}
      >
        {isProcessing ? <Spinner size={28} /> : <Icon name={isFailed ? "alert" : "video"} size={28} />}
      </div>
      <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 4 }}>
        {isFailed ? "Pipeline failed" : isProcessing ? "Generating clips…" : "No clips yet"}
      </div>
      <div style={{ color: "var(--fg-muted)", fontSize: 13 }}>
        {isFailed
          ? "Something went wrong during cutting. Re-run the pipeline to try again."
          : isProcessing
          ? "Clips will appear here as soon as the pipeline finishes."
          : "Run the pipeline to generate clips from your source video."}
      </div>
    </div>
  );
};

const seededSize = (id: string, base: number, range: number): string => {
  const sum = id.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  return (base + (sum % (range * 10)) / 10).toFixed(1);
};

const WorkingDir = ({ project, clips }: { project: Project; clips: Clip[] }) => {
  type FileRow = {
    name: string;
    size: string;
    kind: "video" | "data" | "meta";
    href?: string;
  };
  const transcribeDone = project.pipeline.transcribe === "done";
  const cutDone = project.pipeline.cut === "done";
  const files: FileRow[] = [
    {
      name: project.file?.name ?? "source.mp4",
      size: project.file?.size || "—",
      kind: "video",
    },
    {
      name: "transcript.json",
      size: transcribeDone ? "ready" : "(pending)",
      kind: "data",
      href: transcribeDone ? api.artifactUrl(project.id, "transcript.json") : undefined,
    },
    {
      name: "cuts.json",
      size: cutDone ? "ready" : "(pending)",
      kind: "data",
      href: cutDone ? api.artifactUrl(project.id, "cuts.json") : undefined,
    },
    ...clips.slice(0, 5).map<FileRow>((c) => ({
      name: `clips/${c.id}.mp4`,
      size: `${seededSize(c.id, 8, 14)} MB`,
      kind: "video",
    })),
    ...(clips.length > 5
      ? [{ name: `clips/… +${clips.length - 5} more`, size: "", kind: "meta" as const }]
      : []),
  ];

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderTop: 0,
        borderRadius: "0 0 var(--radius) var(--radius)",
        background: "var(--bg-elev)",
        overflow: "hidden",
      }}
    >
      {files.map((f, i) => (
        <div
          key={i}
          style={{
            padding: "10px 16px",
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontSize: 12.5,
            borderBottom: i < files.length - 1 ? "1px solid var(--border)" : 0,
            fontFamily: "var(--font-mono-jb), ui-monospace, monospace",
          }}
        >
          <span style={{ color: "var(--fg-faint)", flexShrink: 0 }}>
            <Icon
              name={f.kind === "video" ? "video" : f.kind === "data" ? "file" : "folder"}
              size={13}
            />
          </span>
          <span style={{ flex: 1, color: f.kind === "meta" ? "var(--fg-faint)" : "var(--fg)" }}>
            {f.name}
          </span>
          {f.size && <span style={{ color: "var(--fg-faint)", fontSize: 11 }}>{f.size}</span>}
          {f.href ? (
            <a
              href={f.href}
              target="_blank"
              rel="noreferrer"
              className="btn-ghost"
              title="Open in new tab"
              style={{
                padding: 4,
                color: "var(--fg-muted)",
                borderRadius: 4,
                textDecoration: "none",
                display: "inline-flex",
              }}
            >
              <Icon name="open" size={13} />
            </a>
          ) : null}
        </div>
      ))}
    </div>
  );
};
