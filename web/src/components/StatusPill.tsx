import type { ProjectStatus } from "@/lib/types";

export const StatusPill = ({ status }: { status: ProjectStatus }) => (
  <span className={`pill pill-${status.toLowerCase()}`}>
    <span className="dot" />
    {status}
  </span>
);
