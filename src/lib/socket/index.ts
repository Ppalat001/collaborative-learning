import type { Server as SocketServer, Socket } from "socket.io";

import { checkParticipantToken } from "@/lib/auth/participantAuth";
import { isSharedField, type SharedField } from "@/lib/instruments";
import { registerPresence, unregisterPresence } from "@/lib/intervention/presence";
import { EligibilityError, eligibilityGuard } from "@/lib/intervention/ResearchEligibilityGuard";
import { participantRoom } from "@/lib/realtime/emit";
import { getParticipantInSession, getSessionByCode } from "@/lib/services/sessions";
import type { AuthorRun } from "@/lib/types";

/**
 * Only holds fields edited since the server started. Fields missing here are
 * left to the client's database copy, so a restart cannot blank them out.
 */
export interface RoomFieldState {
  fields: Partial<Record<SharedField, string>>;
  authorship: Partial<Record<SharedField, AuthorRun[]>>;
  updatedAt: string;
  updatedBy?: string;
}

export interface ReadyEvent {
  readyIds: string[];
  submitted: boolean;
}

const roomState = new Map<string, RoomFieldState>();

function roomKey(sessionCode: string, scenarioOrder: number): string {
  return `${sessionCode.toUpperCase()}:${scenarioOrder}`;
}

export function getRoomState(
  sessionCode: string,
  scenarioOrder: number
): RoomFieldState | null {
  return roomState.get(roomKey(sessionCode, scenarioOrder)) ?? null;
}

function setRoomField(
  sessionCode: string,
  scenarioOrder: number,
  field: SharedField,
  value: string,
  authorship: AuthorRun[] | undefined,
  updatedBy: string
) {
  const key = roomKey(sessionCode, scenarioOrder);
  const current = roomState.get(key);
  roomState.set(key, {
    fields: { ...current?.fields, [field]: value },
    authorship: authorship
      ? { ...current?.authorship, [field]: authorship }
      : { ...current?.authorship },
    updatedAt: new Date().toISOString(),
    updatedBy,
  });
}

/** Rooms of V2 groups; relays into them require an authorized socket. */
const globalForRooms = globalThis as typeof globalThis & { __collabV2Rooms?: Set<string> };
const v2Rooms = (globalForRooms.__collabV2Rooms ??= new Set<string>());

interface JoinPayload {
  sessionCode: string;
  scenarioOrder: number;
  participantName: string;
  participantId?: string;
  participantToken?: string;
}

type JoinResult =
  | { kind: "legacy" }
  | { kind: "v2"; sessionId: string; participantId: string; participantName: string }
  | { kind: "denied"; reason: string };

/**
 * V2 groups: the socket must present the participant's device token and belong
 * to the started roster with active consent. Legacy groups join as before.
 */
async function authorizeJoin(payload: JoinPayload): Promise<JoinResult> {
  const session = await getSessionByCode(String(payload.sessionCode ?? ""));
  if (!session) return { kind: "legacy" };
  const assignment = await eligibilityGuard.getAssignment(session.id);
  if (!assignment) return { kind: "legacy" };

  const participant = await getParticipantInSession(
    session.id,
    typeof payload.participantId === "string" ? payload.participantId : null
  );
  if (!participant) return { kind: "denied", reason: "not_member" };
  const check = checkParticipantToken({
    isV2: true,
    token: typeof payload.participantToken === "string" ? payload.participantToken : null,
    storedHash: participant.authTokenHash,
  });
  if (check !== "verified") return { kind: "denied", reason: "auth_failed" };
  try {
    await eligibilityGuard.assertScenarioAccess(assignment, participant.id);
  } catch (error) {
    return { kind: "denied", reason: error instanceof EligibilityError ? error.code : "denied" };
  }
  return {
    kind: "v2",
    sessionId: session.id,
    participantId: participant.id,
    participantName: participant.displayName,
  };
}

function canRelay(socket: Socket, sessionCode: string, scenarioOrder: number): boolean {
  const key = roomKey(String(sessionCode ?? ""), Number(scenarioOrder));
  if (!v2Rooms.has(key)) return true;
  return socket.data.v2Room === key;
}

export function initSocketHandlers(io: SocketServer) {
  io.on("connection", (socket) => {
    socket.on("room:join", async (payload: JoinPayload) => {
      const { sessionCode, scenarioOrder } = payload;
      const room = roomKey(sessionCode, scenarioOrder);
      let result: JoinResult;
      try {
        result = await authorizeJoin(payload);
      } catch (error) {
        console.error("Socket join check failed:", error);
        result = { kind: "denied", reason: "server_error" };
      }
      if (result.kind === "denied") {
        socket.emit("room:denied", { reason: result.reason });
        return;
      }

      const participantName =
        result.kind === "v2" ? result.participantName : payload.participantName;
      socket.join(room);
      socket.data.sessionCode = sessionCode;
      socket.data.scenarioOrder = scenarioOrder;
      socket.data.participantName = participantName;

      if (result.kind === "v2") {
        v2Rooms.add(room);
        socket.data.v2Room = room;
        socket.data.participantId = result.participantId;
        socket.join(participantRoom(result.participantId));
        registerPresence(
          { sessionId: result.sessionId, sessionCode, scenarioOrder },
          socket.id,
          result.participantId
        );
      }

      io.to(room).emit("participant:joined", {
        participantName,
        participantCount: io.sockets.adapter.rooms.get(room)?.size ?? 1,
      });

      const state = getRoomState(sessionCode, scenarioOrder);
      if (state) socket.emit("room:state", state);
    });

    socket.on(
      "field:update",
      (payload: {
        sessionCode: string;
        scenarioOrder: number;
        field: string;
        value: string;
        authorship?: AuthorRun[];
        updatedBy: string;
      }) => {
        const { sessionCode, scenarioOrder, field, value, authorship } = payload;
        if (!isSharedField(field) || typeof value !== "string") return;
        if (!canRelay(socket, sessionCode, scenarioOrder)) return;
        const updatedBy = socket.data.v2Room ? socket.data.participantName : payload.updatedBy;
        const runs = Array.isArray(authorship) ? authorship : undefined;
        setRoomField(sessionCode, scenarioOrder, field, value, runs, updatedBy);
        socket
          .to(roomKey(sessionCode, scenarioOrder))
          .emit("field:state", { field, value, authorship: runs, updatedBy });
      }
    );

    socket.on(
      "chat:message",
      (payload: { sessionCode: string; scenarioOrder: number; message: unknown }) => {
        const { sessionCode, scenarioOrder, message } = payload;
        if (!canRelay(socket, sessionCode, scenarioOrder)) return;
        socket.to(roomKey(sessionCode, scenarioOrder)).emit("chat:message", message);
      }
    );

    socket.on(
      "ready:update",
      (payload: ReadyEvent & { sessionCode: string; scenarioOrder: number }) => {
        const { sessionCode, scenarioOrder, readyIds, submitted } = payload;
        if (!canRelay(socket, sessionCode, scenarioOrder)) return;
        socket
          .to(roomKey(sessionCode, scenarioOrder))
          .emit("ready:update", { readyIds, submitted } satisfies ReadyEvent);
      }
    );

    socket.on("disconnect", () => {
      unregisterPresence(socket.id);
      const { sessionCode, scenarioOrder, participantName } = socket.data;
      if (sessionCode && scenarioOrder) {
        const room = roomKey(sessionCode, scenarioOrder);
        io.to(room).emit("participant:left", {
          participantName: participantName ?? "A member",
          participantCount: io.sockets.adapter.rooms.get(room)?.size ?? 0,
        });
      }
    });
  });
}
