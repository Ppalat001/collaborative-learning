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
            <strong>This test is individual.</strong> Answer on your own, with no Skype,
            Zoom, messaging, other people or AI tools. Outside help would distort the
            outcome and the metrics, both for you and for your group.
          </>
        ) : (
          <>
            <strong>No external calls.</strong> Do not use Skype, Zoom, Teams, WhatsApp or
            similar during this study. All group talk stays in this platform&apos;s chat, so
            the outcome and the metrics stay accurate for the group and for each of you.
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
        Important: no external calls or messaging during the whole study
      </h2>
      <p className="mt-2 text-sm text-amber-900">
        From the pre-test until the end of the study, please do <strong>not</strong> use
        any external calls or messaging with your group or anyone else (for example Skype,
        Zoom, Microsoft Teams, Google Meet, WhatsApp, Discord or phone calls).
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">
        <li>
          The <strong>pre-test and post-test</strong> are individual: answer them on your
          own, without help from others or from AI tools.
        </li>
        <li>
          During the scenarios, <strong>all group communication happens in the
          platform&apos;s group chat</strong>.
        </li>
        <li>
          Outside communication is not recorded, so it would distort the outcome and the
          metrics of this study, both for your group and for each of you individually.
        </li>
      </ul>
    </section>
  );
}
