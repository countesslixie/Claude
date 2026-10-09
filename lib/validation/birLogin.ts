import { z } from "zod";

/**
 * D180/D181 — one client's eAFS, Alphalist and ORUS logins: a username and a password
 * each, all optional text. Only the ends are trimmed; everything inside (spaces, quotes,
 * symbols) is kept exactly as typed, because a password can contain any character. An
 * empty box is stored as nothing (null). Error messages are fixed words — they never echo
 * a value. (The old eafsNotes/alphalistNotes columns stay in the database, unused.)
 */
const field = z
  .string()
  .max(200, "Too long")
  .transform((v) => v.trim())
  .transform((v) => (v === "" ? null : v));

export const BIR_LOGIN_FIELDS = [
  "eafsUsername",
  "eafsPassword",
  "alphalistUsername",
  "alphalistPassword",
  "orusUsername",
  "orusPassword",
] as const;

export type BirLoginField = (typeof BIR_LOGIN_FIELDS)[number];

export const birLoginSchema = z.object({
  eafsUsername: field,
  eafsPassword: field,
  alphalistUsername: field,
  alphalistPassword: field,
  orusUsername: field,
  orusPassword: field,
});

export type BirLoginInput = z.infer<typeof birLoginSchema>;
