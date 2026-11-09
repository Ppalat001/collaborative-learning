"use client";

import { useCallback, useEffect, useState } from "react";

const V2_EXPORTS = [
  { type: "v2_assignment", label: "Study assignment and provenance" },
  { type: "v2_consents", label: "Consent records" },
  { type: "v2_evaluations", label: "Decisions, including no-action" },
  { type: "v2_interventions", label: "Interventions" },
  { type: "v2_feedback", label: "Responses to interventions" },
  { type: "v2_sharing", label: "Shared AI ideas" },
  { type: "v2_recommendations", label: "Adaptive recommendations" },
  { type: "v2_learner_models", label: "Learner models (adaptive private suggestions)" },
  { type: "v2_learner_model_events", label: "Learner model updates" },
  { type: "v2_initial_ideas", label: "Initial individual ideas" },
  { type: "v2_roles", label: "Role cards" },
  { type: "v2_checkpoints", label: "Checkpoints raised" },
  { type: "v2_agreement_reasons", label: "Agreement reasons" },
] as const;

const V23_EXPORTS = [
  { type: "v2_3_group_states", label: "Group-state estimates" },
  { type: "v2_3_private_decisions", label: "Private decision traces (incl. waits)" },
  { type: "v2_3_scaffolding_events", label: "Fading and escalation" },
  { type: "v2_3_exposures", label: "Offer exposure" },
  { type: "v2_3_offer_funnel", label: "Offer funnel per member" },
  { type: "v2_3_outcomes", label: "Observed outcomes (proxy)" },
  { type: "v2_3_progress_feedback", label: "One-click progress feedback" },
  { type: "v2_3_review_labels", label: "Human review labels" },
  { type: "v2_3_open_rubric", label: "Open-answer rubric (optional)" },
] as const;

const CONDITION_LABELS: Record<string, string> = {
  baseline_private_request: "Baseline: private AI on request only",
  shared_on_demand: "Shared facilitator on request",
  proactive_group: "Proactive group facilitator",
  dual_adaptive: "Historical dual assignment (private coach removed)",
  proactive_adaptive: "Group facilitator + adaptive private suggestions",
};

interface ReleaseInfo {
  release: {
    enabled: boolean;
    homePageGroups: string;
    defaultCondition: string;
    assignment: string;
    randomizeConditions: string[];
    allowTestPolicy: boolean;
    policyVersion: string | null;
  };
  aiMode: string;
  protocol: { version: string; status: string; consentVersion: string };
  conditions: string[];
  currentPolicyVersion: string;
  openAnswerRubricEnabled: boolean;
  policies: { version: string; testOnly: boolean; status: string; learningAware: boolean }[];
}

interface LearningAwareDashboard {
  stateTimeline: {
    scenarioOrder: number;
    at: string;
    stage: string;
    state: string;
    confidence: number;
    repeatCount: number;
    uncertaintyReasons: string[];
  }[];
  states: Record<string, number>;
  privateDecisions: Record<string, number>;
  funnel: {
    memberOffers: number;
    deliveredToDevice: number;
    seen: number;
    ownAccepted: number;
    ownDismissed: number;
    contentDelivered: number;
    effectiveProxyYes: number;
    humanRated: number;
  };
  exposureByMember: { studentId: string; kinds: Record<string, number> }[];
  outcomes: Record<string, number>;
  fading: {
    scenarioOrder: number;
    studentId: string;
    eventType: string;
    fromTier: string | null;
    toTier: string;
    reasonCode: string;
    at: string;
  }[];
  progressFeedback: Record<string, number>;
  reviewLabels: number;
}

interface AgreementStat {
  n: number;
  percentAgreement: number | null;
  kappa: number | null;
}

interface ReviewAgreementSummary {
  labels: number;
  systemVsHuman: { necessity: AgreementStat; state: AgreementStat };
  humanVsHuman: { necessity: AgreementStat; state: AgreementStat; disagreement: AgreementStat };
}

