"use client";

import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

function useStoredValue(key: string): string | null | undefined {
  return useSyncExternalStore(
    subscribe,
    () => localStorage.getItem(key),
    () => undefined
  );
}

/** `undefined` while rendering on the server, `null` if this device never joined. */
export function useStoredParticipant() {
  const id = useStoredValue("participantId");
  const name = useStoredValue("participantName");
  return {
    loaded: id !== undefined,
    id: id ?? null,
    name: name ?? "Participant",
  };
}
