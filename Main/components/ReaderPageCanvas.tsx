import { useEffect, useRef } from "react";
import { WATERMARK_OPACITY } from "../lib/pageWatermark";
import { applyForensicNoise } from "../lib/forensicNoise";
import ReaderPageWatermark from "./ReaderPageWatermark";
import type { PDFDocument } from "../types";

const SESSION_START = Date.now();

interface ReaderPageCanvasProps {
    pageNum: number;
    /** Final render width in CSS px (fit + zoom, clamped to viewport). */
    displayWidth: number;
    getPdfDoc: () => PDFDocument | null;
    isActive: boolean;
    onSelect: () => void;
    dragMovedRef: React.MutableRefObject<boolean>;
    watermarkLines: string[];
    watermarkCorner: string;
    style?: React.CSSProperties;
    alwaysVisible?: boolean;
    /** Unique user identifier for forensic noise seed derivation. */
    userIdForNoise?: string;
    /** Book identifier for forensic noise seed derivation. */
    bookIdForNoise?: string;
}

export default function ReaderPageCanvas({
    pageNum,
    displayWidth,
    getPdfDoc,
    isActive,
    onSelect,
    style,
    dragMovedRef,
    watermarkLines = [],
    watermarkCorner = "",
    alwaysVisible = true,
    userIdForNoise,
    bookIdForNoise,
}: ReaderPageCanvasProps) {
    const rootRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        if (!alwaysVisible || displayWidth < 1) return;

        let cancelled = false;
        let renderTask: { promise: Promise<void>; cancel: () => void } | null = null;
        const doc = getPdfDoc();
        const canvas = canvasRef.current;
        if (!doc || !canvas) return;

        (async () => {
            try {
                const pdfPage = await doc.getPage(pageNum);
                if (cancelled) return;
                const viewport = pdfPage.getViewport({ scale: 1 });
                const scale = displayWidth / viewport.width;
                const scaledViewport = pdfPage.getViewport({ scale });
                const ctx = canvas.getContext("2d");
                if (!ctx || cancelled) return;
                canvas.width = scaledViewport.width;
                canvas.height = scaledViewport.height;
                const task = pdfPage.render({ canvas, canvasContext: ctx, viewport: scaledViewport }) as { promise: Promise<void>; cancel: () => void };
                renderTask = task;
                await task.promise;
                if (userIdForNoise && bookIdForNoise) {
                    applyForensicNoise(
                        ctx,
                        canvas.width,
                        canvas.height,
                        `${userIdForNoise}-${bookIdForNoise}-${pageNum}-${SESSION_START}`
                    );
                }
            } catch (e) {
                if (!cancelled) console.error(`Failed to render page ${pageNum}`, e);
            }
        })();

        return () => {
            cancelled = true;
            if (renderTask) renderTask.cancel();
        };
    }, [alwaysVisible, displayWidth, pageNum, getPdfDoc]);

    return (
        <div
            ref={rootRef}
            id={`pdf-page-${pageNum}`}
            role="button"
            tabIndex={0}
            onClick={() => {
                if (!dragMovedRef.current) onSelect();
            }}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect();
                }
            }}
            className={`drm-page-block${isActive ? " active" : ""}`}
            style={{
                backgroundColor: "#ffffff",
                ...style,
            }}
        >
            <div className="drm-page-block-label">Page {pageNum}</div>
            <div
                className="drm-page-block-canvas-wrap"
                style={{ cursor: "grab", width: displayWidth > 0 ? displayWidth : undefined }}
            >
                <canvas
                    ref={canvasRef}
                    className="drm-canvas-protected"
                    style={{
                        width: displayWidth > 0 ? `${displayWidth}px` : "100%",
                        height: "auto",
                        display: "block",
                        pointerEvents: "none",
                    }}
                />
                {watermarkLines.length > 0 && (
                    <ReaderPageWatermark lines={watermarkLines} displayWidth={displayWidth} />
                )}
                {watermarkCorner ? (
                    <div
                        className="drm-page-corner-mark"
                        aria-hidden="true"
                        style={{
                            fontSize: `${Math.max(9, Math.min(13, displayWidth / 32))}px`,
                            opacity: WATERMARK_OPACITY,
                        }}
                    >
                        {watermarkCorner}
                    </div>
                ) : null}
            </div>
        </div>
    );
}
