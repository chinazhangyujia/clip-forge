"use client";

// Project-wide auto-cuts report. Lives on the Project Detail screen as a
// collapsed-by-default card above the Clips grid; expands to a sortable,
// reason-filterable list. Two row variants by reason — pause shows a
// before/after excerpt pair framing the silence; filler shows a single
// excerpt with the removed token marked. Cuts that fall in regions the
// LLM didn't promote into a clip render fully but are non-navigable.
//
// Re-uses REASON_META + ReasonGlyph from Cuts.tsx so the colour and
// glyph language matches the per-clip transcript dividers and scrubber
// ticks.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { REASON_META, ReasonGlyph } from "@/components/Cuts";
import { Icon } from "@/lib/icons";
import type { CutReason, Project, ProjectCut } from "@/lib/types";

const KNOWN_REASONS: ReadonlyArray<CutReason> = [
  "pause",
  "filler",
  "repeat",
  "lowvalue",
];

const normalizeReason = (raw: string): CutReason =>
  (KNOWN_REASONS as readonly string[]).includes(raw)
    ? (raw as CutReason)
    : "lowvalue";

// ---------- formatting helpers ----------

const fmtSourceTime = (sec: number): string => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const sStr = s.toFixed(1).padStart(4, "0");
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${sStr}`;
  return `${m}:${sStr}`;
};

const fmtElapsed = (sec: number): string => {
  const total = Math.round(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h}h`);
  if (m || h) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
};

// ---------- chips ----------

const ReasonChip = ({
  reason,
  faded,
}: {
  reason: CutReason;
  faded: boolean;
}) => {
  const m = REASON_META[reason];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        height: 22,
        padding: "0 9px 0 7px",
        borderRadius: 999,
        background: faded ? "var(--bg-sunken)" : m.soft,
        border: `1px solid ${faded ? "var(--border)" : m.border}`,
        color: faded ? "var(--fg-muted)" : m.fg,
        fontSize: 11.5,
        fontWeight: 500,
        letterSpacing: 0.01,
        flexShrink: 0,
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          display: "inline-flex",
          color: faded ? "var(--fg-faint)" : m.accent,
        }}
      >
        <ReasonGlyph reason={reason} size={11} />
      </span>
      {m.label}
    </span>
  );
};

const FilterChip = ({
  active,
  onClick,
  label,
  count,
  reason,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  reason?: CutReason;
}) => {
  const m = reason ? REASON_META[reason] : null;
  return (
    <button
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        height: 28,
        padding: "0 11px 0 9px",
        borderRadius: 999,
        background: active ? (m ? m.soft : "var(--fg)") : "var(--bg-elev)",
        border: `1px solid ${active ? (m ? m.border : "var(--fg)") : "var(--border)"}`,
        color: active ? (m ? m.fg : "var(--bg-elev)") : "var(--fg-muted)",
        fontSize: 12.5,
        fontWeight: 500,
        letterSpacing: 0.01,
        cursor: "pointer",
        transition: "all .12s",
        whiteSpace: "nowrap",
      }}
    >
      {reason && m && (
        <span
          style={{
            display: "inline-flex",
            color: active ? m.accent : "var(--fg-faint)",
          }}
        >
          <ReasonGlyph reason={reason} size={11} />
        </span>
      )}
      {label}
      <span
        className="mono"
        style={{
          fontVariantNumeric: "tabular-nums",
          fontSize: 11,
          fontWeight: 500,
          color: active
            ? m
              ? m.accent
              : "oklch(1 0 0 / 0.7)"
            : "var(--fg-faint)",
        }}
      >
        {count}
      </span>
    </button>
  );
};

// ---------- row chrome ----------

const ChevronRight = ({ size = 10 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="9 6 15 12 9 18" />
  </svg>
);

const RowAffordance = ({
  navigable,
  hover,
}: {
  navigable: boolean;
  hover: boolean;
}) => {
  if (!navigable) {
    return (
      <span
        title="This region wasn't included in any auto-generated clip."
        style={{
          fontSize: 11,
          color: "var(--fg-faint)",
          fontStyle: "italic",
          letterSpacing: 0.01,
          flexShrink: 0,
          padding: "0 4px",
          whiteSpace: "nowrap",
        }}
      >
        outside any clip
      </span>
    );
  }
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        color: hover ? "var(--accent)" : "var(--fg-faint)",
        fontSize: 11.5,
        fontWeight: 500,
        flexShrink: 0,
        transition: "color .1s, transform .1s",
        transform: hover ? "translateX(1px)" : "none",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ opacity: hover ? 1 : 0 }}>Open</span>
      <ChevronRight size={13} />
    </span>
  );
};

