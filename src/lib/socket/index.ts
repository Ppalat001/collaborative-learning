import type { Server as SocketServer } from "socket.io";

import type { ScaffoldingType } from "@/lib/types";

export interface RoomDiscussionState {
  discussionText: string;
  draftAnswer: string;
  updatedAt: string;
  updatedBy?: string;
}

export interface RoomScaffoldingState {
  scaffoldingType: ScaffoldingType;
  aiResponse: string;
  requestedBy: string;
  updatedAt: string;
}

const roomState = new Map<string, RoomDiscussionState>();
const scaffoldingState = new Map<string, RoomScaffoldingState>();

function roomKey(sessionCode: string, scenarioOrder: number): string {
  return `${sessionCode.toUpperCase()}:${scenarioOrder}`;
}

export function getRoomState(
  sessionCode: string,
  scenarioOrder: number
): RoomDiscussionState {
  const key = roomKey(sessionCode, scenarioOrder);
  return (
    roomState.get(key) ?? {
      discussionText: "",
      draftAnswer: "",
      updatedAt: new Date().toISOString(),
    }
  );
}

export function setRoomState(
  sessionCode: string,
  scenarioOrder: number,
  state: Partial<RoomDiscussionState>
) {
  const key = roomKey(sessionCode, scenarioOrder);
  const current = getRoomState(sessionCode, scenarioOrder);
  roomState.set(key, {
    ...current,
    ...state,
    updatedAt: new Date().toISOString(),
  });
}

export function getScaffoldingState(
  sessionCode: string,
  scenarioOrder: number
): RoomScaffoldingState | null {
  return scaffoldingState.get(roomKey(sessionCode, scenarioOrder)) ?? null;
}

export function setScaffoldingState(
  sessionCode: string,
  scenarioOrder: number,
  state: RoomScaffoldingState
) {
  scaffoldingState.set(roomKey(sessionCode, scenarioOrder), state);
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

        socket.emit("discussion:state", getRoomState(sessionCode, scenarioOrder));

        const scaffold = getScaffoldingState(sessionCode, scenarioOrder);
        if (scaffold) {
          socket.emit("scaffolding:state", scaffold);
        }
      }
    );

    socket.on(
      "scaffolding:update",
      (payload: {
        sessionCode: string;
        scenarioOrder: number;
        scaffoldingType: ScaffoldingType;
        aiResponse: string;
        requestedBy: string;
      }) => {
        const { sessionCode, scenarioOrder, scaffoldingType, aiResponse, requestedBy } =
          payload;
        const room = roomKey(sessionCode, scenarioOrder);
        const state: RoomScaffoldingState = {
          scaffoldingType,
          aiResponse,
          requestedBy,
          updatedAt: new Date().toISOString(),
        };
        setScaffoldingState(sessionCode, scenarioOrder, state);
        socket.to(room).emit("scaffolding:state", state);
      }
    );

    socket.on(
      "discussion:update",
      (payload: {
        sessionCode: string;
        scenarioOrder: number;
        discussionText: string;
        draftAnswer: string;
        updatedBy: string;
      }) => {
        const { sessionCode, scenarioOrder, discussionText, draftAnswer, updatedBy } =
          payload;
        const room = roomKey(sessionCode, scenarioOrder);
        const state: RoomDiscussionState = {
          discussionText,
          draftAnswer,
          updatedAt: new Date().toISOString(),
          updatedBy,
        };
        setRoomState(sessionCode, scenarioOrder, state);
        socket.to(room).emit("discussion:state", state);
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
