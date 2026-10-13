"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { DiscussionChat } from "@/components/DiscussionChat";
import { ScaffoldingSelector } from "@/components/ScaffoldingSelector";
import { SurveyForm, type SurveyAnswers } from "@/components/SurveyForm";
import {
  useCollaboration,
  type RoomScaffoldingState,
  type SharedFields,
} from "@/hooks/useCollaboration";
import {
  HELP_REASONS,
  OWN_WORDS_MIN_WORDS,
  countWords,
  getHelpReasonLabel,
} from "@/lib/instruments";
import type { DiscussionMessage, Scenario, ScaffoldingType } from "@/lib/types";

interface ScenarioViewProps {
  sessionCode: string;
  scenarioOrder: number;
  totalScenarios: number;
  participantName: string;
  participantId: string | null;
}

interface AttemptState {
  helpReason: string | null;
  scaffoldingType: ScaffoldingType | null;
  aiResponse: string | null;
  submitted: boolean;
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
  const [attempt, setAttempt] = useState<AttemptState | null>(null);
  const [initialFields, setInitialFields] = useState<SharedFields | null>(null);
  const [initialMessages, setInitialMessages] = useState<DiscussionMessage[] | null>(null);
  const [surveyCompleted, setSurveyCompleted] = useState(false);
  const [helpReason, setHelpReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [scaffoldingLoading, setScaffoldingLoading] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const query = participantId
          ? `?participantId=${encodeURIComponent(participantId)}`
          : "";
        const res = await fetch(
          `/api/sessions/${sessionCode}/scenario/${scenarioOrder}${query}`
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load scenario");
        setScenario(data.scenario);
        setAttempt({
          helpReason: data.attempt.helpReason,
          scaffoldingType: data.attempt.scaffoldingType,
          aiResponse: data.attempt.aiResponse,
          submitted: data.attempt.submitted,
        });
        setInitialFields({
          ownWordsExplanation: data.attempt.ownWordsExplanation ?? "",
          finalAnswer: data.attempt.finalAnswer ?? "",
        });
        setInitialMessages(data.messages ?? []);
        setSurveyCompleted(!!data.surveyCompleted);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [sessionCode, scenarioOrder, participantId]);

  const onScaffoldingUpdate = useCallback((state: RoomScaffoldingState) => {
    setAttempt((prev) =>
      prev
        ? {
            ...prev,
            helpReason: state.helpReason,
            scaffoldingType: state.scaffoldingType,
            aiResponse: state.aiResponse,
          }
        : prev
    );
  }, []);

  const onSubmitted = useCallback(() => {
    setAttempt((prev) => (prev ? { ...prev, submitted: true } : prev));
  }, []);

  const collaboration = useCollaboration({
    sessionCode,
    scenarioOrder,
    participantName,
    participantId,
    initialFields,
    initialMessages,
    onScaffoldingUpdate,
    onSubmitted,
  });
  const { fields } = collaboration;

  const goToNext = () => {
    if (scenarioOrder < totalScenarios) {
      router.push(`/session/${sessionCode}/scenario/${scenarioOrder + 1}`);
    } else {
      router.push(`/session/${sessionCode}/complete`);
    }
  };

  const requestScaffolding = async (scaffoldingType: ScaffoldingType) => {
    if (!helpReason) return;
    setScaffoldingLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionCode}/scaffold`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenarioOrder, scaffoldingType, helpReason, participantId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Scaffolding failed");
      setAttempt((prev) =>
        prev
          ? {
              ...prev,
              helpReason: data.helpReason,
              scaffoldingType: data.scaffoldingType,
              aiResponse: data.aiResponse,
            }
          : prev
      );
      collaboration.broadcastScaffolding(
        data.scaffoldingType,
        data.helpReason,
        data.aiResponse
      );
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
      await collaboration.flush();
      const res = await fetch(
        `/api/sessions/${sessionCode}/scenario/${scenarioOrder}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "submit",
            participantId,
            finalAnswer: fields.finalAnswer,
            ownWordsExplanation: fields.ownWordsExplanation,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Submit failed");
      setAttempt((prev) => (prev ? { ...prev, submitted: true } : prev));
      collaboration.broadcastSubmitted(fields.finalAnswer, fields.ownWordsExplanation);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submit failed");
    } finally {
      setSubmitLoading(false);
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

  if (loading || !scenario || !attempt) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-600">
        {error ?? "Loading scenario..."}
      </div>
    );
  }

  const scaffoldChosen = !!attempt.scaffoldingType;
  const isFullAnswer = attempt.scaffoldingType === "full_answer";
  const ownWordsCount = countWords(fields.ownWordsExplanation);
  const ownWordsReady = !isFullAnswer || ownWordsCount >= OWN_WORDS_MIN_WORDS;
  const canSubmit =
    scaffoldChosen && ownWordsReady && fields.finalAnswer.trim().length > 0;
  const finalStep = isFullAnswer ? 4 : 3;

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
          disabled={attempt.submitted}
          onSend={collaboration.sendMessage}
        />
      </Step>

      <Step number={2} title="AI support">
        {!scaffoldChosen && (
          <fieldset className="mt-3">
            <legend className="text-sm font-medium text-slate-900">
              Why does your group need help at this point?
            </legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {HELP_REASONS.map((reason) => (
                <label
                  key={reason.id}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                    helpReason === reason.id
                      ? "border-indigo-600 bg-indigo-50"
                      : "border-slate-200 hover:border-indigo-300"
                  }`}
                >
                  <input
                    type="radio"
                    name="helpReason"
                    value={reason.id}
                    checked={helpReason === reason.id}
                    onChange={() => setHelpReason(reason.id)}
                    disabled={scaffoldingLoading || attempt.submitted}
                  />
                  {reason.label}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {scaffoldChosen && attempt.helpReason && (
          <p className="mt-2 text-sm text-slate-600">
            Your group said: <span className="font-medium">{getHelpReasonLabel(attempt.helpReason)}</span>
          </p>
        )}
        <div className="mt-4">
          <ScaffoldingSelector
            selected={attempt.scaffoldingType}
            disabled={
              scaffoldingLoading ||
              attempt.submitted ||
              scaffoldChosen ||
              !helpReason
            }
            onSelect={requestScaffolding}
          />
        </div>
        {scaffoldingLoading && (
          <p className="mt-3 text-sm text-indigo-600">Generating AI support...</p>
        )}
        {attempt.aiResponse && (
          <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50 p-4">
            <p className="text-sm font-medium text-indigo-900">AI response</p>
            <p className="mt-1 text-xs text-indigo-700">Visible to everyone in the room.</p>
            <p className="mt-2 whitespace-pre-wrap text-slate-800">{attempt.aiResponse}</p>
          </div>
        )}
      </Step>

      {isFullAnswer && (
        <Step number={3} title="Explain the AI answer in your own words">
          <p className="mt-1 text-sm text-slate-600">
            Before writing your final answer, explain together what you understood from
            the AI answer. Don&apos;t copy it: say what it means and whether you agree.
          </p>
          <textarea
            value={fields.ownWordsExplanation}
            onChange={(e) =>
              collaboration.setField("ownWordsExplanation", e.target.value)
            }
            disabled={attempt.submitted}
            rows={4}
            className="mt-3 w-full rounded-xl border border-slate-300 px-4 py-3"
            placeholder="In our own words, the AI answer means..."
          />
          <p
            className={`mt-1 text-xs ${
              ownWordsReady ? "text-emerald-700" : "text-slate-500"
            }`}
          >
            {ownWordsCount} / {OWN_WORDS_MIN_WORDS} words minimum
          </p>
        </Step>
      )}

      <Step number={finalStep} title="Final group answer">
        {!scaffoldChosen ? (
          <p className="mt-2 text-sm text-slate-500">
            Available after your group chooses AI support in Step 2.
          </p>
        ) : (
          <>
            <p className="mt-1 text-sm text-slate-600">
              Build on your discussion and the AI support to write one shared answer.
            </p>
            <textarea
              value={fields.finalAnswer}
              onChange={(e) => collaboration.setField("finalAnswer", e.target.value)}
              disabled={attempt.submitted || !ownWordsReady}
              rows={5}
              className="mt-3 w-full rounded-xl border border-slate-300 px-4 py-3"
              placeholder={
                ownWordsReady
                  ? "Write your group's final joint answer..."
                  : "Finish Step 3 first."
              }
            />
            {!attempt.submitted && (
              <button
                type="button"
                onClick={submitFinalAnswer}
                disabled={submitLoading || !canSubmit}
                className="mt-4 rounded-lg bg-indigo-600 px-5 py-2.5 text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {submitLoading ? "Submitting..." : "Submit final answer"}
              </button>
            )}
          </>
        )}
      </Step>

      {attempt.submitted && !surveyCompleted && (
        <SurveyForm
          aiUsed={attempt.scaffoldingType !== "no_assistance"}
          canSubmit={!!participantId}
          onSubmit={submitSurvey}
        />
      )}

      {attempt.submitted && surveyCompleted && (
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
