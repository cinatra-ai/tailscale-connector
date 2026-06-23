import "server-only";

import { getTailscaleDeps } from "./deps";

/**
 * Nango connection-storage surface — host-bound via the connector's `deps`
 * (sourced from the nango-connector extension at boot). Resolved lazily so the
 * separately-compiled setup/page bundles share the same globalThis deps slot.
 */
function tailscaleNango() {
  return getTailscaleDeps().nango;
}

import {
  resolveTailscaleTailnet,
  TailscaleApiError,
} from "./tailscale-api.mjs";
import {
  composeTailscaleFunnelUrl,
  deriveDevTailscaleHostname,
} from "./tailscale-hostname.mjs";
import { computeTailscaleTokenExpiry } from "./tailscale-token-expiry.mjs";

// ---------------------------------------------------------------------------
// Cinatra Tailscale connector using Nango API_KEY credential storage.
//
// Stores a Tailscale **API access token** (`tskey-api-…`) in Nango so every
// heavy clone's `cinatra clone start` can mint a per-clone, tag-scoped
// ephemeral auth-key via the Tailscale API and provision a Funnel URL
// automatically.
//
// Storage pattern — Nango's built-in `tailscale-api-key` provider:
//
//   - `provider: "tailscale-api-key"` → `auth_mode: API_KEY` in Nango's
//     providers.yaml. API_KEY credentials live at the **connection** level
//     (Nango's public integration credentials schema only accepts
//     OAuth-shaped credentials, not API_KEY).
//   - `tailnet` (Tailscale `organizationName`) is round-tripped through
//     `connection_config.organizationName`. Default `"-"` resolves to the
//     token's home tailnet; we ping `GET /api/v2/tailnet/-/devices` at
//     save time to discover the real name and store it for UI display.
//   - The local `connector_config:tailscale` row carries non-credential
//     state used by the dev tab + CLI:
//       - `connected: boolean`
//       - `tailnet: string` — resolved-real or operator-supplied; never `-`
//         in storage once we've successfully resolved
//       - `cloneTag: string` — the Tailscale tag the CLI uses when minting
//         per-clone auth-keys. Operator-configurable (defaults to
//         `tag:cinatra-clone`). The CLI reads this from the clone DB.
//       - `lastValidatedAt: string`
//       - `tokenSetAt: string` — when the API token was last saved. Tailscale
//         API tokens live at most 90 days; we can't introspect a bare token's
//         real expiry by value alone, so we persist the set-date and derive a
//         conservative 90-day expiry window for the inline expiry reminder.
//       - `tokenExpiresAt: string` — derived `tokenSetAt + 90d`. Persisted so
//         the read surface needs no recompute and a future host that captures
//         the token's real `expires` can overwrite it.
//
// CLI read path: GET /connection/cinatra-tailscale → `credentials.apiKey`.
// The CLI also reads `connector_config:tailscale.cloneTag` from the clone
// DB metadata for the tag string. API key IS the Bearer for
// `POST /api/v2/tailnet/<tailnet-or-dash>/keys` — no OAuth token exchange.
// ---------------------------------------------------------------------------

const TAILSCALE_LOCAL_CONFIG_KEY = "tailscale" as const;
const TAILSCALE_API_KEY_PROVIDER = "tailscale-api-key" as const;
const DEFAULT_CLONE_TAG = "tag:cinatra-clone" as const;

export type TailscaleConnectionStatus = {
  connected: boolean;
  tailnet?: string;
  cloneTag?: string;
  lastValidatedAt?: string;
  /** When the API token was last saved (basis for the 90-day expiry window). */
  tokenSetAt?: string;
  /** Derived `tokenSetAt + 90d` — drives the inline expiry reminder. */
  tokenExpiresAt?: string;
};

type TailscaleLocalSettings = {
  tailnet?: string;
  cloneTag?: string;
  lastValidatedAt?: string;
  tokenSetAt?: string;
  tokenExpiresAt?: string;
  connected?: boolean;
};

function readLocalSettings(): TailscaleLocalSettings {
  return getTailscaleDeps().readConnectorConfigFromDatabase<TailscaleLocalSettings>(
    TAILSCALE_LOCAL_CONFIG_KEY,
    {},
  );
}

function writeLocalSettings(value: TailscaleLocalSettings) {
  getTailscaleDeps().writeConnectorConfigToDatabase(TAILSCALE_LOCAL_CONFIG_KEY, value);
}