const CutRowShell = ({
  cut,
  onClick,
  navigable,
  children,
}: {
  cut: ProjectCut;
  onClick: () => void;
  navigable: boolean;
  children: React.ReactNode;
}) => {
  const [hover, setHover] = useState(false);
  const reason = normalizeReason(cut.reason);
  return (
    <div
      role={navigable ? "button" : undefined}
      tabIndex={navigable ? 0 : -1}
      onClick={navigable ? onClick : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onKeyDown={(e) => {
        if (!navigable) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "11px 16px",
        borderBottom: "1px solid var(--border)",
        cursor: navigable ? "pointer" : "default",
        background: navigable && hover ? "var(--bg-sunken)" : "transparent",
        transition: "background .1s",
      }}
    >
      <ReasonChip reason={reason} faded={!navigable} />
      <span
        className="mono"
        style={{
          fontSize: 11.5,
          color: navigable ? "var(--fg)" : "var(--fg-muted)",
          fontVariantNumeric: "tabular-nums",
          width: 72,
          flexShrink: 0,
        }}
        title="Source timestamp"
      >
        {fmtSourceTime(cut.sourceSec)}
      </span>
      <span
        className="mono"
        style={{
          fontSize: 11.5,
          color: "var(--fg-faint)",
          fontVariantNumeric: "tabular-nums",
          width: 44,
          flexShrink: 0,
          textAlign: "right",
        }}
        title="Time removed"
      >
        −{cut.removedSec.toFixed(1)}s
      </span>
      {children}
      <RowAffordance navigable={navigable} hover={hover} />
    </div>
  );
};

// ---------- pause row ----------

const ExcerptText = ({
  text,
  align,
}: {
  text: string;
  align: "left" | "right";
}) => (
  <span
    style={{
      flex: 1,
      minWidth: 0,
      color: "var(--fg-muted)",
      fontStyle: "italic",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      textAlign: align,
      direction: align === "right" ? "rtl" : "ltr",
    }}
    title={text}
  >
    {/* bdi keeps the text laying out LTR even though the container's
     * direction flips to RTL — the only effect of the flip is that
     * overflow ellipsis truncates from the *left* on the pre-pause
     * excerpt, which is what we want (we keep the words *closest* to
     * the cut). */}
    <bdi style={{ unicodeBidi: "plaintext" }}>{text}</bdi>
  </span>
);

const PauseConnector = ({
  accent,
  removedSec,
}: {
  accent: string;
  removedSec: number;
}) => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
      flexShrink: 0,
      color: "var(--fg-faint)",
      fontSize: 11,
      padding: "2px 6px",
      borderRadius: 4,
      background: "var(--bg-sunken)",
      border: "1px dashed var(--border)",
    }}
  >
    <ChevronRight size={10} />
    <span style={{ display: "inline-flex", color: accent, opacity: 0.85 }}>
      <ReasonGlyph reason="pause" size={10} />
    </span>
    <span className="mono" style={{ fontVariantNumeric: "tabular-nums" }}>
      {removedSec.toFixed(1)}s
    </span>
    <ChevronRight size={10} />
  </span>
);

const PauseRow = ({
  cut,
  onClick,
  navigable,
}: {
  cut: ProjectCut;
  onClick: () => void;
  navigable: boolean;
}) => {
  const m = REASON_META.pause;
  return (
    <CutRowShell cut={cut} onClick={onClick} navigable={navigable}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flex: 1,
          minWidth: 0,
          fontSize: 13,
          lineHeight: 1.45,
        }}
      >
        <ExcerptText text={cut.pre} align="right" />
        <PauseConnector accent={m.accent} removedSec={cut.removedSec} />
        <ExcerptText text={cut.post} align="left" />
      </div>
    </CutRowShell>
  );
};

// ---------- filler row ----------

const FillerRow = ({
  cut,
  onClick,
  navigable,
}: {
  cut: ProjectCut;
  onClick: () => void;
  navigable: boolean;
}) => {
  const reason = normalizeReason(cut.reason);
  const m = REASON_META[reason];
  return (
    <CutRowShell cut={cut} onClick={onClick} navigable={navigable}>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 13,
          lineHeight: 1.45,
          color: "var(--fg-muted)",
          fontStyle: "italic",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={`${cut.pre} ${cut.word ?? ""} ${cut.post}`}
      >
        <span aria-hidden="true" style={{ color: "var(--fg-faint)" }}>
          {"“"}
        </span>
        …{cut.pre}{" "}
        {cut.word ? (
          <span
            style={{
              color: m.fg,
              background: m.soft,
              padding: "1px 5px",
              borderRadius: 3,
              fontWeight: 500,
              fontStyle: "normal",
              textDecoration: "line-through",
              textDecorationColor: m.accent,
              textDecorationThickness: "1.5px",
            }}
          >
            {cut.word}
          </span>
        ) : null}{" "}
        {cut.post}…
        <span aria-hidden="true" style={{ color: "var(--fg-faint)" }}>
          {"”"}
        </span>
      </span>
    </CutRowShell>
  );
};

