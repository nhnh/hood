let cachedFingerprint: string | null = null;
let cachedLeftThumb: string | null = null;

export async function getDeviceFingerprint(): Promise<string> {
    if (cachedFingerprint) return cachedFingerprint;

    const { invoke } = await import("@tauri-apps/api/core");
    cachedFingerprint = await invoke<string>("get_device_fingerprint");
    return cachedFingerprint;
}

export async function getLeftThumb(): Promise<string> {
    if (cachedLeftThumb) return cachedLeftThumb;

    const { invoke } = await import("@tauri-apps/api/core");
    cachedLeftThumb = await invoke<string>("get_left_thumb");
    return cachedLeftThumb;
}

export async function getPlatform(): Promise<string> {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string>("get_platform_prefix");
}

export function clearFingerprintCache(): void {
    cachedFingerprint = null;
    cachedLeftThumb = null;
}
