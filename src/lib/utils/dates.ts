export function nowIso(): string {
  return new Date().toISOString();
}

export function toIsoString(
  value: string | Date | null | undefined
): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  return value.toISOString();
}

export function secondsBetween(
  start: string | Date | null | undefined,
  end: string | Date | null | undefined
): number | null {
  const startIso = toIsoString(start);
  const endIso = toIsoString(end);
  if (!startIso || !endIso) return null;
  return Math.round(
    (new Date(endIso).getTime() - new Date(startIso).getTime()) / 1000
  );
}
