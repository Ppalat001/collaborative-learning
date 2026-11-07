"use client";

/**
 * The participant identity stored on this device. The token proves to the server
 * that this device joined as that participant (required for V2 groups).
 */

const TOKEN_KEY = "participantToken";
const TOKEN_HEADER = "x-participant-token";

export function storeParticipant(participant: { id: string; displayName: string }, token?: string | null) {
  localStorage.setItem("participantName", participant.displayName);
  localStorage.setItem("participantId", participant.id);
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function getParticipantToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

/** Headers for participant API calls: JSON plus the device token when present. */
export function participantHeaders(json = true): Record<string, string> {
  const headers: Record<string, string> = json ? { "Content-Type": "application/json" } : {};
  const token = getParticipantToken();
  if (token) headers[TOKEN_HEADER] = token;
  return headers;
}

/** fetch() with the participant token attached. */
export function participantFetch(input: string, init: RequestInit = {}): Promise<Response> {
  return fetch(input, {
    ...init,
    headers: { ...participantHeaders(init.body !== undefined), ...(init.headers as Record<string, string> | undefined) },
  });
}
