"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ProjectDetail } from "@/components/screens/ProjectDetail";

function ProjectPageInner() {
  const id = useSearchParams().get("id");
  if (!id) {
    return (
      <div className="page">
        <div className="card" style={{ padding: 32, textAlign: "center", color: "var(--fg-muted)" }}>
          Missing project id.
          <div style={{ marginTop: 16 }}>
            <Link href="/" className="btn">Back to projects</Link>
          </div>
        </div>
      </div>
    );
  }
  return <ProjectDetail projectId={id} />;
}

export default function ProjectPage() {
  return (
    <Suspense fallback={null}>
      <ProjectPageInner />
    </Suspense>
  );
}
