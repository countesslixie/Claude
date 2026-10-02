/**
 * Brief #6b (D147) — the Client code suggested from a registered name on the
 * New client form: last word + "-" + first word, lowercased, accents
 * stripped, and anything outside a-z / 0-9 removed from each word.
 *
 *   "Maria Santos Reyes" -> "reyes-maria"
 *   "Juan Dela Cruz"     -> "cruz-juan"   (two-word surnames are fixed by hand)
 *   "Cher"               -> "cher"
 *   ""                   -> ""
 *
 * Pure: no I/O. It is only a suggestion — the server still validates the
 * code's format and uniqueness, and never appends a number.
 */
function cleanWord(word: string): string {
  return word
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function suggestClientCode(registeredName: string): string {
  // A word that is nothing but punctuation cleans to "" and drops out, so
  // "Maria - Reyes" still reads as two words.
  const words = registeredName
    .split(/\s+/)
    .map(cleanWord)
    .filter((w) => w.length > 0);
  if (words.length === 0) return "";
  if (words.length === 1) return words[0];
  return `${words[words.length - 1]}-${words[0]}`;
}
