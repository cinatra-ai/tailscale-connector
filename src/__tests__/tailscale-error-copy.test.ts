// Error-copy contract for the Tailscale setup form (TailscaleConnectForm).
//
// The setup actions RETURN `{ ok: false, error, code? }` instead of throwing,
// so Next.js production masking does NOT apply: the raw `error` string wraps
// upstream Nango/Tailscale detail (`` `${err.name}: ${err.message}` ``) and
// would leak to the toast + inline alert verbatim if rendered. The form must
// derive ALL user-facing copy through the notice helpers, which map the typed
// `code` to friendly operation-specific copy and never echo `result.error`.
// (This repo's test setup is node-environment vitest over `src/__tests__/
// **/*.test.ts` — no DOM/jsdom harness — so the consumption path is covered
// at the helper the component calls, not via component rendering.)

import { describe, it, expect } from "vitest";

import {
  tailscaleConnectFailureNotice,
  tailscaleDisconnectFailureNotice,
} from "../tailscale-error-copy";

// Shape of what the client receives from a failed save in production: the
// raw server-side detail survives (returned, not thrown — no masking).
const RAW_INTERNAL_DETAIL =
  "Tailscale connection import failed: NangoApiError: 401 Unauthorized — POST /connection returned {\"error\":\"invalid api key tskey-api-…\"}";

const DOCUMENTED_SAVE_CODES = [
  "tailscale.invalid_client",
  "tailscale.scope_denied",
  "tailscale.tag_denied",
  "tailscale.rate_limited",
  "tailscale.network",
  "tailscale.nango_unconfigured",
  "tailscale.nango_writeback",
  "tailscale.unknown",
] as const;

describe("tailscaleConnectFailureNotice (save path)", () => {
  it("never renders the raw returned error string for { ok:false, error:<raw internal detail>, code:'tailscale.unknown' }", () => {
    const notice = tailscaleConnectFailureNotice({
      error: RAW_INTERNAL_DETAIL,
      code: "tailscale.unknown",
    });

    expect(notice.title).toBe("Tailscale connection failed");
    expect(notice.body).not.toBe(RAW_INTERNAL_DETAIL);
    expect(notice.body).not.toContain(RAW_INTERNAL_DETAIL);
    expect(notice.body).not.toContain("NangoApiError");
    expect(notice.body).not.toContain("tskey-api");
    // Friendly + actionable, not a bare failure statement.
    expect(notice.body.length).toBeGreaterThan(0);
  });

  it("maps every documented save code to friendly copy that never echoes result.error", () => {
    for (const code of DOCUMENTED_SAVE_CODES) {
      const notice = tailscaleConnectFailureNotice({
        error: RAW_INTERNAL_DETAIL,
        code,
      });
      expect(notice.title).toBe("Tailscale connection failed");
      expect(notice.body.length).toBeGreaterThan(0);
      expect(notice.body).not.toContain(RAW_INTERNAL_DETAIL);
      expect(notice.body).not.toContain("NangoApiError");
    }
  });

  it("gives code-specific guidance for the documented codes (distinct from the fallback)", () => {
    const fallback = tailscaleConnectFailureNotice({ error: "x" }).body;
    expect(
      tailscaleConnectFailureNotice({ error: "x", code: "tailscale.tag_denied" })
        .body,
    ).toMatch(/tagOwners/);
    expect(
      tailscaleConnectFailureNotice({
        error: "x",
        code: "tailscale.nango_unconfigured",
      }).body,
    ).toMatch(/Nango/);
    expect(
      tailscaleConnectFailureNotice({
        error: "x",
        code: "tailscale.rate_limited",
      }).body,
    ).not.toBe(fallback);
  });

  it("falls back to the unknown copy when code is missing or unrecognized", () => {
    const unknown = tailscaleConnectFailureNotice({
      error: RAW_INTERNAL_DETAIL,
      code: "tailscale.unknown",
    });
    const missing = tailscaleConnectFailureNotice({ error: RAW_INTERNAL_DETAIL });
    const unrecognized = tailscaleConnectFailureNotice({
      error: RAW_INTERNAL_DETAIL,
      code: "tailscale.some_future_code",
    });

    expect(missing.body).toBe(unknown.body);
    expect(unrecognized.body).toBe(unknown.body);
    expect(missing.body).not.toContain(RAW_INTERNAL_DETAIL);
  });
});

describe("tailscaleDisconnectFailureNotice (disconnect path)", () => {
  it("returns unconditional friendly copy and never echoes result.error (action returns no code)", () => {
    const raw =
      "TailscaleApiError: deleteConnection failed: 500 Internal Server Error from nango";
    const notice = tailscaleDisconnectFailureNotice({ error: raw });

    expect(notice.title).toBe("Tailscale disconnect failed");
    expect(notice.body).not.toBe(raw);
    expect(notice.body).not.toContain(raw);
    expect(notice.body).not.toContain("TailscaleApiError");
    expect(notice.body.length).toBeGreaterThan(0);
  });
});
