"""File-based DataStore for local dev.

Tables are JSON arrays under `<db_dir>/{projects,clips,jobs}.json`.
A single asyncio.Lock guards all writes so concurrent worker + HTTP requests
don't corrupt files. Writes go to a tmp file then rename for atomicity.

This is intentionally simple — fine for one local user, not for production.
"""

from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path
from typing import Any

from .base import ClipRow, DataStore, JobRow, ProjectRow


def _now_ms() -> int:
    return int(time.time() * 1000)


class LocalFileDataStore(DataStore):
    def __init__(self, db_dir: Path):
        self.db_dir = db_dir
        self._lock = asyncio.Lock()

    async def init(self) -> None:
        self.db_dir.mkdir(parents=True, exist_ok=True)
        for table in ("projects", "clips", "jobs"):
            f = self._path(table)
            if not f.exists():
                f.write_text("[]", encoding="utf-8")

    async def close(self) -> None:
        pass

    def _path(self, table: str) -> Path:
        return self.db_dir / f"{table}.json"

    def _read(self, table: str) -> list[dict[str, Any]]:
        # utf-8-sig (not bare utf-8) so a stray BOM at the start of the file
        # is stripped on read instead of becoming a literal ﻿ that json
        # then chokes on at "char 0". A BOM can arrive from Notepad-on-
        # Windows resaves, antivirus rewrites, or files imported from
        # external editors — none of which we write, but all of which can
        # touch the user's data dir.
        #
        # encoding handling is otherwise load-bearing on Windows: Path.read_text
        # without an explicit encoding uses the platform locale (gbk on
        # Chinese Windows, cp1252 on English), which silently round-trips
        # fine until project titles or transcripts contain non-ASCII
        # characters that the locale can't represent — then writes raise
        # UnicodeEncodeError and reads produce mojibake.
        path = self._path(table)
        raw = path.read_text(encoding="utf-8-sig")
        # `.strip() or "[]"` catches both truly empty and whitespace-only
        # files. Pre-fix code only checked truthiness, so a file containing
        # a single newline fell through to `json.loads("\n")` and crashed.
        text = raw.strip() or "[]"
        try:
            return json.loads(text)
        except json.JSONDecodeError as e:
            # Self-contained diagnostic: include the path, the parser's
            # position, and a clipped hex+repr snippet of the actual bytes.
            # On the desktop bundle this exception bubbles through the
            # generic exception handler in main.py and lands in the
            # frontend error modal — without the snippet there's no way
            # to tell whether the file has a BOM, garbage bytes, or got
            # truncated.
            snippet = text[: min(len(text), 200)]
            byte_preview = path.read_bytes()[:32].hex(" ")
            raise RuntimeError(
                f"Datastore table {path.name} at {path} is not valid JSON "
                f"({e.msg} at line {e.lineno} col {e.colno}). "
                f"First 32 bytes: {byte_preview}. "
                f"Decoded prefix: {snippet!r}"
            ) from e

    def _write(self, table: str, rows: list[dict[str, Any]]) -> None:
        path = self._path(table)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(
            json.dumps(rows, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        tmp.replace(path)

    # ---------- projects ----------

    async def insert_project(self, project: ProjectRow) -> None:
        async with self._lock:
            rows = self._read("projects")
            rows.append(project.model_dump())
            self._write("projects", rows)

    async def get_project(self, project_id: str) -> ProjectRow | None:
        async with self._lock:
            rows = self._read("projects")
        for r in rows:
            if r["id"] == project_id:
                return ProjectRow(**r)
        return None

    async def list_projects(self) -> list[ProjectRow]:
        async with self._lock:
            rows = self._read("projects")
        rows.sort(key=lambda r: r.get("updated_at", 0), reverse=True)
        return [ProjectRow(**r) for r in rows]

    async def update_project(
        self, project_id: str, fields: dict[str, Any]
    ) -> ProjectRow | None:
        async with self._lock:
            rows = self._read("projects")
            for r in rows:
                if r["id"] == project_id:
                    r.update(fields)
                    self._write("projects", rows)
                    return ProjectRow(**r)
        return None

    async def delete_project(self, project_id: str) -> None:
        async with self._lock:
            for table, key in (
                ("projects", "id"),
                ("clips", "project_id"),
                ("jobs", "project_id"),
            ):
                rows = self._read(table)
                rows = [r for r in rows if r.get(key) != project_id]
                self._write(table, rows)

    async def count_clips(self, project_id: str) -> int:
        async with self._lock:
            rows = self._read("clips")
        return sum(1 for r in rows if r.get("project_id") == project_id)

    # ---------- clips ----------

    async def insert_clips(self, clips: list[ClipRow]) -> None:
        if not clips:
            return
        async with self._lock:
            rows = self._read("clips")
            rows.extend(c.model_dump() for c in clips)
            self._write("clips", rows)

    async def get_clip(self, clip_id: str) -> ClipRow | None:
        async with self._lock:
            rows = self._read("clips")
        for r in rows:
            if r["id"] == clip_id:
                return ClipRow(**r)
        return None

    async def list_clips(self, project_id: str) -> list[ClipRow]:
        async with self._lock:
            rows = self._read("clips")
        rows = [r for r in rows if r["project_id"] == project_id]
        rows.sort(key=lambda r: r.get("start_sec", 0))
        return [ClipRow(**r) for r in rows]

    async def update_clip(
        self, clip_id: str, fields: dict[str, Any]
    ) -> ClipRow | None:
        async with self._lock:
            rows = self._read("clips")
            for r in rows:
                if r["id"] == clip_id:
                    r.update(fields)
                    self._write("clips", rows)
                    return ClipRow(**r)
        return None

    async def delete_clips_for_project(self, project_id: str) -> None:
        async with self._lock:
            rows = self._read("clips")
            rows = [r for r in rows if r["project_id"] != project_id]
            self._write("clips", rows)

    # ---------- jobs ----------

    async def enqueue_job(self, job: JobRow) -> None:
        async with self._lock:
            rows = self._read("jobs")
            rows.append(job.model_dump())
            self._write("jobs", rows)

    async def claim_next_pending_job(self) -> JobRow | None:
        async with self._lock:
            rows = self._read("jobs")
            target_idx: int | None = None
            target_created: int | None = None
            for i, r in enumerate(rows):
                if r["status"] != "pending":
                    continue
                if target_created is None or r["created_at"] < target_created:
                    target_idx = i
                    target_created = r["created_at"]
            if target_idx is None:
                return None
            rows[target_idx]["status"] = "running"
            rows[target_idx]["started_at"] = _now_ms()
            self._write("jobs", rows)
            return JobRow(**rows[target_idx])

    async def mark_job_done(self, job_id: str) -> None:
        async with self._lock:
            rows = self._read("jobs")
            for r in rows:
                if r["id"] == job_id:
                    r["status"] = "done"
                    r["finished_at"] = _now_ms()
                    break
            self._write("jobs", rows)

    async def mark_job_failed(self, job_id: str, error: str) -> None:
        async with self._lock:
            rows = self._read("jobs")
            for r in rows:
                if r["id"] == job_id:
                    r["status"] = "failed"
                    r["error"] = error
                    r["finished_at"] = _now_ms()
                    break
            self._write("jobs", rows)