interface Dashboard {
  group: string;
  assignment: {
    condition: string;
    assignmentMethod: string;
    createdVia: string;
    interventionPolicyVersion: string;
    studyProtocolVersion: string;
    consentVersion: string;
    modelConfigVersion: string;
    aiModeAtAssignment: string;
    assignedAt: string;
    startedAt: string | null;
  };
  members: {
    id: string;
    name: string;
    studentId: string;
    consented: boolean;
    withdrawn: boolean;
    droppedOut: boolean;
    inRoster: boolean;
  }[];
  counts: {
    evaluations: number;
    evaluationRows: number;
    decisions: Record<string, number>;
    reasonCodes: Record<string, number>;
    triggers: Record<string, number>;
    interventionsByStatus: Record<string, number>;
    interventionsByScope: Record<string, number>;
    aiOrigins: Record<string, number>;
    feedback: Record<string, number>;
    shared: number;
    recommendations: number;
    recommendationsOverridden: number;
    learnerModels: number;
    learnerModelUpdates: number;
  };
  aiUsage: AiUsage;
  failures: { id: string; scenarioOrder: number; supportType: string; reason: string | null; at: string | null }[];
  timeline: {
    id: string;
    scenarioOrder: number;
    createdAt: string;
    scope: string;
    initiatedBy: string;
    trigger: string;
    supportType: string;
    status: string;
    aiOrigin: string | null;
    reasonCode: string;
  }[];
  dataQualityFlags: string[];
  warnings: string[];
  learningAware: LearningAwareDashboard | null;
}

interface Props {
  password: string;
  /** True once the admin loaded the group list (password accepted). */
  active: boolean;
  selectedCode: string;
  selectedIsV2: boolean;
  onGroupCreated: (code: string) => Promise<void> | void;
}

async function adminRequest(url: string, password: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: { "x-admin-password": password, "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `Request failed (${res.status})`);
  }
  return res;
}

async function download(url: string, filename: string, password: string) {
  const res = await adminRequest(url, password);
  const link = document.createElement("a");
  link.href = URL.createObjectURL(await res.blob());
  link.download = filename;
  link.click();
}

interface AiUsage {
  humanMessages: number;
  groupAi: {
    manualRequests: number;
    manualReplies: number;
    proactiveOffers: number;
    proactiveAccepted: number;
    proactiveReplies: number;
    proactiveExpired: number;
    proactiveClosedByMembers: number;
  };
  privateAi: {
    manualCalls: number;
    popupsOffered: number;
    popupsAccepted: number;
    popupsDeclined: number;
    popupsDeferred: number;
    popupsExpired: number;
  };
  sharedExcerpts: number;
  origins: { groupAndPopups: Record<string, number>; step2: Record<string, number> };
  feedback: { progress: Record<string, number>; outcomes: Record<string, number>; unknownOutcomes: number };
  tokens: { input: number; output: number };
  failures: number;
}

