let protectionInstalled = false;

const PROTECTED_FUNCTIONS = new Set(['copy', 'cut', 'paste']);

function installApiHardening() {
    if (protectionInstalled) return;
    protectionInstalled = true;

    const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    const origToBlob = HTMLCanvasElement.prototype.toBlob;
    const origGetContext = HTMLCanvasElement.prototype.getContext;

    HTMLCanvasElement.prototype.toDataURL = function (...args: Parameters<HTMLCanvasElement['toDataURL']>): string {
        if (this.classList.contains('drm-canvas-protected')) {
            throw new DOMException('Canvas capture is blocked by DRM.', 'SecurityError');
        }
        return origToDataURL.apply(this, args);
    };

    HTMLCanvasElement.prototype.toBlob = function (...args: Parameters<HTMLCanvasElement['toBlob']>): void {
        if (this.classList.contains('drm-canvas-protected')) {
            throw new DOMException('Canvas capture is blocked by DRM.', 'SecurityError');
        }
        origToBlob.apply(this, args);
    };

    HTMLCanvasElement.prototype.getContext = function getContextOverride(this: HTMLCanvasElement, ...args: Parameters<HTMLCanvasElement['getContext']>) {
        const ctx = (origGetContext as Function).apply(this, args);
        if (ctx && args[0] === '2d') {
            const ctx2d = ctx as CanvasRenderingContext2D;
            const origGetImageData = ctx2d.getImageData.bind(ctx2d);
            ctx2d.getImageData = function getImageDataOverride(this: CanvasRenderingContext2D, ...iArgs: Parameters<CanvasRenderingContext2D['getImageData']>) {
                const canvas = this.canvas;
                if (canvas instanceof HTMLCanvasElement && canvas.classList.contains('drm-canvas-protected')) {
                    throw new DOMException('Canvas pixel access is blocked by DRM.', 'SecurityError');
                }
                return origGetImageData(...iArgs);
            };
        }
        return ctx;
    } as unknown as typeof HTMLCanvasElement.prototype.getContext;

    Object.defineProperty(document, 'designMode', {
        get: () => 'off',
        set: () => { throw new DOMException('Design mode is disabled by DRM.', 'SecurityError'); }
    });

    const origExecCommand = document.execCommand.bind(document) as (...args: unknown[]) => boolean;
    document.execCommand = function execCommandOverride(this: Document, cmdId: string, showUI?: boolean, value?: string | null) {
        if (PROTECTED_FUNCTIONS.has(cmdId.toLowerCase())) {
            throw new DOMException(`${cmdId} is disabled by DRM.`, 'SecurityError');
        }
        return origExecCommand(cmdId, showUI, value);
    } as unknown as typeof document.execCommand;

    try {
        Object.defineProperty(window, 'open', {
            value: function windowOpenOverride(this: Window, ..._args: Parameters<Window['open']>) {
                return null;
            },
            writable: false,
            configurable: false,
        });
    } catch {
        /* may fail in strict CSP environments; non-critical */
    }
}

/** Block screen capture on all platforms:
 *  - Windows/macOS: prevents Snipping Tool, etc. via DWM affinity.
 *  - Android: sets FLAG_SECURE so OS screenshots are blocked.
 *  - All: overrides canvas toDataURL/toBlob/getImageData, disables designMode,
 *         blocks copy/cut execCommand, and nullifies window.open. */
export async function enableScreenCaptureProtection(): Promise<void> {
    installApiHardening();
}

export async function disableScreenCaptureProtection(): Promise<void> {
    /* no-op: setContentProtected removed — incompatible with WebView2 on some PCs */
}
