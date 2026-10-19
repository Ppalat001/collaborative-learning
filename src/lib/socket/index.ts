import type { Server as SocketServer } from "socket.io";

import { isSharedField, type SharedField } from "@/lib/instruments";
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

export function initSocketHandlers(io: SocketServer) {
  io.on("connection", (socket) => {
    socket.on(
      "room:join",
      (payload: { sessionCode: string; scenarioOrder: number; participantName: string }) => {
        const { sessionCode, scenarioOrder, participantName } = payload;
        const room = roomKey(sessionCode, scenarioOrder);
        socket.join(room);
        socket.data.sessionCode = sessionCode;
        socket.data.scenarioOrder = scenarioOrder;
        socket.data.participantName = participantName;

        io.to(room).emit("participant:joined", {
          participantName,
          participantCount: io.sockets.adapter.rooms.get(room)?.size ?? 1,
        });

        const state = getRoomState(sessionCode, scenarioOrder);
        if (state) socket.emit("room:state", state);
      }
    );

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
        const { sessionCode, scenarioOrder, field, value, authorship, updatedBy } = payload;
        if (!isSharedField(field) || typeof value !== "string") return;
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
        socket.to(roomKey(sessionCode, scenarioOrder)).emit("chat:message", message);
      }
    );

    socket.on(
      "ready:update",
      (payload: ReadyEvent & { sessionCode: string; scenarioOrder: number }) => {
        const { sessionCode, scenarioOrder, readyIds, submitted } = payload;
        socket
          .to(roomKey(sessionCode, scenarioOrder))
          .emit("ready:update", { readyIds, submitted } satisfies ReadyEvent);
      }
    );

    socket.on("disconnect", () => {
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
