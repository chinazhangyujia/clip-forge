"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ClipDetail } from "@/components/screens/ClipDetail";

function ClipPageInner() {
  const params = useSearchParams();
  const projectId = params.get("project");
  const clipId = params.get("clip");
  if (!projectId || !clipId) {
    return (
      <div className="page">
        <div className="card" style={{ padding: 32, textAlign: "center", color: "var(--fg-muted)" }}>
          Missing clip parameters.
          <div style={{ marginTop: 16 }}>
            <Link href="/" className="btn">Back to projects</Link>
          </div>
        </div>
      </div>
    );
  }
  // Optional deep-link hint from the project Auto-cuts report — `at` is
  // a source-time second; `cut` is the row id we landed from. ClipDetail
  // seeks the player and shows a one-shot landing pill. Both keys are
  // ignored when missing.
  const at = params.get("at");
  const cutId = params.get("cut");
  const hint =
    at != null && cutId != null
      ? { at: parseFloat(at), cut: cutId }
      : undefined;
  return <ClipDetail projectId={projectId} clipId={clipId} hint={hint} />;
}

export default function ClipPage() {
  return (
    <Suspense fallback={null}>
      <ClipPageInner />
    </Suspense>
  );
}
