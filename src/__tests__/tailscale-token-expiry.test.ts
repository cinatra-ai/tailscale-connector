// Coverage for the pure token-expiry helpers that drive the inline reminder.
// Tailscale API tokens live at most 90 days; the connector persists the
// set-date and derives a conservative expiry window, then classifies how close
// it is so the UI can surface amber/red guidance before the background clone
// auto-tunnel silently stops working.

import { describe, it, expect } from "vitest";
import {
  TAILSCALE_TOKEN_MAX_AGE_DAYS,
  TAILSCALE_TOKEN_WARN_DAYS,
  computeTailscaleTokenExpiry,
  describeTailscaleTokenExpiry,
} from "../tailscale-token-expiry.mjs";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

describe("computeTailscaleTokenExpiry", () => {
  it("adds the 90-day max age to the set-date", () => {
    const setAt = "2026-01-01T00:00:00.000Z";
    const expiry = computeTailscaleTokenExpiry(setAt);
    expect(expiry).toBe("2026-04-01T00:00:00.000Z");
    // Exactly TAILSCALE_TOKEN_MAX_AGE_DAYS apart.
    const delta = new Date(expiry as string).getTime() - new Date(setAt).getTime();
    expect(delta).toBe(TAILSCALE_TOKEN_MAX_AGE_DAYS * MS_PER_DAY);
  });

  it("honors a custom max-age", () => {
    const expiry = computeTailscaleTokenExpiry("2026-01-01T00:00:00.000Z", 7);
    expect(expiry).toBe("2026-01-08T00:00:00.000Z");
  });

  it("returns null for unparseable input", () => {
    expect(computeTailscaleTokenExpiry(undefined)).toBeNull();
    expect(computeTailscaleTokenExpiry(null)).toBeNull();
    expect(computeTailscaleTokenExpiry("not-a-date")).toBeNull();
  });
});

describe("describeTailscaleTokenExpiry", () => {
  const now = new Date("2026-06-01T00:00:00.000Z");

  it("reports 'unknown' when no expiry is tracked (legacy connection)", () => {
    expect(describeTailscaleTokenExpiry(undefined, { now })).toEqual({
      status: "unknown",
      daysRemaining: null,
      expiresAt: null,
    });
    expect(describeTailscaleTokenExpiry("garbage", { now }).status).toBe("unknown");
  });

  it("reports 'ok' with whole days remaining when far from expiry", () => {
    const expiresAt = new Date(now.getTime() + 30 * MS_PER_DAY).toISOString();
    const result = describeTailscaleTokenExpiry(expiresAt, { now });
    expect(result.status).toBe("ok");
    expect(result.daysRemaining).toBe(30);
  });

  it("stays 'ok' at EXACTLY the warn threshold (amber is strictly < WARN_DAYS)", () => {
    const expiresAt = new Date(
      now.getTime() + TAILSCALE_TOKEN_WARN_DAYS * MS_PER_DAY,
    ).toISOString();
    const result = describeTailscaleTokenExpiry(expiresAt, { now });
    expect(result.status).toBe("ok");
    expect(result.daysRemaining).toBe(TAILSCALE_TOKEN_WARN_DAYS);
  });

  it("flips to 'warning' just inside the warn threshold", () => {
    // One minute short of WARN_DAYS — strictly under the threshold.
    const expiresAt = new Date(
      now.getTime() + TAILSCALE_TOKEN_WARN_DAYS * MS_PER_DAY - 60_000,
    ).toISOString();
    const result = describeTailscaleTokenExpiry(expiresAt, { now });
    expect(result.status).toBe("warning");
    expect(result.daysRemaining).toBe(TAILSCALE_TOKEN_WARN_DAYS);
  });

  it("stays 'ok' just past the warn threshold", () => {
    const expiresAt = new Date(
      now.getTime() + (TAILSCALE_TOKEN_WARN_DAYS + 1) * MS_PER_DAY,
    ).toISOString();
    expect(describeTailscaleTokenExpiry(expiresAt, { now }).status).toBe("ok");
  });

  it("rounds partial days UP so a sub-day remainder still reads as a day left", () => {
    const expiresAt = new Date(now.getTime() + Math.round(0.4 * MS_PER_DAY)).toISOString();
    const result = describeTailscaleTokenExpiry(expiresAt, { now });
    expect(result.status).toBe("warning");
    expect(result.daysRemaining).toBe(1);
  });

  it("reports 'expired' at or past the expiry instant with a non-positive day count", () => {
    const atExpiry = describeTailscaleTokenExpiry(now.toISOString(), { now });
    expect(atExpiry.status).toBe("expired");
    expect(atExpiry.daysRemaining).toBeLessThanOrEqual(0);

    const pastExpiry = describeTailscaleTokenExpiry(
      new Date(now.getTime() - 5 * MS_PER_DAY).toISOString(),
      { now },
    );
    expect(pastExpiry.status).toBe("expired");
    expect(pastExpiry.daysRemaining).toBe(-5);
  });

  it("honors a custom warnDays threshold", () => {
    const expiresAt = new Date(now.getTime() + 20 * MS_PER_DAY).toISOString();
    expect(describeTailscaleTokenExpiry(expiresAt, { now }).status).toBe("ok");
    expect(describeTailscaleTokenExpiry(expiresAt, { now, warnDays: 30 }).status).toBe(
      "warning",
    );
  });
});
