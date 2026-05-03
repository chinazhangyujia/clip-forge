import type { ReactElement } from "react";

export type IconName =
  | "plus"
  | "check"
  | "x"
  | "upload"
  | "play"
  | "pause"
  | "chevron"
  | "chevronDown"
  | "chevronLeft"
  | "refresh"
  | "download"
  | "trash"
  | "open"
  | "edit"
  | "sparkle"
  | "file"
  | "folder"
  | "video"
  | "captions"
  | "crop"
  | "bell"
  | "info"
  | "alert"
  | "spinner"
  | "clock"
  | "image"
  | "tag"
  | "grid"
  | "moreH"
  | "search";

const PATHS: Record<IconName, ReactElement> = {
  plus: (
    <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </>
  ),
  check: <polyline points="4 12 10 18 20 6" />,
  x: (
    <>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="6" y1="18" x2="18" y2="6" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4" />
      <polyline points="6 10 12 4 18 10" />
      <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
    </>
  ),
  play: <polygon points="6 4 20 12 6 20 6 4" fill="currentColor" />,
  pause: (
    <>
      <rect x="6" y="4" width="4" height="16" />
      <rect x="14" y="4" width="4" height="16" />
    </>
  ),
  chevron: <polyline points="9 6 15 12 9 18" />,
  chevronDown: <polyline points="6 9 12 15 18 9" />,
  chevronLeft: <polyline points="15 6 9 12 15 18" />,
  refresh: (
    <>
      <polyline points="20 4 20 10 14 10" />
      <path d="M20 10A8 8 0 1 0 18 16" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v12" />
      <polyline points="6 10 12 16 18 10" />
      <path d="M4 20h16" />
    </>
  ),
  trash: (
    <>
      <polyline points="3 6 21 6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </>
  ),
  open: (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4l-9 9" />
      <path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
    </>
  ),
  edit: <path d="M4 20h4l10-10-4-4L4 16v4z" />,
  sparkle: <path d="M12 3l1.5 5L18 9.5 13.5 11 12 16l-1.5-5L6 9.5 10.5 8 12 3z" />,
  file: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </>
  ),
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />,
  video: (
    <>
      <rect x="2" y="6" width="14" height="12" rx="2" />
      <polygon points="22 8 16 12 22 16 22 8" fill="currentColor" />
    </>
  ),
  captions: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 12h3" />
      <path d="M14 12h3" />
      <path d="M7 15h2" />
      <path d="M11 15h6" />
    </>
  ),
  crop: (
    <>
      <path d="M6 2v16a2 2 0 0 0 2 2h14" />
      <path d="M2 6h16a2 2 0 0 1 2 2v14" />
    </>
  ),
  bell: (
    <>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9z" />
      <path d="M10 21a2 2 0 0 0 4 0" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8h.01" />
      <path d="M11 12h1v4h1" />
    </>
  ),
  alert: (
    <>
      <path d="M12 2L2 20h20L12 2z" />
      <path d="M12 9v5" />
      <path d="M12 17h.01" />
    </>
  ),
  spinner: <circle cx="12" cy="12" r="9" strokeDasharray="40 60" strokeLinecap="round" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 14" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="M21 15l-5-5L5 21" />
    </>
  ),
  tag: (
    <>
      <path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9z" />
      <circle cx="8" cy="8" r="1.5" fill="currentColor" />
    </>
  ),
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
    </>
  ),
  moreH: (
    <>
      <circle cx="5" cy="12" r="1.5" fill="currentColor" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      <circle cx="19" cy="12" r="1.5" fill="currentColor" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <line x1="16.5" y1="16.5" x2="21" y2="21" />
    </>
  ),
};

export const Icon = ({
  name,
  size = 16,
  ...rest
}: { name: IconName; size?: number } & Omit<React.SVGProps<SVGSVGElement>, "name">) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.75}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...rest}
  >
    {PATHS[name]}
  </svg>
);

export const Spinner = ({ size = 14 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.5}
    style={{ animation: "spin 0.9s linear infinite" }}
  >
    <circle cx="12" cy="12" r="9" strokeDasharray="40 60" strokeLinecap="round" />
  </svg>
);
