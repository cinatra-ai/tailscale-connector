# Changelog

All notable changes to this project are documented here, derived from the
project's merged pull request and release-tag history.

## v0.1.5 — 2026-06-28

- fix: declared `cinatra.vendor` identity ahead of a marketplace re-submit (#38)
- chore: stripped private tracker references from public source (#35)

## v0.1.4 — 2026-06-28

- feat: OAuth-client auth mode via the Nango Connect UI ("Design C", shipped flag-off) (#26, #32)
- docs: updated OAuth setup copy for the Trust-credentials flow; expanded README to the org standard (#34, #28)
- ci: ramped the raw-JSX lint block to error and re-vendored the UI-gate preset with the dynamic-import ban; adopted source-leak-gate (#29, #33, #30, #31)

## v0.1.3 — 2026-06-25

- feat: inline reminder before the 90-day API token expires (#25)

## v0.1.2 — 2026-06-23

- ci: added the truthful-attribution gate (advisory/WARN mode); adopted the reusable extension→host IoC conformance gate, the tag-driven GitHub release workflow, and secret-scan-gate (#18, #19, #20, #21)

## v0.1.1 — 2026-06-13

- feat: self-registration at `serverEntry` activation via capability services; friendlier operation-specific error copy instead of raw action errors; dev-tunnel-status capability registration; dev CLI modules declared in the extension manifest (#6, #7, #10, #14)
- chore: adopted source-leak-gate, SHA-pinned org gate callers, npm packaging hygiene, Renovate config, reusable release-workflow pinning (#1–#5, #8, #9, #11–#13, #15, #16)

## v0.1.0 — 2026-06-03

- Initial release.

## Unreleased

- chore: stripped private tracker references from workflow comments; pinned the reusable extension-release workflow to the gated version (release-approval wall); declared `cinatra.consumes` for closure-gate enrollment (#39, #40, #41)
