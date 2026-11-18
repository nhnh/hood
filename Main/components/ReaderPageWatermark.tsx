import { buildWatermarkLabel, WATERMARK_OPACITY } from "../lib/pageWatermark";

interface ReaderPageWatermarkProps {
    lines: string[];
    displayWidth: number;
}

export default function ReaderPageWatermark({ lines, displayWidth }: ReaderPageWatermarkProps) {
    const label = buildWatermarkLabel(lines);
    if (!label || displayWidth < 1) return null;

    const fontSize = Math.max(11, Math.min(16, displayWidth / 26));
    const rowHeight = fontSize * 7;

    const tiles = Array.from({ length: 18 }, (_, i) => (
        <span
            key={i}
            className="drm-watermark-tile"
            style={{ fontSize: `${fontSize}px`, minHeight: `${rowHeight}px` }}
        >
            {label}
        </span>
    ));

    return (
        <div className="drm-page-watermark" style={{ opacity: WATERMARK_OPACITY }} aria-hidden="true">
            {tiles}
        </div>
    );
}
