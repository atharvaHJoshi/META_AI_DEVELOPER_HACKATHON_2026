import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";

/**
 * Password hashing uses Argon2id (the library default). A scrypt fallback keeps
 * a development checkout usable if the native binding cannot load on the host
 * platform. Hashes are self-describing so both formats can coexist.
 */
const ARGON_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

function scryptHash(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

function scryptVerify(password: string, stored: string): boolean {
  const [, saltHex, hashHex] = stored.split("$");
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const derived = scryptSync(password, salt, expected.length);
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

export async function hashPassword(password: string): Promise<string> {
  try {
    return await argonHash(password, ARGON_OPTIONS);
  } catch {
    return scryptHash(password);
  }
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  if (stored.startsWith("scrypt$")) return scryptVerify(password, stored);
  try {
    return await argonVerify(stored, password);
  } catch {
    return false;
  }
}

export function passwordProblem(password: string): string | null {
  if (password.length < 10) return "Password must be at least 10 characters.";
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return "Password must include at least one letter and one number.";
  }
  return null;
}
