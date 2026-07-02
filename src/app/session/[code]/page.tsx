"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AssessmentForm } from "@/components/AssessmentForm";
import { getAssessment } from "@/lib/utils/assessment";

interface SessionInfo {
  code: string;
  consentGiven: boolean;
  participantCount: number;
  maxParticipants: number;
  currentScenarioIndex: number;
  completedAt: string | null;
}

interface Participant {
  displayName: string;
}

export default function SessionLobbyPage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const code = params.code.toUpperCase();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [totalScenarios, setTotalScenarios] = useState(10);
  const [loading, setLoading] = useState(true);
  const [consentChecked, setConsentChecked] = useState(false);
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [preTestCompleted, setPreTestCompleted] = useState(false);
  const preTest = getAssessment("pre");

  useEffect(() => {
    setParticipantId(localStorage.getItem("participantId"));
  }, []);

  useEffect(() => {
    async function load() {
      const res = await fetch(`/api/sessions/${code}`);
      const data = await res.json();
      if (res.ok) {
        setSession(data.session);
        setParticipants(data.participants);
        setTotalScenarios(data.totalScenarios);
      }
      setLoading(false);
    }
    load();
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [code]);

  useEffect(() => {
    async function checkPreTest() {
      const id = participantId ?? localStorage.getItem("participantId");
      if (!id) return;
      const res = await fetch(
        `/api/sessions/${code}/assessment?participantId=${encodeURIComponent(id)}&type=pre`
      );
      const data = await res.json();
      if (res.ok && data.completed) {
        setPreTestCompleted(true);
      }
    }
    checkPreTest();
  }, [code, participantId]);

  const giveConsent = async () => {
    await fetch(`/api/sessions/${code}/consent`, { method: "POST" });
    setSession((prev) => (prev ? { ...prev, consentGiven: true } : prev));
  };

  const startStudy = () => {
    const nextIndex = Math.max(1, (session?.currentScenarioIndex ?? 0) + 1);
    if (nextIndex > totalScenarios) {
      router.push(`/session/${code}/complete`);
    } else {
      router.push(`/session/${code}/scenario/${nextIndex}`);
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-slate-600">Loading session...</div>;
  }

  if (!session) {
    return (
      <div className="mx-auto max-w-lg p-8 text-center">
        <p className="text-red-600">Session not found.</p>
        <Link href="/" className="mt-4 inline-block text-indigo-600">
          Back home
        </Link>
      </div>
    );
  }

  const canBegin =
    session.consentGiven && preTestCompleted && session.participantCount >= 1;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <p className="text-sm font-medium text-indigo-600">Group session</p>
      <h1 className="mt-2 text-3xl font-semibold text-slate-900">Room {session.code}</h1>
      <p className="mt-2 text-slate-600">
        {session.participantCount} of {session.maxParticipants} participants joined
      </p>

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="font-semibold text-slate-900">Participants</h2>
        <ul className="mt-3 space-y-2">
          {participants.map((p, index) => (
            <li key={`${p.displayName}-${index}`} className="rounded-lg bg-slate-50 px-3 py-2">
              {p.displayName}
            </li>
          ))}
        </ul>
      </section>

      {!session.consentGiven && (
        <section className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-6">
          <h2 className="font-semibold text-slate-900">Informed consent</h2>
          <p className="mt-2 text-sm text-slate-700">
            This study collects group discussion text, scaffolding choices, AI
            responses, and final answers for dissertation research. Participants
            are identified by anonymous codes only.
          </p>
          <label className="mt-4 flex items-start gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={consentChecked}
              onChange={(e) => setConsentChecked(e.target.checked)}
              className="mt-1"
            />
            Our group agrees to participate and understands how data will be used.
          </label>
          <button
            type="button"
            disabled={!consentChecked}
            onClick={giveConsent}
            className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-white disabled:opacity-50"
          >
            Record consent
          </button>
        </section>
      )}

      {session.consentGiven && !preTestCompleted && (
        <section className="mt-6">
          <AssessmentForm
            title={preTest.title}
            description={preTest.description}
            questions={preTest.questions}
            submitLabel="Submit pre-test"
            onSubmit={async (answers) => {
              const id = participantId ?? localStorage.getItem("participantId");
              const res = await fetch(`/api/sessions/${code}/assessment`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  assessmentType: "pre",
                  answers,
                  participantId: id,
                }),
              });
              if (res.ok) setPreTestCompleted(true);
            }}
          />
        </section>
      )}

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="font-semibold text-slate-900">Activity flow</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-700">
          <li>Complete the pre-test individually</li>
          <li>Read each scenario together</li>
          <li>Discuss as a group</li>
          <li>Choose one AI scaffolding type</li>
          <li>Use the AI response to refine discussion</li>
          <li>Submit a final joint answer</li>
          <li>Complete a brief post-test after all scenarios</li>
        </ol>
        {session.consentGiven && !preTestCompleted && (
          <p className="mt-4 text-sm text-amber-700">
            Complete your pre-test above before the group begins scenarios.
          </p>
        )}
        <button
          type="button"
          onClick={startStudy}
          disabled={!canBegin}
          className="mt-5 rounded-lg bg-indigo-600 px-5 py-2.5 text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {session.completedAt ? "Review activity" : "Begin scenarios"}
        </button>
      </section>
    </div>
  );
}
