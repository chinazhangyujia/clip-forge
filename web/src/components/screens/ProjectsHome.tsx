"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { fmtRelative } from "@/lib/utils";
import { Icon } from "@/lib/icons";
import { StatusPill } from "@/components/StatusPill";
import type { Project, ProjectFile } from "@/lib/types";

export const ProjectsHome = () => {
  const { projects, deleteProject } = useStore();
  const router = useRouter();
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const empty = projects.length === 0;
  const confirmTarget = confirmId ? projects.find((p) => p.id === confirmId) : null;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Projects</h1>
          <p className="page-sub">Long recordings in. Short clips out.</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn">
            <Icon name="search" size={14} />
            Search
          </button>
          <Link className="btn btn-primary" href="/projects/new">
            <Icon name="plus" size={14} />
            New project
          </Link>
        </div>
      </div>

      {empty ? (
        <EmptyState />
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
            gap: "var(--gap)",
          }}
        >
          {projects.map((p) => (
            <ProjectCard
              key={p.id}
              p={p}
              isHover={hoverId === p.id}
              onEnter={() => setHoverId(p.id)}
              onLeave={() => setHoverId(null)}
              onOpen={() => router.push(`/projects/${p.id}`)}
              onDelete={() => setConfirmId(p.id)}
            />
          ))}
        </div>
      )}

      {confirmTarget && (
        <ConfirmDelete
          project={confirmTarget}
          onCancel={() => setConfirmId(null)}
          onConfirm={() => {
            deleteProject(confirmTarget.id);
            setConfirmId(null);
          }}
        />
      )}
    </div>
  );
};

const ProjectCard = ({
  p,
  isHover,
  onEnter,
  onLeave,
  onOpen,
  onDelete,
}: {
  p: Project;
  isHover: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onOpen: () => void;
  onDelete: () => void;
}) => (
  <div
    className="card"
    onMouseEnter={onEnter}
    onMouseLeave={onLeave}
    onClick={onOpen}
    style={{
      cursor: "pointer",
      transition: "border-color .15s, transform .15s, box-shadow .15s",
      borderColor: isHover ? "var(--border-strong)" : "var(--border)",
      transform: isHover ? "translateY(-1px)" : "none",
      boxShadow: isHover ? "var(--shadow)" : "var(--shadow-sm)",
      position: "relative",
      overflow: "hidden",
    }}
  >
    <div
      style={{
        aspectRatio: "16 / 9",
        position: "relative",
        overflow: "hidden",
        borderTopLeftRadius: "var(--radius-lg)",
        borderTopRightRadius: "var(--radius-lg)",
      }}
    >
      <Thumbnail file={p.file} />
      <div
        style={{
          position: "absolute",
          top: 10,
          right: 10,
          display: "flex",
          gap: 6,
          opacity: isHover ? 1 : 0,
          transition: "opacity .15s",
        }}
      >
        <button
          className="btn btn-sm btn-icon"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          title="Open"
          style={{ background: "oklch(1 0 0 / 0.95)", backdropFilter: "blur(8px)" }}
        >
          <Icon name="open" size={13} />
        </button>
        <button
          className="btn btn-sm btn-icon"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Delete"
          style={{ background: "oklch(1 0 0 / 0.95)", backdropFilter: "blur(8px)", color: "var(--red)" }}
        >
          <Icon name="trash" size={13} />
        </button>
      </div>
      {p.file?.duration && (
        <div
          style={{
            position: "absolute",
            bottom: 10,
            left: 10,
            right: 10,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <span
            className="mono"
            style={{
              background: "oklch(0.2 0.02 60 / 0.78)",
              color: "white",
              padding: "3px 7px",
              borderRadius: 5,
              fontSize: 10,
              letterSpacing: 0.04,
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
            }}
          >
            <Icon name="folder" size={10} />
            1 material
          </span>
          <span
            className="mono"
            style={{
              background: "oklch(0.2 0.02 60 / 0.78)",
              color: "white",
              padding: "3px 7px",
              borderRadius: 5,
              fontSize: 11,
              letterSpacing: 0.02,
            }}
          >
            {p.file.duration}
          </span>
        </div>
      )}
    </div>
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
        <h3
          style={{
            margin: 0,
            fontSize: 14.5,
            fontWeight: 500,
            letterSpacing: "-0.01em",
            lineHeight: 1.35,
          }}
        >
          {p.name}
        </h3>
        <StatusPill status={p.status} />
      </div>
      <div
        style={{
          marginTop: 12,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 12,
          color: "var(--fg-muted)",
        }}
      >
        <span>{p.clipCount > 0 ? `${p.clipCount} clip${p.clipCount === 1 ? "" : "s"}` : "No clips yet"}</span>
        <span className="mono" style={{ fontSize: 11 }}>
          {fmtRelative(p.updatedAt)}
        </span>
      </div>
    </div>
  </div>
);

const Thumbnail = ({ file }: { file: ProjectFile | null }) => {
  if (!file) {
    return (
      <div className="placeholder-img" style={{ width: "100%", height: "100%" }}>
        no materials yet
      </div>
    );
  }
  const seed = file.name.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const h1 = (seed * 7) % 360;
  const h2 = (h1 + 40) % 360;
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: `linear-gradient(135deg, oklch(0.55 0.12 ${h1}), oklch(0.4 0.13 ${h2}))`,
        position: "relative",
        display: "grid",
        placeItems: "center",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "radial-gradient(120% 80% at 30% 20%, oklch(1 0 0 / 0.18), transparent 50%)",
        }}
      />
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 999,
          background: "oklch(1 0 0 / 0.92)",
          display: "grid",
          placeItems: "center",
          boxShadow: "0 4px 12px oklch(0 0 0 / 0.15)",
        }}
      >
        <span style={{ marginLeft: 3, color: "var(--fg)" }}>
          <Icon name="play" size={16} />
        </span>
      </div>
    </div>
  );
};

