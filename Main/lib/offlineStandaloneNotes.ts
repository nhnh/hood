import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { join, appDataDir } from "@tauri-apps/api/path";
import { getEncryptionKey, IV_LENGTH, ENCRYPTION_ALGO } from "./offlineBooks";
import type { StandaloneNote } from "../types";
import { OFFLINE } from "./appConfig";

function standaloneLsKey(userId: string): string {
    return `cloudu_${userId}_standalone_notes`;
}

const SALT = OFFLINE.STANDALONE_SALT;

function getStandaloneKey(userId: string): Promise<CryptoKey> {
    return getEncryptionKey(userId, SALT);
}

async function filePath(userId: string): Promise<string> {
    return join(await appDataDir(), `standalone_notes_${userId}.enc`);
}

export async function loadStandaloneNotes(userId: string): Promise<StandaloneNote[]> {
    try {
        const fp = await filePath(userId);
        const encoded = await readTextFile(fp);
        const combined = base64ToArrayBuffer(encoded);
        const key = await getStandaloneKey(userId);
        const iv = new Uint8Array(combined.slice(0, IV_LENGTH));
        const ciphertext = combined.slice(IV_LENGTH);
        const decrypted = await crypto.subtle.decrypt({ name: ENCRYPTION_ALGO, iv }, key, ciphertext);
        const json = new TextDecoder().decode(decrypted);
        return JSON.parse(json);
    } catch { /* fall through to localStorage */ }

    const raw = localStorage.getItem(standaloneLsKey(userId));
    if (!raw) return [];
    try {
        return JSON.parse(raw);
    } catch {
        return [];
    }
}

export async function saveStandaloneNotes(userId: string, notes: StandaloneNote[]): Promise<void> {
    const json = JSON.stringify(notes);
    localStorage.setItem(standaloneLsKey(userId), json);

    try {
        const enc = new TextEncoder();
        const data = enc.encode(json).buffer;
        const key = await getStandaloneKey(userId);
        const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
        const ciphertext = await crypto.subtle.encrypt({ name: ENCRYPTION_ALGO, iv }, key, data);
        const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
        combined.set(iv, 0);
        combined.set(new Uint8Array(ciphertext), iv.byteLength);
        const encoded = arrayBufferToBase64(combined.buffer);
        await writeTextFile(await filePath(userId), encoded);
    } catch (e) {
        console.error("Failed to write encrypted standalone notes file:", e);
    }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}
