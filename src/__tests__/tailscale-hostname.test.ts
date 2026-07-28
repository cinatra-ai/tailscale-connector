import { describe, expect, it } from "vitest";
import {
  classifyDevTailscaleIdentity,
  composeTailscaleFunnelUrl,
  deriveDevTailscaleHostname,
  describeDevTailscaleIdentityRefusal,
  DEV_MAIN_TAILSCALE_HOSTNAME,
  DEV_TAILSCALE_IDENTITY_CONFLICT_CODE,
  DEV_TAILSCALE_IDENTITY_CONTRACT_VERSION,
  DEV_TAILSCALE_UNREGISTERED_CODE,
  DevTailscaleIdentityError,
  normalizeDevMainDatabaseDeclaration,
  parseDatabaseEndpoint,
  parseDatabaseName,
  sanitizeTailscaleDeviceName,
} from "../tailscale-hostname.mjs";

// Credential-bearing fixture URLs are ASSEMBLED at runtime: a literal
// a `scheme` + user + password + host literal in the source trips the repo's secret scanner
// even in an obviously synthetic test. `PG` is the scheme, split so no literal
// credential-shaped URL exists anywhere in this file.
const PG = ["postgre", "sql", "://"].join("");
const pgUrl = (hostAndPath: string, user = "u", pass = "p") =>
  `${PG}${user}:${pass}@${hostAndPath}`;

// The endpoint an explicitly-declared dev main would carry.
const MAIN_DB_URL = pgUrl("127.0.0.1:5434/postgres", "postgres", "postgres");
const MAIN_ENDPOINT = "127.0.0.1:5434/postgres";

describe("parseDatabaseName", () => {
  it("extracts the db name from a postgres URL", () => {
    expect(
      parseDatabaseName(
        pgUrl("127.0.0.1:5434/cinatra_clone_optimizations_260515", "postgres", "postgres"),
      ),
    ).toBe("cinatra_clone_optimizations_260515");
  });

  it("strips a query string", () => {
    expect(
      parseDatabaseName(pgUrl("h:5432/cinatra?sslmode=require")),
    ).toBe("cinatra");
  });

  it("returns empty for blank input", () => {
    expect(parseDatabaseName("")).toBe("");
    expect(parseDatabaseName(undefined)).toBe("");
  });
});

describe("deriveDevTailscaleHostname", () => {
  it("heavy clone → derives from the DB name (NOT the schema, which is plain `cinatra`)", () => {
    // The exact bug: heavy clones have SUPABASE_SCHEMA=cinatra. Keying
    // off schema collided every clone on `cinatra-main`.
    expect(
      deriveDevTailscaleHostname({
        dbUrl:
          pgUrl("127.0.0.1:5434/cinatra_clone_optimizations_260515", "postgres", "postgres"),
        schema: "cinatra",
      }),
    ).toBe("cinatra-clone-optimizations-260515");
  });

  it("two heavy clones get DISTINCT hostnames (no collision)", () => {
    const a = deriveDevTailscaleHostname({
      dbUrl: "postgres://x@h/cinatra_clone_alpha",
      schema: "cinatra",
    });
    const b = deriveDevTailscaleHostname({
      dbUrl: "postgres://x@h/cinatra_clone_beta",
      schema: "cinatra",
    });
    expect(a).toBe("cinatra-clone-alpha");
    expect(b).toBe("cinatra-clone-beta");
    expect(a).not.toBe(b);
  });

  it("light worktree → derives from the schema (shared DB)", () => {
    expect(
      deriveDevTailscaleHostname({
        dbUrl: "postgres://x@h/postgres",
        schema: "cinatra_worktree_tailscale",
      }),
    ).toBe("cinatra-worktree-tailscale");
  });

  it("DECLARED main → cinatra-main", () => {
    expect(
      deriveDevTailscaleHostname({
        dbUrl: MAIN_DB_URL,
        schema: "cinatra",
        mainDatabase: MAIN_ENDPOINT,
      }),
    ).toBe(DEV_MAIN_TAILSCALE_HOSTNAME);
  });

  it("clone DB + a worktree-looking schema is a CONFLICT, not a precedence win", () => {
    // cinatra#2172: resolving this by precedence collapsed two instances on
    // the same clone database (different isolated schemas) onto ONE identity
    // key — and therefore one runtime directory.
    expect(() =>
      deriveDevTailscaleHostname({
        dbUrl: pgUrl("h/cinatra_clone_foo", "x", "p"),
        schema: "cinatra_something",
      }),
    ).toThrowError(DevTailscaleIdentityError);
  });
});

