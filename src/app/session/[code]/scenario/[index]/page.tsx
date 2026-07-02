"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ScenarioView } from "@/components/ScenarioView";

export default function ScenarioPage() {
  const params = useParams<{ code: string; index: string }>();
  const code = params.code.toUpperCase();
  const scenarioOrder = Number(params.index);
  const [participantName, setParticipantName] = useState("Participant");
  const [totalScenarios, setTotalScenarios] = useState(10);

  useEffect(() => {
    setParticipantName(localStorage.getItem("participantName") ?? "Participant");
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
        <span className="text-sm text-slate-500">Signed in as {participantName}</span>
      </div>
      <ScenarioView
        sessionCode={code}
        scenarioOrder={scenarioOrder}
        totalScenarios={totalScenarios}
        participantName={participantName}
      />
    </div>
  );
}
