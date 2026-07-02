"use client";

import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import type { ScaffoldingType } from "@/lib/types";

interface RoomDiscussionState {
  discussionText: string;
  draftAnswer: string;
  updatedAt: string;
  updatedBy?: string;
}

interface RoomScaffoldingState {
  scaffoldingType: ScaffoldingType;
  aiResponse: string;
  requestedBy: string;
  updatedAt: string;
}

interface UseCollaborationOptions {
  sessionCode: string;
  scenarioOrder: number;
  participantName: string;
  initialDiscussion?: string;
  initialDraft?: string;
  onScaffoldingUpdate?: (state: RoomScaffoldingState) => void;
}

export function useCollaboration({
  sessionCode,
  scenarioOrder,
  participantName,
  initialDiscussion = "",
  initialDraft = "",
  onScaffoldingUpdate,
}: UseCollaborationOptions) {
  const [discussionText, setDiscussionText] = useState(initialDiscussion);
  const [draftAnswer, setDraftAnswer] = useState(initialDraft);
  const [connected, setConnected] = useState(false);
  const [participantCount, setParticipantCount] = useState(1);
  const [lastUpdatedBy, setLastUpdatedBy] = useState<string | undefined>();
  const socketRef = useRef<Socket | null>(null);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onScaffoldingUpdateRef = useRef(onScaffoldingUpdate);

  useEffect(() => {
    onScaffoldingUpdateRef.current = onScaffoldingUpdate;
  }, [onScaffoldingUpdate]);

  useEffect(() => {
    setDiscussionText(initialDiscussion);
    setDraftAnswer(initialDraft);
  }, [initialDiscussion, initialDraft, scenarioOrder]);

  useEffect(() => {
    const socketUrl =
      process.env.NEXT_PUBLIC_SOCKET_URL ?? window.location.origin;
    const socket = io(socketUrl, {
      transports: ["websocket", "polling"],
      path: "/socket.io",
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      socket.emit("room:join", {
        sessionCode,
        scenarioOrder,
        participantName,
      });
    });

    socket.on("disconnect", () => setConnected(false));

    socket.on("discussion:state", (state: RoomDiscussionState) => {
      setDiscussionText(state.discussionText);
      setDraftAnswer(state.draftAnswer);
      setLastUpdatedBy(state.updatedBy);
    });

    socket.on("scaffolding:state", (state: RoomScaffoldingState) => {
      onScaffoldingUpdateRef.current?.(state);
    });

    socket.on(
      "participant:joined",
      (payload: { participantName: string; participantCount: number }) => {
        setParticipantCount(payload.participantCount);
      }
    );

    socket.on(
      "participant:left",
      (payload: { participantName: string; participantCount: number }) => {
        setParticipantCount(payload.participantCount);
      }
    );

    return () => {
      socket.disconnect();
    };
  }, [sessionCode, scenarioOrder, participantName]);

  const schedulePersist = (nextDiscussion: string, nextDraft: string) => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      fetch(`/api/sessions/${sessionCode}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenarioOrder,
          discussionText: nextDiscussion,
          draftAnswer: nextDraft,
        }),
      }).catch(console.error);
    }, 800);
  };

  const broadcastUpdate = (nextDiscussion: string, nextDraft: string) => {
    setDiscussionText(nextDiscussion);
    setDraftAnswer(nextDraft);
    schedulePersist(nextDiscussion, nextDraft);
    socketRef.current?.emit("discussion:update", {
      sessionCode,
      scenarioOrder,
      discussionText: nextDiscussion,
      draftAnswer: nextDraft,
      updatedBy: participantName,
    });
  };

  const broadcastScaffolding = (
    scaffoldingType: ScaffoldingType,
    aiResponse: string
  ) => {
    socketRef.current?.emit("scaffolding:update", {
      sessionCode,
      scenarioOrder,
      scaffoldingType,
      aiResponse,
      requestedBy: participantName,
    });
  };

  return {
    discussionText,
    draftAnswer,
    connected,
    participantCount,
    lastUpdatedBy,
    setDiscussionText: (value: string) =>
      broadcastUpdate(value, draftAnswer),
    setDraftAnswer: (value: string) =>
      broadcastUpdate(discussionText, value),
    broadcastScaffolding,
  };
}