function UsageList({ title, rows }: { title: string; rows: [string, number][] }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</div>
      <ul className="mt-1 space-y-0.5 text-sm text-slate-700">
        {rows.map(([label, count]) => (
          <li key={label} className="flex justify-between gap-3">
            <span>{label}</span>
            <span className="font-mono">{count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Each kind of AI use on its own line; human chat messages are never mixed in. */
function AiUsagePanel({ usage }: { usage: AiUsage }) {
  return (
    <div>
      <h4 className="text-sm font-semibold text-slate-800">AI use (counted separately)</h4>
      <div className="mt-1 grid gap-3 sm:grid-cols-3">
        <UsageList
          title="Step 1 group chat"
          rows={[
            ["Human messages", usage.humanMessages],
            ["Manual group AI requests", usage.groupAi.manualRequests],
            ["Manual group AI replies", usage.groupAi.manualReplies],
            ["Proactive group offers", usage.groupAi.proactiveOffers],
            ["Proactive offers accepted", usage.groupAi.proactiveAccepted],
            ["Proactive replies delivered", usage.groupAi.proactiveReplies],
            ["Offers expired (not opened)", usage.groupAi.proactiveExpired],
            ["Offers closed by members", usage.groupAi.proactiveClosedByMembers],
            ["Shared private excerpts", usage.sharedExcerpts],
          ]}
        />
        <UsageList
          title="Step 2 private help"
          rows={[
            ["Manual private AI calls", usage.privateAi.manualCalls],
            ["Popups offered", usage.privateAi.popupsOffered],
            ["Popups accepted", usage.privateAi.popupsAccepted],
            ["Popups declined (No thanks)", usage.privateAi.popupsDeclined],
            ["Popups deferred (Not now)", usage.privateAi.popupsDeferred],
            ["Popups expired", usage.privateAi.popupsExpired],
          ]}
        />
        <UsageList
          title="Cost and failures"
          rows={[
            ["Input tokens (group AI + popups)", usage.tokens.input],
            ["Output tokens (group AI + popups)", usage.tokens.output],
            ["Failed generations", usage.failures],
            ["Unknown outcomes", usage.feedback.unknownOutcomes],
          ]}
        />
        <Counts title="Origin: group AI + popups" values={usage.origins.groupAndPopups} />
        <Counts title="Origin: Step 2 responses" values={usage.origins.step2} />
        <Counts title="Progress feedback" values={usage.feedback.progress} />
        <Counts title="Observed outcomes" values={usage.feedback.outcomes} />
      </div>
    </div>
  );
}

function Counts({ title, values }: { title: string; values: Record<string, number> }) {
  const entries = Object.entries(values).sort((a, b) => b[1] - a[1]);
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</div>
      {entries.length === 0 ? (
        <p className="mt-1 text-sm text-slate-400">None</p>
      ) : (
        <ul className="mt-1 space-y-0.5 text-sm text-slate-700">
          {entries.map(([key, count]) => (
            <li key={key} className="flex justify-between gap-3">
              <span className="truncate">{key}</span>
              <span className="font-mono">{count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatAgreement(stat: AgreementStat) {
  if (stat.n === 0) return "no pairs yet";
  const percent = stat.percentAgreement === null ? "-" : `${Math.round(stat.percentAgreement * 100)}%`;
  const kappa = stat.kappa === null ? "undefined" : stat.kappa.toFixed(2);
  return `n=${stat.n}, agreement ${percent}, kappa ${kappa}`;
}

/** policy-v2-3 groups: estimates, private decisions, exposure, outcomes, fading and review agreement. */
function LearningAwareSection({
  data,
  group,
  password,
  run,
}: {
  data: LearningAwareDashboard;
  group: string;
  password: string;
  run: (action: () => Promise<void>) => Promise<void>;
}) {
  const [agreement, setAgreement] = useState<ReviewAgreementSummary | null>(null);
  const funnel: [string, number][] = [
    ["Proposed (offer x member)", data.funnel.memberOffers],
    ["Delivered to device", data.funnel.deliveredToDevice],
    ["Seen (on screen, not proof of reading)", data.funnel.seen],
    ["Accepted by this member", data.funnel.ownAccepted],
    ["Dismissed by this member", data.funnel.ownDismissed],
    ["Content delivered", data.funnel.contentDelivered],
    ["Effective proxy = yes (associational)", data.funnel.effectiveProxyYes],
    ["Human rated", data.funnel.humanRated],
  ];
  return (
    <div className="space-y-3 rounded-xl border border-violet-200 bg-violet-50/40 p-4">
      <h4 className="text-sm font-semibold text-slate-800">Learning-aware adaptation (policy-v2-3)</h4>
      <p className="text-xs text-slate-500">
        States are cautious estimates with heuristic confidence, not diagnoses. Outcomes are proxies and associational,
        not proof that a suggestion caused learning.
      </p>
      <div className="grid gap-2 sm:grid-cols-4">
        {funnel.map(([label, value]) => (
          <div key={label} className="rounded-lg border border-slate-200 bg-white p-2">
            <div className="text-[11px] text-slate-500">{label}</div>
            <div className="font-mono text-sm text-slate-800">{value}</div>
          </div>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Counts title="Estimated states (incl. repeats)" values={data.states} />
        <Counts title="Private decisions (action:reason)" values={data.privateDecisions} />
        <Counts title="Outcomes (scope:resolved:validity)" values={data.outcomes} />
        <Counts title="One-click progress feedback" values={data.progressFeedback} />
      </div>
      {data.exposureByMember.length > 0 && (
        <div className="overflow-x-auto">
          <h5 className="text-xs font-semibold text-slate-700">Exposure by member</h5>
          <ul className="mt-1 space-y-0.5 text-xs text-slate-700">
            {data.exposureByMember.map((m) => (
              <li key={m.studentId}>
                <span className="font-mono">{m.studentId}</span>:{" "}
                {Object.entries(m.kinds)
                  .map(([kind, n]) => `${kind} ${n}`)
                  .join(", ")}
              </li>
            ))}
          </ul>
        </div>
      )}
      {data.fading.length > 0 && (
        <div>
          <h5 className="text-xs font-semibold text-slate-700">Fading and escalation trace</h5>
          <ul className="mt-1 space-y-0.5 text-xs text-slate-700">
            {data.fading.map((f) => (
              <li key={`${f.studentId}-${f.at}-${f.eventType}`}>
                Scenario {f.scenarioOrder} · <span className="font-mono">{f.studentId}</span> · {f.eventType}:{" "}
                {f.fromTier ?? "-"} → {f.toTier} ({f.reasonCode})
              </li>
            ))}
          </ul>
        </div>
      )}
      {data.stateTimeline.length > 0 && (
        <div className="overflow-x-auto">
          <h5 className="text-xs font-semibold text-slate-700">State timeline (latest 30)</h5>
          <table className="mt-1 w-full text-left text-xs text-slate-700">
            <thead className="text-slate-500">
              <tr>
                <th className="py-1 pr-2">Scenario</th>
                <th className="py-1 pr-2">Time (UTC)</th>
                <th className="py-1 pr-2">Stage</th>
                <th className="py-1 pr-2">State</th>
                <th className="py-1 pr-2">Confidence (heuristic)</th>
                <th className="py-1 pr-2">Repeats</th>
                <th className="py-1 pr-2">Uncertainty</th>
              </tr>
            </thead>
            <tbody>
              {data.stateTimeline.slice(-30).map((s) => (
                <tr key={`${s.at}-${s.state}`} className="border-t border-slate-100">
                  <td className="py-1 pr-2">{s.scenarioOrder}</td>
                  <td className="py-1 pr-2 font-mono">{s.at.slice(0, 19)}</td>
                  <td className="py-1 pr-2">{s.stage}</td>
                  <td className="py-1 pr-2">{s.state}</td>
                  <td className="py-1 pr-2">{s.confidence.toFixed(2)}</td>
                  <td className="py-1 pr-2">{s.repeatCount}</td>
                  <td className="py-1 pr-2">{s.uncertaintyReasons.join(", ") || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div>
        <button
          type="button"
          onClick={() =>
            run(async () => {
              const res = await adminRequest(
                `/api/admin/v2-3/review?session=${encodeURIComponent(group)}&mode=agreement`,
                password
              );
              setAgreement(await res.json());
            })
          }
          className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
        >
          Load review agreement ({data.reviewLabels} labels)
        </button>
        {agreement && (
          <ul className="mt-2 space-y-0.5 text-xs text-slate-700">
            <li>System vs human, necessity: {formatAgreement(agreement.systemVsHuman.necessity)}</li>
            <li>System vs human, state: {formatAgreement(agreement.systemVsHuman.state)}</li>
            <li>Rater vs rater, necessity: {formatAgreement(agreement.humanVsHuman.necessity)}</li>
            <li>Rater vs rater, state: {formatAgreement(agreement.humanVsHuman.state)}</li>
            <li>Rater vs rater, disagreement type: {formatAgreement(agreement.humanVsHuman.disagreement)}</li>
          </ul>
        )}
      </div>
    </div>
  );
}

export function ResearcherInterventionDashboard({ password, active, selectedCode, selectedIsV2, onGroupCreated }: Props) {
  const [info, setInfo] = useState<ReleaseInfo | null>(null);
  const [loadedDashboard, setDashboard] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    condition: "proactive_adaptive",
    policyVersion: "",
    roles: false,
    checkpoints: true,
    openingPrompt: true,
    initialIdea: "off",
    agreementReason: "off",
  });

  const run = async (action: () => Promise<void>) => {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const fetchDashboard = useCallback(
    async (code: string): Promise<Dashboard> =>
      (await adminRequest(`/api/admin/interventions?session=${encodeURIComponent(code)}`, password)).json(),
    [password]
  );

  const loadDashboard = useCallback(async () => {
    if (selectedCode && selectedIsV2) setDashboard(await fetchDashboard(selectedCode));
  }, [fetchDashboard, selectedCode, selectedIsV2]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const fail = (err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load V2 data");
    };
    adminRequest("/api/admin/interventions", password)
      .then((res) => res.json())
      .then((data: ReleaseInfo) => {
        if (!cancelled) setInfo(data);
      })
      .catch(fail);
    if (selectedCode && selectedIsV2) {
      fetchDashboard(selectedCode)
        .then((data) => {
          if (!cancelled) setDashboard(data);
        })
        .catch(fail);
    }
    return () => {
      cancelled = true;
    };
  }, [active, password, fetchDashboard, selectedCode, selectedIsV2]);

  const dashboard = loadedDashboard && selectedIsV2 && loadedDashboard.group === selectedCode ? loadedDashboard : null;

  const createGroup = () =>
    run(async () => {
      const res = await adminRequest("/api/admin/sessions", password, {
        method: "POST",
        body: JSON.stringify({
          condition: form.condition,
          policyVersion: form.policyVersion || undefined,
          features: {
            openingPrompt: form.openingPrompt,
            checkpoints: form.checkpoints,
            roles: form.roles,
            initialIdea: form.initialIdea,
            agreementReason: form.agreementReason,
          },
        }),
      });
      const data = await res.json();
      setNotice(`Created group ${data.code} (${data.condition}, ${data.interventionPolicyVersion}).`);
      await onGroupCreated(data.code);
    });

  const markDroppedOut = (member: Dashboard["members"][number]) =>
    run(async () => {
      const note = window.prompt(`Record that ${member.name} left group ${selectedCode} for good? Optional note:`);
      if (note === null) return;
      await adminRequest("/api/admin/dropout", password, {
        method: "POST",
        body: JSON.stringify({ session: selectedCode, participantId: member.id, note }),
      });
      setNotice(`${member.name} recorded as dropped out.`);
      await loadDashboard();
    });

  if (!active) return null;
  const release = info?.release;

  return (
    <section className="mt-8 rounded-2xl border border-violet-200 bg-white p-6">
      <h2 className="text-xl font-semibold text-slate-900">Adaptive Scaffolding V2</h2>
      {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {notice && (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</div>
      )}

      {release && info && (
        <div className="mt-3 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
          <div>
            V2: <strong>{release.enabled ? "enabled" : "disabled"}</strong>; home-page groups:{" "}
            <strong>{release.homePageGroups}</strong>
          </div>
          <div>
            AI provider:{" "}
            <strong>{info.aiMode === "real" ? "real (OpenAI)" : "demo text (no OPENAI_API_KEY set)"}</strong>
          </div>
          <div>
            New home-page groups get:{" "}
            <strong>
              {!release.enabled || release.homePageGroups === "legacy"
                ? "legacy (no V2)"
                : release.assignment === "randomized"
                  ? `randomized: ${release.randomizeConditions.join(", ")}`
                  : (CONDITION_LABELS[release.defaultCondition] ?? release.defaultCondition)}
            </strong>
          </div>
          <div>
            Consent version: <strong>{info.protocol.consentVersion}</strong>
          </div>
          <div>
            Policy for new groups: <strong>{release.policyVersion ?? info.currentPolicyVersion}</strong>
            {release.policyVersion ? " (pinned by ADAPTIVE_V2_POLICY_VERSION)" : " (current default)"}
          </div>
          <div>
            Open-answer rubric: <strong>{info.openAnswerRubricEnabled ? "on" : "off"}</strong>
          </div>
          <div className="sm:col-span-2 text-xs text-slate-500">
            Protocol {info.protocol.version}: {info.protocol.status}
          </div>
        </div>
      )}

      {release?.enabled && info && (
        <div className="mt-5 rounded-xl border border-slate-200 p-4">
          <h3 className="font-semibold text-slate-900">Create a V2 group</h3>
          <p className="mt-1 text-xs text-slate-500">
            The condition and versions are fixed when the group is created and can never change. Existing
            groups are not affected.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="block text-slate-700">Condition</span>
              <select
                value={form.condition}
                onChange={(e) => setForm({ ...form, condition: e.target.value })}
                className="w-full rounded-lg border border-slate-300 px-2 py-1.5"
              >
                {info.conditions.map((c) => (
                  <option key={c} value={c}>
                    {CONDITION_LABELS[c] ?? c}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="block text-slate-700">Intervention policy</span>
              <select
                value={form.policyVersion}
                onChange={(e) => setForm({ ...form, policyVersion: e.target.value })}
                className="w-full rounded-lg border border-slate-300 px-2 py-1.5"
              >
                <option value="">current default</option>
                {info.policies.map((p) => (
                  <option key={p.version} value={p.version}>
                    {p.version}
                    {p.learningAware ? " (learning-aware)" : ""}
                    {p.testOnly ? " (test only)" : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-sm text-slate-700">
            {(["openingPrompt", "checkpoints", "roles"] as const).map((key) => (
              <label key={key} className="flex items-center gap-1.5">
                <input type="checkbox" checked={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.checked })} />
                {key === "openingPrompt" ? "Opening prompt" : key === "checkpoints" ? "Checkpoints" : "Role cards"}
              </label>
            ))}
            {(["initialIdea", "agreementReason"] as const).map((key) => (
              <label key={key} className="flex items-center gap-1.5">
                {key === "initialIdea" ? "Initial idea" : "Agreement reason"}
                <select
                  value={form[key]}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                  className="rounded border border-slate-300 px-1 py-0.5"
                >
                  <option value="off">off</option>
                  <option value="optional">optional</option>
                  <option value="required">required</option>
                </select>
              </label>
            ))}
          </div>
          <button
            type="button"
            onClick={createGroup}
            disabled={busy}
            className="mt-4 rounded-lg bg-violet-600 px-4 py-2 text-sm text-white hover:bg-violet-700 disabled:opacity-50"
          >
            Create group
          </button>
        </div>
      )}

      <div className="mt-5 rounded-xl border border-slate-200 p-4">
        <h3 className="font-semibold text-slate-900">V2 exports for all V2 groups</h3>
        <p className="mt-1 text-xs text-slate-500">
          One file with every V2 group. Each row names its group and condition; legacy groups are not included.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {V2_EXPORTS.map((item) => (
            <button
              key={item.type}
              type="button"
              onClick={() =>
                run(() =>
                  download(
                    `/api/admin/export?type=${item.type}&scope=all`,
                    `all-v2-groups-${item.type}.csv`,
                    password
                  )
                )
              }
              className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-violet-700 hover:border-violet-400"
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs font-medium text-slate-600">V2.3 learning-aware exports (rows only for policy-v2-3 groups)</p>
        <div className="mt-1 flex flex-wrap gap-2">
          {V23_EXPORTS.map((item) => (
            <button
              key={item.type}
              type="button"
              onClick={() =>
                run(() =>
                  download(
                    `/api/admin/export?type=${item.type}&scope=all`,
                    `all-v2-groups-${item.type}.csv`,
                    password
                  )
                )
              }
              className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-violet-700 hover:border-violet-400"
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {selectedCode && !selectedIsV2 && (
        <p className="mt-5 text-sm text-slate-500">
          {selectedCode} is a legacy group: it has no V2 data and uses only the original exports above.
        </p>
      )}

      {dashboard && (
        <div className="mt-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold text-slate-900">
              {dashboard.group}: {CONDITION_LABELS[dashboard.assignment.condition] ?? dashboard.assignment.condition}
            </h3>
            <button
              type="button"
              onClick={() => run(loadDashboard)}
              className="rounded-lg border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
            >
              Refresh
            </button>
          </div>
          {dashboard.warnings.length > 0 && (
            <ul className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {dashboard.warnings.map((w) => (
                <li key={w}>⚠ {w}</li>
              ))}
            </ul>
          )}
          <div className="grid gap-1 text-xs text-slate-600 sm:grid-cols-2">
            <div>Policy: {dashboard.assignment.interventionPolicyVersion}</div>
            <div>Protocol: {dashboard.assignment.studyProtocolVersion}</div>
            <div>Consent: {dashboard.assignment.consentVersion}</div>
            <div>
              Model at creation: {dashboard.assignment.modelConfigVersion} ({dashboard.assignment.aiModeAtAssignment})
            </div>
            <div>
              Assigned: {dashboard.assignment.assignmentMethod} via {dashboard.assignment.createdVia}
            </div>
            <div>Started: {dashboard.assignment.startedAt ?? "not yet"}</div>
            <div className="sm:col-span-2">Data-quality flags: {dashboard.dataQualityFlags.join(", ") || "none"}</div>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-slate-800">Members</h4>
            <ul className="mt-1 divide-y divide-slate-100 text-sm">
              {dashboard.members.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-1">
                  <span>
                    {m.name} <span className="font-mono text-xs text-slate-400">{m.studentId}</span>
                  </span>
                  <span className="flex items-center gap-2 text-xs text-slate-600">
                    {m.consented ? "consented" : "no consent"}
                    {m.inRoster && " · in roster"}
                    {m.withdrawn && " · withdrawn"}
                    {m.droppedOut && " · dropped out"}
                    {m.inRoster && !m.withdrawn && !m.droppedOut && (
                      <button
                        type="button"
                        onClick={() => markDroppedOut(m)}
                        className="rounded border border-slate-300 px-2 py-0.5 hover:bg-slate-50"
                      >
                        Mark as dropped out
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <p className="text-sm text-slate-700">
            {dashboard.counts.evaluations} evaluations ({dashboard.counts.evaluationRows} logged rows after collapsing
            repeats), {dashboard.counts.shared} shared ideas, {dashboard.counts.recommendations} recommendations (
            {dashboard.counts.recommendationsOverridden} where a more direct level was chosen)
            {dashboard.counts.learnerModels > 0 &&
              `, ${dashboard.counts.learnerModels} learner models with ${dashboard.counts.learnerModelUpdates} logged updates`}
            .
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Counts title="Decisions" values={dashboard.counts.decisions} />
            <Counts title="Reason codes" values={dashboard.counts.reasonCodes} />
            <Counts title="Triggers detected" values={dashboard.counts.triggers} />
            <Counts title="Interventions by status" values={dashboard.counts.interventionsByStatus} />
            <Counts title="Scope / initiated by" values={dashboard.counts.interventionsByScope} />
            <Counts title="AI origin" values={dashboard.counts.aiOrigins} />
            <Counts title="Member responses" values={dashboard.counts.feedback} />
          </div>
          {dashboard.aiUsage && <AiUsagePanel usage={dashboard.aiUsage} />}

          {dashboard.failures.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-slate-800">Failures</h4>
              <ul className="mt-1 text-xs text-slate-600">
                {dashboard.failures.map((f) => (
                  <li key={f.id}>
                    Scenario {f.scenarioOrder}, {f.supportType}: {f.reason ?? "unknown"} ({f.at ?? "-"})
                  </li>
                ))}
              </ul>
            </div>
          )}

          {dashboard.timeline.length > 0 && (
            <div className="overflow-x-auto">
              <h4 className="text-sm font-semibold text-slate-800">Intervention timeline</h4>
              <table className="mt-1 w-full text-left text-xs text-slate-700">
                <thead className="text-slate-500">
                  <tr>
                    <th className="py-1 pr-2">Scenario</th>
                    <th className="py-1 pr-2">Time (UTC)</th>
                    <th className="py-1 pr-2">Scope</th>
                    <th className="py-1 pr-2">By</th>
                    <th className="py-1 pr-2">Trigger</th>
                    <th className="py-1 pr-2">Support</th>
                    <th className="py-1 pr-2">Status</th>
                    <th className="py-1 pr-2">AI</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.timeline.map((t) => (
                    <tr key={t.id} className="border-t border-slate-100">
                      <td className="py-1 pr-2">{t.scenarioOrder}</td>
                      <td className="py-1 pr-2 font-mono">{t.createdAt.slice(0, 19)}</td>
                      <td className="py-1 pr-2">{t.scope}</td>
                      <td className="py-1 pr-2">{t.initiatedBy}</td>
                      <td className="py-1 pr-2">{t.trigger}</td>
                      <td className="py-1 pr-2">{t.supportType}</td>
                      <td className="py-1 pr-2">{t.status}</td>
                      <td className="py-1 pr-2">{t.aiOrigin ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {dashboard.learningAware && (
            <LearningAwareSection data={dashboard.learningAware} group={dashboard.group} password={password} run={run} />
          )}

          <div>
            <h4 className="text-sm font-semibold text-slate-800">V2 exports for {dashboard.group}</h4>
            <div className="mt-2 flex flex-wrap gap-2">
              {[...V2_EXPORTS, ...V23_EXPORTS].map((item) => (
                <button
                  key={item.type}
                  type="button"
                  onClick={() =>
                    run(() =>
                      download(
                        `/api/admin/export?type=${item.type}&session=${encodeURIComponent(dashboard.group)}`,
                        `${dashboard.group}-${item.type}.csv`,
                        password
                      )
                    )
                  }
                  className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-violet-700 hover:border-violet-400"
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
