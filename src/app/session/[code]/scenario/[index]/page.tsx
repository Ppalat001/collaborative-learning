"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ScenarioView } from "@/components/ScenarioView";
import { useStoredParticipant } from "@/hooks/useStoredParticipant";

export default function ScenarioPage() {
  const params = useParams<{ code: string; index: string }>();
  const code = params.code.toUpperCase();
  const scenarioOrder = Number(params.index);
  const stored = useStoredParticipant();
  const participant = stored.loaded ? stored : null;
  const [totalScenarios, setTotalScenarios] = useState(10);

  useEffect(() => {
    fetch(`/api/sessions/${code}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.totalScenarios) setTotalScenarios(data.totalScenarios);
      })
      .catch(console.error);
  }, [code]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <Link href={`/session/${code}`} className="text-sm text-indigo-600 hover:underline">
          Back to lobby
        </Link>
        {participant && (
          <span className="text-sm text-slate-500">Signed in as {participant.name}</span>
        )}
      </div>
      {participant && !participant.id && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          This device hasn&apos;t joined the session, so your contributions and ratings
          can&apos;t be recorded. Join from the home page with the room code.
        </div>
      )}
      {participant && (
        <ScenarioView
          key={`${code}-${scenarioOrder}`}
          sessionCode={code}
          scenarioOrder={scenarioOrder}
          totalScenarios={totalScenarios}
          participantName={participant.name}
          participantId={participant.id}
        />
      )}
    </div>
  );
}
