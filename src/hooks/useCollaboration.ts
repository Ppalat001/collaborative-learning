"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { applyEdit, diffText, normalizeRuns } from "@/lib/authorship";
import { SHARED_FIELDS, type SharedField } from "@/lib/instruments";
import type { AuthorRun, DiscussionMessage } from "@/lib/types";

export type SharedFields = Record<SharedField, string>;
export type SharedAuthorship = Record<SharedField, AuthorRun[]>;

export interface ReadyEvent {
  readyIds: string[];
  submitted: boolean;
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
  initialAuthorship: SharedAuthorship | null;
  initialMessages: DiscussionMessage[] | null;
  onReadyUpdate?: (event: ReadyEvent) => void;
}

const PERSIST_DELAY_MS = 800;

export const EMPTY_FIELDS: SharedFields = { finalAnswer: "" };
const EMPTY_AUTHORSHIP: SharedAuthorship = { finalAnswer: [] };

function mergeMessages(
  current: DiscussionMessage[],
  incoming: DiscussionMessage[]
): DiscussionMessage[] {
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function useCollaboration({
  sessionCode,
  scenarioOrder,
  participantName,
  participantId,
  initialFields,
  initialAuthorship,
  initialMessages,
  onReadyUpdate,
}: UseCollaborationOptions) {
  const [fields, setFields] = useState<SharedFields>(EMPTY_FIELDS);
  const [authorship, setAuthorship] = useState<SharedAuthorship>(EMPTY_AUTHORSHIP);
  const [messages, setMessages] = useState<DiscussionMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const [participantCount, setParticipantCount] = useState(1);
  const [lastUpdatedBy, setLastUpdatedBy] = useState<string | undefined>();

  const socketRef = useRef<Socket | null>(null);
  const fieldsRef = useRef<SharedFields>(EMPTY_FIELDS);
  const authorshipRef = useRef<SharedAuthorship>(EMPTY_AUTHORSHIP);
  const liveFieldsRef = useRef(new Set<SharedField>());
  const dirtyFieldsRef = useRef(new Set<SharedField>());
  const pendingEditsRef = useRef<Partial<Record<SharedField, PendingEdit>>>({});
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbacksRef = useRef({ onReadyUpdate });

  useEffect(() => {
    callbacksRef.current = { onReadyUpdate };
  }, [onReadyUpdate]);

  const applyFields = useCallback(
    (updates: Partial<SharedFields>, runs: Partial<SharedAuthorship> = {}) => {
      fieldsRef.current = { ...fieldsRef.current, ...updates };
      const nextAuthorship = { ...authorshipRef.current };
      for (const field of Object.keys(updates) as SharedField[]) {
        nextAuthorship[field] = normalizeRuns(
          runs[field] ?? authorshipRef.current[field],
          fieldsRef.current[field].length
        );
      }
      authorshipRef.current = nextAuthorship;
      setFields(fieldsRef.current);
      setAuthorship(nextAuthorship);
    },
    []
  );

  const applyLiveFields = useCallback(
    (updates: Partial<SharedFields>, runs?: Partial<SharedAuthorship>) => {
      for (const field of Object.keys(updates) as SharedField[]) {
        liveFieldsRef.current.add(field);
      }
      applyFields(updates, runs);
    },
    [applyFields]
  );

  const addMessages = useCallback((incoming: DiscussionMessage[]) => {
    setMessages((current) => mergeMessages(current, incoming));
  }, []);

  useEffect(() => {
    if (!initialFields) return;
    const updates: Partial<SharedFields> = {};
    const runs: Partial<SharedAuthorship> = {};
    for (const field of SHARED_FIELDS) {
      if (liveFieldsRef.current.has(field)) continue;
      updates[field] = initialFields[field];
      runs[field] = initialAuthorship?.[field] ?? [];
    }
    applyFields(updates, runs);
  }, [initialFields, initialAuthorship, applyFields]);

  const allMessages = useMemo(
    () => mergeMessages(initialMessages ?? [], messages),
    [initialMessages, messages]
  );

  /** Saves pending edits; resolves to an error message if the server rejected them. */
  const flush = useCallback(
    async (options?: { keepalive?: boolean }): Promise<string | null> => {
      if (persistTimer.current) {
        clearTimeout(persistTimer.current);
        persistTimer.current = null;
      }
      const dirty = [...dirtyFieldsRef.current];
      if (dirty.length === 0) return null;

      const changedFields: Partial<SharedFields> = {};
      for (const field of dirty) changedFields[field] = fieldsRef.current[field];
      const edits = Object.entries(pendingEditsRef.current).map(([field, edit]) => ({
        field,
        ...edit,
      }));
      dirtyFieldsRef.current.clear();
      pendingEditsRef.current = {};

      try {
        const res = await fetch(`/api/sessions/${sessionCode}/sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          keepalive: options?.keepalive,
          body: JSON.stringify({
            scenarioOrder,
            participantId,
            fields: changedFields,
            authorship: authorshipRef.current.finalAnswer,
            edits,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          return data.error ?? "Could not save the answer";
        }
        return null;
      } catch (error) {
        console.error(error);
        return "Could not save the answer";
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
      (state: {
        fields: Partial<SharedFields>;
        authorship?: Partial<SharedAuthorship>;
        updatedBy?: string;
      }) => {
        applyLiveFields(state.fields, state.authorship);
        setLastUpdatedBy(state.updatedBy);
      }
    );

    socket.on(
      "field:state",
      (payload: {
        field: SharedField;
        value: string;
        authorship?: AuthorRun[];
        updatedBy: string;
      }) => {
        applyLiveFields(
          { [payload.field]: payload.value },
          payload.authorship ? { [payload.field]: payload.authorship } : undefined
        );
        setLastUpdatedBy(payload.updatedBy);
      }
    );

    socket.on("ready:update", (event: ReadyEvent) => {
      callbacksRef.current.onReadyUpdate?.(event);
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
    const runs = applyEdit(authorshipRef.current[field], edit, participantId);
    const pending = pendingEditsRef.current[field] ?? {
      charsAdded: 0,
      charsRemoved: 0,
      insertedText: "",
    };
    pendingEditsRef.current[field] = {
      charsAdded: pending.charsAdded + edit.insertedText.length,
      charsRemoved: pending.charsRemoved + edit.removed,
      insertedText: pending.insertedText + edit.insertedText,
    };

    liveFieldsRef.current.add(field);
    dirtyFieldsRef.current.add(field);
    applyFields({ [field]: value }, { [field]: runs });

    socketRef.current?.emit("field:update", {
      sessionCode,
      scenarioOrder,
      field,
      value,
      authorship: authorshipRef.current[field],
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

  const broadcastReady = (event: ReadyEvent) => {
    socketRef.current?.emit("ready:update", { sessionCode, scenarioOrder, ...event });
  };

  return {
    fields,
    authorship,
    setField,
    messages: allMessages,
    sendMessage,
    flush,
    connected,
    participantCount,
    lastUpdatedBy,
    broadcastReady,
  };
}
