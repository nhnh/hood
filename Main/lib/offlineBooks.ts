import { supabase } from "../supabaseClient";
import { OFFLINE, getAppVersion } from "./appConfig";
import { getLeftThumb, getDeviceFingerprint } from "./deviceFingerprint";
import { fetchMinVersion, compareVersions } from "./appUpdater";
import { decryptPdf } from "./transportDecrypt";

const DB_NAME = OFFLINE.DB_NAME;
const DB_VERSION = OFFLINE.DB_VERSION;
const PDF_STORE = OFFLINE.PDF_STORE;
const META_STORE = OFFLINE.META_STORE;
const COVER_STORE = OFFLINE.COVER_STORE;
const BOOK_FILES_BUCKET = OFFLINE.BOOK_FILES_BUCKET;
const BOOK_COVERS_BUCKET = OFFLINE.BOOK_COVERS_BUCKET;

export const ENCRYPTION_ALGO = OFFLINE.ENCRYPTION_ALGO;
export const IV_LENGTH = OFFLINE.IV_LENGTH;

export async function getEncryptionKey(userId: string, salt?: string, fingerprint?: string): Promise<CryptoKey> {
    const fp = fingerprint || await getLeftThumb();
    const secret = `${fp}:${userId}`;
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        enc.encode(secret),
        "PBKDF2",
        false,
        ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: enc.encode(salt || OFFLINE.STORAGE_SALT),
            iterations: OFFLINE.PBKDF2_ITERATIONS,
            hash: "SHA-256",
        },
        keyMaterial,
        { name: ENCRYPTION_ALGO, length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
}

async function encryptBuffer(userId: string, data: ArrayBuffer): Promise<ArrayBuffer> {
    const key = await getEncryptionKey(userId, OFFLINE.STORAGE_SALT);
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const ciphertext = await crypto.subtle.encrypt({ name: ENCRYPTION_ALGO, iv }, key, data);
    const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), iv.byteLength);
    return combined.buffer;
}

export async function decryptBuffer(userId: string, data: ArrayBuffer): Promise<ArrayBuffer> {
    const tryDecrypt = async (fp: string): Promise<ArrayBuffer> => {
        const key = await getEncryptionKey(userId, OFFLINE.STORAGE_SALT, fp);
        const iv = new Uint8Array(data.slice(0, IV_LENGTH));
        const ciphertext = data.slice(IV_LENGTH);
        return crypto.subtle.decrypt({ name: ENCRYPTION_ALGO, iv }, key, ciphertext);
    };

    const fps = [
        await getLeftThumb(),
        localStorage.getItem('prev_device_fingerprint'),
        await getDeviceFingerprint(),
    ].filter(Boolean) as string[];

    const seen = new Set<string>();
    for (const fp of fps) {
        if (seen.has(fp)) continue;
        seen.add(fp);
        try {
            return await tryDecrypt(fp);
        } catch { /* try next */ }
    }
    throw new Error('Damaged copy. Please re-download.');
}

interface DownloadedBookMeta {
    bookId: string;
    userId: string;
    storagePath: string;
    downloadedAt: number;
    byteSize: number;
}

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(PDF_STORE)) {
                db.createObjectStore(PDF_STORE);
            }
            if (!db.objectStoreNames.contains(META_STORE)) {
                db.createObjectStore(META_STORE);
            }
            if (!db.objectStoreNames.contains(COVER_STORE)) {
                db.createObjectStore(COVER_STORE);
            }
        };
    });
}

export function getBookFilePath(book: { file_path?: string | null }): string | null {
    const path = book.file_path?.trim();
    return path || null;
}

function bookKey(userId: string, bookId: string): string {
    return `${userId}::${bookId}`;
}

export async function listDownloadedBookIds(userId: string): Promise<string[]> {
    try {
        const db = await openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(META_STORE, "readonly");
            const req = tx.objectStore(META_STORE).getAll();
            req.onsuccess = () => {
                const all = (req.result as DownloadedBookMeta[]) || [];
                const ids = all
                    .filter(m => m.userId === userId)
                    .map(m => m.bookId);
                resolve(ids);
            };
            req.onerror = () => reject(req.error);
        });
    } catch (err) {
        console.error("Failed to list downloaded books:", err);
        return [];
    }
}

