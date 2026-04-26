const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const DEFAULT_PERIOD_SECONDS = 30;
const DEFAULT_DIGITS = 6;

export interface TotpOptions {
  timestamp?: number;
  periodSeconds?: number;
  digits?: number;
}

export interface TotpValidationResult {
  ok: boolean;
  secret: string;
  message?: string;
}

function getCrypto() {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle) {
    throw new Error("Web Crypto is unavailable.");
  }
  return cryptoApi;
}

function cleanBase32(value: string) {
  return value
    .trim()
    .replace(/\s+/g, "")
    .replace(/-/g, "")
    .replace(/=+$/g, "")
    .toUpperCase();
}

export function normalizeTotpSecretInput(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return "";

  if (/^otpauth:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      return cleanBase32(url.searchParams.get("secret") ?? "");
    } catch {
      return "";
    }
  }

  return cleanBase32(trimmed);
}

export function decodeBase32Secret(input: string) {
  const normalized = normalizeTotpSecretInput(input);
  if (!normalized) {
    throw new Error("TOTP secret is required.");
  }

  const bytes: number[] = [];
  let buffer = 0;
  let bitsLeft = 0;

  for (const char of normalized) {
    const value = BASE32_ALPHABET.indexOf(char);
    if (value === -1) {
      throw new Error("TOTP secret must be Base32 characters A-Z and 2-7.");
    }

    buffer = (buffer << 5) | value;
    bitsLeft += 5;

    if (bitsLeft >= 8) {
      bitsLeft -= 8;
      bytes.push((buffer >> bitsLeft) & 0xff);
    }
  }

  if (bytes.length === 0) {
    throw new Error("TOTP secret is too short.");
  }

  return new Uint8Array(bytes);
}

export function validateTotpSecret(input: string): TotpValidationResult {
  const secret = normalizeTotpSecretInput(input);
  if (!secret) {
    return {
      ok: false,
      secret,
      message: "Secret key is required.",
    };
  }

  try {
    decodeBase32Secret(secret);
    return {
      ok: true,
      secret,
    };
  } catch (caughtError) {
    return {
      ok: false,
      secret,
      message: caughtError instanceof Error
        ? caughtError.message
        : "Secret key must be valid Base32.",
    };
  }
}

export function getTotpSecondsLeft(
  timestamp = Date.now(),
  periodSeconds = DEFAULT_PERIOD_SECONDS,
) {
  const seconds = Math.floor(timestamp / 1000);
  const elapsed = seconds % periodSeconds;
  return elapsed === 0 ? periodSeconds : periodSeconds - elapsed;
}

function makeCounterBytes(counter: number) {
  const bytes = new Uint8Array(8);
  let value = BigInt(counter);

  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    bytes[index] = Number(value & 0xffn);
    value >>= 8n;
  }

  return bytes;
}

export async function generateTotpCode(secretInput: string, options: TotpOptions = {}) {
  const {
    timestamp = Date.now(),
    periodSeconds = DEFAULT_PERIOD_SECONDS,
    digits = DEFAULT_DIGITS,
  } = options;

  const secretBytes = decodeBase32Secret(secretInput);
  const counter = Math.floor(Math.floor(timestamp / 1000) / periodSeconds);
  const cryptoApi = getCrypto();
  const key = await cryptoApi.subtle.importKey(
    "raw",
    secretBytes,
    {
      name: "HMAC",
      hash: "SHA-1",
    },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await cryptoApi.subtle.sign("HMAC", key, makeCounterBytes(counter)),
  );
  const offset = signature[signature.length - 1] & 0x0f;
  const binary =
    ((signature[offset] & 0x7f) << 24) |
    ((signature[offset + 1] & 0xff) << 16) |
    ((signature[offset + 2] & 0xff) << 8) |
    (signature[offset + 3] & 0xff);
  const token = binary % (10 ** digits);

  return token.toString().padStart(digits, "0");
}

export function formatTotpCode(code: string) {
  if (code.length !== DEFAULT_DIGITS) return code;
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}
