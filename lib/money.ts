import Decimal from "decimal.js";

/**
 * Money is always stored and passed around as integer centavos.
 * Floating-point arithmetic on currency is forbidden anywhere in this
 * codebase (see SPEC.md section 4) — use Decimal.js at every boundary
 * where a human enters or reads a peso amount.
 */
export type Cents = number;

/** Basis points, e.g. 800 = 8.00%. Used for all rates (tax rate, WHT rate). */
export type Bps = number;

Decimal.set({ rounding: Decimal.ROUND_HALF_UP });

/** Parses a user-entered peso string ("1,234.56") into integer centavos. */
export function pesosToCents(input: string | number): Cents {
  const normalized =
    typeof input === "string" ? input.replace(/,/g, "").trim() : input;
  if (normalized === "" || normalized === null || normalized === undefined) {
    return 0;
  }
  const decimal = new Decimal(normalized);
  return decimal.times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

/** Formats integer centavos as a peso string, e.g. 123456 -> "1,234.56". */
export function centsToPesos(cents: Cents, opts?: { withSymbol?: boolean }): string {
  const decimal = new Decimal(cents).dividedBy(100);
  const formatted = decimal.toFixed(2).replace(/\B(?=(\d{3})+(?!\d)(?=\.))/g, ",");
  const [intPart, decPart] = formatted.split(".");
  const withComma = insertThousandsSeparator(intPart) + "." + decPart;
  return opts?.withSymbol ? `₱${withComma}` : withComma;
}

/**
 * Formats a computation-sheet breakdown line's amount, parenthesizing it
 * when the line is the final Tax Payable/(Overpayment) row and the figure
 * is an overpayment — (₱16,700.00) rather than a plain positive figure
 * that reads identically to tax due (brief #5g §7). amountCents is always
 * the non-negative magnitude; only the display wraps it in parentheses.
 */
export function formatBreakdownAmount(amountCents: Cents, isOverpaymentLine?: boolean): string {
  const formatted = centsToPesos(amountCents, { withSymbol: true });
  return isOverpaymentLine ? `(${formatted})` : formatted;
}

function insertThousandsSeparator(intPart: string): string {
  const negative = intPart.startsWith("-");
  const digits = negative ? intPart.slice(1) : intPart;
  const withCommas = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return negative ? `-${withCommas}` : withCommas;
}

/** Applies a basis-point rate to a centavo amount, half-up rounded to the centavo. */
export function applyBps(amountCents: Cents, bps: Bps): Cents {
  return new Decimal(amountCents)
    .times(bps)
    .dividedBy(10000)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber();
}

export function bpsToPercentLabel(bps: Bps): string {
  return `${new Decimal(bps).dividedBy(100).toFixed(2)}%`;
}

/** Parses a user-entered percent string ("5" or "5.00") into basis points, e.g. "5" -> 500. */
export function percentToBps(input: string | number): Bps {
  const normalized = typeof input === "string" ? input.trim() : input;
  if (normalized === "" || normalized === null || normalized === undefined) {
    return 0;
  }
  const decimal = new Decimal(normalized);
  return decimal.times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

export function addCents(...values: Cents[]): Cents {
  return values.reduce((sum, v) => sum + v, 0);
}
