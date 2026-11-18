export const TRANSPORT_SALT_LENGTH = 16;
export const TRANSPORT_IV_LENGTH = 12;
export const TRANSPORT_PBKDF2_ITERATIONS = 100000;

export async function decryptPdf(password: string, encryptedData: ArrayBuffer): Promise<ArrayBuffer> {
    const data = new Uint8Array(encryptedData);

    const salt = data.slice(0, TRANSPORT_SALT_LENGTH);
    const iv = data.slice(TRANSPORT_SALT_LENGTH, TRANSPORT_SALT_LENGTH + TRANSPORT_IV_LENGTH);
    const ciphertext = data.slice(TRANSPORT_SALT_LENGTH + TRANSPORT_IV_LENGTH);

    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        "raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]
    );
    const key = await crypto.subtle.deriveKey(
        { name: "PBKDF2", salt, iterations: TRANSPORT_PBKDF2_ITERATIONS, hash: "SHA-256" },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["decrypt"]
    );

    return crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
}
