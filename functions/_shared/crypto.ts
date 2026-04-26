const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function base64UrlEncodeText(value: string): string {
  return base64UrlEncode(encoder.encode(value));
}

export function base64UrlDecodeText(value: string): string {
  return decoder.decode(base64UrlDecode(value));
}

export function randomBase64Url(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function importAesKeyFromSecret(secret: string, context: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`${context}:${secret}`));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return bytesToHex(signature);
}

export async function hashVerifier(secret: string, verifier: string): Promise<string> {
  return `hmac-sha256:${await hmacHex(secret, `verifier:${verifier}`)}`;
}

export async function hmacBase64Url(secret: string, value: string): Promise<string> {
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return base64UrlEncode(new Uint8Array(signature));
}

export async function encryptTextWithSecret(secret: string, context: string, plaintext: string): Promise<{ iv: string; ciphertext: string }> {
  const ivBytes = new Uint8Array(12);
  crypto.getRandomValues(ivBytes);
  const key = await importAesKeyFromSecret(secret, context);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: ivBytes }, key, encoder.encode(plaintext));
  return {
    iv: base64UrlEncode(ivBytes),
    ciphertext: base64UrlEncode(new Uint8Array(ciphertext)),
  };
}

export async function decryptTextWithSecret(secret: string, context: string, iv: string, ciphertext: string): Promise<string> {
  const key = await importAesKeyFromSecret(secret, context);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64UrlDecode(iv) }, key, base64UrlDecode(ciphertext));
  return decoder.decode(plaintext);
}

export function constantTimeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  const max = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;

  for (let index = 0; index < max; index += 1) {
    diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }

  return diff === 0;
}
