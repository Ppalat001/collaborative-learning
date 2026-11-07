import type { Server as SocketServer } from "socket.io";

/**
 * Server-side broadcasts. The Socket.IO server is created in server.ts and shared
 * through globalThis with Next route handlers (same process, different module
 * graph). Callers persist to the database first and broadcast afterwards.
 */

export interface RealtimeEvent {
  event: string;
  payload: unknown;
}

const globalForIo = globalThis as typeof globalThis & {
  __collabIo?: SocketServer;
  __collabEmitLog?: { target: string; event: string; payload: unknown }[];
};

export function setRealtimeServer(io: SocketServer) {
  globalForIo.__collabIo = io;
}

export function groupRoom(sessionCode: string, scenarioOrder: number): string {
  return `${sessionCode.toUpperCase()}:${scenarioOrder}`;
}

/** Private channel joined only after the participant's token was verified. */
export function participantRoom(participantId: string): string {
  return `participant:${participantId}`;
}

function record(target: string, event: string, payload: unknown) {
  // Captured in tests (no Socket.IO server) to assert routing.
  if (globalForIo.__collabEmitLog) globalForIo.__collabEmitLog.push({ target, event, payload });
}

export function emitToGroup(sessionCode: string, scenarioOrder: number, event: string, payload: unknown) {
  const target = groupRoom(sessionCode, scenarioOrder);
  record(target, event, payload);
  globalForIo.__collabIo?.to(target).emit(event, payload);
}

export function emitToParticipant(participantId: string, event: string, payload: unknown) {
  const target = participantRoom(participantId);
  record(target, event, payload);
  globalForIo.__collabIo?.to(target).emit(event, payload);
}

/** Test helper: start capturing emitted events. */
export function captureEmits(): { target: string; event: string; payload: unknown }[] {
  globalForIo.__collabEmitLog = [];
  return globalForIo.__collabEmitLog;
}
