// ---------------------------------------------------------------------------
// Tailscale REST API client.
//
// Pure ESM module (NOT .ts) so the Node ESM CLI at
// `packages/cli/bin/cinatra.mjs` can `import` the same module the TS
// connector helper imports. This preserves the `.mjs` boundary between TS
// server code and the plain-Node CLI
// (`packages/mcp-server/src/mcp-public-base-url-shape.mjs`).
//
// Two exported functions:
//   - mintTailscaleAccessToken({ clientId, clientSecret, scope? })
//     → POSTs `https://api.tailscale.com/api/v2/oauth/token` with
//       grant_type=client_credentials, returns the access token.
//   - mintTailscaleAuthKey({ accessToken, tailnet, tags?, ephemeral?, ... })
//     → POSTs `https://api.tailscale.com/api/v2/tailnet/{tailnet}/keys`
//       with caps for device.create, returns the tskey-auth-… string.
//
// Defensive rules:
//   - NEVER include `clientSecret`, the access token, or the auth-key
//     in error messages or thrown error fields. Use generic strings.
//   - Don't log raw response bodies on auth failures (current Docker
//     output scrubbing only covers the Tailscale auth-key shell path).
//   - On HTTP error: map common codes (401, 403, 429) to friendly
//     messages so callers can surface them in the UI.
// ---------------------------------------------------------------------------

const TAILSCALE_BASE_URL = "https://api.tailscale.com/api/v2";

/**
 * Errors thrown by this module are tagged with `.code` so callers can
 * map them to UI messages without parsing strings.
 *
 * Codes: "tailscale.invalid_client" | "tailscale.scope_denied"
 *      | "tailscale.tag_denied"    | "tailscale.rate_limited"
 *      | "tailscale.network"        | "tailscale.unknown"
 */
export class TailscaleApiError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {number} [status]
   */
  constructor(code, message, status) {
    super(message);
    this.name = "TailscaleApiError";
    this.code = code;
    if (typeof status === "number") {
      this.status = status;
    }
  }
}

/**
 * Mint a short-lived Tailscale access token via OAuth client credentials.
 *
 * Tailscale's OAuth tokens have a 1-hour TTL. Always re-mint at clone-start
 * time and treat any cached token as advisory.
 *
 * If `scope` is provided, it is included in the token request as
 * `scope=<value>` (default Tailscale OAuth grants the scopes the client
 * was configured with; requesting an explicit scope surfaces
 * misconfiguration as a 403 at save time).
 *
 * @param {object} args
 * @param {string} args.clientId
 * @param {string} args.clientSecret
 * @param {string} [args.scope]
 * @returns {Promise<{ accessToken: string, expiresIn: number }>}
 */
