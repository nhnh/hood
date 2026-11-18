import { invoke } from "@tauri-apps/api/core";

export async function getAppVersion(): Promise<string> {
    try {
        return await invoke("get_app_version");
    } catch {
        return "0.0.0";
    }
}

export const STORAGE = {
  OFFLINE_SESSION_KEY: "cloudu_offline_session",
  OFFLINE_MOCK_ACCESS_PREFIX: "offline_mock_access_token_",
  OFFLINE_MOCK_REFRESH_TOKEN: "offline_mock_refresh_token",
  CHECK_UPDATES_CACHE_KEY: "cloudu_check_updates_cache",
  DEVICE_VERIFIED_FINGERPRINT_KEY: "cloudu_device_verified_fp",
  DEVICE_VERIFIED_AT_KEY: "cloudu_device_verified_at",
} as const;

export function userKey(userId: string, suffix: string): string {
  return `cloudu_${userId}_${suffix}`;
}

export function listCachedUserIds(): string[] {
  const prefix = "cloudu_";
  const suffix = "_cached_user";
  const out: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k) continue;
    if (k.startsWith(prefix) && k.endsWith(suffix)) {
      const id = k.slice(prefix.length, k.length - suffix.length);
      if (id) out.push(id);
    }
  }
  return out;
}

export function removeUserStorage(userId: string): void {
  const prefix = `cloudu_${userId}_`;
  const toRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(prefix)) toRemove.push(k);
  }
  toRemove.forEach(k => localStorage.removeItem(k));
}

export const OFFLINE = {
  DB_NAME: "cloudshelf_reader_offline",
  DB_VERSION: 3,
  PDF_STORE: "pdfs",
  META_STORE: "meta",
  COVER_STORE: "covers",
  BOOK_FILES_BUCKET: "book-files",
  BOOK_COVERS_BUCKET: "book-covers",
  ENCRYPTION_ALGO: "AES-GCM" as const,
  IV_LENGTH: 12,
  PBKDF2_ITERATIONS: 100000,
  NOTES_SALT: "cloudshelf-notes-salt-v1",
  STORAGE_SALT: "cloudshelf-storage-salt-v1",
  STANDALONE_SALT: "cloudshelf-standalone-salt-v1",
  SIGNED_URL_EXPIRY_SEC: 600,
} as const;

export const INTERVALS = {
  CHECK_UPDATES_MS: 86_400_000,
} as const;
