"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AssessmentForm } from "@/components/AssessmentForm";
import { getAssessment } from "@/lib/utils/assessment";

export default function CompletePage() {
  const params = useParams<{ code: string }>();
  const code = params.code.toUpperCase();
  const [postTestCompleted, setPostTestCompleted] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const postTest = getAssessment("post");

  useEffect(() => {
    async function checkPostTest() {
      const participantId = localStorage.getItem("participantId");
      if (!participantId) return;
      const res = await fetch(
        `/api/sessions/${code}/assessment?participantId=${encodeURIComponent(participantId)}&type=post`
      );
      const data = await res.json();
      if (res.ok && data.completed) {
        setPostTestCompleted(true);
        setScore(data.score);
      }
    }
    checkPostTest();
  }, [code]);

  if (!postTestCompleted) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <p className="text-sm font-medium text-indigo-600">Almost done</p>
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
