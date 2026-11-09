export function NoExternalCallsNote({
  compact = false,
  forTest = false,
  className = "",
}: {
  compact?: boolean;
  forTest?: boolean;
  className?: string;
}) {
  if (compact) {
    return (
      <p
        className={`rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 ${className}`}
      >
        {forTest ? (
          <>
            <strong>Please complete this test on your own.</strong> Do not ask other
            people or AI tools for help.
          </>
        ) : (
          <>
            <strong>Please use only this platform&apos;s group chat.</strong> Do not call
            or message anyone outside the platform during the study.
          </>
        )}
      </p>
    );
  }

  return (
    <section
      className={`rounded-2xl border-2 border-amber-300 bg-amber-50 p-5 ${className}`}
      aria-labelledby="no-external-calls-title"
    >
      <h2 id="no-external-calls-title" className="font-semibold text-amber-900">
        Please use only this platform
      </h2>
      <p className="mt-2 text-sm text-amber-900">
        Please do not call or message anyone outside the platform during the study.
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">
        <li>
          Complete the <strong>pre-test and post-test on your own</strong>, without help
          from other people or AI tools.
        </li>
        <li>
          During the scenarios, use only the <strong>group chat in this platform</strong>.
        </li>
        <li>
          Outside communication is not recorded and may affect the study results.
        </li>
      </ul>
    </section>
  );
}
