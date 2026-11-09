"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DiscussionChat } from "@/components/DiscussionChat";
import { GroupAIFacilitatorPanel } from "@/components/GroupAIFacilitatorPanel";
import { GroupSuggestionIndicator } from "@/components/GroupSuggestionIndicator";
import { GroupAnswerEditor, GroupAnswerNote } from "@/components/GroupAnswerEditor";
import { GroupDiscussionStarter } from "@/components/GroupDiscussionStarter";
import { MetacognitionPrompt, type MetacognitionAnswers } from "@/components/MetacognitionPrompt";
import { NoExternalCallsNote } from "@/components/NoExternalCallsNote";
import { AcceptedSuggestions, PrivateSuggestionPopup } from "@/components/PrivateSuggestionPopup";
import { ScaffoldingSelector } from "@/components/ScaffoldingSelector";
import { SurveyForm, type SurveyAnswers } from "@/components/SurveyForm";
import { InitialIdeaForm, ShareIdeaControl, type ShareSource } from "@/components/V2PrivateTools";
import {
  useCollaboration,
  type ReadyEvent,
  type SharedAuthorship,
  type SharedFields,
} from "@/hooks/useCollaboration";
import { useInterventions } from "@/hooks/useInterventions";
import { participantHeaders } from "@/lib/client/participant";
import type { ScenarioV2State } from "@/lib/services/interventions";
import type { publicStudyInfo } from "@/lib/services/studyV2";
import {
  getScaffoldingOption,
  type DiscussionMessage,
  type GroupMember,
  type IndividualScaffold,
  type Scenario,
  type ScaffoldingType,
} from "@/lib/types";

type ScenarioV2 = ScenarioV2State & ReturnType<typeof publicStudyInfo>;

interface ScenarioViewProps {
  sessionCode: string;
  scenarioOrder: number;
  totalScenarios: number;
  participantName: string;
  participantId: string | null;
}

function metacognitionStorageKey(code: string, order: number, participantId: string) {
  return `metacognition:${code}:${order}:${participantId}`;
}