// ---------------------------------------------------------------------------
// cinatra#2172 — the reserved main identity is DECLARED, never inferred.
//
// The regression these pin: `deriveDevTailscaleHostname` used to FALL THROUGH
// to the literal `cinatra-main` for anything that matched neither isolation
// model, so a throwaway instance derived the reserved identity byte-for-byte
// and provisioning from it squatted tunnel state it did not own.
// ---------------------------------------------------------------------------

describe("fail-closed dev tunnel identity (cinatra#2172)", () => {
  it("an UNREGISTERED instance no longer derives the reserved main identity — it THROWS", () => {
    // The exact reported shape: a scratch database, no schema override.
    const inputs = { dbUrl: pgUrl("127.0.0.1:5434/scratch_2172"), schema: "" };
    expect(() => deriveDevTailscaleHostname(inputs)).toThrowError(
      DevTailscaleIdentityError,
    );
    let thrown: unknown;
    try {
      deriveDevTailscaleHostname(inputs);
    } catch (err) {
      thrown = err;
    }
    expect((thrown as { code?: string }).code).toBe(DEV_TAILSCALE_UNREGISTERED_CODE);
    // And it never leaks the reserved literal as a "value" in the message.
    expect((thrown as Error).message).toContain("Refusing to provision");
  });

  it("missing inputs are unregistered too (no identity ⇒ no tunnel)", () => {
    const identity = classifyDevTailscaleIdentity({ dbUrl: undefined, schema: undefined });
    expect(identity.ok).toBe(false);
    expect(identity.kind).toBe("unregistered");
    expect(identity.hostname).toBeNull();
  });

  it("the classifier is TOTAL — it never throws and never returns the reserved hostname unasked", () => {
    for (const bad of [undefined, null, "", "not a url", "postgres://", 42, {}]) {
      const identity = classifyDevTailscaleIdentity({
        dbUrl: bad as unknown as string,
        schema: bad as unknown as string,
      });
      expect(identity.ok).toBe(false);
      expect(identity.hostname).not.toBe(DEV_MAIN_TAILSCALE_HOSTNAME);
      expect(identity.version).toBe(DEV_TAILSCALE_IDENTITY_CONTRACT_VERSION);
    }
  });

  it("the refusal names BOTH sanctioned identities plus the explicit main declaration", () => {
    const identity = classifyDevTailscaleIdentity({
      dbUrl: pgUrl("127.0.0.1:5434/scratch_2172"),
      schema: "",
    });
    const message = describeDevTailscaleIdentityRefusal(
      identity,
      pgUrl("127.0.0.1:5434/scratch_2172"),
    );
    expect(message).toContain("cinatra_clone_<slug>");
    expect(message).toContain("SUPABASE_SCHEMA=cinatra_<slug>");
    // The exact declaration value for THIS instance, ready to paste.
    expect(message).toContain("CINATRA_DEV_MAIN_DATABASE=127.0.0.1:5434/scratch_2172");
    // The password never reaches an operator-facing message.
    expect(message).not.toContain(`p${"@"}`);
  });

  it("BOTH sanctioned derivations still work, and neither needs a declaration", () => {
    expect(
      classifyDevTailscaleIdentity({
        dbUrl: pgUrl("127.0.0.1:5434/cinatra_clone_optimizations_260515"),
        schema: "cinatra",
      }),
    ).toMatchObject({
      ok: true,
      kind: "clone",
      hostname: "cinatra-clone-optimizations-260515",
      key: "clone:127.0.0.1:5434/cinatra_clone_optimizations_260515",
    });
    expect(
      classifyDevTailscaleIdentity({
        dbUrl: pgUrl("127.0.0.1:5434/postgres"),
        schema: "cinatra_worktree_preview_a",
      }),
    ).toMatchObject({
      ok: true,
      kind: "schema",
      hostname: "cinatra-worktree-preview-a",
      key: "schema:127.0.0.1:5434/postgres#cinatra_worktree_preview_a",
    });
  });

  it("identity keys are ENDPOINT-SCOPED — the same name on two servers is two identities", () => {
    const a = classifyDevTailscaleIdentity({
      dbUrl: pgUrl("host-a:5432/cinatra_clone_x"),
      schema: "cinatra",
    });
    const b = classifyDevTailscaleIdentity({
      dbUrl: pgUrl("host-b:5432/cinatra_clone_x"),
      schema: "cinatra",
    });
    expect(a.hostname).toBe(b.hostname); // the MagicDNS name is name-derived…
    expect(a.key).not.toBe(b.key); // …the runtime-state key is not
  });

  it("the identity KEY separates two identities that sanitise to the same hostname", () => {
    const a = classifyDevTailscaleIdentity({ schema: "cinatra_a_b" });
    const b = classifyDevTailscaleIdentity({ schema: "cinatra_a-b" });
    expect(a.hostname).toBe(b.hostname); // sanitisation collapses `_` and `-`
    expect(a.key).not.toBe(b.key); // the key does NOT
  });

  it("a NON-main identity that sanitises onto the reserved hostname is REFUSED", () => {
    // The squat, one layer down: the runtime slug would differ, but the
    // MagicDNS node registered would be the reserved main's.
    for (const schema of ["cinatra_main", "cinatra__main", "cinatra_-main"]) {
      const identity = classifyDevTailscaleIdentity({ schema });
      expect(identity.ok).toBe(false);
      expect(identity.code).toBe(DEV_TAILSCALE_IDENTITY_CONFLICT_CODE);
      expect(identity.reason).toContain(DEV_MAIN_TAILSCALE_HOSTNAME);
    }
  });

  it("a PRESENT but unfingerprintable database URL is unregistered, not name-keyed", () => {
    // Falling back to the bare name is how two instances on different servers
    // collapse onto one identity key — the same shared-state failure the
    // reserved-identity fallthrough caused.
    for (const dbUrl of [
      "postgresql://h:5432/cinatra_clone_x?host=elsewhere",
      "postgresql://h:%2F/cinatra_clone_x",
      "mysql://h:3306/cinatra_clone_x",
    ]) {
      expect(classifyDevTailscaleIdentity({ dbUrl, schema: "cinatra" }).ok).toBe(false);
    }
    // A libpq redirect hidden behind percent-encoding is caught too.
    expect(
      classifyDevTailscaleIdentity({
        dbUrl: "postgresql://h:5432/cinatra_clone_x?%68ost=elsewhere",
        schema: "cinatra",
      }).ok,
    ).toBe(false);
  });

  it("schema isolation is still an identity BEFORE a database URL is configured", () => {
    expect(classifyDevTailscaleIdentity({ schema: "cinatra_lane" })).toMatchObject({
      ok: true,
      kind: "schema",
      key: "schema:#cinatra_lane",
    });
  });

  it("a HOST (or a password) can never masquerade as the database name", () => {
    // No path ⇒ no database ⇒ no identity. Previously the last `/` segment
    // read the HOST — so a host named `cinatra_clone_x` classified as a clone,
    // and a userinfo-bearing authority dragged the PASSWORD into the identity key.
    for (const dbUrl of [
      "postgresql://cinatra_clone_x",
      pgUrl("cinatra_clone_x", "u", "hunter2"),
      "postgresql://h/other/cinatra_clone_x",
    ]) {
      const identity = classifyDevTailscaleIdentity({ dbUrl, schema: "cinatra" });
      expect(identity.ok).toBe(false);
      expect(identity.key).toBeNull();
      expect(identity.reason).not.toContain("hunter2");
    }
  });

  it("a main declaration must match this instance's own endpoint", () => {
    // Right database name, WRONG endpoint (a config copied from elsewhere).
    const identity = classifyDevTailscaleIdentity({
      dbUrl: MAIN_DB_URL,
      schema: "cinatra",
      mainDatabase: "10.0.0.9:5434/postgres",
    });
    expect(identity.ok).toBe(false);
    expect(identity.code).toBe(DEV_TAILSCALE_UNREGISTERED_CODE);
    expect(identity.reason).toContain("does not match");
  });

  it("a bare database NAME is not a valid declaration (endpoint binding, not a name allowlist)", () => {
    expect(normalizeDevMainDatabaseDeclaration("postgres")).toBe("");
    expect(
      classifyDevTailscaleIdentity({
        dbUrl: MAIN_DB_URL,
        schema: "cinatra",
        mainDatabase: "postgres",
      }).ok,
    ).toBe(false);
  });

  it("a full connection string is an accepted declaration form", () => {
    expect(
      classifyDevTailscaleIdentity({
        dbUrl: MAIN_DB_URL,
        schema: "cinatra",
        mainDatabase: MAIN_DB_URL,
      }),
    ).toMatchObject({ ok: true, kind: "main", hostname: DEV_MAIN_TAILSCALE_HOSTNAME });
  });

  it("CONFLICTING signals are rejected, never resolved by precedence", () => {
    const cloneConflict = classifyDevTailscaleIdentity({
      dbUrl: pgUrl("127.0.0.1:5434/cinatra_clone_foo"),
      schema: "cinatra",
      mainDatabase: "127.0.0.1:5434/cinatra_clone_foo",
    });
    expect(cloneConflict.ok).toBe(false);
    expect(cloneConflict.code).toBe(DEV_TAILSCALE_IDENTITY_CONFLICT_CODE);

    const schemaConflict = classifyDevTailscaleIdentity({
      dbUrl: MAIN_DB_URL,
      schema: "cinatra_lane",
      mainDatabase: MAIN_ENDPOINT,
    });
    expect(schemaConflict.ok).toBe(false);
    expect(schemaConflict.code).toBe(DEV_TAILSCALE_IDENTITY_CONFLICT_CODE);
  });

  it("a declared main on a non-default schema is a conflict, not a main", () => {
    const identity = classifyDevTailscaleIdentity({
      dbUrl: MAIN_DB_URL,
      schema: "public",
      mainDatabase: MAIN_ENDPOINT,
    });
    expect(identity.ok).toBe(false);
    expect(identity.code).toBe(DEV_TAILSCALE_IDENTITY_CONFLICT_CODE);
  });

  it("an unset schema is the plain default for a declared main", () => {
    expect(
      classifyDevTailscaleIdentity({ dbUrl: MAIN_DB_URL, mainDatabase: MAIN_ENDPOINT }),
    ).toMatchObject({ ok: true, kind: "main" });
  });
});

