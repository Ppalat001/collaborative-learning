"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ScaffoldingSelector } from "@/components/ScaffoldingSelector";
import { SurveyForm } from "@/components/SurveyForm";
import { useCollaboration } from "@/hooks/useCollaboration";
import type { Scenario, ScaffoldingType } from "@/lib/types";

interface ScenarioViewProps {
  sessionCode: string;
  scenarioOrder: number;
  totalScenarios: number;
  participantName: string;
}

interface AttemptState {
  discussionText: string;
  draftAnswer: string;
  scaffoldingType: ScaffoldingType | null;
  aiResponse: string | null;
  finalAnswer: string;
  submitted: boolean;
}

export function ScenarioView({
  sessionCode,
  scenarioOrder,
  totalScenarios,
  participantName,
}: ScenarioViewProps) {
  const router = useRouter();
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [attempt, setAttempt] = useState<AttemptState | null>(null);
  const [finalAnswer, setFinalAnswer] = useState("");
  const [loading, setLoading] = useState(true);
  const [scaffoldingLoading, setScaffoldingLoading] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSurvey, setShowSurvey] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/sessions/${sessionCode}/scenario/${scenarioOrder}`
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load scenario");
        setScenario(data.scenario);
        setAttempt(data.attempt);
        setFinalAnswer(data.attempt.finalAnswer ?? "");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [sessionCode, scenarioOrder]);

  const collaboration = useCollaboration({
    sessionCode,
    scenarioOrder,
    participantName,
    initialDiscussion: attempt?.discussionText ?? "",
    initialDraft: attempt?.draftAnswer ?? "",
    onScaffoldingUpdate: (state) => {
      setAttempt((prev) =>
        prev
          ? {
              ...prev,
              scaffoldingType: state.scaffoldingType,
              aiResponse: state.aiResponse,
            }
          : prev
      );
    },
  });

  const requestScaffolding = async (scaffoldingType: ScaffoldingType) => {
    setScaffoldingLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionCode}/scaffold`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenarioOrder,
          scaffoldingType,
          discussionText: collaboration.discussionText,
          draftAnswer: collaboration.draftAnswer,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Scaffolding failed");
      setAttempt((prev) =>
        prev
          ? {
              ...prev,
              scaffoldingType: data.scaffoldingType,
              aiResponse: data.aiResponse,
            }
          : prev
      );
      collaboration.broadcastScaffolding(data.scaffoldingType, data.aiResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scaffolding failed");
    } finally {
      setScaffoldingLoading(false);
    }
  };

  const submitFinalAnswer = async () => {
    setSubmitLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/sessions/${sessionCode}/scenario/${scenarioOrder}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "submit",
            finalAnswer,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Submit failed");
      setAttempt((prev) => (prev ? { ...prev, submitted: true, finalAnswer } : prev));
      setShowSurvey(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submit failed");
    } finally {
      setSubmitLoading(false);
    }
  };

  if (loading || !scenario || !attempt) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-600">
        Loading scenario...
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

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Group discussion</h2>
        <p className="mt-1 text-sm text-slate-600">
          Work together here before requesting AI support.
          {collaboration.lastUpdatedBy
            ? ` Last edit by ${collaboration.lastUpdatedBy}.`
            : ""}
        </p>
        <textarea
          value={collaboration.discussionText}
          onChange={(e) => collaboration.setDiscussionText(e.target.value)}
          disabled={attempt.submitted}
          rows={8}
          className="mt-3 w-full rounded-xl border border-slate-300 px-4 py-3"
          placeholder="Type your group's discussion here..."
        />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Draft answer (optional)</h2>
        <p className="mt-1 text-sm text-slate-600">
          Useful if you choose feedback scaffolding.
        </p>
        <textarea
          value={collaboration.draftAnswer}
          onChange={(e) => collaboration.setDraftAnswer(e.target.value)}
          disabled={attempt.submitted || !!attempt.scaffoldingType}
          rows={4}
          className="mt-3 w-full rounded-xl border border-slate-300 px-4 py-3"
          placeholder="Optional draft answer before AI support..."
        />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">AI scaffolding</h2>
        <div className="mt-4">
          <ScaffoldingSelector
            selected={attempt.scaffoldingType}
            disabled={scaffoldingLoading || attempt.submitted || !!attempt.scaffoldingType}
            onSelect={requestScaffolding}
          />
        </div>
        {scaffoldingLoading && (
          <p className="mt-3 text-sm text-indigo-600">Generating AI support...</p>
        )}
        {attempt.aiResponse && (
          <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50 p-4">
            <p className="text-sm font-medium text-indigo-900">AI response</p>
            {attempt.scaffoldingType && (
              <p className="mt-1 text-xs text-indigo-700">
                Visible to everyone in the room.
              </p>
            )}
            <p className="mt-2 whitespace-pre-wrap text-slate-800">
              {attempt.aiResponse}
            </p>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Final group answer</h2>
        <textarea
          value={finalAnswer}
          onChange={(e) => setFinalAnswer(e.target.value)}
          disabled={attempt.submitted}
          rows={5}
          className="mt-3 w-full rounded-xl border border-slate-300 px-4 py-3"
          placeholder="Write your group's final joint answer..."
        />
        {!attempt.submitted && (
          <button
            type="button"
            onClick={submitFinalAnswer}
            disabled={submitLoading || !attempt.scaffoldingType || !finalAnswer.trim()}
            className="mt-4 rounded-lg bg-indigo-600 px-5 py-2.5 text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {submitLoading ? "Submitting..." : "Submit final answer"}
          </button>
        )}
      </section>

      {showSurvey && scenario && (
        <SurveyForm
          onSubmit={async (ratings) => {
            await fetch(`/api/sessions/${sessionCode}/survey`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ scenarioId: scenario.id, ...ratings }),
            });
            if (scenarioOrder < totalScenarios) {
              router.push(`/session/${sessionCode}/scenario/${scenarioOrder + 1}`);
            } else {
              router.push(`/session/${sessionCode}/complete`);
            }
          }}
        />
      )}

      {attempt.submitted && !showSurvey && (
        <div className="flex gap-3">
          {scenarioOrder < totalScenarios ? (
            <button
              type="button"
              onClick={() =>
                router.push(`/session/${sessionCode}/scenario/${scenarioOrder + 1}`)
              }
              className="rounded-lg bg-indigo-600 px-5 py-2.5 text-white hover:bg-indigo-700"
            >
              Next scenario
            </button>
          ) : (
            <button
              type="button"
              onClick={() => router.push(`/session/${sessionCode}/complete`)}
              className="rounded-lg bg-indigo-600 px-5 py-2.5 text-white hover:bg-indigo-700"
            >
              Finish study
            </button>
          )}
        </div>
      )}
    </div>
  );
}
