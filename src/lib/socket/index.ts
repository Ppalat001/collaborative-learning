import type { Server as SocketServer } from "socket.io";

import { isSharedField, type SharedField } from "@/lib/instruments";
import type { ProposalEvent, ScaffoldingType } from "@/lib/types";

/**
 * Only holds fields edited since the server started. Fields missing here are
 * left to the client's database copy, so a restart cannot blank them out.
 */
export interface RoomFieldState {
  fields: Partial<Record<SharedField, string>>;
  updatedAt: string;
  updatedBy?: string;
}

export interface RoomScaffoldingState {
  scaffoldingType: ScaffoldingType;
  helpReason: string;
  aiResponse: string;
  proposedBy: string;
  agreedBy: string;
  updatedAt: string;
}

export interface RoomSubmissionState {
  finalAnswer: string;
  ownWordsExplanation: string;
  submittedBy: string;
}

const roomState = new Map<string, RoomFieldState>();
const scaffoldingState = new Map<string, RoomScaffoldingState>();

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
  updatedBy: string
) {
  const key = roomKey(sessionCode, scenarioOrder);
  const current = roomState.get(key);
  roomState.set(key, {
    fields: { ...current?.fields, [field]: value },
    updatedAt: new Date().toISOString(),
    updatedBy,
  });
}

export function getScaffoldingState(
  sessionCode: string,
  scenarioOrder: number
): RoomScaffoldingState | null {
  return scaffoldingState.get(roomKey(sessionCode, scenarioOrder)) ?? null;
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

        const scaffold = getScaffoldingState(sessionCode, scenarioOrder);
        if (scaffold) socket.emit("scaffolding:state", scaffold);
      }
    );

    socket.on(
      "field:update",
      (payload: {
        sessionCode: string;
        scenarioOrder: number;
        field: string;
        value: string;
        updatedBy: string;
      }) => {
        const { sessionCode, scenarioOrder, field, value, updatedBy } = payload;
        if (!isSharedField(field) || typeof value !== "string") return;
        setRoomField(sessionCode, scenarioOrder, field, value, updatedBy);
        socket
          .to(roomKey(sessionCode, scenarioOrder))
          .emit("field:state", { field, value, updatedBy });
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
      "scaffolding:update",
      (payload: {
        sessionCode: string;
        scenarioOrder: number;
        scaffoldingType: ScaffoldingType;
        helpReason: string;
        aiResponse: string;
        proposedBy: string;
        agreedBy: string;
      }) => {
        const { sessionCode, scenarioOrder, ...rest } = payload;
        const state: RoomScaffoldingState = {
          ...rest,
          updatedAt: new Date().toISOString(),
        };
        scaffoldingState.set(roomKey(sessionCode, scenarioOrder), state);
        socket.to(roomKey(sessionCode, scenarioOrder)).emit("scaffolding:state", state);
      }
    );

    socket.on(
      "proposal:update",
      (payload: { sessionCode: string; scenarioOrder: number; event: ProposalEvent }) => {
        const { sessionCode, scenarioOrder, event } = payload;
        socket.to(roomKey(sessionCode, scenarioOrder)).emit("proposal:update", event);
      }
    );

    socket.on(
      "scenario:submitted",
      (payload: RoomSubmissionState & { sessionCode: string; scenarioOrder: number }) => {
        const { sessionCode, scenarioOrder, ...submission } = payload;
        socket.to(roomKey(sessionCode, scenarioOrder)).emit("scenario:submitted", submission);
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
