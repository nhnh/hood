import { readTextFile, writeTextFile, mkdir } from "@tauri-apps/plugin-fs";
import { join, appDataDir } from "@tauri-apps/api/path";
import { getEncryptionKey, IV_LENGTH, ENCRYPTION_ALGO } from "./offlineBooks";
import { OFFLINE } from "./appConfig";

export interface BookNote {
    id: string;
    page: number;
    text: string;
    createdAt: number;
    title?: string;
}

function notesLsKey(userId: string, bookId: string): string {
    return `cloudu_${userId}_notes_${bookId}`;
}

function getNotesKey(userId: string): Promise<CryptoKey> {
    return getEncryptionKey(userId, OFFLINE.NOTES_SALT);
}

async function notesFilePath(userId: string, bookId: string): Promise<string> {
    return join(await appDataDir(), `notes_${userId}_${bookId}.enc`);
}

export async function loadNotes(userId: string, bookId: string): Promise<BookNote[]> {
    const fileNotes = await readNotes(userId, bookId);
    if (fileNotes.length > 0) return fileNotes;

    const raw = localStorage.getItem(notesLsKey(userId, bookId));
    if (!raw) return [];

    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            const valid = parsed.filter(
                (n): n is BookNote =>
                    n && typeof n.id === "string" && typeof n.page === "number" && typeof n.text === "string"
            );
            if (valid.length > 0) return valid;
        }
    } catch { /* ignore */ }
    return [];
}

export async function saveNotes(userId: string, bookId: string, notes: BookNote[]): Promise<void> {
    const json = JSON.stringify(notes);
    localStorage.setItem(notesLsKey(userId, bookId), json);

    try {
        const enc = new TextEncoder();
        const data = enc.encode(json).buffer;

        const key = await getNotesKey(userId);
        const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
        const ciphertext = await crypto.subtle.encrypt({ name: ENCRYPTION_ALGO, iv }, key, data);

        const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
        combined.set(iv, 0);
        combined.set(new Uint8Array(ciphertext), iv.byteLength);

        const encoded = arrayBufferToBase64(combined.buffer);
        const filePath = await notesFilePath(userId, bookId);
        await mkdir(await appDataDir(), { recursive: true }).catch(() => {});
        await writeTextFile(filePath, encoded);
    } catch (e) {
        console.error("Failed to write encrypted notes file:", e);
    }
}

async function readNotes(userId: string, bookId: string): Promise<BookNote[]> {
    try {
        const filePath = await notesFilePath(userId, bookId);
        const encoded = await readTextFile(filePath);

        const combined = base64ToArrayBuffer(encoded);
        const key = await getNotesKey(userId);
        const iv = new Uint8Array(combined.slice(0, IV_LENGTH));
        const ciphertext = combined.slice(IV_LENGTH);

        const decrypted = await crypto.subtle.decrypt({ name: ENCRYPTION_ALGO, iv }, key, ciphertext);
        const json = new TextDecoder().decode(decrypted);
        return JSON.parse(json);
    } catch {
        return [];
    }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}
