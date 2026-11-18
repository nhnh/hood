const OVERLAY_CHECK_INTERVAL = 60000;

export function startOverlayDetection(onOverlayDetected: () => void): () => void {
    const intervalId = setInterval(async () => {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const suspicious = devices.filter(
                (d) => d.kind === 'videoinput' && d.label.toLowerCase().includes('screen')
            );
            if (suspicious.length > 0) {
                onOverlayDetected();
            }
        } catch {
            /* permissions not granted — not a concern */
        }
    }, OVERLAY_CHECK_INTERVAL);

    return () => clearInterval(intervalId);
}
