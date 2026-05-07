"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, Fragment } from "react";
import { useStore } from "@/lib/store";
import { Icon } from "@/lib/icons";

type Crumb = { label: string; href?: string };

const deriveCrumbs = (pathname: string): Crumb[] => {
  if (pathname === "/projects/new") return [{ label: "New project" }];
  if (pathname === "/clip") {
    return [{ label: "Projects", href: "/" }, { label: "Clip" }];
  }
  return [];
};

export const TopNav = () => {
  const pathname = usePathname();
  const crumbs = deriveCrumbs(pathname);
  const { jobs, settings } = useStore();
  const [jobsOpen, setJobsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const jobsRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const running = jobs.filter((j) => j.status === "running");

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (jobsRef.current && !jobsRef.current.contains(e.target as Node)) setJobsOpen(false);
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node))
        setSettingsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setJobsOpen(false);
        setSettingsOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <header className="topnav">
      <Link href="/" className="logo">
        <span className="logo-mark" />
        ClipForge
      </Link>
      {crumbs.length > 0 && (
        <nav className="crumbs">
          <span className="sep">/</span>
          {crumbs.map((c, i) => (
            <Fragment key={i}>
              {c.href ? (
                <Link href={c.href}>{c.label}</Link>
              ) : (
                <span style={{ color: "var(--fg)" }}>{c.label}</span>
              )}
              {i < crumbs.length - 1 && <span className="sep">/</span>}
            </Fragment>
          ))}
        </nav>
      )}
      <div className="spacer" />
      <div ref={settingsRef} style={{ position: "relative" }}>
        <button
          className="btn-ghost"
          onClick={() => {
            setSettingsOpen((o) => !o);
            setJobsOpen(false);
          }}
          title="Settings"
          aria-label="Settings"
          style={{
            width: 32,
            height: 32,
            borderRadius: 999,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: settingsOpen ? "var(--fg)" : "var(--fg-muted)",
            background: settingsOpen ? "var(--bg-sunken)" : "transparent",
            border: "1px solid transparent",
            position: "relative",
          }}
        >
          <Icon name="gear" size={16} />
          {!settings.libraryReachable && (
            <span
              title="Default workspace isn't reachable"
              style={{
                position: "absolute",
                top: 4,
                right: 4,
                width: 7,
                height: 7,
                borderRadius: 999,
                background: "var(--amber)",
                border: "1.5px solid var(--bg-elev)",
              }}
            />
          )}
        </button>
        {settingsOpen && <SettingsPopover />}
      </div>
      <div ref={jobsRef} style={{ position: "relative" }}>
        <button
          className="jobs-trigger"
          onClick={() => {
            setJobsOpen((o) => !o);
            setSettingsOpen(false);
          }}
        >
          {running.length > 0 ? (
            <span className="pulse" />
          ) : (
            <span style={{ width: 7, height: 7, borderRadius: 999, background: "var(--border-strong)" }} />
          )}
          <span>Jobs</span>
          <span className="jobs-count">{running.length}</span>
        </button>
        {jobsOpen && <JobsPopover />}
      </div>
    </header>
  );
};

const SettingsPopover = () => {
  const { settings, pickFolder } = useStore();
  return (
    <div className="popover" style={{ width: 360 }}>
      <div className="popover-head">
        <span>Settings</span>
      </div>
      <div style={{ padding: 16 }}>
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
          Default workspace
        </div>
        <div style={{ fontSize: 12.5, color: "var(--fg-muted)", marginBottom: 12 }}>
          Where new projects are saved.
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            padding: "10px 12px",
            background: "var(--bg-sunken)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            marginBottom: 12,
          }}
        >
          <span style={{ color: "var(--fg-muted)", flexShrink: 0, marginTop: 1 }}>
            <Icon name="folderThin" size={14} />
          </span>
          <span
            className="mono"
            title={settings.defaultLibrary}
            style={{
              fontSize: 12,
              lineHeight: 1.45,
              color: settings.libraryReachable ? "var(--fg)" : "var(--fg-faint)",
              textDecoration: settings.libraryReachable ? "none" : "line-through",
              wordBreak: "break-all",
              flex: 1,
              minWidth: 0,
            }}
          >
            {settings.defaultLibrary}
          </span>
          {!settings.libraryReachable && (
            <span
              title="This folder isn't reachable"
              style={{ color: "var(--amber)", flexShrink: 0, marginTop: 1 }}
            >
              <Icon name="warn" size={14} />
            </span>
          )}
        </div>

        <button
          className="btn"
          onClick={() => {
            pickFolder();
          }}
          style={{ width: "100%", justifyContent: "center" }}
        >
          <Icon name="folderThin" size={14} />
          Change folder…
        </button>

        <div style={{ marginTop: 10, fontSize: 11.5, color: "var(--fg-faint)", lineHeight: 1.5 }}>
          Existing projects stay in their current location. Only new projects use the new default.
        </div>
      </div>
    </div>
  );
};

const JobsPopover = () => {
  const { jobs, projects } = useStore();
  return (
    <div className="popover">
      <div className="popover-head">
        <span>Running Jobs</span>
        <span className="mono" style={{ color: "var(--fg-faint)" }}>{jobs.length}</span>
      </div>
      <div style={{ maxHeight: 360, overflowY: "auto" }}>
        {jobs.length === 0 ? (
          <div style={{ padding: "24px 16px", textAlign: "center", color: "var(--fg-faint)", fontSize: 13 }}>
            <Icon name="check" size={18} />
            <div style={{ marginTop: 6 }}>No jobs running</div>
          </div>
        ) : (
          jobs.map((j) => {
            const proj = projects.find((p) => p.id === j.projectId);
            return (
              <Link href={`/project?id=${j.projectId}`} key={j.id}>
                <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontWeight: 500,
                          fontSize: 13,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {proj?.name || "Project"}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--fg-muted)", marginTop: 2 }}>
                        {j.label}…
                      </div>
                    </div>
                    {!j.indeterminate && (
                      <span className="mono" style={{ color: "var(--fg-muted)", fontSize: 12 }}>
                        {Math.floor(j.progress)}%
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      height: 4,
                      background: "var(--bg-sunken)",
                      borderRadius: 999,
                      overflow: "hidden",
                      position: "relative",
                    }}
                  >
                    {j.indeterminate ? (
                      <div
                        style={{
                          position: "absolute",
                          inset: 0,
                          background:
                            "linear-gradient(90deg, transparent 0%, var(--accent) 50%, transparent 100%)",
                          animation: "chipShimmer 1.4s ease-in-out infinite",
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          height: "100%",
                          width: `${j.progress}%`,
                          background: "var(--accent)",
                          borderRadius: 999,
                          transition: "width .4s",
                        }}
                      />
                    )}
                  </div>
                </div>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
};
