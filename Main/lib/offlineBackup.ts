import { save, open } from "@tauri-apps/plugin-dialog";
import { writeTextFile, readTextFile } from "@tauri-apps/plugin-fs";
import { IV_LENGTH, ENCRYPTION_ALGO } from "./offlineBooks";
import { loadNotes, saveNotes, BookNote } from "./offlineNotes";
import { loadStandaloneNotes, saveStandaloneNotes } from "./offlineStandaloneNotes";
import type { StandaloneNote } from "../types";
import { OFFLINE } from "./appConfig";

const BACKUP_SALT = "cloudshelf-backup-salt-v1";

interface BackupData {
    version: 1;
    exportedAt: number;
    userId: string;
    bookNotes: Record<string, BookNote[]>;
    standaloneNotes: StandaloneNote[];
}

async function getBackupKey(userId: string): Promise<CryptoKey> {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        "raw", enc.encode(userId), "PBKDF2", false, ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: enc.encode(BACKUP_SALT),
            iterations: OFFLINE.PBKDF2_ITERATIONS,
            hash: "SHA-256",
        },
        keyMaterial,
        { name: ENCRYPTION_ALGO, length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
}

async function encryptBackup(userId: string, data: string): Promise<string> {
    const key = await getBackupKey(userId);
    const enc = new TextEncoder();
    const plaintext = enc.encode(data).buffer;
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const ciphertext = await crypto.subtle.encrypt({ name: ENCRYPTION_ALGO, iv }, key, plaintext);
    const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), iv.byteLength);
    let binary = "";
    for (let i = 0; i < combined.length; i++) binary += String.fromCharCode(combined[i]);
    return btoa(binary);
}

async function decryptBackup(userId: string, encoded: string): Promise<string> {
    const key = await getBackupKey(userId);
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const combined = bytes.buffer;
    const iv = new Uint8Array(combined.slice(0, IV_LENGTH));
    const ciphertext = combined.slice(IV_LENGTH);
    const decrypted = await crypto.subtle.decrypt({ name: ENCRYPTION_ALGO, iv }, key, ciphertext);
    return new TextDecoder().decode(decrypted);
}

export async function exportNotesToFile(userId: string): Promise<void> {
    const prefix = `cloudu_${userId}_notes_`;
    const bookIds: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) {
            bookIds.push(k.slice(prefix.length));
        }
    }

    const bookNotes: Record<string, BookNote[]> = {};
    for (const bookId of bookIds) {
        const notes = await loadNotes(userId, bookId);
        if (notes.length > 0) {
            bookNotes[bookId] = notes;
        }
    }
    const standaloneNotes = await loadStandaloneNotes(userId);

    const backup: BackupData = {
        version: 1,
        exportedAt: Date.now(),
        userId,
        bookNotes,
        standaloneNotes,
    };

    const encrypted = await encryptBackup(userId, JSON.stringify(backup));

    const filePath = await save({
        defaultPath: `CloudShelf-Notes-Backup-${userId.slice(0, 8)}.cloudshelf`,
        filters: [{ name: "CloudShelf Backup", extensions: ["cloudshelf"] }],
    });
    if (!filePath) return;

    await writeTextFile(filePath, encrypted);
}

export async function importNotesFromFile(userId: string): Promise<{ success: boolean; message: string }> {
    const filePath = await open({
        filters: [{ name: "CloudShelf Backup", extensions: ["cloudshelf"] }],
        multiple: false,
    });
    if (!filePath) return { success: false, message: "Cancelled" };

    let encrypted: string;
    try {
        encrypted = await readTextFile(filePath as string);
    } catch {
        return { success: false, message: "Failed to read the selected file." };
    }

    let json: string;
    try {
        json = await decryptBackup(userId, encrypted);
    } catch {
        return { success: false, message: "Failed to decrypt backup. The file may be corrupted or from a different account." };
    }

    let backup: BackupData;
    try {
        backup = JSON.parse(json);
    } catch {
        return { success: false, message: "Invalid backup file format." };
    }

    if (backup.userId !== userId) {
        return { success: false, message: "This backup belongs to a different account." };
    }

    let importedCount = 0;
    for (const [bookId, importedNotes] of Object.entries(backup.bookNotes)) {
        const existing = await loadNotes(userId, bookId);
        const map = new Map(existing.map(n => [n.id, n]));
        for (const note of importedNotes) {
            map.set(note.id, note);
        }
        await saveNotes(userId, bookId, Array.from(map.values()));
        importedCount += importedNotes.length;
    }

    if (backup.standaloneNotes?.length) {
        const existing = await loadStandaloneNotes(userId);
        const map = new Map(existing.map(n => [n.id, n]));
        for (const note of backup.standaloneNotes) {
            map.set(note.id, note);
        }
        await saveStandaloneNotes(userId, Array.from(map.values()));
    }

    return { success: true, message: `Successfully imported ${importedCount} notes.` };
}
