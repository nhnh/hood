import { Session } from "@supabase/supabase-js";
import type { Book } from "../types";
import { STORAGE, userKey, listCachedUserIds, removeUserStorage } from "./appConfig";

export interface CachedUser {
    id: string;
    email: string;
    fullName: string;
    role: string;
    passwordHash?: string;
    passwordSalt?: string;
}

// Simple salt generator
function generateSalt(): string {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, "0")).join("");
}

// SHA-256 Hashing with Salt using Web Crypto API
async function hashPassword(password: string, salt: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(password + salt);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
}

function userLsKey(userId: string): string {
    return userKey(userId, "cached_user");
}

function booksLsKey(userId: string): string {
    return userKey(userId, "cached_books");
}

function getUserEntry(userId: string): CachedUser | null {
    const raw = localStorage.getItem(userLsKey(userId));
    if (!raw) return null;
    try {
        return JSON.parse(raw) as CachedUser;
    } catch {
        return null;
    }
}

function setUserEntry(user: CachedUser): void {
    localStorage.setItem(userLsKey(user.id), JSON.stringify(user));
}

/**
 * Caches user credentials and profile details upon a successful online login.
 * Multi-user safe: each user is stored under their own key.
 */
export async function cacheUserCredentials(
    session: Session,
    fullName: string,
    role: string,
    password?: string
) {
    if (!session?.user?.id) return;

    const userId = session.user.id;
    const cached: CachedUser = {
        id: userId,
        email: session.user.email || "",
        fullName: fullName || session.user.user_metadata?.full_name || "Student",
        role: role || session.user.user_metadata?.role || "buyer",
    };

    const existing = getUserEntry(userId);
    if (existing) {
        cached.passwordHash = existing.passwordHash;
        cached.passwordSalt = existing.passwordSalt;
    }

    if (password) {
        const salt = generateSalt();
        const hash = await hashPassword(password, salt);
        cached.passwordSalt = salt;
        cached.passwordHash = hash;
    }

    setUserEntry(cached);
}

/**
 * Verifies email and password offline against any cached user credentials.
 * Iterates all cached users on this device.
 */
export async function verifyOfflineCredentials(email: string, password: string): Promise<Session> {
    const normalized = email.toLowerCase();
    const userIds = listCachedUserIds();

    if (userIds.length === 0) {
        throw new Error("No offline account found on this device. You must log in online at least once first.");
    }

    let matched: CachedUser | null = null;
    for (const uid of userIds) {
        const user = getUserEntry(uid);
        if (user && user.email.toLowerCase() === normalized) {
            matched = user;
            break;
        }
    }

    if (!matched) {
        throw new Error("Invalid email or password (offline mode).");
    }

    if (!matched.passwordHash || !matched.passwordSalt) {
        throw new Error("Offline login credentials not set. Please log in online first to enable offline access.");
    }

    const testHash = await hashPassword(password, matched.passwordSalt);
    if (testHash !== matched.passwordHash) {
        throw new Error("Invalid email or password (offline mode).");
    }

    const mockSession = createMockSession(matched);
    localStorage.setItem(STORAGE.OFFLINE_SESSION_KEY, JSON.stringify(mockSession));
    return mockSession;
}

/**
 * Creates a mock Supabase session object.
 */
function createMockSession(user: CachedUser): Session {
    return {
        access_token: STORAGE.OFFLINE_MOCK_ACCESS_PREFIX + Date.now(),
        refresh_token: STORAGE.OFFLINE_MOCK_REFRESH_TOKEN,
        expires_in: 31536000, // 1 year
        expires_at: Math.floor(Date.now() / 1000) + 31536000,
        token_type: "bearer",
        user: {
            id: user.id,
            app_metadata: {},
            user_metadata: {
                full_name: user.fullName,
                role: user.role,
            },
            aud: "authenticated",
            created_at: new Date().toISOString(),
            email: user.email,
            phone: "",
            role: "authenticated",
            updated_at: new Date().toISOString(),
        },
    } as Session;
}

/**
 * Returns the stored offline session if any.
 */
export function getOfflineSession(): Session | null {
    const raw = localStorage.getItem(STORAGE.OFFLINE_SESSION_KEY);
    if (!raw) return null;
    try {
        return JSON.parse(raw) as Session;
    } catch {
        return null;
    }
}

/**
 * Clears the active offline session (on logout).
 */
export function clearOfflineSession() {
    localStorage.removeItem(STORAGE.OFFLINE_SESSION_KEY);
}

/**
 * Caches the list of owned books for the specified user.
 */
export function cacheOwnedBooks(userId: string, books: Book[]) {
    localStorage.setItem(booksLsKey(userId), JSON.stringify(books));
}

/**
 * Retrieves the cached owned books for the specified user.
 */
export function getCachedOwnedBooks(userId: string): Book[] {
    const raw = localStorage.getItem(booksLsKey(userId));
    if (!raw) return [];
    try {
        return JSON.parse(raw);
    } catch {
        return [];
    }
}

/**
 * Returns the cached user object for the given userId, or null.
 */
export function getCachedUser(userId?: string): CachedUser | null {
    if (userId) return getUserEntry(userId);

    const session = getOfflineSession();
    if (session?.user?.id) return getUserEntry(session.user.id);

    const userIds = listCachedUserIds();
    if (userIds.length === 1) return getUserEntry(userIds[0]);
    return null;
}

/**
 * Returns all cached user accounts on this device.
 */
export function getAllCachedUsers(): CachedUser[] {
    const ids = listCachedUserIds();
    const users: CachedUser[] = [];
    for (const id of ids) {
        const u = getUserEntry(id);
        if (u) users.push(u);
    }
    return users;
}

const DEVICE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function cacheDeviceVerification(fingerprint: string): void {
    localStorage.setItem(STORAGE.DEVICE_VERIFIED_FINGERPRINT_KEY, fingerprint);
    localStorage.setItem(STORAGE.DEVICE_VERIFIED_AT_KEY, String(Date.now()));
}

export function isDeviceVerifiedLocally(fingerprint: string): boolean {
    const storedFp = localStorage.getItem(STORAGE.DEVICE_VERIFIED_FINGERPRINT_KEY);
    if (storedFp !== fingerprint) return false;

    const storedAt = localStorage.getItem(STORAGE.DEVICE_VERIFIED_AT_KEY);
    if (!storedAt) return false;

    return Date.now() - Number(storedAt) < DEVICE_CACHE_TTL_MS;
}

export function clearDeviceVerificationCache(): void {
    localStorage.removeItem(STORAGE.DEVICE_VERIFIED_FINGERPRINT_KEY);
    localStorage.removeItem(STORAGE.DEVICE_VERIFIED_AT_KEY);
}

/**
 * Checks if at least one user has setup credentials for offline login.
 */
export function hasOfflineCredentials(): boolean {
    const ids = listCachedUserIds();
    if (ids.length === 0) return false;
    for (const id of ids) {
        const user = getUserEntry(id);
        if (user?.passwordHash && user?.passwordSalt) return true;
    }
    return false;
}

/**
 * Removes all offline data for a specific user (cached books + IndexedDB entries).
 * Does not remove the user entry itself.
 */
export function purgeUserOfflineData(userId: string): void {
    removeUserStorage(userId);
}
