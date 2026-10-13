"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AssessmentForm } from "@/components/AssessmentForm";
import { FINAL_REFLECTION_QUESTIONS } from "@/lib/instruments";
import { getAssessment } from "@/lib/utils/assessment";

export default function CompletePage() {
  const params = useParams<{ code: string }>();
  const code = params.code.toUpperCase();
  const [loaded, setLoaded] = useState(false);
  const [postTestCompleted, setPostTestCompleted] = useState(false);
  const [reflectionCompleted, setReflectionCompleted] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const postTest = getAssessment("post");

  useEffect(() => {
    async function checkProgress() {
      const participantId = localStorage.getItem("participantId");
      if (participantId) {
        const id = encodeURIComponent(participantId);
        const [assessmentRes, reflectionRes] = await Promise.all([
          fetch(`/api/sessions/${code}/assessment?participantId=${id}&type=post`),
          fetch(`/api/sessions/${code}/reflection?participantId=${id}`),
        ]);
        const assessment = await assessmentRes.json();
        const reflection = await reflectionRes.json();
        if (assessmentRes.ok && assessment.completed) {
          setPostTestCompleted(true);
          setScore(assessment.score);
        }
        if (reflectionRes.ok && reflection.completed) setReflectionCompleted(true);
      }
      setLoaded(true);
    }
    checkProgress();
  }, [code]);

  if (!loaded) {
    return <div className="p-8 text-center text-slate-600">Loading...</div>;
  }

  if (!postTestCompleted) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <p className="text-sm font-medium text-indigo-600">Almost done · 1 of 2</p>
        <h1 className="mt-2 text-3xl font-semibold text-slate-900">
          Post-study knowledge check
        </h1>
        <p className="mt-2 text-slate-600">
          Complete this individually before finishing session {code}.
        </p>
        <div className="mt-6">
          <AssessmentForm
            title={postTest.title}
            description={postTest.description}
            questions={postTest.questions}
            submitLabel="Submit post-test"
            onSubmit={async (answers) => {
              const participantId = localStorage.getItem("participantId");
              const res = await fetch(`/api/sessions/${code}/assessment`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  assessmentType: "post",
                  answers,
                  participantId,
                }),
              });
              const data = await res.json();
              if (res.ok) {
                setPostTestCompleted(true);
                setScore(data.score);
              }
            }}
          />
        </div>
      </div>
    );
  }

  if (!reflectionCompleted) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <p className="text-sm font-medium text-indigo-600">Almost done · 2 of 2</p>
        <h1 className="mt-2 text-3xl font-semibold text-slate-900">
          Looking back on the activity
        </h1>
        <p className="mt-2 text-slate-600">
          Answer individually. A few sentences per question is plenty, and you can skip
          any question you don&apos;t want to answer.
        </p>
        {error && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-700">
            {error}
          </div>
        )}
        <form
          className="mt-6 space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
          onSubmit={async (event) => {
            event.preventDefault();
            setError(null);
            const form = new FormData(event.currentTarget);
            const answers: Record<string, string> = {};
            for (const question of FINAL_REFLECTION_QUESTIONS) {
              answers[question.id] = String(form.get(question.id) ?? "");
            }
            const res = await fetch(`/api/sessions/${code}/reflection`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                participantId: localStorage.getItem("participantId"),
                answers,
              }),
            });
            const data = await res.json();
            if (res.ok) setReflectionCompleted(true);
            else setError(data.error ?? "Failed to save your answers");
          }}
        >
          {FINAL_REFLECTION_QUESTIONS.map((question, index) => (
            <label key={question.id} className="block space-y-1">
              <span className="text-sm font-medium text-slate-900">
                {index + 1}. {question.text}
              </span>
              <textarea
                name={question.id}
                rows={3}
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
          ))}
          <button
            type="submit"
            className="rounded-lg bg-indigo-600 px-5 py-2.5 text-white hover:bg-indigo-700"
          >
            Submit and finish
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-16 text-center">
      <p className="text-sm font-medium text-indigo-600">Study complete</p>
      <h1 className="mt-2 text-3xl font-semibold text-slate-900">
        Thank you for participating
      </h1>
      <p className="mt-4 text-slate-600">
        Your group has finished the collaborative learning activity in session{" "}
        {code}.
        {score !== null && (
          <> Your post-test score: {score} / {postTest.questions.length}.</>
        )}
      </p>
      <Link
        href="/"
        className="mt-8 inline-block rounded-lg bg-indigo-600 px-5 py-2.5 text-white hover:bg-indigo-700"
      >
        Return home
      </Link>
    </div>
  );
}
