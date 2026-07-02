"use client";

import Link from "next/link";
import { useState } from "react";

export default function AdminPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const exportData = () => {
    setError(null);
    const url = `/api/admin/export?password=${encodeURIComponent(password)}`;
    fetch(url)
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error ?? "Export failed");
        }
        return res.blob();
      })
      .then((blob) => {
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `research-export-${Date.now()}.csv`;
        link.click();
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Export failed");
      });
  };

  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <Link href="/" className="text-sm text-indigo-600 hover:underline">
        Back home
      </Link>
      <h1 className="mt-4 text-3xl font-semibold text-slate-900">Researcher admin</h1>
      <p className="mt-2 text-slate-600">
        Export all session data as CSV for dissertation analysis.
      </p>

      {error && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-700">
          {error}
        </div>
      )}

      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
        <label className="block space-y-1">
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
          onClick={exportData}
          className="mt-4 rounded-lg bg-indigo-600 px-5 py-2.5 text-white hover:bg-indigo-700"
        >
          Download scenario CSV
        </button>
        <button
          type="button"
          onClick={() => {
            setError(null);
            const url = `/api/admin/export?type=assessments&password=${encodeURIComponent(password)}`;
            fetch(url)
              .then(async (res) => {
                if (!res.ok) {
                  const data = await res.json();
                  throw new Error(data.error ?? "Export failed");
                }
                return res.blob();
              })
              .then((blob) => {
                const link = document.createElement("a");
                link.href = URL.createObjectURL(blob);
                link.download = `assessments-export-${Date.now()}.csv`;
                link.click();
              })
              .catch((err) => {
                setError(err instanceof Error ? err.message : "Export failed");
              });
          }}
          className="mt-3 block rounded-lg border border-indigo-600 px-5 py-2.5 text-indigo-700 hover:bg-indigo-50"
        >
          Download pre/post-test scores
        </button>
        <p className="mt-3 text-xs text-slate-500">
          Default password: research-admin (set ADMIN_PASSWORD in .env)
        </p>
      </div>
    </div>
  );
}