/**
 * Public read surface for the dev tab UI + connector page. No network
 * round-trip.
 */
export function getTailscaleConnectionStatus(): TailscaleConnectionStatus {
  const settings = readLocalSettings();
  // Derive `tokenExpiresAt` on read when only `tokenSetAt` was persisted, so
  // connections saved before the expiry column existed still surface a window
  // (and a future host that captures the token's real `expires` can persist
  // `tokenExpiresAt` directly and have it win).
  const tokenExpiresAt =
    settings.tokenExpiresAt ??
    computeTailscaleTokenExpiry(settings.tokenSetAt) ??
    undefined;
  return {
    connected: settings.connected === true,
    tailnet: settings.tailnet,
    cloneTag: settings.cloneTag,
    lastValidatedAt: settings.lastValidatedAt,
    tokenSetAt: settings.tokenSetAt,
    tokenExpiresAt,
  };
}

/**
 * The deterministic dedicated Tailscale device hostname for THIS dev
 * instance, derived fresh from the immutable isolation inputs
 * (`SUPABASE_DB_URL` for heavy clones, `SUPABASE_SCHEMA` for light
 * worktrees). NOT persisted — the derivation is pure over immutable
 * inputs, so the app preview and the CLI's `clone start` provisioning
 * compute the identical value without a stored-value sync (persistence
 * was a stale-cache bug vector: every heavy clone has schema `cinatra`,
 * so a schema-only derivation collided on `cinatra-main`).
 */
export function getTailscaleDevHostname(): string {
  return deriveDevTailscaleHostname({
    dbUrl: process.env.SUPABASE_DB_URL,
    schema: process.env.SUPABASE_SCHEMA,
  });
}

/**
 * The dedicated Tailscale Funnel URL Cinatra predicts for this dev
 * instance, e.g. `https://my-clone.foo.ts.net`.
 *
 * Returns `null` only when the tailnet hasn't been resolved yet (no
 * Tailscale connection). The URL is deterministic and shown in the dev
 * tab flyout BEFORE any sidecar is provisioned — picking + saving it is
 * safe because the provisioning path registers the node under exactly
 * this hostname (same pure derivation, same immutable inputs).
 */
export function getTailscaleFunnelUrlPreview(): string | null {
  const settings = readLocalSettings();
  const tailnet = settings.tailnet;
  if (!tailnet || tailnet === "-") return null;
  return composeTailscaleFunnelUrl(getTailscaleDevHostname(), tailnet);
}

/**
 * Default clone-tag suggestion offered to the operator in the form.
 *
 * Resolution order:
 *   1. Saved `connector_config:tailscale.cloneTag` (operator already
 *      committed to a value — preserve it).
 *   2. Derived from `instance_identity.instanceDisplayName` —
 *      kebab-cased, sanitised to Tailscale's tag naming rules
 *      (lowercase alphanumeric + hyphens, starts with letter). This
 *      gives multi-instance deployments distinct tags
 *      (`tag:acme-hr-tools-clone`, `tag:cinatra-clone`, etc.) so
 *      least-privilege scoping survives a shared tailnet.
 *   3. Fallback `tag:cinatra-clone` if no instance identity yet
 *      (setup wizard incomplete) or the display name sanitises to
 *      empty.
 *
 * The Tailscale tag rules (lowercase + alphanumeric + hyphens, start
 * with letter, length 1-63) are enforced by Tailscale at auth-key mint
 * time. Anything that survives `kebabFromInstanceDisplayName` complies.
 */
export function getDefaultTailscaleCloneTag(): string {
  const stored = readLocalSettings().cloneTag;
  if (stored) return stored;
  const slug = kebabFromInstanceDisplayName(
    getTailscaleDeps().readInstanceIdentity()?.instanceDisplayName,
  );
  if (slug) return `tag:${slug}-clone`;
  return DEFAULT_CLONE_TAG;
}

/**
 * Kebab-case + sanitise an instance display name down to something
 * Tailscale accepts inside a tag name.
 *
 * Rules:
 *   - lowercase
 *   - non-alphanumeric → hyphen
 *   - collapse multiple hyphens → single hyphen
 *   - trim leading/trailing hyphens
 *   - first char must be a letter (Tailscale rule) — drop leading
 *     digits-then-hyphens until we hit one
 *   - max 50 chars (leaves headroom for `tag:` prefix + `-clone` suffix
 *     inside Tailscale's 63-char tag limit)
 *
 * Returns empty string when nothing usable survives — caller falls back
 * to `tag:cinatra-clone`.
 */
