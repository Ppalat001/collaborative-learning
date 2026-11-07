"use client";

import { useEffect, useState } from "react";
import { participantHeaders } from "@/lib/client/participant";

interface ConsentDocument {
  version: string;
  informationSheetVersion: string;
  textAvailable: boolean;
  title: string;
  paragraphs: string[];
  checkboxes: { id: string; text: string }[];
  contact: string;
  withdrawal: string;
  draft: boolean;
}

/** One participant's own consent on their own device (V2 groups). */
export function ResearchConsentForm({
  code,
  participantId,
  onConsented,
}: {
  code: string;
  participantId: string;
  onConsented: () => void;
}) {
  const [doc, setDoc] = useState<ConsentDocument | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/sessions/${code}/consent?participantId=${encodeURIComponent(participantId)}`, {
      headers: participantHeaders(false),
    })
      .then(async (res) => {
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) setError(data.error ?? "Could not load the consent form");
        else setDoc(data.document);
      })
      .catch(() => !cancelled && setError("Could not load the consent form"));
    return () => {
      cancelled = true;
    };
  }, [code, participantId]);

  if (error && !doc) {
    return <p className="mt-6 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>;
  }
  if (!doc) return <p className="mt-6 text-sm text-slate-600">Loading consent form...</p>;
  if (!doc.textAvailable) {
    return (
      <p className="mt-6 rounded-xl bg-red-50 p-4 text-sm text-red-700">
        The consent text for this group&apos;s version is not available. Please contact the researcher.
      </p>
    );
  }

  const allChecked = doc.checkboxes.every((c) => checked.includes(c.id));

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${code}/consent`, {
        method: "POST",
        headers: participantHeaders(),
        body: JSON.stringify({ participantId, confirmedStatements: checked }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error ?? "Could not record your consent");
      else onConsented();
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-6">
      <h2 className="font-semibold text-slate-900">{doc.title}</h2>
      <p className="mt-1 text-xs text-slate-500">
        Each member confirms this for themselves. Consent version {doc.version}; information sheet{" "}
        {doc.informationSheetVersion}.
      </p>
      {doc.draft && (
        <p className="mt-2 rounded-lg bg-amber-100 px-3 py-2 text-xs font-medium text-amber-900">
          Draft wording: this consent text has not been finalised by the researcher yet.
        </p>
      )}
      <div className="mt-3 space-y-2 text-sm text-slate-700">
        {doc.paragraphs.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
        <p className="text-slate-600">{doc.withdrawal}</p>
        <p className="text-slate-600">{doc.contact}</p>
      </div>
      <div className="mt-4 space-y-2">
        {doc.checkboxes.map((box) => (
          <label key={box.id} className="flex items-start gap-2 text-sm text-slate-800">
            <input
              type="checkbox"
              className="mt-1"
              checked={checked.includes(box.id)}
              onChange={(e) =>
                setChecked((current) =>
                  e.target.checked ? [...current, box.id] : current.filter((id) => id !== box.id)
                )
              }
            />
            {box.text}
          </label>
        ))}
      </div>
      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      <button
        type="button"
        disabled={!allChecked || saving}
        onClick={submit}
        className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-white disabled:opacity-50"
      >
        {saving ? "Saving..." : "I give my consent"}
      </button>
    </section>
  );
}
