// ---------------------------------------------------------------------------
// Tailscale API access-token expiry — pure, dependency-free helpers.
//
// Tailscale API access tokens (`tskey-api-…`) are valid for at most 90 days.
// The token powers clone auto-tunnels in the BACKGROUND, so expiry fails
// silently — tunnels just stop working. We can't introspect a bare token's
// real expiry by value alone (that needs the key's id), so the connector
// persists the set-date at save time and we derive a conservative 90-day
// expiry window from it. If the host ever captures a real `expires` date, the
// same helpers accept it directly.
//
// Pure ESM (NOT .ts) so the Node ESM CLI can import the identical module the
// TS connector + setup form import — same `.mjs` boundary as
// `tailscale-api.mjs` / `tailscale-hostname.mjs`.
// ---------------------------------------------------------------------------

/** Tailscale API access tokens live at most 90 days. */
export const TAILSCALE_TOKEN_MAX_AGE_DAYS = 90;

/** Show an amber heads-up once the token has strictly fewer than this many days left. */
export const TAILSCALE_TOKEN_WARN_DAYS = 14;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Compute the conservative expiry instant from the date the token was saved.
 *
 * @param {string | number | Date | null | undefined} setAt — when the token was stored
 * @param {number} [maxAgeDays] — token lifetime in days (defaults to 90)
 * @returns {string | null} ISO-8601 expiry instant, or null when `setAt` is unparseable
 */
export function computeTailscaleTokenExpiry(setAt, maxAgeDays = TAILSCALE_TOKEN_MAX_AGE_DAYS) {
  const base = toDate(setAt);
  if (!base) return null;
  return new Date(base.getTime() + maxAgeDays * MS_PER_DAY).toISOString();
}

/**
 * Classify how close a token is to expiry, for inline UI guidance.
 *
 * Status ladder:
 *   - "unknown"  — no expiry tracked (legacy connection saved before this field)
 *   - "ok"       — at least WARN_DAYS of real time remaining
 *   - "warning"  — strictly fewer than WARN_DAYS but more than 0 remaining
 *   - "expired"  — at or past the expiry instant
 *
 * The amber threshold is measured on the raw remaining duration ("< 14 days"),
 * NOT the rounded day count, so a token with exactly WARN_DAYS left still reads
 * as "ok". `daysRemaining` is the whole-day count, rounded UP (1.4 days left
 * reads as "2 days"), and is negative once expired; null when status is
 * "unknown".
 *
 * @param {string | number | Date | null | undefined} expiresAt
 * @param {object} [opts]
 * @param {string | number | Date} [opts.now] — injectable clock for tests
 * @param {number} [opts.warnDays] — amber threshold (defaults to 14)
 * @returns {{ status: "unknown" | "ok" | "warning" | "expired", daysRemaining: number | null, expiresAt: string | null }}
 */
export function describeTailscaleTokenExpiry(expiresAt, opts = {}) {
  const expiry = toDate(expiresAt);
  if (!expiry) {
    return { status: "unknown", daysRemaining: null, expiresAt: null };
  }
  const now = toDate(opts.now) ?? new Date();
  const warnDays =
    typeof opts.warnDays === "number" && Number.isFinite(opts.warnDays)
      ? opts.warnDays
      : TAILSCALE_TOKEN_WARN_DAYS;

  const msRemaining = expiry.getTime() - now.getTime();
  if (msRemaining <= 0) {
    return {
      status: "expired",
      daysRemaining: Math.floor(msRemaining / MS_PER_DAY),
      expiresAt: expiry.toISOString(),
    };
  }
  const daysRemaining = Math.ceil(msRemaining / MS_PER_DAY);
  // Threshold on the raw remaining duration ("strictly < WARN_DAYS"), so a
  // token with EXACTLY WARN_DAYS of real time left stays "ok".
  return {
    status: msRemaining < warnDays * MS_PER_DAY ? "warning" : "ok",
    daysRemaining,
    expiresAt: expiry.toISOString(),
  };
}

/**
 * Parse a permissive date-ish input into a valid Date, or null.
 * @param {string | number | Date | null | undefined} value
 * @returns {Date | null}
 */
function toDate(value) {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