const EmptyState = () => (
  <div
    style={{
      border: "1px dashed var(--border-strong)",
      borderRadius: "var(--radius-lg)",
      padding: "80px 24px",
      textAlign: "center",
      background: "var(--bg-elev)",
    }}
  >
    <div
      style={{
        width: 88,
        height: 88,
        margin: "0 auto 20px",
        borderRadius: 24,
        background: "var(--accent-soft)",
        display: "grid",
        placeItems: "center",
        position: "relative",
      }}
    >
      <div style={{ color: "var(--accent)" }}>
        <Icon name="video" size={36} />
      </div>
      <div
        style={{
          position: "absolute",
          top: -8,
          right: -8,
          width: 28,
          height: 28,
          borderRadius: 999,
          background: "var(--accent)",
          color: "white",
          display: "grid",
          placeItems: "center",
          boxShadow: "var(--shadow)",
        }}
      >
        <Icon name="sparkle" size={14} />
      </div>
    </div>
    <h2 style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 600, letterSpacing: "-0.02em" }}>
      Create your first project
    </h2>
    <p style={{ margin: "0 auto 24px", color: "var(--fg-muted)", maxWidth: 420 }}>
      Upload a long recording — a lecture, a livestream, a Q&amp;A — and ClipForge will turn it
      into short clips ready to post.
    </p>
    <Link className="btn btn-primary btn-lg" href="/projects/new">
      <Icon name="plus" size={15} />
      New project
    </Link>
  </div>
);

const ConfirmDelete = ({
  project,
  onCancel,
  onConfirm,
}: {
  project: Project;
  onCancel: () => void;
  onConfirm: () => void;
}) => (
  <div
    onClick={onCancel}
    style={{
      position: "fixed",
      inset: 0,
      background: "oklch(0.2 0.02 60 / 0.4)",
      backdropFilter: "blur(2px)",
      display: "grid",
      placeItems: "center",
      zIndex: 300,
      animation: "fadeIn .15s",
    }}
  >
    <div
      className="card"
      onClick={(e) => e.stopPropagation()}
      style={{ width: 420, padding: 24, boxShadow: "var(--shadow-lg)" }}
    >
      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Delete project?</h3>
      <p style={{ margin: "8px 0 20px", color: "var(--fg-muted)" }}>
        <strong style={{ color: "var(--fg)" }}>{project.name}</strong> and all its clips will be
        permanently removed.
      </p>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="btn btn-primary"
          onClick={onConfirm}
          style={{ background: "var(--red)", borderColor: "var(--red)" }}
        >
          Delete
        </button>
      </div>
    </div>
  </div>
);
