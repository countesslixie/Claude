/**
 * D121 — the "preparation aid" sentence is no longer shown anywhere. Frozen
 * snapshots (and the engine's own notes) still carry it, so it is filtered out
 * at display time: the sheet's "Show explanations" and newly saved sheet files.
 * Display only — nothing stored is rewritten.
 */
export function displaySourceNote(note: string): string {
  return note
    .replace(
      /\s*This is a preparation aid(?:\.\s*The|\s*[—;-]\s*the) filed return and BIR(?:'|&#39;)s own assessment govern\.?/gi,
      "",
    )
    .trim();
}
