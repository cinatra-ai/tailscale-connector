/**
 * Canonical dedicated-Tailscale-hostname derivation.
 *
 * Every Cinatra dev instance (heavy clone, light worktree, or main) has
 * ONE deterministic Tailscale device hostname. The Funnel URL is then
 * `https://<hostname>.<tailnet>.ts.net`.
 *
 * The SAME function is called by:
 *   - the app server (dev-tab flyout — predicts the URL before the
 *     sidecar is up)
 *   - the CLI's provisioning path (`cinatra clone start` — names the
 *     Tailscale sidecar's node)
 * so the flyout-shown URL always equals the URL the node actually
 * registers.
 *
 * IMPORTANT — what makes an instance unique differs by isolation model
 * (this was a real bug: keying off SUPABASE_SCHEMA alone made every
 * heavy clone derive `cinatra-main` and collide):
 *
 *   - Heavy clone  → separate DATABASE `cinatra_clone_<slug>`, schema
 *     stays plain `cinatra`. Uniqueness lives in the DB name.
 *   - Light worktree → shared database, isolated by SCHEMA
 *     `cinatra_<slug>`. Uniqueness lives in the schema.
 *   - Main → the RESERVED `cinatra-main` identity, which an instance must
 *     DECLARE (see below). It is never inferred.
 *
 * So we derive from BOTH the DB name (parsed from SUPABASE_DB_URL) and
 * the schema, in that precedence. The inputs are immutable per dev
 * instance, so the derivation is a pure deterministic function — no
 * persistence needed (and persistence was a stale-cache liability).
 *
 * FAIL-CLOSED IDENTITY (cinatra#2172)
 * ----------------------------------
 * This function used to FALL THROUGH to the literal `cinatra-main` for
 * anything that matched neither isolation model. That made every
 * throwaway instance (a scratch database, no schema override) derive the
 * RESERVED main identity byte-for-byte, so provisioning from it would
 * squat tunnel state it does not own and re-register the reserved node
 * against the wrong port. The only guard was downstream (the registered-
 * hostname comparison), which turns a silent squat into a failed
 * provision rather than preventing it.
 *
 * The fallthrough is gone. An instance now has an identity only when it
 * POSITIVELY matches one of three cases, and the reserved main identity
 * is the one that must be declared explicitly:
 *
 *   1. registered clone  — database `cinatra_clone_<slug>`
 *   2. schema isolation  — schema `cinatra_<slug>`
 *   3. declared main     — `mainDatabase` equals this instance's own
 *      database ENDPOINT fingerprint (`host:port/database`), and the
 *      schema is the plain default. The declaration is bound to the
 *      endpoint, not to a database NAME, so a copied configuration
 *      cannot accidentally authorise an unrelated database.
 *
 * Anything else classifies as `unregistered` and callers must REFUSE to
 * provision. Conflicting signals (a main declaration on an instance that
 * is also clone- or schema-isolated) are rejected outright rather than
 * silently resolved by precedence.
 *
 * Pure ESM (no TS, no `@/` aliases) so the plain-Node CLI imports the
 * exact module the TS connector imports across the `.mjs` boundary.
 */

/** The RESERVED dev-main Tailscale device hostname. Never a fallback. */
export const DEV_MAIN_TAILSCALE_HOSTNAME = "cinatra-main";

/**
 * Contract version of `classifyDevTailscaleIdentity`'s result shape. The
 * CLI loads this module dynamically out of the operator's on-disk
 * extension tree, so it can meet an older or newer copy than it was
 * built against; it must treat an unknown version as unsupported and
 * fail closed rather than guess.
 */
export const DEV_TAILSCALE_IDENTITY_CONTRACT_VERSION = 1;

/** No sanctioned identity — the caller must refuse to provision. */
export const DEV_TAILSCALE_UNREGISTERED_CODE = "tailscale.unregistered_dev_identity";

/** Mutually exclusive identity signals were set at the same time. */
export const DEV_TAILSCALE_IDENTITY_CONFLICT_CODE = "tailscale.conflicting_dev_identity";

/**
 * Thrown by `deriveDevTailscaleHostname` when the instance has no
 * sanctioned identity. Carries a STABLE `.code` string (not just a
 * class identity) because callers may hold a different module instance
 * than the thrower.
 */
