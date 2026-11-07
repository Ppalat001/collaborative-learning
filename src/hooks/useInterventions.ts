"use client";

import { useCallback, useRef, useState } from "react";
import type { RealtimeEventName } from "@/hooks/useCollaboration";
import { participantHeaders } from "@/lib/client/participant";
import type {
  CheckpointView,
  FeedbackAction,
  InterventionView,
  SharedIdeaView,
} from "@/lib/intervention/types";

export interface ChosenRole {
  participantId: string;
  role: string;
}

interface InitialState {
  interventions: InterventionView[];
  sharedIdeas: SharedIdeaView[];
  checkpoints: CheckpointView[];
  roles: ChosenRole[];
}

function byTime<T extends { createdAt: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function upsertById<T extends { id: string; createdAt: string }>(items: T[], next: T): T[] {
  return byTime([...items.filter((item) => item.id !== next.id), next]);
}

/**
 * V2 facilitator state for one scenario. The database is the source of truth:
 * socket events are merged in, and everything is reloaded after a reconnect.
 */
export function useInterventions({
  sessionCode,
  scenarioOrder,
  participantId,
  initial,
}: {
  sessionCode: string;
  scenarioOrder: number;
  participantId: string | null;
  initial: InitialState | null;
}) {
  const [items, setItems] = useState<InterventionView[]>([]);
  const [sharedIdeas, setSharedIdeas] = useState<SharedIdeaView[]>([]);
  const [checkpoints, setCheckpoints] = useState<CheckpointView[]>([]);
  const [roles, setRoles] = useState<ChosenRole[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const viewedRef = useRef(new Set<string>());
  const [loadedInitial, setLoadedInitial] = useState<InitialState | null>(null);

  if (initial !== loadedInitial) {
    setLoadedInitial(initial);
    if (initial) {
      setItems(byTime(initial.interventions));
      setSharedIdeas(byTime(initial.sharedIdeas));
      setCheckpoints(byTime(initial.checkpoints));
      setRoles(initial.roles);
    }
  }

  /** Broadcast payloads carry no per-member feedback, so keep this member's own. */
  const mergeView = useCallback((view: InterventionView) => {
    setItems((current) => {
      const existing = current.find((item) => item.id === view.id);
      const merged = existing
        ? { ...view, myFeedback: existing.myFeedback, deferredUntil: existing.deferredUntil }
        : view;
      return upsertById(current, merged);
    });
  }, []);

  const onRealtimeEvent = useCallback(
    (event: RealtimeEventName, payload: unknown) => {
      switch (event) {
        case "intervention:offered":
        case "intervention:delivered":
        case "intervention:state": {
          const view = payload as InterventionView;
          if (view?.scenarioOrder === scenarioOrder) mergeView(view);
          break;
        }
        case "ideas:shared": {
          const idea = payload as SharedIdeaView;
          if (idea?.scenarioOrder === scenarioOrder) setSharedIdeas((current) => upsertById(current, idea));
          break;
        }
        case "checkpoint:raised": {
          const checkpoint = payload as CheckpointView;
          if (checkpoint?.scenarioOrder === scenarioOrder) {
            setCheckpoints((current) => upsertById(current, checkpoint));
          }
          break;
        }
        case "roles:updated": {
          const data = payload as { scenarioOrder: number; chosen: ChosenRole[] };
          if (data?.scenarioOrder === scenarioOrder) setRoles(data.chosen);
          break;
        }
        default:
          break;
      }
    },
    [scenarioOrder, mergeView]
  );

  const reload = useCallback(async () => {
    if (!participantId) return;
    const params = new URLSearchParams({ participantId, scenarioOrder: String(scenarioOrder) });
    const res = await fetch(`/api/sessions/${sessionCode}/interventions?${params}`, {
      headers: participantHeaders(false),
    });
    if (!res.ok) return;
    const data = await res.json();
    setItems(byTime(data.interventions ?? []));
    setSharedIdeas(byTime(data.sharedIdeas ?? []));
    setCheckpoints(byTime(data.checkpoints ?? []));
  }, [sessionCode, scenarioOrder, participantId]);

  const post = useCallback(
    async (url: string, body: Record<string, unknown>, busyKey: string) => {
      setBusy(busyKey);
      setError(null);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: participantHeaders(),
          body: JSON.stringify({ participantId, scenarioOrder, ...body }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error ?? "Something went wrong");
          return null;
        }
        return data;
      } catch {
        setError("Could not reach the server");
        return null;
      } finally {
        setBusy(null);
      }
    },
    [participantId, scenarioOrder]
  );

  const requestGroupHelp = async (supportType: string) => {
    const data = await post(
      `/api/sessions/${sessionCode}/interventions`,
      { kind: "group_request", supportType, requestId: crypto.randomUUID() },
      `group:${supportType}`
    );
    if (data?.intervention) mergeView(data.intervention);
  };

  const requestPersonal = async () => {
    const data = await post(
      `/api/sessions/${sessionCode}/interventions`,
      { kind: "personal_request", requestId: crypto.randomUUID() },
      "personal"
    );
    if (data?.intervention) setItems((current) => upsertById(current, data.intervention));
  };

  const respond = async (id: string, action: FeedbackAction) => {
    const data = await post(`/api/sessions/${sessionCode}/interventions/${id}/feedback`, { action }, `${id}:${action}`);
    if (data?.intervention) setItems((current) => upsertById(current, data.intervention));
  };

  /** Records that this member saw an offer (once per page load). */
  const markViewed = useCallback(
    (id: string) => {
      if (!participantId || viewedRef.current.has(id)) return;
      viewedRef.current.add(id);
      void fetch(`/api/sessions/${sessionCode}/interventions/${id}/feedback`, {
        method: "POST",
        headers: participantHeaders(),
        body: JSON.stringify({ participantId, action: "viewed" }),
      }).catch(() => undefined);
    },
    [sessionCode, participantId]
  );

  const collaborate = (action: string, body: Record<string, unknown>) =>
    post(`/api/sessions/${sessionCode}/collaboration`, { action, ...body }, action);

  const share = async (sourceType: "individual_scaffold" | "intervention", sourceId: string, sharedText: string) => {
    const data = await collaborate("share", { sourceType, sourceId, sharedText, confirmed: true });
    if (data?.sharedIdea) setSharedIdeas((current) => upsertById(current, data.sharedIdea));
    return Boolean(data?.sharedIdea);
  };

  const raiseCheckpoint = async (kind: string) => {
    const data = await collaborate("checkpoint", { kind });
    if (data?.checkpoint) setCheckpoints((current) => upsertById(current, data.checkpoint));
  };

  const chooseRole = async (role: string) => {
    const data = await collaborate("role", { role });
    if (data?.chosen) setRoles(data.chosen);
  };

  return {
    items,
    groupItems: items.filter((item) => item.scope === "group"),
    privateItems: items.filter((item) => item.scope === "individual"),
    sharedIdeas,
    checkpoints,
    roles,
    busy,
    error,
    onRealtimeEvent,
    reload,
    requestGroupHelp,
    requestPersonal,
    respond,
    markViewed,
    share,
    raiseCheckpoint,
    chooseRole,
    collaborate,
  };
}
