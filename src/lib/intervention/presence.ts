/**
 * Which authenticated V2 members are connected to which scenario room. Kept on
 * globalThis because server.ts (tsx) and Next route handlers load separate module
 * graphs in the same process. In-memory only: after a restart presence rebuilds as
 * clients reconnect, which can only delay (never trigger) silence-based prompts.
 */

export interface RoomPresence {
  sessionId: string;
  sessionCode: string;
  scenarioOrder: number;
  /** socket id -> participant id */
  sockets: Map<string, string>;
  /** For k = 1..4: since when at least k distinct members have been continuously online. */
  onlineSince: Map<number, string>;
}

interface PresenceStore {
  rooms: Map<string, RoomPresence>;
  socketRoom: Map<string, string>;
}

const globalForPresence = globalThis as typeof globalThis & { __collabPresence?: PresenceStore };

function store(): PresenceStore {
  if (!globalForPresence.__collabPresence) {
    globalForPresence.__collabPresence = { rooms: new Map(), socketRoom: new Map() };
  }
  return globalForPresence.__collabPresence;
}

export function presenceKey(sessionCode: string, scenarioOrder: number): string {
  return `${sessionCode.toUpperCase()}:${scenarioOrder}`;
}

function distinctCount(room: RoomPresence): number {
  return new Set(room.sockets.values()).size;
}

function updateThresholds(room: RoomPresence, now: string) {
  const count = distinctCount(room);
  for (let k = 1; k <= 4; k++) {
    if (count >= k) {
      if (!room.onlineSince.has(k)) room.onlineSince.set(k, now);
    } else {
      room.onlineSince.delete(k);
    }
  }
}

export function registerPresence(
  info: { sessionId: string; sessionCode: string; scenarioOrder: number },
  socketId: string,
  participantId: string,
  now = new Date().toISOString()
): RoomPresence {
  unregisterPresence(socketId, now);
  const key = presenceKey(info.sessionCode, info.scenarioOrder);
  const rooms = store().rooms;
  let room = rooms.get(key);
  if (!room) {
    room = { ...info, sessionCode: info.sessionCode.toUpperCase(), sockets: new Map(), onlineSince: new Map() };
    rooms.set(key, room);
  }
  room.sockets.set(socketId, participantId);
  store().socketRoom.set(socketId, key);
  updateThresholds(room, now);
  return room;
}

export function unregisterPresence(socketId: string, now = new Date().toISOString()) {
  const { rooms, socketRoom } = store();
  const key = socketRoom.get(socketId);
  if (!key) return null;
  socketRoom.delete(socketId);
  const room = rooms.get(key);
  if (!room) return null;
  const participantId = room.sockets.get(socketId) ?? null;
  room.sockets.delete(socketId);
  updateThresholds(room, now);
  if (room.sockets.size === 0) rooms.delete(key);
  return { room, participantId, stillOnline: participantId ? [...room.sockets.values()].includes(participantId) : false };
}

export function getOnlineParticipantIds(sessionCode: string, scenarioOrder: number): string[] {
  const room = store().rooms.get(presenceKey(sessionCode, scenarioOrder));
  return room ? [...new Set(room.sockets.values())] : [];
}

export function getOnlineSince(
  sessionCode: string,
  scenarioOrder: number,
  minMembers: number
): string | null {
  const room = store().rooms.get(presenceKey(sessionCode, scenarioOrder));
  return room?.onlineSince.get(Math.max(1, minMembers)) ?? null;
}

export function listActiveRooms(): RoomPresence[] {
  return [...store().rooms.values()].filter((room) => room.sockets.size > 0);
}

/** Test helper. */
export function resetPresence() {
  const s = store();
  s.rooms.clear();
  s.socketRoom.clear();
}
