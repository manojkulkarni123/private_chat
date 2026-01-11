/**
 * END-TO-END ENCRYPTION UTILITIES
 * Uses the Web Crypto API for secure, high-performance encryption in the browser.
 */

// Derives a cryptographic key from a password and salt using PBKDF2
export async function deriveKey(password: string, salt: string): Promise<CryptoKey> {
    const enc = new TextEncoder()
    const passwordKey = await crypto.subtle.importKey(
        "raw",
        enc.encode(password),
        { name: "PBKDF2" },
        false,
        ["deriveKey"]
    )

    return crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: enc.encode(salt),
            iterations: 100000,
            hash: "SHA-256",
        },
        passwordKey,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    )
}

// Encrypts a message string using AES-GCM
export async function encryptMessage(content: string, key: CryptoKey): Promise<string> {
    const enc = new TextEncoder()
    const iv = crypto.getRandomValues(new Uint8Array(12)) // GCM recommended IV size
    const encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        key,
        enc.encode(content)
    )

    // Combine IV and Ciphertext for transport
    const combined = new Uint8Array(iv.length + encrypted.byteLength)
    combined.set(iv)
    combined.set(new Uint8Array(encrypted), iv.length)

    // Return as Base64 string for easy Socket.IO transport
    return btoa(String.fromCharCode(...combined))
}

// Decrypts a Base64 encoded message string
export async function decryptMessage(encryptedBase64: string, key: CryptoKey): Promise<string> {
    const combined = new Uint8Array(
        atob(encryptedBase64)
            .split("")
            .map((c) => c.charCodeAt(0))
    )

    const iv = combined.slice(0, 12)
    const encrypted = combined.slice(12)

    const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv },
        key,
        encrypted
    )

    const dec = new TextDecoder()
    return dec.decode(decrypted)
}

//Both users type the same password. The browser slowly turns that password into a strong secret key using PBKDF2.
// That key encrypts each message using AES-GCM, producing unreadable bytes plus a random IV. The bytes are
// Base64-encoded so they can travel over Socket.IO. The receiver reverses the process and sees the original message