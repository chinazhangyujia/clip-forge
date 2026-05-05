"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, Fragment } from "react";
import { useStore } from "@/lib/store";
import { Icon } from "@/lib/icons";

type Crumb = { label: string; href?: string };

const deriveCrumbs = (pathname: string): Crumb[] => {
  if (pathname === "/projects/new") return [{ label: "New project" }];
  if (/^\/projects\/[^/]+\/clips\/[^/]+$/.test(pathname)) {
    return [{ label: "Projects", href: "/" }, { label: "Clip" }];
  }
  return [];
};

export const TopNav = () => {
  const pathname = usePathname();
  const crumbs = deriveCrumbs(pathname);
  const { jobs } = useStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const running = jobs.filter((j) => j.status === "running");

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
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
      <div ref={ref} style={{ position: "relative" }}>
        <button className="jobs-trigger" onClick={() => setOpen((o) => !o)}>
          {running.length > 0 ? (
            <span className="pulse" />
          ) : (
            <span style={{ width: 7, height: 7, borderRadius: 999, background: "var(--border-strong)" }} />
          )}
          <span>Jobs</span>
          <span className="jobs-count">{running.length}</span>
        </button>
        {open && <JobsPopover />}
      </div>
    </header>
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
              <Link href={`/projects/${j.projectId}`} key={j.id}>
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
