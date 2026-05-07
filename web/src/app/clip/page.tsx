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
  return <ClipDetail projectId={projectId} clipId={clipId} />;
}

export default function ClipPage() {
  return (
    <Suspense fallback={null}>
      <ClipPageInner />
    </Suspense>
  );
}