export async function getBookPdf(userId: string, bookId: string): Promise<ArrayBuffer | null> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(PDF_STORE, "readonly");
        const req = tx.objectStore(PDF_STORE).get(bookKey(userId, bookId));
        req.onsuccess = async () => {
            const data = req.result as ArrayBuffer;
            if (!data) return resolve(null);
            try {
                const decrypted = await decryptBuffer(userId, data);
                resolve(decrypted);
            } catch (e) {
                console.error("Decryption failed. Data might be corrupted or key mismatch.", e);
                reject(e);
            }
        };
        req.onerror = () => reject(req.error);
    });
}

export async function removeBookDownload(userId: string, bookId: string): Promise<void> {
    try {
        const db = await openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction([PDF_STORE, META_STORE, COVER_STORE], "readwrite");
            tx.objectStore(PDF_STORE).delete(bookKey(userId, bookId));
            tx.objectStore(META_STORE).delete(bookKey(userId, bookId));
            tx.objectStore(COVER_STORE).delete(bookKey(userId, bookId));
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch (err) {
        console.error("Failed to remove book download:", err);
        throw err;
    }
}

async function saveBookPdf(userId: string, bookId: string, data: ArrayBuffer, storagePath: string): Promise<void> {
    const db = await openDb();
    const encryptedData = await encryptBuffer(userId, data);
    const meta: DownloadedBookMeta = {
        bookId,
        userId,
        storagePath,
        downloadedAt: Date.now(),
        byteSize: encryptedData.byteLength,
    };
    return new Promise((resolve, reject) => {
        const tx = db.transaction([PDF_STORE, META_STORE], "readwrite");
        tx.objectStore(PDF_STORE).put(encryptedData, bookKey(userId, bookId));
        tx.objectStore(META_STORE).put(meta, bookKey(userId, bookId));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function downloadViaGDrive(
    gdriveUrl: string,
    onProgress?: (percent: number) => void
): Promise<ArrayBuffer> {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    const proxyUrl = `${supabaseUrl}/functions/v1/gdrive-proxy`;

    let response;
    try {
        response = await fetch(proxyUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${supabaseKey}`,
            },
            body: JSON.stringify({ gdrive_url: gdriveUrl }),
        });
    } catch (err) {
        throw new Error(`Network error during GDrive proxy download: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    if (!response.ok) {
        const errText = await response.text().catch(() => "Unknown error");
        throw new Error(`GDrive proxy download failed (${response.status}): ${errText}`);
    }

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
        if (total > 0) {
            onProgress?.(Math.min(99, Math.round((loaded / total) * 100)));
        }
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

async function downloadViaSupabase(storagePath: string): Promise<ArrayBuffer> {
    try {
        const { data, error } = await supabase.storage.from(BOOK_FILES_BUCKET).download(storagePath);
        if (error) throw new Error(error.message);
        if (!data) throw new Error("No file data returned from storage.");
        return data.arrayBuffer();
    } catch (err) {
        console.error("Supabase download failed:", err);
        throw err;
    }
}

async function downloadViaSignedUrl(
    storagePath: string,
    onProgress?: (percent: number) => void
): Promise<ArrayBuffer> {
    const { data: signed, error: signError } = await supabase.storage
        .from(BOOK_FILES_BUCKET)
        .createSignedUrl(storagePath, OFFLINE.SIGNED_URL_EXPIRY_SEC);

    if (signError || !signed?.signedUrl) {
        throw new Error(signError?.message || "Could not create download URL.");
    }

    let response;
    try {
        response = await fetch(signed.signedUrl);
    } catch (err) {
        throw new Error(`Network error during download: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
    if (!response.ok) {
        throw new Error(`Download failed (${response.status}).`);
    }

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
        if (total > 0) {
            onProgress?.(Math.min(99, Math.round((loaded / total) * 100)));
        }
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

export async function downloadBookFile(
    userId: string,
    bookId: string,
    storagePath: string,
    gdriveUrl?: string | null,
    onProgress?: (percent: number) => void
): Promise<void> {
    onProgress?.(0);

    let buffer: ArrayBuffer;

    // Check for transport encryption
    const { data: encData } = await supabase.rpc('get_book_transport_encryption', { p_book_id: bookId }).maybeSingle();
    const enc = encData as { encrypted_file_path?: string; password?: string } | null;

    if (enc?.encrypted_file_path && enc?.password) {
        // Version check
        const minVer = await fetchMinVersion();
        if (minVer) {
            const currentVer = await getAppVersion();
            if (compareVersions(currentVer, minVer) < 0) {
                throw new Error(`Update required. Please update your app to at least v${minVer} to access encrypted books.`);
            }
        }

        // Download encrypted file (always from Supabase storage, never GDrive)
        onProgress?.(10);
        try {
            buffer = await downloadViaSignedUrl(enc.encrypted_file_path, (p: number) => onProgress?.(Math.round(p * 0.7)));
        } catch {
            buffer = await downloadViaSupabase(enc.encrypted_file_path);
            onProgress?.(70);
        }

        // Decrypt with password
        onProgress?.(75);
        buffer = await decryptPdf(enc.password, buffer);
        onProgress?.(85);
    } else {
        // No transport encryption — existing flow
        if (gdriveUrl) {
            try {
                buffer = await downloadViaGDrive(gdriveUrl, (p: number) => onProgress?.(Math.round(p * 0.9)));
            } catch (gdriveErr) {
                console.warn("GDrive download failed, falling back to Supabase:", gdriveErr);
                try {
                    buffer = await downloadViaSignedUrl(storagePath, (p: number) => onProgress?.(Math.round(p * 0.9)));
                } catch {
                    buffer = await downloadViaSupabase(storagePath);
                    onProgress?.(100);
                }
            }
        } else {
            try {
                buffer = await downloadViaSignedUrl(storagePath, (p: number) => onProgress?.(Math.round(p * 0.9)));
            } catch {
                buffer = await downloadViaSupabase(storagePath);
                onProgress?.(100);
            }
        }
    }

    await saveBookPdf(userId, bookId, buffer, storagePath);
    onProgress?.(100);
}

function parseCoverPath(coverUrl: string | null | undefined): string | null {
    if (!coverUrl) return null;
    try {
        const url = new URL(coverUrl);
        const match = url.pathname.match(/\/storage\/v1\/object\/(?:public|sign)\/[^/]+\/(.+)$/);
        if (match) return decodeURIComponent(match[1]);
        return null;
    } catch {
        return null;
    }
}

export function getCoverStoragePath(book: { cover_url?: string | null }): string | null {
    return parseCoverPath(book.cover_url);
}

export async function downloadBookCover(userId: string, bookId: string, coverUrl: string): Promise<void> {
    const storagePath = parseCoverPath(coverUrl);
    try {
        const dlPath = storagePath || coverUrl;
        const { data, error } = await supabase.storage.from(BOOK_COVERS_BUCKET).download(dlPath);
        if (error || !data) throw error || new Error("No cover data returned.");
        await saveBookCover(userId, bookId, data);
    } catch (err) {
        console.warn("Cover download via SDK failed, trying public URL:", err);
        try {
            const response = await fetch(coverUrl);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const blob = await response.blob();
            await saveBookCover(userId, bookId, blob);
        } catch (err2) {
            console.warn("Cover download via public URL also failed:", err2);
        }
    }
}

async function saveBookCover(userId: string, bookId: string, blob: Blob): Promise<void> {
    try {
        const db = await openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(COVER_STORE, "readwrite");
            tx.objectStore(COVER_STORE).put(blob, bookKey(userId, bookId));
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch (err) {
        console.error("Failed to save book cover:", err);
    }
}

export async function getBookCoverBlob(userId: string, bookId: string): Promise<Blob | null> {
    try {
        const db = await openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(COVER_STORE, "readonly");
            const req = tx.objectStore(COVER_STORE).get(bookKey(userId, bookId));
            req.onsuccess = () => resolve((req.result as Blob) || null);
            req.onerror = () => reject(req.error);
        });
    } catch (err) {
        console.error("Failed to read book cover:", err);
        return null;
    }
}

export async function listDownloadedCoverIds(userId: string): Promise<string[]> {
    try {
        const db = await openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(COVER_STORE, "readonly");
            const req = tx.objectStore(COVER_STORE).getAllKeys();
            req.onsuccess = () => {
                const all = req.result as string[];
                const prefix = `${userId}::`;
                resolve(all.filter(k => k.startsWith(prefix)).map(k => k.slice(prefix.length)));
            };
            req.onerror = () => reject(req.error);
        });
    } catch (err) {
        console.error("Failed to list downloaded covers:", err);
        return [];
    }
}
