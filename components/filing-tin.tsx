import { formatTin } from "@/lib/formatTin";

/**
 * D202/D203 — "TIN 123-456-789-000" on the filing page's header and slim bar:
 * the word in the muted colour, the number dashed (formatTin, D184), monospace,
 * in the primary text colour, as the client page shows it. Nothing at all when
 * the client has no TIN stored. No Copy.
 */
export function FilingTin({ tin }: { tin: string | null | undefined }) {
  const shown = formatTin(tin);
  if (!shown) return null;
  return (
    <span>
      TIN <span className="font-mono text-ink">{shown}</span>
    </span>
  );
}

/** D202 — the header subtitle: "TIN 123-456-789-000 · 1701Q - due November 16, 2026"; with no TIN stored, just the existing text. */
export function FilingSubtitle({ tin, text }: { tin: string | null | undefined; text: string }) {
  const shown = formatTin(tin);
  return (
    <p className="mt-0.5 text-sm text-ink-secondary" data-filing-subtitle>
      {shown ? (
        <>
          <FilingTin tin={tin} /> · {text}
        </>
      ) : (
        text
      )}
    </p>
  );
}
