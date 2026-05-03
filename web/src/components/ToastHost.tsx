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
            {t.body && <div className="toast-body">{t.body}</div>}
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
