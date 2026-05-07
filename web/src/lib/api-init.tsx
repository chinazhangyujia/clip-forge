"use client";

import { useEffect, useState, type ReactNode } from "react";
import { initApi } from "./api";

/**
 * Resolves the runtime backend URL (Tauri-aware) before rendering children.
 *
 * In `npm run dev` (no Tauri), `initApi` is a no-op and `ready` flips on the
 * next tick, so this is effectively transparent. In the desktop bundle it
 * waits for the Rust shell's `get_backend_url` command to return the port
 * the FastAPI sidecar picked.
 */
export function ApiInitGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let mounted = true;
    initApi().then(() => {
      if (mounted) {
        setReady(true);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);
  if (!ready) return null;
  return <>{children}</>;
}
