import { useState, useEffect } from "react";
import { subscribe, type ToastType } from "../lib/toast";

interface Toast {
    id: number;
    message: string;
    type: ToastType;
}

const bgColor: Record<ToastType, string> = {
    success: "#2e7d32",
    error: "#c62828",
    info: "#396cd8",
    warning: "#e65100",
};

export default function ToastContainer() {
    const [toasts, setToasts] = useState<Toast[]>([]);

    useEffect(() => {
        return subscribe(setToasts);
    }, []);

    if (toasts.length === 0) return null;

    return (
        <div style={{
            position: "fixed",
            bottom: "24px",
            right: "24px",
            zIndex: 99999,
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            pointerEvents: "none",
        }}>
            {toasts.map((t) => (
                <div
                    key={t.id}
                    style={{
                        backgroundColor: bgColor[t.type],
                        color: "#fff",
                        padding: "12px 20px",
                        borderRadius: "8px",
                        fontSize: "0.85rem",
                        fontWeight: 500,
                        boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
                        maxWidth: "360px",
                        pointerEvents: "auto",
                        animation: "toastIn 0.25s ease-out",
                    }}
                >
                    {t.message}
                </div>
            ))}
        </div>
    );
}