function kebabFromInstanceDisplayName(input: string | null | undefined): string {
  if (typeof input !== "string") return "";
  let slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  // Drop leading non-letters so the final tag starts with a letter.
  while (slug.length > 0 && !/^[a-z]/.test(slug)) {
    slug = slug.replace(/^[^a-z]+-?/, "");
  }
  if (slug.length > 50) slug = slug.slice(0, 50).replace(/-+$/, "");
  return slug;
}

/**
 * Save a Tailscale API access token into Nango via the built-in
 * `tailscale-api-key` provider, then resolve and persist the real tailnet
 * name + the operator's chosen clone-tag.
 *
 * Flow:
 *   1. Validate `apiKey` + `cloneTag` are non-empty.
 *   2. `ensureNangoIntegration` (no creds at integration level — API_KEY
 *      lives at connection level).
 *   3. `importNangoConnection` with `credentials: {type:"API_KEY",apiKey}`
 *      and `connectionConfig: {organizationName: tailnet}`. Nango's
 *      verification ping (`GET /v2/tailnet/<org>/users`) catches bad
 *      tokens here.
 *   4. Read back via `getNangoCredentials`; assert apiKey survived.
 *   5. Resolve `-` to the real tailnet name via Tailscale API ping
 *      (best-effort; fall back to the operator-supplied string on
 *      failure).
 *   6. Mirror non-secret state (`connected`, `tailnet` resolved,
 *      `cloneTag`, `lastValidatedAt`) to `connector_config:tailscale`.
 *
 * Error codes returned to the caller:
 *   - "tailscale.invalid_client"      — empty apiKey or cloneTag
 *   - "tailscale.nango_unconfigured"  — Nango itself isn't configured
 *   - "tailscale.nango_writeback"     — Nango persisted credentials
 *                                       but the read-back didn't return them
 *   - "tailscale.unknown"             — any other failure (Nango
 *                                       rejected the token at verification,
 *                                       network error, etc.)
 */
