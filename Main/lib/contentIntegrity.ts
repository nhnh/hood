const CHECK_INTERVAL = 7000;
const CRITICAL_SELECTORS = ['.drm-blur-overlay', '.drm-reader-container'];

export function startContentIntegrityCheck(onViolation: () => void): () => void {
    const intervalId = setInterval(() => {
        for (const sel of CRITICAL_SELECTORS) {
            const el = document.querySelector(sel);
            if (!el) continue;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) < 0.1) {
                onViolation();
                return;
            }
        }
    }, CHECK_INTERVAL);

    return () => clearInterval(intervalId);
}