export async function mintTailscaleAccessToken({ clientId, clientSecret, scope }) {
  if (typeof clientId !== "string" || clientId.length === 0) {
    throw new TailscaleApiError(
      "tailscale.invalid_client",
      "Tailscale OAuth client_id is required.",
    );
  }
  if (typeof clientSecret !== "string" || clientSecret.length === 0) {
    throw new TailscaleApiError(
      "tailscale.invalid_client",
      "Tailscale OAuth client_secret is required.",
    );
  }

  const params = new URLSearchParams();
  params.set("grant_type", "client_credentials");
  params.set("client_id", clientId);
  params.set("client_secret", clientSecret);
  if (scope) {
    params.set("scope", scope);
  }

  let response;
  try {
    response = await fetch(`${TAILSCALE_BASE_URL}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
  } catch (err) {
    // Network error — do NOT include the request body (which contains
    // the client_secret) in the error message.
    throw new TailscaleApiError(
      "tailscale.network",
      `Tailscale OAuth token request failed: ${err instanceof Error ? err.name : "network error"}`,
    );
  }

  if (response.status === 401 || response.status === 403) {
    // Don't echo the response body; it may contain hints about the
    // client_id that aren't safe to surface to a public UI.
    throw new TailscaleApiError(
      "tailscale.scope_denied",
      response.status === 403
        ? "Tailscale OAuth client rejected the requested scope. Re-create the client in the Tailscale admin console with the required scope checked."
        : "Tailscale OAuth client credentials invalid. Check the client_id and client_secret in the admin console.",
      response.status,
    );
  }
  if (response.status === 429) {
    throw new TailscaleApiError(
      "tailscale.rate_limited",
      "Tailscale rate-limited the OAuth token request. Try again in a few seconds.",
      429,
    );
  }
  if (!response.ok) {
    throw new TailscaleApiError(
      "tailscale.unknown",
      `Tailscale OAuth token request failed with status ${response.status}.`,
      response.status,
    );
  }

  /** @type {{ access_token?: unknown, expires_in?: unknown }} */
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new TailscaleApiError(
      "tailscale.unknown",
      "Tailscale OAuth token response was not JSON.",
    );
  }

  const accessToken =
    typeof payload?.access_token === "string" ? payload.access_token : "";
  if (!accessToken) {
    throw new TailscaleApiError(
      "tailscale.unknown",
      "Tailscale OAuth token response was missing access_token.",
    );
  }
  const expiresIn =
    typeof payload?.expires_in === "number" ? payload.expires_in : 3600;
  return { accessToken, expiresIn };
}

/**
 * Mint an auth-key via Tailscale's tailnet keys API.
 *
 * @param {object} args
 * @param {string} args.accessToken — minted via mintTailscaleAccessToken
 * @param {string} [args.tailnet] — defaults to "-" (the credential's default tailnet)
 * @param {string[]} [args.tags] — defaults to ["tag:cinatra-clone"]; the OAuth client MUST have permission for these tags or the call returns 403
 * @param {boolean} [args.ephemeral] — defaults to true (node auto-deregisters on sidecar stop)
 * @param {boolean} [args.preauthorized] — defaults to true (node skips Tailscale admin approval)
 * @param {boolean} [args.reusable] — defaults to false (one-shot per clone-start)
 * @returns {Promise<{ authKey: string }>} where authKey is the tskey-auth-… string
 */
export async function mintTailscaleAuthKey({
  accessToken,
  tailnet,
  tags,
  ephemeral,
  preauthorized,
  reusable,
}) {
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new TailscaleApiError(
      "tailscale.invalid_client",
      "Tailscale access token is required to mint an auth-key.",
    );
  }
  const resolvedTailnet =
    typeof tailnet === "string" && tailnet.length > 0 ? tailnet : "-";
  const resolvedTags =
    Array.isArray(tags) && tags.length > 0 ? tags : ["tag:cinatra-clone"];
  const body = {
    capabilities: {
      devices: {
        create: {
          ephemeral: ephemeral !== false,
          preauthorized: preauthorized !== false,
          reusable: reusable === true,
          tags: resolvedTags,
        },
      },
    },
  };

  let response;
  try {
    response = await fetch(
      `${TAILSCALE_BASE_URL}/tailnet/${encodeURIComponent(resolvedTailnet)}/keys`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
  } catch (err) {
    throw new TailscaleApiError(
      "tailscale.network",
      `Tailscale auth-key request failed: ${err instanceof Error ? err.name : "network error"}`,
    );
  }

  if (response.status === 401) {
    throw new TailscaleApiError(
      "tailscale.invalid_client",
      "Tailscale rejected the access token (401). Re-mint with mintTailscaleAccessToken.",
      401,
    );
  }
  if (response.status === 403) {
    throw new TailscaleApiError(
      "tailscale.tag_denied",
      "Tailscale rejected the auth-key tag(s). Confirm the OAuth client has permission for the requested tags (e.g. tag:cinatra-clone in your ACL).",
      403,
    );
  }
  if (response.status === 429) {
    throw new TailscaleApiError(
      "tailscale.rate_limited",
      "Tailscale rate-limited the auth-key request. Try again in a few seconds.",
      429,
    );
  }
  if (!response.ok) {
    throw new TailscaleApiError(
      "tailscale.unknown",
      `Tailscale auth-key request failed with status ${response.status}.`,
      response.status,
    );
  }

  /** @type {{ key?: unknown }} */
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new TailscaleApiError(
      "tailscale.unknown",
      "Tailscale auth-key response was not JSON.",
    );
  }
  const authKey = typeof payload?.key === "string" ? payload.key : "";
  if (!authKey) {
    throw new TailscaleApiError(
      "tailscale.unknown",
      "Tailscale auth-key response was missing the key field.",
    );
  }
  return { authKey };
}

/**
 * Resolve the literal tailnet `-` (token's home tailnet) to the actual
 * tailnet name (e.g. `example.com`, `acme.github`, `foo.ts.net`).
 *
 * Calls `GET /api/v2/tailnet/-/devices` and parses the tailnet portion
 * from a device's FQDN (`hostname.<tailnet>.ts.net`). Falls back to `null`
 * when the call fails or no devices exist — caller should keep `-` as
 * the stored value in that case.
 *
 * Never throws past this boundary on transport errors (returns null
 * instead) — the resolved tailnet is a UX nicety, not a correctness
 * dependency. The CLI still uses `-` as the path segment when minting
 * auth-keys regardless of what name we surface to the operator.
 *
 * @param {object} args
 * @param {string} args.apiKey — Tailscale API access token (`tskey-api-…`)
 * @returns {Promise<string | null>} the resolved tailnet name, or null if
 *   resolution failed for any reason.
 */
export async function resolveTailscaleTailnet({ apiKey }) {
  if (typeof apiKey !== "string" || apiKey.length === 0) return null;
  let response;
  try {
    response = await fetch(`${TAILSCALE_BASE_URL}/tailnet/-/devices`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  /** @type {{ devices?: Array<{ name?: unknown }> } | null} */
  let payload;
  try {
    payload = await response.json();
  } catch {
    return null;
  }
  const devices = Array.isArray(payload?.devices) ? payload.devices : [];
  for (const device of devices) {
    const name = typeof device?.name === "string" ? device.name : "";
    // Device FQDN shape: `<hostname>.<tailnet>.ts.net`. The tailnet portion
    // may itself contain dots (e.g. `acme.github`), so capture everything
    // between the first dot and `.ts.net`.
    const match = name.match(/^[^.]+\.([^\s]+)\.ts\.net$/);
    if (match?.[1]) return match[1];
  }
  return null;
}
