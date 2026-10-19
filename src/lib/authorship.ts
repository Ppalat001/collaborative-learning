import type { AuthorRun } from "@/lib/types";

export interface TextEdit {
  /** Index where the change starts. */
  start: number;
  removed: number;
  insertedText: string;
}

/** Smallest single edit that turns `previous` into `next` (common prefix and suffix kept). */
export function diffText(previous: string, next: string): TextEdit {
  let start = 0;
  const maxPrefix = Math.min(previous.length, next.length);
  while (start < maxPrefix && previous[start] === next[start]) start++;

  let suffix = 0;
  const maxSuffix = Math.min(previous.length, next.length) - start;
  while (
    suffix < maxSuffix &&
    previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix++;
  }

  return {
    start,
    removed: previous.length - start - suffix,
    insertedText: next.slice(start, next.length - suffix),
  };
}

function merge(runs: AuthorRun[]): AuthorRun[] {
  const merged: AuthorRun[] = [];
  for (const run of runs) {
    if (run.length <= 0) continue;
    const last = merged[merged.length - 1];
    if (last && last.participantId === run.participantId) last.length += run.length;
    else merged.push({ ...run });
  }
  return merged;
}

/** Makes runs cover exactly `length` characters; untracked text is attributed to nobody. */
export function normalizeRuns(runs: AuthorRun[] | null | undefined, length: number): AuthorRun[] {
  const result: AuthorRun[] = [];
  let remaining = length;
  for (const run of runs ?? []) {
    if (remaining <= 0) break;
    const take = Math.min(Math.max(0, Math.floor(run.length)), remaining);
    result.push({ participantId: run.participantId ?? null, length: take });
    remaining -= take;
  }
  if (remaining > 0) result.push({ participantId: null, length: remaining });
  return merge(result);
}

export function applyEdit(runs: AuthorRun[], edit: TextEdit, author: string | null): AuthorRun[] {
  const before: AuthorRun[] = [];
  const after: AuthorRun[] = [];
  const end = edit.start + edit.removed;
  let position = 0;

  for (const run of runs) {
    const runStart = position;
    const runEnd = position + run.length;
    position = runEnd;
    if (runStart < edit.start) {
      before.push({ ...run, length: Math.min(runEnd, edit.start) - runStart });
    }
    if (runEnd > end) {
      after.push({ ...run, length: runEnd - Math.max(runStart, end) });
    }
  }

  return merge([
    ...before,
    { participantId: author, length: edit.insertedText.length },
    ...after,
  ]);
}

export interface AuthoredSegment {
  participantId: string | null;
  text: string;
}

export function toSegments(text: string, runs: AuthorRun[]): AuthoredSegment[] {
  const segments: AuthoredSegment[] = [];
  let position = 0;
  for (const run of normalizeRuns(runs, text.length)) {
    segments.push({
      participantId: run.participantId,
      text: text.slice(position, position + run.length),
    });
    position += run.length;
  }
  return segments;
}

/** Number of characters of the current text written by each participant. */
export function charsByAuthor(runs: AuthorRun[] | null | undefined): Map<string | null, number> {
  const totals = new Map<string | null, number>();
  for (const run of runs ?? []) {
    totals.set(run.participantId, (totals.get(run.participantId) ?? 0) + run.length);
  }
  return totals;
}
