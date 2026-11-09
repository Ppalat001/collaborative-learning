"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeEventName } from "@/hooks/useCollaboration";
import { participantHeaders } from "@/lib/client/participant";
import type {
  CheckpointView,
  ClientExposureKind,
  FeedbackAction,
  InterventionView,
  LearningAwareMemberState,
  ProgressFeedbackResponse,
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
  learningAware?: LearningAwareMemberState | null;
}

function byTime<T extends { createdAt: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function upsertById<T extends { id: string; createdAt: string }>(items: T[], next: T): T[] {
  return byTime([...items.filter((item) => item.id !== next.id), next]);
}

/** Where an error is shown: next to the Step 1 chat, or in Step 2 (private help). */
export type ErrorScope = "chat" | "private";

/**
 * V2 AI state for one scenario: group AI items for the Step 1 chat and this
 * member's private items. The database is the source of truth: socket events
 * are merged in, and everything is reloaded after a reconnect.
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
  const [error, setError] = useState<{ scope: ErrorScope; message: string } | null>(null);
  /** How long this member's group AI buttons wait, as reported by the server (retryAfterSeconds). */
  const [groupCooldown, setGroupCooldown] = useState<{ until: number; seconds: number } | null>(null);
  const [learningAware, setLearningAware] = useState<LearningAwareMemberState | null>(null);
  const viewedRef = useRef(new Set<string>());
  const exposedRef = useRef(new Set<string>());
  const learningAwareRef = useRef(false);
  const [loadedInitial, setLoadedInitial] = useState<InitialState | null>(null);

  if (initial !== loadedInitial) {
    setLoadedInitial(initial);
    if (initial) {
      setItems(byTime(initial.interventions));
      setSharedIdeas(byTime(initial.sharedIdeas));
      setCheckpoints(byTime(initial.checkpoints));
      setRoles(initial.roles);
      setLearningAware(initial.learningAware ?? null);
    }
  }

  useEffect(() => {
    learningAwareRef.current = Boolean(learningAware?.enabled);
  }, [learningAware]);

  /** policy-v2-3: what this member's client observed about an offer (once per kind and page load). */
  const reportExposure = useCallback(
    (id: string, kind: ClientExposureKind) => {
      const key = `${id}:${kind}`;
      if (!participantId || !learningAwareRef.current || exposedRef.current.has(key)) return;
      exposedRef.current.add(key);
      void fetch(`/api/sessions/${sessionCode}/interventions/${id}/exposure`, {
        method: "POST",
        headers: participantHeaders(),
        body: JSON.stringify({ participantId, kind, clientAt: new Date().toISOString() }),
      }).catch(() => undefined);
    },
    [sessionCode, participantId]
  );

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
          if (view?.scenarioOrder === scenarioOrder) {
            mergeView(view);
            if (event === "intervention:offered") reportExposure(view.id, "socket_delivered");
          }
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
    [scenarioOrder, mergeView, reportExposure]
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
    setLearningAware(data.learningAware ?? null);
  }, [sessionCode, scenarioOrder, participantId]);

  const post = useCallback(
    async (
      url: string,
      body: Record<string, unknown>,
      busyKey: string,
      scope: ErrorScope = "private",
      onRateLimited?: (retryAfterSeconds: number) => void
    ) => {
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
          const retryAfter = Number(data.retryAfterSeconds);
          if (res.status === 429 && onRateLimited && retryAfter > 0) onRateLimited(retryAfter);
          else setError({ scope, message: data.error ?? "Something went wrong" });
          return null;
        }
        return data;
      } catch {
        setError({ scope, message: "Could not reach the server" });
        return null;
      } finally {
        setBusy(null);
      }
    },
    [participantId, scenarioOrder]
  );

  const startGroupCooldown = useCallback((seconds: number) => {
    setGroupCooldown(seconds > 0 ? { until: Date.now() + seconds * 1000, seconds } : null);
  }, []);

  /** One click = one request id, so a retried network call cannot create a second reply. */
  const requestGroupHelp = async (supportType: string) => {
    const data = await post(
      `/api/sessions/${sessionCode}/interventions`,
      { kind: "group_request", supportType, requestId: crypto.randomUUID() },
      `group:${supportType}`,
      "chat",
      startGroupCooldown
    );
    if (data?.intervention) mergeView(data.intervention);
    if (data && Number(data.retryAfterSeconds) > 0) startGroupCooldown(Number(data.retryAfterSeconds));
  };

  const respond = async (id: string, action: FeedbackAction) => {
    const scope = items.find((item) => item.id === id)?.scope === "group" ? "chat" : "private";
    const data = await post(
      `/api/sessions/${sessionCode}/interventions/${id}/feedback`,
      { action },
      `${id}:${action}`,
      scope
    );
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

  /** One-click "Did this help you make progress?" (voluntary, once per suggestion). */
  const sendProgressFeedback = async (id: string, response: ProgressFeedbackResponse) => {
    const data = await post(`/api/sessions/${sessionCode}/interventions/${id}/progress`, { response }, `${id}:progress`);
    if (data?.response) {
      setLearningAware((current) =>
        current ? { ...current, progressFeedback: { ...current.progressFeedback, [id]: data.response } } : current
      );
    }
  };

  /** "Don't suggest again in this scenario" (private suggestions only). */
  const stopForScenario = async (interventionId: string | null) => {
    const data = await post(
      `/api/sessions/${sessionCode}/interventions`,
      { kind: "stop_proactive_for_scenario", interventionId },
      interventionId ? `${interventionId}:stop` : "stop"
    );
    if (!data?.stopped) return;
    if (data.intervention) setItems((current) => upsertById(current, data.intervention));
    setLearningAware((current) => (current ? { ...current, proactiveStopped: true } : current));
  };

  const groupItems = useMemo(() => items.filter((item) => item.scope === "group"), [items]);
  const privateItems = useMemo(() => items.filter((item) => item.scope === "individual"), [items]);

  const collaborate = (action: string, body: Record<string, unknown>, scope: ErrorScope = "private") =>
    post(`/api/sessions/${sessionCode}/collaboration`, { action, ...body }, action, scope);

  const share = async (sourceType: "individual_scaffold" | "intervention", sourceId: string, sharedText: string) => {
    const data = await collaborate("share", { sourceType, sourceId, sharedText, confirmed: true });
    if (data?.sharedIdea) setSharedIdeas((current) => upsertById(current, data.sharedIdea));
    return Boolean(data?.sharedIdea);
  };

  const raiseCheckpoint = async (kind: string) => {
    const data = await collaborate("checkpoint", { kind }, "chat");
    if (data?.checkpoint) setCheckpoints((current) => upsertById(current, data.checkpoint));
  };

  const chooseRole = async (role: string) => {
    const data = await collaborate("role", { role }, "chat");
    if (data?.chosen) setRoles(data.chosen);
  };

  return {
    items,
    groupItems,
    privateItems,
    sharedIdeas,
    checkpoints,
    roles,
    busy,
    errorFor: (scope: ErrorScope) => (error?.scope === scope ? error.message : null),
    groupCooldown,
    onRealtimeEvent,
    reload,
    requestGroupHelp,
    respond,
    markViewed,
    share,
    raiseCheckpoint,
    chooseRole,
    collaborate,
    learningAware,
    reportExposure,
    sendProgressFeedback,
    stopForScenario,
  };
}
