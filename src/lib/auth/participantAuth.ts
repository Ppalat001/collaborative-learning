import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const PARTICIPANT_TOKEN_HEADER = "x-participant-token";

/** A random device token; only its SHA-256 hash is stored. */
export function issueParticipantToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashParticipantToken(token) };
}

export function hashParticipantToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function tokenMatches(token: string | null | undefined, storedHash: string | null): boolean {
  if (!token || !storedHash) return false;
  const presented = Buffer.from(hashParticipantToken(token), "hex");
  const stored = Buffer.from(storedHash, "hex");
  return presented.length === stored.length && timingSafeEqual(presented, stored);
}

export function readParticipantToken(request: Request): string | null {
  return request.headers.get(PARTICIPANT_TOKEN_HEADER)?.trim() || null;
}

export type TokenCheck = "verified" | "legacy_unverified" | "rejected";

/**
 * V2 groups always require the token. Legacy groups keep the original rule (a
 * member's id is enough) unless a token is presented, which must then match.
 */
export function checkParticipantToken(options: {
  isV2: boolean;
  token: string | null;
  storedHash: string | null;
}): TokenCheck {
  const { isV2, token, storedHash } = options;
  if (isV2) return tokenMatches(token, storedHash) ? "verified" : "rejected";
  if (token && storedHash) return tokenMatches(token, storedHash) ? "verified" : "rejected";
  return "legacy_unverified";
}
