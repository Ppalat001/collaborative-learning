"use client";

import Link from "next/link";
import { useState } from "react";
import { RubricScoring } from "@/components/RubricScoring";

const EXPORTS = [
  {
    type: "scenarios",
    label: "Group answers per scenario",
    description:
      "Final answer, who wrote which share, AI help each student used, how much of the answer was copied from AI, chat before/after AI, time, rubric total, average confidence",
  },
  {
    type: "messages",
    label: "Discussion chat log",
    description: "Every chat message with student name, time and whether it was before or after AI",
  },
  {
    type: "ai_support",
    label: "Individual AI support",
    description:
      "Every AI help each student selected: type, level, how often shown/hidden and the AI reply",
  },
  {
    type: "contributions",
    label: "Individual contributions",
    description:
      "Per student per scenario: chat messages and words, characters typed, share of the final answer",
  },
  {
    type: "ratings",
    label: "Individual scenario ratings",
    description:
      "Per student per scenario: confidence in the group answer and why, what the group could do differently, the 1-5 ratings, amount of AI help and comment",
  },
  {
    type: "assessments",
    label: "Pre/post-test comparison",
    description:
      "One row per student: pre and post scores, each concept and the written answers side by side",
  },
  {
    type: "reflections",
    label: "End questionnaire",
    description: "One row per student with every answer from the questionnaire after the post-test",
  },
  {
    type: "rubric",
    label: "Rubric scores",
    description: "Your scores for each final group answer (6 criteria, 1-4 each, total 6-24)",
  },
] as const;

/** Adaptive Scaffolding V2 groups only; students appear as anonymous ids. */
const V2_EXPORTS = [
  {
    type: "v2_ai_usage",
    label: "AI use per scenario",
    description:
      "Human chat messages, group AI requests and proactive offers, Step 2 replies, private popups, shared excerpts, real or demo AI, feedback, outcomes, tokens, failures and group warnings, each counted on its own",
  },
  {
    type: "v2_assignment",
    label: "Study assignment and provenance",
    description: "One row per group: condition, policy, every version, features, roster, AI origins and data-quality flags",
  },
  {
    type: "v2_consents",
    label: "Consent records",
    description: "Per student: consent, withdrawal, drop-out and whether they were in the group at the start",
  },
  {
    type: "v2_evaluations",
    label: "Decisions, including no-action",
    description: "Every time the system checked the group: trigger, evidence, decision, reason and repeat count",
  },
  {
    type: "v2_interventions",
    label: "Interventions",
    description: "Every group AI reply, offer and private popup: status times, AI origin and model, tokens, failures, text and responses",
  },
  {
    type: "v2_feedback",
    label: "Responses to interventions",
    description: "Each student action on an AI item: viewed, accepted, no thanks, not now, why, shared",
  },
  {
    type: "v2_sharing",
    label: "Shared AI ideas",
    description: "Text students chose to share from their private AI help into the group chat",
  },
  {
    type: "v2_recommendations",
    label: "Adaptive recommendations",
    description: "Recommended private support level, fading and what the student chose",
  },
  {
    type: "v2_learner_models",
    label: "Learner models",
    description: "Per student: estimated pace, independence, openness to help, which help works, and popup counts",
  },
  {
    type: "v2_learner_model_events",
    label: "Learner model updates",
    description: "Every learner model update with its reward and the state before and after",
  },
  {
    type: "v2_initial_ideas",
    label: "Initial individual ideas",
    description: "First private idea per student and scenario, and whether it came before private AI",
  },
  {
    type: "v2_roles",
    label: "Role cards",
    description: "Roles chosen per scenario and whether they matched the suggested rotation",
  },
  {
    type: "v2_checkpoints",
    label: "Checkpoints raised",
    description: "Checkpoint questions students raised for their group",
  },
  {
    type: "v2_agreement_reasons",
    label: "Agreement reasons",
    description: "One-sentence reasons given when clicking \"I am good\"",
  },
  {
    type: "v2_3_offer_funnel",
    label: "Offer funnel per student",
    description: "Per offer and student: proposed, delivered, seen, own response, accepted, delivered content, effective (proxy)",
  },
  {
    type: "v2_3_group_states",
    label: "Group-state estimates",
    description: "Estimated collaboration stage and state behind each decision, with heuristic confidence and evidence",
  },
  {
    type: "v2_3_private_decisions",
    label: "Private decision traces",
    description: "Every private-help decision per student, including waits, with reason and tier",
  },
  {
    type: "v2_3_scaffolding_events",
    label: "Fading and escalation",
    description: "Fading, escalation, reassessment and \"don't suggest again\" events",
  },
  {
    type: "v2_3_exposures",
    label: "Offer exposure",
    description: "When each offer was delivered, shown on screen, opened, answered or expired",
  },
  {
    type: "v2_3_outcomes",
    label: "Observed outcomes (proxy)",
    description: "After proactive help: activity resumed and difficulty resolved (proxy), with confounds and validity",
  },
  {
    type: "v2_3_progress_feedback",
    label: "One-click progress feedback",
    description: "Voluntary \"Did this help you make progress?\" answers",
  },
  {
    type: "v2_3_review_labels",
    label: "Human review labels",
    description: "Researcher labels on decision windows next to the system's decision",
  },
  {
    type: "v2_3_open_rubric",
    label: "Open-answer rubric (optional)",
    description: "Optional researcher rubric for written test question 9 (0-4)",
  },
] as const;

