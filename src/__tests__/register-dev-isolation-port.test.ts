// The dev-instance isolation inputs reach the connector through the host's
// ambient runtime port, asked AT CALL TIME, and map to the classifier's three
// inputs so the derived tunnel identity equals what the equivalent connection
// strings gave. Each arm restores the deps it registered.

import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

import { register } from "../register";
import { _resetTailscaleDepsForTests, getTailscaleDevHostname } from "../index";
import { getTailscaleDeps } from "../deps";
import {
  DEV_MAIN_TAILSCALE_HOSTNAME,
  DEV_TAILSCALE_UNREGISTERED_CODE,
  deriveDevTailscaleHostname,
} from "../tailscale-hostname.mjs";

afterEach(() => {
  _resetTailscaleDepsForTests();
  vi.restoreAllMocks();
});

type Record = {
  databaseConfigured: boolean;
  databaseEndpoint: string | null;
  schema: string | null;
  mainDeclared: boolean;
  mainEndpoint: string | null;
};

const ep = (host: string, port: number, db: string) => `${host}:${port}/${db}`;
const url = (endpoint: string) => ["postgresql:", "//", endpoint].join("");

function record(over: Partial<Record>): Record {
  return {
    databaseConfigured: false,
    databaseEndpoint: null,
    schema: null,
    mainDeclared: false,
    mainEndpoint: null,
    ...over,
  };
}

function registerWith(member: unknown) {
  const runtime: { flag: () => boolean; devInstanceIsolation?: unknown } = { flag: () => false };
  if (member !== undefined) runtime.devInstanceIsolation = member;
  register({
    capabilities: { registerProvider: vi.fn(), resolveProviders: () => [] },
    runtime,
  } as never);
}

function outcome(read: () => string) {
  try {
    return { hostname: read() };
  } catch (error) {
    const e = error as { code?: string; message?: string };
    return { code: e.code, message: e.message };
  }
}

const portRoad = () => outcome(() => getTailscaleDevHostname());
const envRoad = (inputs: { dbUrl?: string; schema?: string; mainDatabase?: string }) =>
  outcome(() => deriveDevTailscaleHostname(inputs));

describe("register(ctx) — isolation inputs through the runtime port", () => {
  it("A1 a clone-database record gives the hostname of the equivalent connection string", () => {
    const endpoint = ep("db.example", 5434, "cinatra_clone_foo");
    registerWith(() => record({ databaseConfigured: true, databaseEndpoint: endpoint }));
    const expected = envRoad({ dbUrl: url(endpoint) });
    expect(expected.hostname).toBeTruthy();
    expect(portRoad()).toEqual(expected);
  });

  it("A2 a worktree-schema record gives the hostname of the equivalent inputs", () => {
    const endpoint = ep("h", 5432, "cinatra");
    registerWith(() =>
      record({ databaseConfigured: true, databaseEndpoint: endpoint, schema: "cinatra_worktree_preview_a" }),
    );
    const expected = envRoad({ dbUrl: url(endpoint), schema: "cinatra_worktree_preview_a" });
    expect(expected.hostname).toBeTruthy();
    expect(portRoad()).toEqual(expected);
  });

  it("A3 a main-declared record gives the reserved main hostname", () => {
    const endpoint = ep("h", 5432, "cinatra");
    registerWith(() =>
      record({ databaseConfigured: true, databaseEndpoint: endpoint, mainDeclared: true, mainEndpoint: endpoint }),
    );
    const expected = envRoad({ dbUrl: url(endpoint), mainDatabase: endpoint });
    expect(expected.hostname).toBe(DEV_MAIN_TAILSCALE_HOSTNAME);
    expect(portRoad()).toEqual(expected);
  });

  it("A4 a declaration naming another endpoint throws what the equivalent inputs throw", () => {
    const endpoint = ep("h", 5432, "cinatra");
    const other = ep("other", 5432, "cinatra");
    registerWith(() =>
      record({ databaseConfigured: true, databaseEndpoint: endpoint, mainDeclared: true, mainEndpoint: other }),
    );
    const expected = envRoad({ dbUrl: url(endpoint), mainDatabase: other });
    expect(expected.code).toBeTruthy();
    expect(portRoad()).toEqual(expected);
  });

  it("B the member absent gives no inputs and the unregistered refusal; registration throws nothing", () => {
    expect(() => registerWith(undefined)).not.toThrow();
    expect(getTailscaleDeps().readDevIsolationInputs()).toEqual({});
    expect(portRoad().code).toBe(DEV_TAILSCALE_UNREGISTERED_CODE);
  });

  it("C the member answering null gives the same three readings", () => {
    expect(() => registerWith(() => null)).not.toThrow();
    expect(getTailscaleDeps().readDevIsolationInputs()).toEqual({});
    expect(portRoad().code).toBe(DEV_TAILSCALE_UNREGISTERED_CODE);
  });

  it("D1 a configured database with an unreadable endpoint keeps the refusal of the equivalent string", () => {
    registerWith(() => record({ databaseConfigured: true, databaseEndpoint: null }));
    const expected = envRoad({ dbUrl: url(ep("h", 5432, "cinatra")) + "?host=elsewhere" });
    expect(expected.code).toBeTruthy();
    expect(portRoad()).toEqual(expected);
  });

  it("D2 a declaration the host could not read keeps the refusal of a bare database name", () => {
    const endpoint = ep("h", 5432, "cinatra");
    registerWith(() =>
      record({ databaseConfigured: true, databaseEndpoint: endpoint, mainDeclared: true, mainEndpoint: null }),
    );
    const expected = envRoad({ dbUrl: url(endpoint), mainDatabase: "cinatra" });
    expect(expected.code).toBeTruthy();
    expect(portRoad()).toEqual(expected);
  });

  it("E1 registration does not call the member", () => {
    const spy = vi.fn(() => null);
    registerWith(spy);
    expect(spy).toHaveBeenCalledTimes(0);
  });

  it("E2 every read asks the member once and sees its current answer", () => {
    const spy = vi
      .fn()
      .mockReturnValueOnce(record({ databaseConfigured: true, databaseEndpoint: ep("h", 5432, "cinatra"), schema: "cinatra_a" }))
      .mockReturnValueOnce(
        record({
          databaseConfigured: true,
          databaseEndpoint: ep("db.example", 5434, "cinatra_b"),
          schema: "cinatra_b",
          mainDeclared: true,
          mainEndpoint: ep("other", 5432, "cinatra"),
        }),
      );
    registerWith(spy);
    const first = getTailscaleDeps().readDevIsolationInputs();
    expect(spy).toHaveBeenCalledTimes(1);
    const second = getTailscaleDeps().readDevIsolationInputs();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(first).toEqual({ dbUrl: url(ep("h", 5432, "cinatra")), schema: "cinatra_a", mainDatabase: undefined });
    expect(second).toEqual({
      dbUrl: url(ep("db.example", 5434, "cinatra_b")),
      schema: "cinatra_b",
      mainDatabase: ep("other", 5432, "cinatra"),
    });
  });

  it("F the registration source holds no process-environment text", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(path.join(here, "../register.ts"), "utf8");
    expect(source.includes(["process", "env"].join("."))).toBe(false);
  });
});