export class DevTailscaleIdentityError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = "DevTailscaleIdentityError";
    this.code = code;
  }
}

/**
 * Sanitise an arbitrary string to a valid Tailscale device name:
 * lowercase, alphanumeric + hyphens, starts with a letter, <= 63 chars.
 *
 * @param {string} input
 * @returns {string}
 */
export function sanitizeTailscaleDeviceName(input) {
  const base = String(input ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!base) return "cinatra-dev";
  const withLetter = /^[a-z]/.test(base) ? base : `c-${base}`;
  if (withLetter.length <= 63) return withLetter;
  let hash = 2166136261;
  for (let i = 0; i < withLetter.length; i++) {
    hash ^= withLetter.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const suffix = hash.toString(36).slice(0, 8);
  return `${withLetter.slice(0, 54).replace(/-+$/g, "")}-${suffix}`;
}

/**
 * Parse the database name (last path segment) from a Postgres
 * connection string. Returns "" when it can't be parsed.
 *
 * @param {string | null | undefined} dbUrl
 * @returns {string}
 */
export function parseDatabaseName(dbUrl) {
  const s = String(dbUrl ?? "").trim();
  if (!s) return "";
  // Strip query string, then take the segment after the last "/".
  const noQuery = s.split("?")[0];
  const seg = noQuery.split("/").pop() ?? "";
  return seg.trim();
}

/**
 * STRICT database-name extraction, used by the identity classifier.
 *
 * Deliberately stricter than the historical `parseDatabaseName` above
 * (kept byte-compatible for its existing callers), which takes the last
 * `/`-separated segment of the WHOLE string. That is unsafe for an
 * identity decision:
 *
 *   - `postgresql://dbhost` (no path) yields the HOST as the database
 *     name — a host literally named `cinatra_clone_x` would classify as
 *     a registered clone;
 *   - a `postgresql://` URL carrying userinfo but NO path yields the
 *     whole `<user>:<password>@<host>` authority as the database name,
 *     which would drag a PASSWORD into the identity key, the runtime
 *     manifest and every message quoting them;
 *   - `postgresql://h/other/main` silently discards `other/`.
 *
 * This requires a real path with EXACTLY ONE non-empty segment.
 *
 * @param {string} raw  already-trimmed connection string
 * @returns {string} database name, or "" when it cannot be resolved
 */
function strictDatabaseName(raw) {
  const schemeEnd = raw.indexOf("://");
  if (schemeEnd < 0) return "";
  const afterScheme = raw.slice(schemeEnd + 3);
  const queryAt = afterScheme.search(/[?#]/);
  const beforeQuery = queryAt >= 0 ? afterScheme.slice(0, queryAt) : afterScheme;
  const slash = beforeQuery.indexOf("/");
  if (slash < 0) return "";
  // Tolerate exactly one trailing `/` (`…/main/`); reject deeper paths.
  const pathPart = beforeQuery.slice(slash + 1).replace(/\/$/, "");
  if (!pathPart || pathPart.includes("/")) return "";
  return pathPart;
}

/** Connection schemes an endpoint declaration may use. */
const ENDPOINT_SCHEMES = new Set(["postgres", "postgresql"]);

/**
 * Query keys that can REDIRECT a libpq connection away from the URL's
 * own authority/path. An endpoint carrying any of them cannot be
 * fingerprinted honestly.
 *
 * libpq PERCENT-DECODES parameter names, so the query is decoded before
 * the test — `?%68ost=elsewhere` is `?host=elsewhere`.
 */
const REDIRECTING_QUERY_KEYS = /[?&](host|hostaddr|port|dbname)=/i;

/**
 * Best-effort percent-decode. A malformed escape decodes to itself
 * rather than throwing — the caller only pattern-matches the result.
 *
 * @param {string} s
 * @returns {string}
 */
function percentDecodeLoose(s) {
  return s.replace(/%[0-9a-f]{2}/gi, (m) => {
    try {
      return decodeURIComponent(m);
    } catch {
      return m;
    }
  });
}

/**
 * Canonical ENDPOINT fingerprint for a Postgres connection string:
 * `host:port/database`, lowercased, with the default port filled in.
 * User info (and therefore any password) is discarded — the fingerprint
 * is safe to print in an operator-facing message.
 *
 * Parsed by hand rather than through `URL` so a password containing
 * `URL`-hostile characters can never make a real connection string
 * silently unparseable (which would fail the instance closed for the
 * wrong reason).
 *
 * Returns "" when host or database cannot be resolved.
 *
 * @param {string | null | undefined} dbUrl
 * @returns {string}
 */
export function parseDatabaseEndpoint(dbUrl) {
  const raw = String(dbUrl ?? "").trim();
  if (!raw) return "";

  const schemeEnd = raw.indexOf("://");
  const scheme = schemeEnd > 0 ? raw.slice(0, schemeEnd).toLowerCase() : "";
  if (!ENDPOINT_SCHEMES.has(scheme)) return "";
  // libpq honours `host=` / `hostaddr=` / `port=` / `dbname=` in the query
  // string, which can point somewhere entirely different from the URL's own
  // authority. Refuse to fingerprint such a URL rather than fingerprint it
  // wrongly (fail closed: the reserved identity just cannot be declared).
  if (REDIRECTING_QUERY_KEYS.test(percentDecodeLoose(raw))) return "";

  const database = strictDatabaseName(raw);
  if (!database) return "";

  // Strip the scheme, then everything from the first `/` (path) onwards.
  const afterScheme = raw.slice(schemeEnd + 3);
  const authority = afterScheme.split("/")[0] ?? "";
  // Userinfo may itself contain `@` inside a percent-escaped password, so
  // split on the LAST `@`.
  const at = authority.lastIndexOf("@");
  const hostPort = (at >= 0 ? authority.slice(at + 1) : authority).trim();
  if (!hostPort) return "";

  let host = "";
  let port = "";
  let portGiven = false;
  if (hostPort.startsWith("[")) {
    // IPv6 literal: `[::1]` or `[::1]:5432`.
    const close = hostPort.indexOf("]");
    if (close <= 1) return "";
    const inner = hostPort.slice(1, close);
    // Bracket contents must at least LOOK like an IPv6 literal — never accept
    // arbitrary text just because it is bracketed.
    if (!/^[0-9a-f:.]+$/i.test(inner) || !inner.includes(":")) return "";
    host = hostPort.slice(0, close + 1);
    const rest = hostPort.slice(close + 1);
    if (rest.startsWith(":")) {
      port = rest.slice(1);
      portGiven = true;
    } else if (rest.length > 0) return "";
  } else {
    const colon = hostPort.indexOf(":");
    if (colon >= 0) {
      host = hostPort.slice(0, colon);
      port = hostPort.slice(colon + 1);
      portGiven = true;
      // A SECOND colon means an UNBRACKETED IPv6 literal — ambiguous, refuse
      // (rather than misparse `::1` into host ":" plus port "1").
      if (port.includes(":")) return "";
    } else {
      host = hostPort;
    }
  }
  // A trailing root dot is dropped so `h.` and `h` fingerprint identically.
  if (!host.startsWith("[")) host = host.replace(/\.$/, "");
  if (!host) return "";
  // Registered name or IPv4 only (bracketed IPv6 was handled above).
  if (!host.startsWith("[") && !/^[a-z0-9][a-z0-9.\-_]*$/i.test(host)) return "";
  if (portGiven) {
    // An explicit `:` demands a real port — no empty value, no leading zeros,
    // in range. (`h:` is a typo, not "the default port".)
    if (!/^[1-9]\d{0,4}$/.test(port) || Number(port) > 65535) return "";
  }
  return `${host.toLowerCase()}:${port || "5432"}/${database}`;
}

/**
 * Normalise an operator's main-identity declaration to the same
 * `host:port/database` fingerprint shape `parseDatabaseEndpoint`
 * produces, so the comparison is exact.
 *
 * Accepted forms:
 *   - a full `postgresql://` connection string (userinfo and all)
 *   - a bare fingerprint (`host:5432/db`, `host/db`)
 *
 * A bare DATABASE NAME is deliberately NOT accepted: the declaration
 * must bind to an endpoint so a configuration copied to another host or
 * another Postgres cannot silently claim the reserved identity.
 *
 * @param {string | null | undefined} declaration
 * @returns {string} normalised fingerprint, or "" when unusable
 */
export function normalizeDevMainDatabaseDeclaration(declaration) {
  const raw = String(declaration ?? "").trim();
  if (!raw) return "";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return parseDatabaseEndpoint(raw);
  if (!raw.includes("/")) return "";
  return parseDatabaseEndpoint(`postgresql://${raw}`);
}

/**
 * A sanctioned identity. `key` is the canonical value callers key
 * isolated runtime state on: it carries the identity KIND and its
 * UNSANITISED discriminator, so two identities that sanitise to the same
 * Tailscale hostname still differ here.
 *
 * @typedef {{
 *   version: number,
 *   ok: true,
 *   kind: "clone" | "schema" | "main",
 *   hostname: string,
 *   key: string,
 *   code: null,
 *   reason: null,
 * }} DevTailscaleIdentityOk
 */

/**
 * No sanctioned identity. `code` is stable across module copies.
 *
 * @typedef {{
 *   version: number,
 *   ok: false,
 *   kind: "unregistered" | "conflict",
 *   hostname: null,
 *   key: null,
 *   code: string,
 *   reason: string,
 * }} DevTailscaleIdentityFailure
 */

/** @typedef {DevTailscaleIdentityOk | DevTailscaleIdentityFailure} DevTailscaleIdentity */

/**
 * Classify this dev instance's Tailscale identity. PURE and total — it
 * never throws and never falls through to the reserved main identity.
 *
 * @param {object} [args]
 * @param {string | null | undefined} [args.dbUrl]   SUPABASE_DB_URL
 * @param {string | null | undefined} [args.schema]  SUPABASE_SCHEMA
 * @param {string | null | undefined} [args.mainDatabase]  the explicit
 *   main-identity declaration (an endpoint fingerprint or a connection
 *   string); absent ⇒ this instance is not the dev main.
 * @returns {DevTailscaleIdentity}
 */
export function classifyDevTailscaleIdentity({ dbUrl, schema, mainDatabase } = {}) {
  const raw = String(dbUrl ?? "").trim();
  // STRICT parse — never the historical last-`/`-segment reading, which would
  // let a host name (or a password) masquerade as a database name.
  const dbName = strictDatabaseName(raw);
  const schemaName = String(schema ?? "").trim();
  const endpoint = parseDatabaseEndpoint(dbUrl);
  const declared = normalizeDevMainDatabaseDeclaration(mainDatabase);
  const declarationPresent = String(mainDatabase ?? "").trim().length > 0;

  const cloneSlug = dbName.match(/^cinatra_clone_(.+)$/)?.[1] ?? "";
  const schemaSlug = schemaName.match(/^cinatra_(.+)$/)?.[1] ?? "";
  const declaresMain = declared !== "" && endpoint !== "" && declared === endpoint;

  // Conflicting signals are REJECTED, never resolved by precedence. Picking
  // one would be a GUESS about which state the instance owns, and the guess
  // is exactly what shares state: two instances on the same clone database
  // with different isolated schemas would otherwise collapse onto one
  // identity key and therefore one runtime directory.
  if (cloneSlug && schemaSlug) {
    return failure(
      DEV_TAILSCALE_IDENTITY_CONFLICT_CODE,
      "conflict",
      `This instance is BOTH a registered clone (database "${dbName}") and ` +
        `schema-isolated (schema "${schemaName}"). Exactly one isolation model ` +
        `may apply — a clone keeps the plain default schema. Drop one.`,
    );
  }
  if (declaresMain && (cloneSlug || schemaSlug)) {
    return failure(
      DEV_TAILSCALE_IDENTITY_CONFLICT_CODE,
      "conflict",
      `This instance declares the reserved main tunnel identity but is also ` +
        `${cloneSlug ? `a registered clone (database "${dbName}")` : `schema-isolated (schema "${schemaName}")`}. ` +
        `Exactly one identity may apply. Drop the main declaration, or drop the isolation.`,
    );
  }

  // Identity keys are ENDPOINT-SCOPED: the same database or schema NAME on two
  // different Postgres servers is two different instances, and they must not
  // share runtime state. A connection string that is PRESENT but does not
  // fingerprint is therefore fatal, not a reason to fall back to the bare name
  // — that fallback is exactly how two instances collapse onto one key.
  if (raw !== "" && endpoint === "") {
    return failure(
      DEV_TAILSCALE_UNREGISTERED_CODE,
      "unregistered",
      `This instance's database URL does not resolve to an unambiguous ` +
        `endpoint (expected a "postgresql://host:port/database" form with no ` +
        `libpq host/port/dbname query override), so its tunnel identity cannot ` +
        `be scoped to a specific server. Refusing to provision.`,
    );
  }

  if (cloneSlug) {
    return reserveGuarded(
      "clone",
      `clone:${endpoint}`,
      sanitizeTailscaleDeviceName(`cinatra-clone-${cloneSlug}`),
      `database "${dbName}"`,
    );
  }

  if (schemaSlug) {
    // A schema-isolated instance with NO database URL configured yet is still
    // a legitimate identity (the schema is the discriminator); once a URL IS
    // present it must fingerprint, which the guard above enforces.
    return reserveGuarded(
      "schema",
      `schema:${endpoint}#${schemaName}`,
      sanitizeTailscaleDeviceName(`cinatra-${schemaSlug}`),
      `schema "${schemaName}"`,
    );
  }

  if (declaresMain) {
    // The reserved identity additionally requires the PLAIN schema: a
    // main declaration cannot cover an instance whose reads are pointed
    // somewhere non-default.
    if (schemaName !== "" && schemaName !== "cinatra") {
      return failure(
        DEV_TAILSCALE_IDENTITY_CONFLICT_CODE,
        "conflict",
        `This instance declares the reserved main tunnel identity but runs on ` +
          `schema "${schemaName}" rather than the plain default. The reserved ` +
          `identity covers the default schema only.`,
      );
    }
    return success("main", `main:${endpoint}`, DEV_MAIN_TAILSCALE_HOSTNAME);
  }

  const mismatch =
    declarationPresent && declared === ""
      ? ` The main declaration could not be read as an endpoint — it must be ` +
        `"host:port/database" or a full connection string.`
      : declarationPresent
        ? ` The main declaration ("${declared}") does not match this instance's ` +
          `database endpoint${endpoint ? ` ("${endpoint}")` : ""}.`
        : "";

  return failure(
    DEV_TAILSCALE_UNREGISTERED_CODE,
    "unregistered",
    `This dev instance has no sanctioned Tailscale tunnel identity ` +
      `(database "${dbName || "(unresolved)"}", schema "${schemaName || "(unset)"}").${mismatch}`,
  );
}

/**
 * A non-main identity whose SANITISED hostname lands on the reserved
 * main name is refused. `sanitizeTailscaleDeviceName` collapses `_`/`-`
 * runs, so schemas like `cinatra_main`, `cinatra__main` and
 * `cinatra_-main` all sanitise to the reserved `cinatra-main`. Their
 * runtime directories differ (the slug is keyed on the identity key),
 * but the MagicDNS name would still be the reserved one — the same
 * squat, one layer down.
 *
 * @param {"clone" | "schema"} kind
 * @param {string} key
 * @param {string} hostname
 * @param {string} what  operator-facing description of the isolation input
 * @returns {DevTailscaleIdentity}
 */
function reserveGuarded(kind, key, hostname, what) {
  if (hostname === DEV_MAIN_TAILSCALE_HOSTNAME) {
    return failure(
      DEV_TAILSCALE_IDENTITY_CONFLICT_CODE,
      "conflict",
      `This instance's ${what} derives the RESERVED main tunnel hostname ` +
        `"${DEV_MAIN_TAILSCALE_HOSTNAME}", which belongs to the dev main. ` +
        `Rename it (any other suffix works) so this instance gets its own ` +
        `Tailscale node.`,
    );
  }
  return success(kind, key, hostname);
}

/**
 * @param {"clone" | "schema" | "main"} kind
 * @param {string} key
 * @param {string} hostname
 * @returns {DevTailscaleIdentityOk}
 */
function success(kind, key, hostname) {
  return {
    version: DEV_TAILSCALE_IDENTITY_CONTRACT_VERSION,
    ok: true,
    kind,
    hostname,
    key,
    code: null,
    reason: null,
  };
}

/**
 * @param {string} code
 * @param {"unregistered" | "conflict"} kind
 * @param {string} reason
 * @returns {DevTailscaleIdentityFailure}
 */
function failure(code, kind, reason) {
  return {
    version: DEV_TAILSCALE_IDENTITY_CONTRACT_VERSION,
    ok: false,
    kind,
    hostname: null,
    key: null,
    code,
    reason,
  };
}

/**
 * The remediation an operator needs when an instance has no sanctioned
 * identity. Names the two sanctioned identities plus the explicit
 * reserved-main declaration, and — when the endpoint is resolvable —
 * the exact value to declare.
 *
 * @param {DevTailscaleIdentity} identity  a failed classification
 * @param {string | null | undefined} [dbUrl]  to quote the exact endpoint
 * @returns {string}
 */
export function describeDevTailscaleIdentityRefusal(identity, dbUrl) {
  const endpoint = parseDatabaseEndpoint(dbUrl);
  const lines = [
    identity?.reason ?? "This dev instance has no sanctioned Tailscale tunnel identity.",
    "",
    "Refusing to provision a tunnel: the reserved main identity " +
      `("${DEV_MAIN_TAILSCALE_HOSTNAME}") is NOT a fallback, and provisioning ` +
      "under it would overwrite tunnel state this instance does not own.",
    "",
    "Adopt one of the sanctioned identities:",
    "  1. Registered clone — run this instance on its own " +
      "`cinatra_clone_<slug>` database (`cinatra clone start`).",
    "  2. Schema isolation — set SUPABASE_SCHEMA=cinatra_<slug> so this " +
      "instance is schema-isolated.",
  ];
  if (endpoint) {
    lines.push(
      "",
      "If this checkout really IS the dev main, declare it explicitly:",
      `  CINATRA_DEV_MAIN_DATABASE=${endpoint}`,
    );
  }
  return lines.join("\n");
}

/**
 * The deterministic dedicated hostname for this dev instance.
 *
 *   - heavy clone : SUPABASE_DB_URL `…/cinatra_clone_optimizations_260515`
 *                   → `cinatra-clone-optimizations-260515`
 *   - light worktree : SUPABASE_SCHEMA `cinatra_worktree_preview_a`
 *                   → `cinatra-worktree-preview-a`
 *   - declared main : `mainDatabase` === this instance's endpoint → `cinatra-main`
 *
 * THROWS `DevTailscaleIdentityError` (stable `.code`) when the instance
 * has no sanctioned identity. It NEVER returns the reserved main
 * hostname for an undeclared instance — see the fail-closed note at the
 * top of this module.
 *
 * @param {object} args
 * @param {string | null | undefined} args.dbUrl   process.env.SUPABASE_DB_URL
 * @param {string | null | undefined} args.schema  process.env.SUPABASE_SCHEMA
 * @param {string | null | undefined} [args.mainDatabase]  explicit
 *   reserved-main declaration (endpoint fingerprint or connection string)
 * @returns {string}
 */
export function deriveDevTailscaleHostname({ dbUrl, schema, mainDatabase }) {
  const identity = classifyDevTailscaleIdentity({ dbUrl, schema, mainDatabase });
  if (!identity.ok) {
    throw new DevTailscaleIdentityError(
      identity.code,
      describeDevTailscaleIdentityRefusal(identity, dbUrl),
    );
  }
  return identity.hostname;
}

/**
 * Compose the dedicated Funnel URL for a dev instance.
 *
 * @param {string} hostname
 * @param {string | null | undefined} tailnet  resolved tailnet (e.g.
 *   `taild5286c`); `-` or empty → returns null
 * @returns {string | null}
 */
export function composeTailscaleFunnelUrl(hostname, tailnet) {
  const host = String(hostname ?? "").trim();
  const net = String(tailnet ?? "").trim();
  if (!host || !net || net === "-") return null;
  return `https://${host}.${net}.ts.net`;
}
