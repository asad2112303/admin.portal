/**
 * Pakistani mobile number handling.
 *
 * Numbers are stored normalised as 92XXXXXXXXXX so that dial links, WhatsApp
 * links and duplicate checks all work off one canonical form. These two
 * functions are the read side of that: the public website owns the validation
 * used when a number is first submitted.
 */

/** `0300 1234567`, `+92 300 1234567`, `3001234567` -> `923001234567`. */
export function normalizePakistaniPhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (!digits) return null;

  let national: string;
  if (digits.startsWith("92") && digits.length === 12) national = digits.slice(2);
  else if (digits.startsWith("0") && digits.length === 11) national = digits.slice(1);
  else if (digits.length === 10) national = digits;
  else return null;

  return /^3\d{9}$/.test(national) ? `92${national}` : null;
}

/** `923001234567` -> `+92 300 1234567`, for display. */
export function formatPakistaniPhone(normalized: string): string {
  const n = normalized.slice(2);
  return `+92 ${n.slice(0, 3)} ${n.slice(3)}`;
}
