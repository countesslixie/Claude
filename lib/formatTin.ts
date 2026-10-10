/**
 * D184 — a TIN as shown on screen: 9 digits → "123-456-789", 12 digits
 * (TIN + branch) → "123-456-789-000". Anything else (blank, odd length,
 * letters, already dashed) is returned exactly as stored — nothing is
 * stripped, padded or invented. Display only: stored values, validation and
 * form inputs are untouched, and BIR-facing text (the eSubmission email,
 * exports, file names) keeps plain digits and does not use this.
 */
export function formatTin(value: string | null | undefined): string {
  if (value == null) return "";
  if (/^\d{9}$/.test(value)) return `${value.slice(0, 3)}-${value.slice(3, 6)}-${value.slice(6)}`;
  if (/^\d{12}$/.test(value)) {
    return `${value.slice(0, 3)}-${value.slice(3, 6)}-${value.slice(6, 9)}-${value.slice(9)}`;
  }
  return value;
}
