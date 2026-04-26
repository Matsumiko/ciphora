export interface PasswordGenerationOptions {
  length: number;
  upper?: boolean;
  lower?: boolean;
  numbers?: boolean;
  symbols?: boolean;
}

const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWER = "abcdefghijklmnopqrstuvwxyz";
const NUMBERS = "0123456789";
const SYMBOLS = "!@#$%^&*()_+-=[]{}|;:,.<>?";

export function secureRandomIndex(maxExclusive: number) {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0) {
    throw new Error("Random upper bound must be a positive safe integer.");
  }

  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) {
    throw new Error("Secure random generator is unavailable.");
  }

  const maxUint32 = 0xffffffff;
  const limit = Math.floor(maxUint32 / maxExclusive) * maxExclusive;
  const bytes = new Uint32Array(1);

  do {
    cryptoApi.getRandomValues(bytes);
  } while (bytes[0] >= limit);

  return bytes[0] % maxExclusive;
}

export function generateSecurePassword({
  length,
  upper = true,
  lower = true,
  numbers = true,
  symbols = true,
}: PasswordGenerationOptions) {
  let pool = "";
  if (upper) pool += UPPER;
  if (lower) pool += LOWER;
  if (numbers) pool += NUMBERS;
  if (symbols) pool += SYMBOLS;
  if (!pool) pool = LOWER;

  return Array.from({ length }, () => pool[secureRandomIndex(pool.length)]).join("");
}
