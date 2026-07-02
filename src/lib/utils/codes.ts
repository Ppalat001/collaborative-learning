import { customAlphabet } from "nanoid";

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const generateSegment = customAlphabet(alphabet, 4);

export function generateSessionCode(): string {
  return `GROUP-${generateSegment()}`;
}

export function generateAnonymousId(): string {
  return `P-${generateSegment()}${generateSegment()}`;
}
