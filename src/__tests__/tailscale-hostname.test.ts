import { describe, expect, it } from "vitest";
import {
  composeTailscaleFunnelUrl,
  deriveDevTailscaleHostname,
  parseDatabaseName,
  sanitizeTailscaleDeviceName,
} from "../tailscale-hostname.mjs";

describe("parseDatabaseName", () => {
  it("extracts the db name from a postgres URL", () => {
    expect(
      parseDatabaseName(
        "postgresql://postgres:postgres@127.0.0.1:5434/cinatra_clone_optimizations_260515",
      ),
    ).toBe("cinatra_clone_optimizations_260515");
  });

  it("strips a query string", () => {
    expect(
      parseDatabaseName("postgres://u:p@h:5432/cinatra?sslmode=require"),
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
          "postgresql://postgres:postgres@127.0.0.1:5434/cinatra_clone_optimizations_260515",
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

  it("main → cinatra-main", () => {
    expect(
      deriveDevTailscaleHostname({
        dbUrl: "postgres://x@h/cinatra",
        schema: "cinatra",
      }),
    ).toBe("cinatra-main");
  });

  it("missing inputs → cinatra-main", () => {
    expect(deriveDevTailscaleHostname({ dbUrl: undefined, schema: undefined })).toBe(
      "cinatra-main",
    );
  });

  it("clone DB takes precedence over a worktree-looking schema", () => {
    expect(
      deriveDevTailscaleHostname({
        dbUrl: "postgres://x@h/cinatra_clone_foo",
        schema: "cinatra_something",
      }),
    ).toBe("cinatra-clone-foo");
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