export async function saveTailscaleConnection(input: {
  apiKey: string;
  cloneTag?: string;
}): Promise<TailscaleConnectionStatus> {
  const apiKey = input.apiKey.trim();
  const cloneTag = input.cloneTag?.trim() || DEFAULT_CLONE_TAG;
  // Tailscale API tokens are single-tailnet by Tailscale's model: a token
  // can only mint auth-keys for its home tailnet, and `-` resolves to
  // exactly that tailnet at every Tailscale API call. We never need (or
  // can usefully accept) anything else from the operator — the real name
  // is discovered at the end of this flow for display purposes only.
  const tailnetInput = "-";

  if (!apiKey) {
    throw new TailscaleApiError(
      "tailscale.invalid_client",
      "Tailscale API access token is required.",
    );
  }
  if (!cloneTag.startsWith("tag:")) {
    throw new TailscaleApiError(
      "tailscale.invalid_client",
      "Clone tag must start with `tag:` (e.g. `tag:cinatra-clone`).",
    );
  }

  const nango = tailscaleNango();
  if (!nango.isConfigured()) {
    throw new TailscaleApiError(
      "tailscale.nango_unconfigured",
      "Configure the connection service (Nango) first so Tailscale credentials can be stored.",
    );
  }

  const providerConfigKey = nango.providerConfigKeys.tailscale;
  const connectionId = providerConfigKey;
  const now = new Date().toISOString();

  // Step 2 — ensure the provider config exists. No credentials at
  // integration level for API_KEY providers.
  try {
    await nango.ensureIntegration({
      provider: TAILSCALE_API_KEY_PROVIDER,
      providerConfigKey,
      displayName: "Cinatra Tailscale (auto-tunnel)",
    });
  } catch (err) {
    const detail =
      err instanceof Error
        ? `${err.name}: ${err.message}`
        : typeof err === "string"
          ? err
          : "unknown error";
    console.error(
      "[connector-tailscale] ensureNangoIntegration failed",
      { providerConfigKey, errName: err instanceof Error ? err.name : undefined },
      err,
    );
    throw new TailscaleApiError(
      "tailscale.unknown",
      `Tailscale integration write failed: ${detail}`,
    );
  }

  // Step 3 — create / replace the connection record. Upsert by
  // (provider_config_key, connection_id). Nango's verification ping
  // runs here (`GET /v2/tailnet/<org>/users`) — bad tokens get 401.
  try {
    await nango.importConnection({
      connectorKey: "tailscale",
      providerConfigKey,
      connectionId,
      credentials: { type: "API_KEY", apiKey },
      connectionConfig: { organizationName: tailnetInput },
      metadata: { lastValidatedAt: now },
    });
  } catch (err) {
    const detail =
      err instanceof Error
        ? `${err.name}: ${err.message}`
        : typeof err === "string"
          ? err
          : "unknown error";
    console.error(
      "[connector-tailscale] importNangoConnection failed",
      { providerConfigKey, errName: err instanceof Error ? err.name : undefined },
      err,
    );
    throw new TailscaleApiError(
      "tailscale.unknown",
      `Tailscale connection import failed: ${detail}`,
    );
  }

  // Step 4 — read-back verification. forceRefresh bypasses Nango's cache so we
  // verify against the JUST-written credential, never a stale cached value.
  let readBack;
  try {
    readBack = await nango.getCredentials(providerConfigKey, connectionId, { forceRefresh: true });
  } catch {
    readBack = null;
  }
  const readBackApiKey =
    readBack && typeof readBack === "object" && "apiKey" in readBack
      ? (readBack as { apiKey?: unknown }).apiKey
      : undefined;
  // Require the read-back to EQUAL the submitted key (a non-empty-but-different
  // value is still a write failure). `importConnection` was called with
  // `connectorKey: "tailscale"`, so it eagerly saved the cinatra-side pointer
  // record; a complete rollback must scrub BOTH the Nango connection AND that
  // pointer record.
  if (typeof readBackApiKey !== "string" || readBackApiKey !== apiKey) {
    try {
      await nango.deleteConnection(providerConfigKey, connectionId);
    } catch {
      // best-effort
    }
    try {
      await nango.clearConnectionRecords("tailscale");
    } catch {
      // best-effort
    }
    // Scrub local state too. Otherwise a failed re-save OVER an existing
    // connection would leave `connector_config:tailscale` reporting
    // `connected: true` (getTailscaleConnectionStatus reads only local settings)
    // while the Nango credential + pointer have been rolled back — a split-brain
    // the UI would surface as "connected" with no working credential. Mirror
    // clearTailscaleConnection()'s local wipe.
    writeLocalSettings({});
    throw new TailscaleApiError(
      "tailscale.nango_writeback",
      "Tailscale API key wrote to Nango but the read-back did not match the submitted key. Rolled back.",
    );
  }

  // Step 5 — resolve `-` to the real tailnet name (best-effort UX nicety).
  // Use whichever name we can show the operator; the CLI always uses `-`
  // as the URL path segment when minting auth-keys, so this is purely for
  // display purposes.
  let resolvedTailnet = tailnetInput;
  if (tailnetInput === "-") {
    const resolved = await resolveTailscaleTailnet({ apiKey });
    if (resolved) {
      resolvedTailnet = resolved;
    }
  }

  // Step 6 — mirror non-secret state to the local row. Stamp the token's
  // set-date and derive its conservative 90-day expiry window so the inline
  // reminder has a real date to count down from.
  const tokenExpiresAt = computeTailscaleTokenExpiry(now) ?? undefined;
  const next: TailscaleLocalSettings = {
    tailnet: resolvedTailnet,
    cloneTag,
    lastValidatedAt: now,
    tokenSetAt: now,
    tokenExpiresAt,
    connected: true,
  };
  writeLocalSettings(next);

  return {
    connected: true,
    tailnet: resolvedTailnet,
    cloneTag,
    lastValidatedAt: now,
    tokenSetAt: now,
    tokenExpiresAt,
  };
}

export async function clearTailscaleConnection(): Promise<void> {
  const nango = tailscaleNango();
  const providerConfigKey = nango.providerConfigKeys.tailscale;
  const connectionId = providerConfigKey;
  // API_KEY at connection level — deleting the connection scrubs the
  // apiKey. Integration entry has no credentials of its own; leaving it
  // in place lets re-Connect upsert a new connection without recreating
  // the provider config.
  try {
    await nango.deleteConnection(providerConfigKey, connectionId);
  } catch {
    // ignore
  }
  try {
    await nango.clearConnectionRecords("tailscale");
  } catch {
    // ignore
  }
  writeLocalSettings({});
}

// Host DI surface (boot wiring lives in src/lib/register-transport-connectors.ts).
export { registerTailscaleConnector, getTailscaleDeps, _resetTailscaleDepsForTests } from "./deps";
export type { TailscaleConnectorDeps } from "./deps";
