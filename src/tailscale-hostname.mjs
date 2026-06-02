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
 *   - Main → database `cinatra` (or default), schema `cinatra`.
 *
 * So we derive from BOTH the DB name (parsed from SUPABASE_DB_URL) and
 * the schema, in that precedence. The inputs are immutable per dev
 * instance, so the derivation is a pure deterministic function — no
 * persistence needed (and persistence was a stale-cache liability).
 *
 * Pure ESM (no TS, no `@/` aliases) so the plain-Node CLI imports the
 * exact module the TS connector imports across the `.mjs` boundary.
 */

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
 * The deterministic dedicated hostname for this dev instance.
 *
 *   - heavy clone : SUPABASE_DB_URL `…/cinatra_clone_optimizations_260515`
 *                   → `cinatra-clone-optimizations-260515`
 *   - light worktree : SUPABASE_SCHEMA `cinatra_worktree_preview_a`
 *                   → `cinatra-worktree-preview-a`
 *   - main : DB `cinatra` + schema `cinatra` → `cinatra-main`
 *
 * @param {object} args
 * @param {string | null | undefined} args.dbUrl   process.env.SUPABASE_DB_URL
 * @param {string | null | undefined} args.schema  process.env.SUPABASE_SCHEMA
 * @returns {string}
 */
export function deriveDevTailscaleHostname({ dbUrl, schema }) {
  const dbName = parseDatabaseName(dbUrl);
  const cloneMatch = dbName.match(/^cinatra_clone_(.+)$/);
  if (cloneMatch && cloneMatch[1]) {
    return sanitizeTailscaleDeviceName(`cinatra-clone-${cloneMatch[1]}`);
  }
  const schemaName = String(schema ?? "").trim();
  const worktreeMatch = schemaName.match(/^cinatra_(.+)$/);
  if (worktreeMatch && worktreeMatch[1]) {
    return sanitizeTailscaleDeviceName(`cinatra-${worktreeMatch[1]}`);
  }
  return "cinatra-main";
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
