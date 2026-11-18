export const WATERMARK_OPACITY = 0.15;

export function buildWatermarkLabel(lines: string[]): string {
    return lines.filter(Boolean).join(" · ");
}


