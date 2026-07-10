// Regression coverage for the toast-dedup fix (epic cinatra-ai/cinatra#1107,
// sub-issue S12): `TailscaleConnectForm` used to render a `friendlyError`
// destructive `<Alert>` duplicating every error already surfaced via
// `useNotify().addNotification(...)`. The banner was deleted outright.
//
// This repo's vitest is node-environment only (see
// `tailscale-error-copy.test.ts`) and `@cinatra-ai/sdk-ui` — the host of
// `useNotify` — is a host-internal peer that isn't installable outside the
// cinatra monorepo (confirmed: `pnpm install` 404s on `@cinatra-ai/sdk-ui`
// standalone), so this component can't be mounted in a DOM harness from this
// repo. Instead this test locks in the two structural invariants a DOM test
// would otherwise cover: no leftover dead-banner state/markup, and every
// failure branch that used to feed the banner still reaches a toast.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const formSource = readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../tailscale-connect-form.tsx",
  ),
  "utf8",
);

describe("TailscaleConnectForm toast dedup (S12)", () => {
  it("has no remaining friendlyError state or inline error banner", () => {
    expect(formSource).not.toMatch(/friendlyError/);
  });

  it("keeps the persistent (non-error-outcome) alerts", () => {
    // Token-expiry notice and the OAuth-disconnect reminder are persistent
    // state, not transient error feedback — the issue keeps them.
    expect(formSource).toMatch(/expiryNotice/);
    expect(formSource).toMatch(/Disconnecting removes the connection from Nango/);
  });

  it("every failed-outcome branch (`!result.ok` / `!saved.ok` / `!session.ok`) still calls addNotification", () => {
    const failureBranchRe = /if\s*\(!\w+\.ok\)\s*{([\s\S]*?)^ {8}}/gm;
    const branches = [...formSource.matchAll(failureBranchRe)];
    expect(branches.length).toBeGreaterThanOrEqual(4);
    for (const [, body] of branches) {
      expect(body).toMatch(/addNotification\(/);
    }
  });

  it("the OAuth Connect-UI 'error' event surfaces a toast (previously silent)", () => {
    const errorEventRe = /event\.type === "error"\)\s*{([\s\S]*?)\n {12}}/;
    const match = formSource.match(errorEventRe);
    expect(match).not.toBeNull();
    expect(match?.[1]).toMatch(/addNotification\(/);
  });

  it("the outer catch (dialog failed to open) surfaces a toast (previously silent)", () => {
    const catchRe = /} catch {([\s\S]*?)connectUI\?\.close\(\);\n {6}} finally/;
    const match = formSource.match(catchRe);
    expect(match).not.toBeNull();
    expect(match?.[1]).toMatch(/addNotification\(/);
  });
});