function readStoredMetacognition(
  code: string,
  order: number,
  participantId: string
): MetacognitionAnswers | null {
  try {
    const raw = sessionStorage.getItem(metacognitionStorageKey(code, order, participantId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MetacognitionAnswers;
    if (
      Number.isInteger(parsed.answerConfidence) &&
      parsed.answerConfidence >= 1 &&
      parsed.answerConfidence <= 5 &&
      parsed.confidenceReason?.trim() &&
      parsed.doDifferently?.trim()
    ) {
      return parsed;
    }
  } catch {
    /* ignore a corrupted draft */
  }
  return null;
}

function Step({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">
        <span className="mr-2 text-indigo-600">Step {number}.</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

export function ScenarioView({
  sessionCode,
  scenarioOrder,
  totalScenarios,
  participantName,
  participantId,
}: ScenarioViewProps) {
  const router = useRouter();
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [scaffolds, setScaffolds] = useState<IndividualScaffold[]>([]);
  const [loadingTypes, setLoadingTypes] = useState<ScaffoldingType[]>([]);
  const [readyIds, setReadyIds] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [initialFields, setInitialFields] = useState<SharedFields | null>(null);
  const [initialAuthorship, setInitialAuthorship] = useState<SharedAuthorship | null>(null);
  const [initialMessages, setInitialMessages] = useState<DiscussionMessage[] | null>(null);
  const [surveyCompleted, setSurveyCompleted] = useState(false);
  const [metacognition, setMetacognition] = useState<MetacognitionAnswers | null>(() =>
    participantId
      ? readStoredMetacognition(sessionCode, scenarioOrder, participantId)
      : null
  );
  const [loading, setLoading] = useState(true);
  const [readyBusy, setReadyBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [v2, setV2] = useState<ScenarioV2 | null>(null);
  const [agreementReason, setAgreementReason] = useState("");
  const fetchScenario = useCallback(async () => {
    const query = participantId ? `?participantId=${encodeURIComponent(participantId)}` : "";
    const res = await fetch(`/api/sessions/${sessionCode}/scenario/${scenarioOrder}${query}`, {
      headers: participantHeaders(false),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Failed to load scenario");
    return data;
  }, [sessionCode, scenarioOrder, participantId]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchScenario();
        setScenario(data.scenario);
        setMembers(data.members ?? []);
        setScaffolds(data.myScaffolds ?? []);
        setReadyIds(data.attempt.readyIds ?? []);
        setSubmitted(!!data.attempt.submitted);
        setInitialFields({ finalAnswer: data.attempt.finalAnswer ?? "" });
        setInitialAuthorship({ finalAnswer: data.attempt.finalAnswerAuthorship ?? [] });
        setInitialMessages(data.messages ?? []);
        setSurveyCompleted(!!data.surveyCompleted);
        setV2(data.v2 ?? null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [fetchScenario]);

  const onReadyUpdate = useCallback(
    (event: ReadyEvent) => {
      setReadyIds(event.readyIds);
      if (event.submitted) setSubmitted(true);
      // A member who joined after this page loaded would otherwise be missing from the bar.
      if (event.readyIds.some((id) => !members.some((m) => m.id === id))) {
        fetchScenario()
          .then((data) => setMembers(data.members ?? []))
          .catch(console.error);
      }
    },
    [members, fetchScenario]
  );

  const initialInterventions = useMemo(
    () =>
      v2
        ? {
            interventions: v2.interventions,
            sharedIdeas: v2.sharedIdeas,
            checkpoints: v2.checkpoints?.raised ?? [],
            roles: v2.roles?.chosen ?? [],
            learningAware: v2.learningAware ?? null,
          }
        : null,
    [v2]
  );
  const interventions = useInterventions({
    sessionCode,
    scenarioOrder,
    participantId,
    initial: initialInterventions,
  });

  const collaboration = useCollaboration({
    sessionCode,
    scenarioOrder,
    participantName,
    participantId,
    initialFields,
    initialAuthorship,
    initialMessages,
    onReadyUpdate,
    onRealtimeEvent: v2 ? interventions.onRealtimeEvent : undefined,
    onReconnect: v2 ? interventions.reload : undefined,
  });
  const { fields, authorship } = collaboration;

  const goToNext = () => {
    if (scenarioOrder < totalScenarios) {
      router.push(`/session/${sessionCode}/scenario/${scenarioOrder + 1}`);
    } else {
      router.push(`/session/${sessionCode}/complete`);
    }
  };

  const toggleSupport = async (scaffoldingType: ScaffoldingType, select: boolean) => {
    const cached = scaffolds.find((s) => s.scaffoldingType === scaffoldingType);
    setError(null);
    if (cached) {
      setScaffolds((current) =>
        current.map((s) => (s.scaffoldingType === scaffoldingType ? { ...s, selected: select } : s))
      );
    } else {
      setLoadingTypes((current) => [...current, scaffoldingType]);
    }
    try {
      const res = await fetch(`/api/sessions/${sessionCode}/scaffold`, {
        method: "POST",
        headers: participantHeaders(),
        body: JSON.stringify({
          action: select ? "select" : "unselect",
          scenarioOrder,
          participantId,
          scaffoldingType,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "AI support failed");
      const scaffold = data.scaffold as IndividualScaffold | null;
      if (scaffold) {
        setScaffolds((current) => [
          ...current.filter((s) => s.scaffoldingType !== scaffoldingType),
          scaffold,
        ]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI support failed");
      if (cached) {
        setScaffolds((current) =>
          current.map((s) => (s.scaffoldingType === scaffoldingType ? cached : s))
        );
      }
    } finally {
      setLoadingTypes((current) => current.filter((t) => t !== scaffoldingType));
    }
  };

  const setReady = async (ready: boolean) => {
    setReadyBusy(true);
    setError(null);
    try {
      const saveError = await collaboration.flush();
      if (saveError) throw new Error(saveError);
      const res = await fetch(`/api/sessions/${sessionCode}/scenario/${scenarioOrder}`, {
        method: "PUT",
        headers: participantHeaders(),
        body: JSON.stringify({
          action: "ready",
          participantId,
          ready,
          ...(v2 && v2.agreementReasonMode !== "off" ? { agreementReason } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not update");
      const event: ReadyEvent = { readyIds: data.readyIds, submitted: data.submitted };
      setReadyIds(event.readyIds);
      if (event.submitted) setSubmitted(true);
      collaboration.broadcastReady(event);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update");
    } finally {
      setReadyBusy(false);
    }
  };

  const submitSurvey = async (answers: SurveyAnswers) => {
    if (!scenario) return;
    setError(null);
    const res = await fetch(`/api/sessions/${sessionCode}/survey`, {
      method: "POST",
      headers: participantHeaders(),
      body: JSON.stringify({
        scenarioId: scenario.id,
        participantId,
        ...answers,
        ...metacognition,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Failed to save your rating");
      return;
    }
    setSurveyCompleted(true);
    if (participantId) {
      sessionStorage.removeItem(
        metacognitionStorageKey(sessionCode, scenarioOrder, participantId)
      );
    }
    goToNext();
  };

  const saveMetacognition = (answers: MetacognitionAnswers) => {
    if (participantId) {
      sessionStorage.setItem(
        metacognitionStorageKey(sessionCode, scenarioOrder, participantId),
        JSON.stringify(answers)
      );
    }
    setMetacognition(answers);
  };

  const submitInitialIdea = async (text: string) => {
    const data = await interventions.collaborate("initial_idea", { text });
    if (data?.initialIdea) {
      setV2((current) => (current ? { ...current, initialIdea: { ...current.initialIdea, ...data.initialIdea } } : current));
    }
  };

  if (loading || !scenario) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-600">
        {error ?? "Loading scenario..."}
      </div>
    );
  }

  const ideaBlocksAi =
    !!v2 && v2.initialIdea.mode === "required" && !v2.initialIdea.submitted && !submitted;
  const showFacilitator =
    !!v2 && (v2.capabilities.sharedManual || v2.capabilities.proactiveGroup || v2.capabilities.sharing);
  const suggestions = v2?.capabilities.adaptivePrivate
    ? interventions.privateItems.filter((item) => item.trigger === "adaptive_need")
    : [];
  const shareSources: ShareSource[] = v2?.capabilities.sharing
    ? [
        ...scaffolds
          .filter((s) => s.selected && s.scaffoldingType !== "full_answer")
          .map((s) => ({
            sourceType: "individual_scaffold" as const,
            sourceId: s.scaffoldingType,
            label: getScaffoldingOption(s.scaffoldingType)?.label ?? s.scaffoldingType,
            text: s.aiResponse,
          })),
        ...interventions.privateItems
          .filter((item) => item.status === "delivered" && item.content)
          .map((item) => ({
            sourceType: "intervention" as const,
            sourceId: item.id,
            label: `Suggestion: ${item.supportLabel}`,
            text: item.content ?? "",
          })),
      ]
    : [];
  const myReady = !!participantId && readyIds.includes(participantId);

  return (
    <div className="space-y-6">
      <header className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-indigo-600">
              Scenario {scenarioOrder} of {totalScenarios}
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-900">
              {scenario.title}
            </h1>
          </div>
          <div className="text-sm text-slate-500">
            {collaboration.connected ? "Live sync on" : "Connecting..."} ·{" "}
            {collaboration.participantCount} online
          </div>
        </div>
        <p className="mt-4 whitespace-pre-line text-slate-700">{scenario.description}</p>
        <p className="mt-3 rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
          <span className="font-medium">Discuss:</span> {scenario.promptForGroup}
          <span className="mt-2 block font-medium text-slate-600">
            Keep your final answer concise.
          </span>
        </p>
        <NoExternalCallsNote compact className="mt-4" />
      </header>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-700">
          {error}
        </div>
      )}
      {collaboration.denied && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-700">
          Live updates are off because this device is not signed in for this group. Go back to the lobby on
          the device you joined with.
        </div>
      )}

      {v2 && (
        <GroupDiscussionStarter
          openingPrompt={v2.openingPrompt}
          roles={v2.roles}
          chosenRoles={interventions.roles}
          members={members}
          participantId={participantId}
          locked={submitted}
          busy={interventions.busy}
          onChooseRole={interventions.chooseRole}
        />
      )}

      <Step number={1} title="Group discussion">
        <DiscussionChat
          messages={collaboration.messages}
          participantId={participantId}
          disabled={submitted}
          onSend={collaboration.sendMessage}
          prompts={
            v2?.checkpoints?.kinds
              ? {
                  kinds: v2.checkpoints.kinds,
                  raised: interventions.checkpoints,
                  busy: interventions.busy === "checkpoint",
                  onRaise: interventions.raiseCheckpoint,
                }
              : null
          }
        />
        {v2 && showFacilitator && interventions.learningAware?.enabled && !submitted && (
          <GroupSuggestionIndicator items={interventions.groupItems} onExposure={interventions.reportExposure} />
        )}
      </Step>

      {v2 && showFacilitator && (
        <GroupAIFacilitatorPanel
          items={interventions.groupItems}
          sharedIdeas={interventions.sharedIdeas}
          manualTypes={v2.manualGroupSupport}
          locked={submitted}
          busy={interventions.busy}
          error={interventions.error}
          onRequest={interventions.requestGroupHelp}
          onRespond={interventions.respond}
          onViewed={interventions.markViewed}
          learningAware={interventions.learningAware}
          onExposure={interventions.reportExposure}
          onProgressFeedback={interventions.sendProgressFeedback}
        />
      )}

      <Step number={2} title="AI support (just for you)">
        <p className="mt-1 text-sm text-slate-600">
          This step is individual: only you can see the support you choose here. Select as
          many options as you like, and unselect any of them to hide it again. Each answer
          is created once and kept, so selecting it again shows the same answer. Not
          selecting anything is fine too.
        </p>
        {v2 && v2.initialIdea.mode !== "off" && (
          <InitialIdeaForm
            mode={v2.initialIdea.mode}
            submitted={v2.initialIdea.submitted}
            text={v2.initialIdea.text}
            busy={interventions.busy === "initial_idea"}
            onSubmit={submitInitialIdea}
          />
        )}
        {v2?.recommendation && !v2.capabilities.proactivePrivate && (
          <p className="mt-3 text-xs text-slate-600">
            Suggested starting point: <strong>{v2.recommendation.label}</strong>. You can choose any option.
          </p>
        )}
        <div className="mt-4">
          <ScaffoldingSelector
            scaffolds={scaffolds}
            loading={loadingTypes}
            locked={submitted}
            disabled={!participantId || ideaBlocksAi}
            onToggle={toggleSupport}
          />
        </div>
        <AcceptedSuggestions
          items={suggestions}
          learningAware={interventions.learningAware}
          locked={submitted}
          busy={interventions.busy}
          onProgressFeedback={interventions.sendProgressFeedback}
        />
        {v2?.capabilities.sharing && !submitted && (
          <ShareIdeaControl
            sources={shareSources}
            busy={interventions.busy === "share"}
            onShare={(source, text) => interventions.share(source.sourceType, source.sourceId, text)}
          />
        )}
        {v2 && interventions.error && (
          <p className="mt-3 text-sm text-red-700">{interventions.error}</p>
        )}
      </Step>

      <Step number={3} title="Final group answer">
        <GroupAnswerNote />
        {v2 && v2.agreementReasonMode !== "off" && !submitted && !myReady && (
          <label className="mt-3 block text-sm text-slate-700">
            Before you click &quot;I am good&quot;: in one sentence, why do you agree with this answer?
            {v2.agreementReasonMode === "optional" && " (optional)"}
            <textarea
              value={agreementReason}
              maxLength={500}
              onChange={(e) => setAgreementReason(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
        )}
        <GroupAnswerEditor
          value={fields.finalAnswer}
          authorship={authorship.finalAnswer}
          members={members}
          participantId={participantId}
          readyIds={readyIds}
          submitted={submitted}
          readyBusy={readyBusy}
          onChange={(value) => collaboration.setField("finalAnswer", value)}
          onReadyChange={setReady}
        />
      </Step>

      {submitted && !surveyCompleted && participantId && !metacognition && (
        <MetacognitionPrompt finalAnswer={fields.finalAnswer} onContinue={saveMetacognition} />
      )}

      {submitted && !surveyCompleted && metacognition && (
        <SurveyForm
          aiUsed={scaffolds.length > 0 || interventions.privateItems.some((item) => item.status === "delivered")}
          canSubmit={!!participantId}
          onSubmit={submitSurvey}
        />
      )}

      {submitted && surveyCompleted && (
        <div className="flex gap-3">
          <button
            type="button"
            onClick={goToNext}
            className="rounded-lg bg-indigo-600 px-5 py-2.5 text-white hover:bg-indigo-700"
          >
            {scenarioOrder < totalScenarios ? "Next scenario" : "Finish study"}
          </button>
        </div>
      )}

      {v2?.capabilities.adaptivePrivate && participantId && (
        <PrivateSuggestionPopup
          items={suggestions}
          locked={submitted || ideaBlocksAi}
          busy={interventions.busy}
          onRespond={interventions.respond}
          onViewed={interventions.markViewed}
          learningAware={interventions.learningAware}
          onExposure={interventions.reportExposure}
          onStop={(id) => void interventions.stopForScenario(id)}
        />
      )}
    </div>
  );
}