interface MemberStatus {
  id: string;
  name: string;
  inRoster: boolean;
  withdrawn: boolean;
  droppedOut: boolean;
}

interface GroupSummary {
  code: string;
  createdAt: string;
  completedAt: string | null;
  members: string[];
  scenariosFinished: number;
  totalScenarios: number;
  /** false for legacy groups without an Adaptive Scaffolding V2 assignment. */
  isV2: boolean;
  condition: string | null;
  started: boolean | null;
}

async function adminFetch(url: string, password: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: {
      "x-admin-password": password,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `Request failed (${res.status})`);
  }
  return res;
}

/** `code` null downloads every V2 group in one file (V2 exports only). */
async function downloadExport(type: string, code: string | null, password: string) {
  const target = code ? `session=${encodeURIComponent(code)}` : "scope=all";
  const res = await adminFetch(`/api/admin/export?type=${type}&${target}`, password);
  const blob = await res.blob();
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${code ?? "all-v2-groups"}-${type}.csv`;
  link.click();
}

export default function AdminPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [groups, setGroups] = useState<GroupSummary[] | null>(null);
  const [selected, setSelected] = useState("");
  const [deleteCode, setDeleteCode] = useState("");
  const [allV2Groups, setAllV2Groups] = useState(false);
  const [loadedMembers, setLoadedMembers] = useState<{ code: string; members: MemberStatus[] } | null>(null);
  const [dropoutMember, setDropoutMember] = useState("");

  const run = async (action: () => Promise<void>) => {
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  };

  const loadMembers = async (group: GroupSummary | undefined) => {
    setDropoutMember("");
    if (!group?.isV2) return;
    const res = await adminFetch(
      `/api/admin/interventions?session=${encodeURIComponent(group.code)}`,
      password
    );
    const data: { members: MemberStatus[] } = await res.json();
    setLoadedMembers({ code: group.code, members: data.members });
  };

  const fetchGroups = async (keep: string) => {
    const res = await adminFetch("/api/admin/sessions", password);
    const data: { sessions: GroupSummary[] } = await res.json();
    const code = data.sessions.some((g) => g.code === keep) ? keep : data.sessions[0]?.code ?? "";
    setGroups(data.sessions);
    setSelected(code);
    await loadMembers(data.sessions.find((g) => g.code === code));
  };

  const loadGroups = () => run(() => fetchGroups(selected));

  const selectGroup = (code: string) => {
    setSelected(code);
    run(() => loadMembers(groups?.find((g) => g.code === code)));
  };

  const deleteGroup = () =>
    run(async () => {
      const code = deleteCode.trim().toUpperCase();
      if (
        !window.confirm(
          `This permanently deletes group ${code} and everything recorded for it. Continue?`
        )
      ) {
        return;
      }
      await adminFetch(`/api/admin/sessions?session=${encodeURIComponent(code)}`, password, {
        method: "DELETE",
        body: JSON.stringify({ confirm: code }),
      });
      setDeleteCode("");
      if (groups) await fetchGroups(selected === code ? "" : selected);
      setNotice(`Group ${code} deleted.`);
    });

  const deleteAll = () =>
    run(async () => {
      const confirm = window.prompt(
        'This permanently deletes EVERY group and all study data. Type "DELETE ALL" to confirm.'
      );
      if (confirm === null) return;
      const res = await adminFetch("/api/admin/sessions?all=1", password, {
        method: "DELETE",
        body: JSON.stringify({ confirm }),
      });
      const data = await res.json();
      setNotice(`Deleted ${data.deleted} group(s). The database is now empty.`);
      setSelected("");
      setGroups([]);
    });

  const selectedGroup = groups?.find((g) => g.code === selected);
  const members =
    selectedGroup?.isV2 && loadedMembers?.code === selected ? loadedMembers.members : null;
  const stillInGroup = members?.filter((m) => m.inRoster && !m.withdrawn && !m.droppedOut) ?? [];
  const droppedOut = members?.filter((m) => m.droppedOut) ?? [];
  const v2Enabled = allV2Groups ? groups !== null : !!selectedGroup?.isV2;

  const markDroppedOut = () =>
    run(async () => {
      const member = members?.find((m) => m.id === dropoutMember);
      if (!member) return;
      const note = window.prompt(
        `Record that ${member.name} left group ${selected} for good? Optional note:`
      );
      if (note === null) return;
      await adminFetch("/api/admin/dropout", password, {
        method: "POST",
        body: JSON.stringify({ session: selected, participantId: member.id, note }),
      });
      await loadMembers(selectedGroup);
      setNotice(`${member.name} recorded as dropped out of ${selected}.`);
    });

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <Link href="/" className="text-sm text-indigo-600 hover:underline">
        Back home
      </Link>
      <h1 className="mt-4 text-3xl font-semibold text-slate-900">Researcher admin</h1>
      <p className="mt-2 text-slate-600">
        Download the study data and metrics as CSV, score group answers with the rubric, and
        clean up test data.
      </p>

      {error && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-700">
          {error}
        </div>
      )}
      {notice && (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-800">
          {notice}
        </div>
      )}

      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block w-full max-w-sm space-y-1">
            <span className="text-sm text-slate-700">Admin password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
          <button
            type="button"
            onClick={loadGroups}
            disabled={!password}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {groups ? "Refresh groups" : "Load groups"}
          </button>
        </div>

        {groups && (
          <label className="mt-5 block max-w-xl space-y-1">
            <span className="text-sm text-slate-700">Group</span>
            {groups.length === 0 ? (
              <p className="text-sm text-slate-500">No groups in the database.</p>
            ) : (
              <select
                value={selected}
                onChange={(e) => selectGroup(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                {groups.map((group) => (
                  <option key={group.code} value={group.code}>
                    {group.code}
                    {group.isV2 ? ` (V2: ${group.condition})` : " (legacy)"}
                  </option>
                ))}
              </select>
            )}
          </label>
        )}

        <h2 className="mt-6 font-semibold text-slate-900">
          CSV exports{selectedGroup ? ` for ${selectedGroup.code}` : ""}
        </h2>
        {!selectedGroup && (
          <p className="mt-1 text-sm text-slate-500">
            Enter the password and load the groups, then choose a group to download its data.
          </p>
        )}
        <h3 className="mt-4 text-sm font-semibold text-slate-800">Study data (every group)</h3>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {EXPORTS.map((item) => (
            <button
              key={item.type}
              type="button"
              disabled={!selectedGroup}
              onClick={() => run(() => downloadExport(item.type, selected, password))}
              className="rounded-xl border border-slate-200 p-3 text-left hover:border-indigo-400 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-slate-200"
            >
              <div className="font-medium text-indigo-700">{item.label}</div>
              <div className="mt-1 text-xs text-slate-600">{item.description}</div>
            </button>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-800">
            AI support and adaptation (V2 groups)
          </h3>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={allV2Groups}
              onChange={(e) => setAllV2Groups(e.target.checked)}
            />
            All V2 groups in one file
          </label>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {allV2Groups
            ? "Each file holds every V2 group, oldest first, and every row names its group and condition. Legacy groups are never included."
            : selectedGroup && !selectedGroup.isV2
              ? `${selectedGroup.code} is a legacy group: it has no V2 data. Tick "All V2 groups in one file" to download every V2 group.`
              : "Students appear only as anonymous IDs. Every row repeats the group, condition and policy."}
        </p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {V2_EXPORTS.map((item) => (
            <button
              key={item.type}
              type="button"
              disabled={!v2Enabled}
              onClick={() =>
                run(() => downloadExport(item.type, allV2Groups ? null : selected, password))
              }
              className="rounded-xl border border-slate-200 p-3 text-left hover:border-violet-400 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-slate-200"
            >
              <div className="font-medium text-violet-700">{item.label}</div>
              <div className="mt-1 text-xs text-slate-600">{item.description}</div>
            </button>
          ))}
        </div>

        <div className="mt-8 rounded-xl border border-red-200 bg-red-50/50 p-4">
          <h2 className="font-semibold text-red-800">Clean up data</h2>
          <p className="mt-1 text-sm text-red-700">
            Deleting cannot be undone. Download anything you need first.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="space-y-1">
              <span className="block text-sm text-red-800">Group ID to delete</span>
              <input
                value={deleteCode}
                onChange={(e) => setDeleteCode(e.target.value.toUpperCase())}
                placeholder="GROUP-ABCD"
                list="delete-group-codes"
                className="rounded-lg border border-red-300 bg-white px-3 py-2 uppercase"
              />
              <datalist id="delete-group-codes">
                {groups?.map((group) => (
                  <option key={group.code} value={group.code} />
                ))}
              </datalist>
            </label>
            <button
              type="button"
              onClick={deleteGroup}
              disabled={!password || !deleteCode.trim()}
              className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              Delete group
            </button>
            <button
              type="button"
              onClick={deleteAll}
              disabled={!password}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700 disabled:opacity-50"
            >
              Delete all groups
            </button>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-slate-200 p-4">
          <h2 className="font-semibold text-slate-900">Member left for good</h2>
          <p className="mt-1 text-sm text-slate-600">
            For a started V2 group: the others can still finish, because &quot;I am good&quot; stops
            waiting for this member. Nothing is deleted.
          </p>
          {!selectedGroup?.isV2 ? (
            <p className="mt-2 text-sm text-slate-500">Choose a V2 group above.</p>
          ) : (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <select
                value={dropoutMember}
                onChange={(e) => setDropoutMember(e.target.value)}
                disabled={stillInGroup.length === 0}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">
                  {stillInGroup.length === 0 ? "No member to mark" : "Choose a member"}
                </option>
                {stillInGroup.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={markDroppedOut}
                disabled={!dropoutMember}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Mark as dropped out
              </button>
              {droppedOut.length > 0 && (
                <span className="text-xs text-slate-500">
                  Already recorded: {droppedOut.map((m) => m.name).join(", ")}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      <RubricScoring password={password} groupCodes={groups?.map((group) => group.code) ?? []} />
    </div>
  );
}