describe("parseDatabaseEndpoint", () => {
  it("drops user info and fills the default port", () => {
    expect(parseDatabaseEndpoint(pgUrl("Db.Example:5434/cinatra", "u", "pw"))).toBe(
      "db.example:5434/cinatra",
    );
    expect(parseDatabaseEndpoint(`${PG}u@h/cinatra`)).toBe("h:5432/cinatra");
  });

  it("tolerates an at-sign inside the password (splits on the LAST one)", () => {
    expect(parseDatabaseEndpoint(pgUrl("h:5432/cinatra", "u", "p%40ss"))).toBe(
      "h:5432/cinatra",
    );
  });

  it("handles an IPv6 literal host", () => {
    expect(parseDatabaseEndpoint(pgUrl("[::1]:5434/cinatra"))).toBe(
      "[::1]:5434/cinatra",
    );
    expect(parseDatabaseEndpoint(pgUrl("[::1]/cinatra"))).toBe(
      "[::1]:5432/cinatra",
    );
  });

  it("strips a query string via parseDatabaseName", () => {
    expect(parseDatabaseEndpoint(pgUrl("h:5432/cinatra?sslmode=require"))).toBe(
      "h:5432/cinatra",
    );
  });

  it("tolerates a single trailing slash", () => {
    expect(parseDatabaseEndpoint("postgresql://h:5434/cinatra/")).toBe("h:5434/cinatra");
  });

  it("drops a trailing root dot so `h.` and `h` fingerprint identically", () => {
    expect(parseDatabaseEndpoint("postgresql://h.:5434/cinatra")).toBe(
      parseDatabaseEndpoint("postgresql://h:5434/cinatra"),
    );
  });

  it("returns empty for unusable or AMBIGUOUS input (fail closed)", () => {
    for (const bad of [
      "",
      undefined,
      "postgresql://h:5432/", // no database
      pgUrl("h:notaport/cinatra"), // non-numeric port
      "postgresql://h:0/cinatra", // port out of range
      "postgresql://h:070/cinatra", // leading-zero port
      "postgresql://h:99999/cinatra", // port out of range
      "postgresql://h:/cinatra", // empty port
      "postgresql://::1/cinatra", // unbracketed IPv6 — ambiguous
      "postgresql://h/a/b", // deeper path
      "postgresql://cinatra", // no path at all
      "https://h:5432/cinatra", // not a Postgres scheme
      "mysql://h:3306/cinatra", // not a Postgres scheme
      "postgresql://h:5432/cinatra?host=elsewhere", // libpq redirect
      "postgresql://h:5432/cinatra?port=6543", // libpq redirect
      "postgresql:///cinatra?host=elsewhere", // libpq redirect
    ]) {
      expect(parseDatabaseEndpoint(bad as string)).toBe("");
    }
  });
});

