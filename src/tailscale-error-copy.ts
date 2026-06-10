// Friendly, operation-specific error copy for the Tailscale setup form.
//
// The setup server actions (`saveTailscaleConnectionAction`,
// `clearTailscaleConnectionAction`) RETURN `{ ok: false, error, code? }`
// instead of throwing, so Next.js production error masking does NOT apply:
// the raw `error` string (built from `err.message`, which wraps upstream
// Nango/Tailscale API detail as `` `${err.name}: ${err.message}` ``) would
// reach end users verbatim if rendered. These helpers are the single place
// the client derives user-facing copy from a failed action result. They
// intentionally IGNORE `result.error` — raw detail stays server-side (the
// connector's `console.error` logging in `src/index.ts` is unchanged) — and
// map the action's typed `code` to short, actionable copy instead.

/** The failure shape both setup actions return (`code` only on the save path). */
export type TailscaleFailedActionResult = {
  error: string;
  code?: string;
};

export type TailscaleFailureNotice = {
  title: string;
  body: string;
};

/**
 * Save-path `code` → friendly copy. Codes documented on
 * `saveTailscaleConnection` (src/index.ts) + `TailscaleApiError`
 * (src/tailscale-api.mjs).
 *
 * Note: Nango's save-time token verification failure is wrapped as
 * `tailscale.unknown` ("Tailscale connection import failed: …"), so the
 * unknown/fallback copy points at the token as the most likely cause.
 */
const TAILSCALE_CONNECT_ERROR_FALLBACK =
  "Unable to connect Tailscale. Check that the API access token is valid and try again — the server logs have details.";

const TAILSCALE_CONNECT_ERROR_COPY: ReadonlyMap<string, string> = new Map([
  [
    "tailscale.invalid_client",
    "Tailscale rejected the API access token. Generate a new token and make sure its Tags scope matches the tag you entered.",
  ],
  [
    "tailscale.scope_denied",
    "The API access token is missing the required permissions. Generate a new token in the Tailscale admin console with the needed scopes.",
  ],
  [
    "tailscale.tag_denied",
    "Tailscale rejected the tag. Add a tagOwners entry for it in your tailnet policy file and make sure the token's Tags scope includes it.",
  ],
  [
    "tailscale.rate_limited",
    "Tailscale is rate-limiting requests right now. Wait a few seconds and try again.",
  ],
  [
    "tailscale.network",
    "Couldn't reach the Tailscale API. Check your network connection and try again.",
  ],
  [
    "tailscale.nango_unconfigured",
    "Configure the connection service (Nango) first so Tailscale credentials can be stored.",
  ],
  [
    "tailscale.nango_writeback",
    "The token couldn't be stored reliably, so the connection was rolled back. Try connecting again.",
  ],
  ["tailscale.unknown", TAILSCALE_CONNECT_ERROR_FALLBACK],
]);

/**
 * Notice for a failed `saveTailscaleConnectionAction` result. Maps the typed
 * `code` to friendly copy; `result.error` is never rendered.
 */
export function tailscaleConnectFailureNotice(
  result: TailscaleFailedActionResult,
): TailscaleFailureNotice {
  // Map lookup (not a plain object index) so an unrecognized code can never
  // resolve a prototype-chain member — anything unmapped falls back.
  const body =
    (result.code !== undefined
      ? TAILSCALE_CONNECT_ERROR_COPY.get(result.code)
      : undefined) ?? TAILSCALE_CONNECT_ERROR_FALLBACK;
  return { title: "Tailscale connection failed", body };
}

/**
 * Notice for a failed `clearTailscaleConnectionAction` result. The disconnect
 * action returns no `code`, so the copy is unconditional; the result is still
 * accepted (and ignored) so the call site mirrors the connect path and
 * documents that `result.error` deliberately never reaches the UI.
 */
export function tailscaleDisconnectFailureNotice(
  _result: TailscaleFailedActionResult,
): TailscaleFailureNotice {
  return {
    title: "Tailscale disconnect failed",
    body: "Unable to disconnect Tailscale. Try again, and check the server logs if the problem persists.",
  };
}
