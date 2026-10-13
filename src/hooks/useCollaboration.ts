"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { SHARED_FIELDS, type SharedField } from "@/lib/instruments";
import type { DiscussionMessage, ScaffoldingType } from "@/lib/types";

export type SharedFields = Record<SharedField, string>;

export interface RoomScaffoldingState {
  scaffoldingType: ScaffoldingType;
  helpReason: string;
  aiResponse: string;
  requestedBy: string;
  updatedAt: string;
}

export interface RoomSubmissionState {
  finalAnswer: string;
  ownWordsExplanation: string;
  submittedBy: string;
}

interface PendingEdit {
  charsAdded: number;
  charsRemoved: number;
  insertedText: string;
}

interface UseCollaborationOptions {
  sessionCode: string;
  scenarioOrder: number;
  participantName: string;
  participantId: string | null;
  /** Database copy of the shared boxes; null until the scenario has loaded. */
  initialFields: SharedFields | null;
  initialMessages: DiscussionMessage[] | null;
  onScaffoldingUpdate?: (state: RoomScaffoldingState) => void;
  onSubmitted?: (state: RoomSubmissionState) => void;
}

const PERSIST_DELAY_MS = 800;

export const EMPTY_FIELDS: SharedFields = {
  ownWordsExplanation: "",
  finalAnswer: "",
};

