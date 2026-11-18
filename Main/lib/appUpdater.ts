import { supabase } from "../supabaseClient";

export interface AppRelease {
  id: string;
  app_name: "reader" | "moderator";
  version: string;
  platform: string;
  release_notes: string | null;
  installer_url: string;
  gdrive_url: string | null;
  storage_path: string | null;
  signature: string;
  pub_date: string;
  min_version?: string | null;
}

/** Fetch the min_version for the reader app across all platforms */
export async function fetchMinVersion(): Promise<string | null> {
  const { data, error } = await supabase
    .from("app_releases")
    .select("min_version")
    .eq("app_name", "reader")
    .not("min_version", "is", null)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error || !data || data.length === 0) return null;
  return data[0].min_version as string;
}

export async function fetchLatestRelease(platform: string): Promise<AppRelease | null> {
  const { data, error } = await supabase
    .from("app_releases")
    .select("*")
    .eq("app_name", "reader")
    .eq("platform", platform)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error || !data || data.length === 0) return null;
  return data[0];
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

export async function downloadAppFile(
  url: string,
  gdriveUrl?: string | null,
  onProgress?: (percent: number) => void
): Promise<ArrayBuffer> {
  if (gdriveUrl) {
    try {
      return await fetchWithProgress(gdriveUrl, onProgress);
    } catch {
      console.warn("GDrive download failed, falling back to direct URL");
    }
  }
  return fetchWithProgress(url, onProgress);
}

async function fetchWithProgress(url: string, onProgress?: (percent: number) => void): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const total = Number(response.headers.get("content-length") || 0);
  const reader = response.body?.getReader();
  if (!reader) {
    onProgress?.(100);
    return response.arrayBuffer();
  }

  const chunks: Uint8Array[] = [];
  let loaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    if (total > 0) onProgress?.(Math.min(99, Math.round((loaded / total) * 100)));
  }

  const merged = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  onProgress?.(100);
  return merged.buffer;
}
