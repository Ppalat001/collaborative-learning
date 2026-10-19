"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { DiscussionChat } from "@/components/DiscussionChat";
import { GroupAnswerEditor, GroupAnswerNote } from "@/components/GroupAnswerEditor";
import { ScaffoldingSelector } from "@/components/ScaffoldingSelector";
import { SurveyForm, type SurveyAnswers } from "@/components/SurveyForm";
import {
  useCollaboration,
  type ReadyEvent,
  type SharedAuthorship,
  type SharedFields,
} from "@/hooks/useCollaboration";
import type {
  DiscussionMessage,
  GroupMember,
  IndividualScaffold,
  Scenario,
  ScaffoldingType,
} from "@/lib/types";

interface ScenarioViewProps {
  sessionCode: string;
  scenarioOrder: number;
  totalScenarios: number;
  participantName: string;
  participantId: string | null;
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
  const [loading, setLoading] = useState(true);
  const [readyBusy, setReadyBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchScenario = useCallback(async () => {
    const query = participantId ? `?participantId=${encodeURIComponent(participantId)}` : "";
    const res = await fetch(`/api/sessions/${sessionCode}/scenario/${scenarioOrder}${query}`);
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

  const collaboration = useCollaboration({
    sessionCode,
    scenarioOrder,
    participantName,
    participantId,
    initialFields,
    initialAuthorship,
    initialMessages,
    onReadyUpdate,
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
        headers: { "Content-Type": "application/json" },
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ready", participantId, ready }),
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenarioId: scenario.id, participantId, ...answers }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Failed to save your rating");
      return;
    }
    setSurveyCompleted(true);
    goToNext();
  };

  if (loading || !scenario) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-600">
        {error ?? "Loading scenario..."}
      </div>
    );
  }

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
        <p className="mt-4 text-slate-700">{scenario.description}</p>
        <p className="mt-3 rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
          <span className="font-medium">Discuss:</span> {scenario.promptForGroup}
        </p>
      </header>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-700">
          {error}
        </div>
      )}

      <Step number={1} title="Group discussion">
        <p className="mt-1 text-sm text-slate-600">
          Discuss the task together. Each message shows who wrote it, and every group
          member has their own colour.
        </p>
        <DiscussionChat
          messages={collaboration.messages}
          participantId={participantId}
          disabled={submitted}
          onSend={collaboration.sendMessage}
        />
      </Step>

      <Step number={2} title="AI support (just for you)">
        <p className="mt-1 text-sm text-slate-600">
          This step is individual: only you can see the support you choose here. Select as
          many options as you like, and unselect any of them to hide it again. Each answer
          is created once and kept, so selecting it again shows the same answer. Not
          selecting anything is fine too.
        </p>
        <div className="mt-4">
          <ScaffoldingSelector
            scaffolds={scaffolds}
            loading={loadingTypes}
            locked={submitted}
            disabled={!participantId}
            onToggle={toggleSupport}
          />
        </div>
      </Step>

      <Step number={3} title="Final group answer">
        <GroupAnswerNote />
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

      {submitted && !surveyCompleted && (
        <SurveyForm
          aiUsed={scaffolds.length > 0}
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
    </div>
  );
}