function mergeMessages(
  current: DiscussionMessage[],
  incoming: DiscussionMessage[]
): DiscussionMessage[] {
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function diffText(previous: string, next: string): PendingEdit {
  let prefix = 0;
  const maxPrefix = Math.min(previous.length, next.length);
  while (prefix < maxPrefix && previous[prefix] === next[prefix]) prefix++;

  let suffix = 0;
  const maxSuffix = Math.min(previous.length, next.length) - prefix;
  while (
    suffix < maxSuffix &&
    previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix++;
  }

  const insertedText = next.slice(prefix, next.length - suffix);
  return {
    charsAdded: insertedText.length,
    charsRemoved: previous.length - prefix - suffix,
    insertedText,
  };
}

export function useCollaboration({
  sessionCode,
  scenarioOrder,
  participantName,
  participantId,
  initialFields,
  initialMessages,
  onScaffoldingUpdate,
  onSubmitted,
}: UseCollaborationOptions) {
  const [fields, setFields] = useState<SharedFields>(EMPTY_FIELDS);
  const [messages, setMessages] = useState<DiscussionMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const [participantCount, setParticipantCount] = useState(1);
  const [lastUpdatedBy, setLastUpdatedBy] = useState<string | undefined>();

  const socketRef = useRef<Socket | null>(null);
  const fieldsRef = useRef<SharedFields>(EMPTY_FIELDS);
  const liveFieldsRef = useRef(new Set<SharedField>());
  const dirtyFieldsRef = useRef(new Set<SharedField>());
  const pendingEditsRef = useRef<Partial<Record<SharedField, PendingEdit>>>({});
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbacksRef = useRef({ onScaffoldingUpdate, onSubmitted });

  useEffect(() => {
    callbacksRef.current = { onScaffoldingUpdate, onSubmitted };
  }, [onScaffoldingUpdate, onSubmitted]);

  const applyFields = useCallback((updates: Partial<SharedFields>) => {
    fieldsRef.current = { ...fieldsRef.current, ...updates };
    setFields(fieldsRef.current);
  }, []);

  const applyLiveFields = useCallback(
    (updates: Partial<SharedFields>) => {
      for (const field of Object.keys(updates) as SharedField[]) {
        liveFieldsRef.current.add(field);
      }
      applyFields(updates);
    },
    [applyFields]
  );

  const addMessages = useCallback((incoming: DiscussionMessage[]) => {
    setMessages((current) => mergeMessages(current, incoming));
  }, []);

  useEffect(() => {
    if (!initialFields) return;
    const updates: Partial<SharedFields> = {};
    for (const field of SHARED_FIELDS) {
      if (!liveFieldsRef.current.has(field)) updates[field] = initialFields[field];
    }
    applyFields(updates);
  }, [initialFields, applyFields]);

  const allMessages = useMemo(
    () => mergeMessages(initialMessages ?? [], messages),
    [initialMessages, messages]
  );

  const flush = useCallback(
    async (options?: { keepalive?: boolean }) => {
      if (persistTimer.current) {
        clearTimeout(persistTimer.current);
        persistTimer.current = null;
      }
      const dirty = [...dirtyFieldsRef.current];
      if (dirty.length === 0) return;

      const changedFields: Partial<SharedFields> = {};
      for (const field of dirty) changedFields[field] = fieldsRef.current[field];
      const edits = Object.entries(pendingEditsRef.current).map(([field, edit]) => ({
        field,
        ...edit,
      }));
      dirtyFieldsRef.current.clear();
      pendingEditsRef.current = {};

      try {
        await fetch(`/api/sessions/${sessionCode}/sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          keepalive: options?.keepalive,
          body: JSON.stringify({
            scenarioOrder,
            participantId,
            fields: changedFields,
            edits,
          }),
        });
      } catch (error) {
        console.error(error);
      }
    },
    [sessionCode, scenarioOrder, participantId]
  );

  useEffect(() => {
    const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || window.location.origin;
    const socket = io(socketUrl, {
      transports: ["websocket", "polling"],
      path: "/socket.io",
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      socket.emit("room:join", { sessionCode, scenarioOrder, participantName });
      fetch(`/api/sessions/${sessionCode}/scenario/${scenarioOrder}`)
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data.messages)) addMessages(data.messages);
        })
        .catch(console.error);
    });

    socket.on("chat:message", (message: DiscussionMessage) => addMessages([message]));

    socket.on("disconnect", () => setConnected(false));

    socket.on(
      "room:state",
      (state: { fields: Partial<SharedFields>; updatedBy?: string }) => {
        applyLiveFields(state.fields);
        setLastUpdatedBy(state.updatedBy);
      }
    );

    socket.on(
      "field:state",
      (payload: { field: SharedField; value: string; updatedBy: string }) => {
        applyLiveFields({ [payload.field]: payload.value });
        setLastUpdatedBy(payload.updatedBy);
      }
    );

    socket.on("scaffolding:state", (state: RoomScaffoldingState) => {
      callbacksRef.current.onScaffoldingUpdate?.(state);
    });

    socket.on("scenario:submitted", (state: RoomSubmissionState) => {
      applyLiveFields({
        finalAnswer: state.finalAnswer,
        ownWordsExplanation: state.ownWordsExplanation,
      });
      callbacksRef.current.onSubmitted?.(state);
    });

    const onParticipantChange = (payload: { participantCount: number }) =>
      setParticipantCount(payload.participantCount);
    socket.on("participant:joined", onParticipantChange);
    socket.on("participant:left", onParticipantChange);

    return () => {
      socket.disconnect();
    };
  }, [sessionCode, scenarioOrder, participantName, applyLiveFields, addMessages]);

  useEffect(() => {
    return () => {
      void flush({ keepalive: true });
    };
  }, [flush]);

  const setField = (field: SharedField, value: string) => {
    const edit = diffText(fieldsRef.current[field], value);
    const pending = pendingEditsRef.current[field] ?? {
      charsAdded: 0,
      charsRemoved: 0,
      insertedText: "",
    };
    pendingEditsRef.current[field] = {
      charsAdded: pending.charsAdded + edit.charsAdded,
      charsRemoved: pending.charsRemoved + edit.charsRemoved,
      insertedText: pending.insertedText + edit.insertedText,
    };

    liveFieldsRef.current.add(field);
    dirtyFieldsRef.current.add(field);
    applyFields({ [field]: value });

    socketRef.current?.emit("field:update", {
      sessionCode,
      scenarioOrder,
      field,
      value,
      updatedBy: participantName,
    });

    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => void flush(), PERSIST_DELAY_MS);
  };

  const sendMessage = async (text: string) => {
    const res = await fetch(`/api/sessions/${sessionCode}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenarioOrder, participantId, text }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Failed to send message");
    addMessages([data.message]);
    socketRef.current?.emit("chat:message", {
      sessionCode,
      scenarioOrder,
      message: data.message,
    });
  };

  const broadcastScaffolding = (
    scaffoldingType: ScaffoldingType,
    helpReason: string,
    aiResponse: string
  ) => {
    socketRef.current?.emit("scaffolding:update", {
      sessionCode,
      scenarioOrder,
      scaffoldingType,
      helpReason,
      aiResponse,
      requestedBy: participantName,
    });
  };

  const broadcastSubmitted = (finalAnswer: string, ownWordsExplanation: string) => {
    socketRef.current?.emit("scenario:submitted", {
      sessionCode,
      scenarioOrder,
      finalAnswer,
      ownWordsExplanation,
      submittedBy: participantName,
    });
  };

  return {
    fields,
    setField,
    messages: allMessages,
    sendMessage,
    flush,
    connected,
    participantCount,
    lastUpdatedBy,
    broadcastScaffolding,
    broadcastSubmitted,
  };
}
