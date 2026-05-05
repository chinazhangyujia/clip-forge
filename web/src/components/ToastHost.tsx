"use client";

import { useStore } from "@/lib/store";
import { Icon } from "@/lib/icons";

export const ToastHost = () => {
  const { toasts, dismissToast } = useStore();
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind || "info"}`}>
          <span className="toast-icon">
            {t.kind === "success" ? (
              <Icon name="check" size={18} />
            ) : t.kind === "error" ? (
              <Icon name="alert" size={18} />
            ) : (
              <Icon name="info" size={18} />
            )}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="toast-title">{t.title}</div>
            {t.body && (
              <div className="toast-body" style={{ wordBreak: "break-word" }}>
                {t.body}
              </div>
            )}
            {t.action && (
              <button
                onClick={() => {
                  t.action?.onClick?.();
                  dismissToast(t.id);
                }}
                style={{
                  marginTop: 6,
                  marginLeft: -8,
                  padding: "3px 8px",
                  fontSize: 12,
                  fontWeight: 500,
                  borderRadius: 4,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  color:
                    t.kind === "error"
                      ? "var(--red)"
                      : t.kind === "success"
                        ? "oklch(0.42 0.13 155)"
                        : "var(--accent)",
                }}
              >
                {t.action.label}
                <Icon name="chevron" size={11} />
              </button>
            )}
          </div>
          <button
            className="btn-ghost btn-sm btn-icon"
            onClick={() => dismissToast(t.id)}
            style={{ height: 22, width: 22, color: "var(--fg-faint)" }}
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
};
