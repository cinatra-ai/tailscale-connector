// Pins the actual cross-repo integration seam (cinatra#2534): the
// `dev-tunnel-status` capability provider `register(ctx)` registers must carry
// a callable, zero-argument `getFunnelUrlPreviewReason`, under EXACTLY that
// name, alongside the existing `getConnectionStatus` / `getFunnelUrlPreview`
// entries — that is the OPTIONAL getter cinatra's host-side
// `getDevTunnelStatus()` structurally probes for on the same provider impl
// (see `@/lib/dev-tunnel-status.ts` in cinatra). A spelling or wiring
// regression here would silently degrade the host back to the cause-agnostic
// copy with no test failure anywhere else in this repo.

import { describe, it, expect, vi, afterEach } from "vitest";

import { register } from "../register";
import { _resetTailscaleDepsForTests } from "../index";

afterEach(() => {
  _resetTailscaleDepsForTests();
});

// `register(ctx)` resolves every host service LAZILY (closures invoked only
// at call time — see the file header of register.ts), so registration itself
// touches only `ctx.capabilities.registerProvider`. A minimal stub is
// therefore a faithful exercise of the real registration path, not a
// bypass of it.
function stubHostContext(registerProvider: ReturnType<typeof vi.fn>) {
  return {
    capabilities: {
      registerProvider,
      resolveProviders: () => [],
    },
    runtime: { flag: () => false },
  } as unknown as Parameters<typeof register>[0];
}

describe("register(ctx) — dev-tunnel-status provider shape", () => {
  it("registers a callable, zero-arg getFunnelUrlPreviewReason alongside getConnectionStatus/getFunnelUrlPreview", () => {
    const registerProvider = vi.fn();
    register(stubHostContext(registerProvider));

    const call = registerProvider.mock.calls.find(([capability]) => capability === "dev-tunnel-status");
    expect(call).toBeDefined();
    const [, provider] = call as [string, { packageName: string; impl: Record<string, unknown> }];

    expect(provider.packageName).toBe("@cinatra-ai/tailscale-connector");
    expect(typeof provider.impl.getConnectionStatus).toBe("function");
    expect(typeof provider.impl.getFunnelUrlPreview).toBe("function");
    expect(typeof provider.impl.getFunnelUrlPreviewReason).toBe("function");
    // Zero-arg, per the host's optional-getter probe (see cinatra's
    // DevTunnelReasonReader — `getFunnelUrlPreviewReason?: () => unknown`).
    expect((provider.impl.getFunnelUrlPreviewReason as (...a: unknown[]) => unknown).length).toBe(0);
  });
});