describe("sanitizeTailscaleDeviceName", () => {
  it("lowercases + hyphenates non-alphanumerics + collapses runs", () => {
    expect(sanitizeTailscaleDeviceName("Foo Bar__Baz")).toBe("foo-bar-baz");
  });

  it("trims leading/trailing hyphens", () => {
    expect(sanitizeTailscaleDeviceName("--foo--")).toBe("foo");
  });

  it("prefixes c- when the name would not start with a letter", () => {
    expect(sanitizeTailscaleDeviceName("260515-clone")).toBe("c-260515-clone");
  });

  it("truncates + hashes names longer than 63 chars deterministically", () => {
    const long = "a".repeat(80);
    const a = sanitizeTailscaleDeviceName(long);
    const b = sanitizeTailscaleDeviceName(long);
    expect(a).toBe(b);
    expect(a.length).toBeLessThanOrEqual(63);
    expect(a.startsWith("a")).toBe(true);
    expect(sanitizeTailscaleDeviceName("a".repeat(79) + "b")).not.toBe(a);
  });

  it("never returns empty", () => {
    expect(sanitizeTailscaleDeviceName("")).toBe("cinatra-dev");
    expect(sanitizeTailscaleDeviceName("___")).toBe("cinatra-dev");
  });
});

describe("composeTailscaleFunnelUrl", () => {
  it("composes a full https Funnel URL", () => {
    expect(composeTailscaleFunnelUrl("cinatra-clone-foo", "taild5286c")).toBe(
      "https://cinatra-clone-foo.taild5286c.ts.net",
    );
  });

  it("returns null when the tailnet is unresolved", () => {
    expect(composeTailscaleFunnelUrl("cinatra-main", "-")).toBeNull();
    expect(composeTailscaleFunnelUrl("cinatra-main", "")).toBeNull();
    expect(composeTailscaleFunnelUrl("cinatra-main", undefined)).toBeNull();
  });

  it("returns null when the hostname is empty", () => {
    expect(composeTailscaleFunnelUrl("", "taild5286c")).toBeNull();
  });
});