// ---------- sort dropdown ----------

type SortKey = "source" | "longest";

const SortControl = ({
  value,
  onChange,
}: {
  value: SortKey;
  onChange: (v: SortKey) => void;
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  const options: { value: SortKey; label: string }[] = [
    { value: "source", label: "Source time" },
    { value: "longest", label: "Longest first" },
  ];
  const cur = options.find((o) => o.value === value)!;
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          height: 28,
          padding: "0 8px 0 10px",
          borderRadius: 999,
          border: "1px solid var(--border)",
          background: "var(--bg-elev)",
          color: "var(--fg-muted)",
          fontSize: 12,
          cursor: "pointer",
        }}
      >
        <span style={{ color: "var(--fg-faint)" }}>Sort:</span>
        <span style={{ color: "var(--fg)", fontWeight: 500 }}>{cur.label}</span>
        <span
          style={{
            color: "var(--fg-faint)",
            display: "inline-flex",
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform .12s",
          }}
        >
          <Icon name="chevronDown" size={11} />
        </span>
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            right: 0,
            background: "var(--bg-elev)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            boxShadow: "var(--shadow-lg)",
            zIndex: 5,
            minWidth: 160,
            overflow: "hidden",
          }}
        >
          {options.map((o) => (
            <button
              key={o.value}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              style={{
                display: "flex",
                width: "100%",
                padding: "8px 12px",
                alignItems: "center",
                justifyContent: "space-between",
                fontSize: 12.5,
                color: o.value === value ? "var(--fg)" : "var(--fg-muted)",
                fontWeight: o.value === value ? 500 : 400,
                background: o.value === value ? "var(--bg-sunken)" : "transparent",
                border: "none",
                cursor: "pointer",
              }}
            >
              {o.label}
              {o.value === value && (
                <span style={{ color: "var(--accent)" }}>
                  <Icon name="check" size={12} />
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ---------- header ----------

const ScissorsIcon = ({ size = 14 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="6" cy="7" r="2.5" />
    <circle cx="6" cy="17" r="2.5" />
    <line x1="8" y1="8.5" x2="20" y2="16" />
    <line x1="8" y1="15.5" x2="20" y2="8" />
  </svg>
);

const ReportHeader = ({
  cuts,
  expanded,
  onToggle,
}: {
  cuts: ProjectCut[];
  expanded: boolean;
  onToggle: () => void;
}) => {
  const totalRemoved = cuts.reduce((sum, c) => sum + c.removedSec, 0);
  return (
    <button
      onClick={onToggle}
      onMouseEnter={(e) => {
        if (!expanded) e.currentTarget.style.background = "var(--bg-sunken)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "14px 16px",
        background: "transparent",
        border: "none",
        borderBottom: expanded ? "1px solid var(--border)" : "none",
        textAlign: "left",
        cursor: "pointer",
        borderRadius: expanded ? "var(--radius-lg) var(--radius-lg) 0 0" : "var(--radius-lg)",
        transition: "background .12s",
      }}
    >
      <span
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: "var(--bg-sunken)",
          border: "1px solid var(--border)",
          display: "grid",
          placeItems: "center",
          color: "var(--fg-muted)",
          flexShrink: 0,
        }}
      >
        <ScissorsIcon size={15} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            letterSpacing: "-0.005em",
            color: "var(--fg)",
          }}
        >
          Auto-cuts
        </div>
        <div style={{ fontSize: 12, color: "var(--fg-muted)", marginTop: 2 }}>
          {cuts.length === 0 ? (
            "No cuts produced"
          ) : (
            <>
              <span style={{ fontWeight: 500, color: "var(--fg)" }}>
                <span className="mono" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {cuts.length}
                </span>{" "}
                auto-cuts
              </span>
              {" · "}
              <span className="mono" style={{ fontVariantNumeric: "tabular-nums" }}>
                {fmtElapsed(totalRemoved)}
              </span>{" "}
              removed across the source
            </>
          )}
        </div>
      </div>
      <span
        style={{
          fontSize: 11.5,
          color: "var(--fg-faint)",
          fontWeight: 500,
          letterSpacing: 0.02,
          textTransform: "uppercase",
          marginRight: 4,
        }}
      >
        {expanded ? "Hide" : "View report"}
      </span>
      <span
        style={{
          color: "var(--fg-muted)",
          display: "inline-flex",
          transform: expanded ? "rotate(180deg)" : "none",
          transition: "transform .15s",
        }}
      >
        <Icon name="chevronDown" size={16} />
      </span>
    </button>
  );
};

// ---------- empty states ----------

const ZeroCuts = () => (
  <div
    style={{
      padding: "28px 20px",
      textAlign: "center",
      color: "var(--fg-muted)",
      fontSize: 13,
      background: "var(--bg-sunken)",
    }}
  >
    No auto-cuts in this project — the source ran clean.
  </div>
);

const FilteredEmpty = () => (
  <div
    style={{
      padding: "28px 20px",
      textAlign: "center",
      color: "var(--fg-muted)",
      fontSize: 13,
    }}
  >
    No cuts of this type.
  </div>
);

// ---------- body ----------

const ReportBody = ({
  cuts,
  projectId,
}: {
  cuts: ProjectCut[];
  projectId: string;
}) => {
  const router = useRouter();
  const [filter, setFilter] = useState<"all" | CutReason>("all");
  const [sort, setSort] = useState<SortKey>("source");

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: cuts.length };
    for (const cut of cuts) {
      const r = normalizeReason(cut.reason);
      c[r] = (c[r] || 0) + 1;
    }
    return c;
  }, [cuts]);

  const reasonOrder = useMemo<CutReason[]>(() => {
    const seen = (Object.keys(counts).filter((k) => k !== "all") as CutReason[]);
    const preferred: CutReason[] = ["pause", "filler", "repeat", "lowvalue"];
    return [
      ...preferred.filter((k) => seen.includes(k)),
      ...seen.filter((k) => !preferred.includes(k)),
    ];
  }, [counts]);

  const visible = useMemo(() => {
    let arr = cuts;
    if (filter !== "all") {
      arr = arr.filter((c) => normalizeReason(c.reason) === filter);
    }
    arr = [...arr].sort((a, b) => {
      if (sort === "longest") return b.removedSec - a.removedSec;
      return a.sourceSec - b.sourceSec;
    });
    return arr;
  }, [cuts, filter, sort]);

  const navigateToCut = (cut: ProjectCut) => {
    if (!cut.clipId) return;
    // Production routes use /clip?project=…&clip=…  (per requirements:
    // App Router static export needs query-param routing for runtime IDs).
    const params = new URLSearchParams({
      project: projectId,
      clip: cut.clipId,
      at: cut.sourceSec.toString(),
      cut: cut.id,
    });
    router.push(`/clip?${params.toString()}`);
  };

  return (
    <div>
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 1,
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          padding: "12px 16px",
          background: "var(--bg-elev)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <FilterChip
          active={filter === "all"}
          onClick={() => setFilter("all")}
          label="All"
          count={counts.all}
        />
        {reasonOrder.map((reason) => (
          <FilterChip
            key={reason}
            active={filter === reason}
            onClick={() => setFilter(reason)}
            label={REASON_META[reason].plural}
            count={counts[reason] ?? 0}
            reason={reason}
          />
        ))}
        <span style={{ flex: 1 }} />
        <SortControl value={sort} onChange={setSort} />
      </div>

      <div style={{ maxHeight: 540, overflowY: "auto" }}>
        {visible.length === 0 ? (
          <FilteredEmpty />
        ) : (
          visible.map((cut) =>
            normalizeReason(cut.reason) === "filler" ? (
              <FillerRow
                key={cut.id}
                cut={cut}
                navigable={!!cut.clipId}
                onClick={() => navigateToCut(cut)}
              />
            ) : (
              <PauseRow
                key={cut.id}
                cut={cut}
                navigable={!!cut.clipId}
                onClick={() => navigateToCut(cut)}
              />
            ),
          )
        )}
      </div>
    </div>
  );
};

// ---------- top-level ----------

export const CutReport = ({
  project,
  cuts,
}: {
  project: Project;
  cuts: ProjectCut[];
}) => {
  const [expanded, setExpanded] = useState(false);
  // Hidden until the cut stage finishes — there's no data to show until
  // the auto-cutter has run.
  if (project.pipeline?.cut !== "done") return null;

  return (
    <section
      className="card"
      style={{ marginBottom: 20, overflow: "hidden" }}
      aria-label="Auto-cuts report"
    >
      <ReportHeader
        cuts={cuts}
        expanded={expanded}
        onToggle={() => setExpanded((e) => !e)}
      />
      {expanded &&
        (cuts.length === 0 ? (
          <ZeroCuts />
        ) : (
          <ReportBody cuts={cuts} projectId={project.id} />
        ))}
    </section>
  );
};
