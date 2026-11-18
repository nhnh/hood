const CHECK_INTERVAL = 2000;

export function startDevToolsDetection(onDetect: () => void): () => void {
    if (import.meta.env.DEV) {
        return () => {};
    }

    // debugger timing trick only works on desktop DevTools, not Android WebView
    if (/android/i.test(navigator.userAgent)) {
        return () => {};
    }

    const intervalId = setInterval(() => {
        const start = performance.now();
        debugger;
        const end = performance.now();
        if (end - start > 100) {
            onDetect();
        }
    }, CHECK_INTERVAL);

    return () => clearInterval(intervalId);
}
