# Tailscale

Give every Cinatra dev instance a deterministic public URL through your tailnet. Once set up, each clone automatically gets a Tailscale Funnel URL (e.g. `https://my-clone.acme.ts.net`) so webhooks, OAuth callbacks, and MCP clients reach your instance without configuring a tunnel each session.

**Setup (recommended — OAuth client):** In the connector settings, choose **OAuth client**. In Tailscale, open **Trust credentials** (`login.tailscale.com/admin/settings/trust-credentials`), add a **Credential → OAuth** with **Keys (`auth_keys`) = Write**, attach your clone tag (for example, `tag:cinatra-clone`), and **Generate credential**. Back in Cinatra, click **Connect OAuth client** and enter the client ID + secret in the connection service dialog. An OAuth client has no 90-day expiry.

**Setup (API access token):** Alternatively, paste a Tailscale API access token (`tskey-api-…`) and choose the same clone tag. API tokens expire after up to 90 days; the connector reminds you as expiry approaches.

**Security model:** Both modes require a `tagOwners` entry for your clone tag in the tailnet policy (e.g. owner `autogroup:admin`). Credentials live in the connection service (Nango); the OAuth secret stays there and is never read by Cinatra or its clones. Each clone mints its own short-lived, tag-scoped, per-node auth-key at start through that service.

**Troubleshooting:** If connection fails, regenerate the credential and confirm its `auth_keys` Write scope (OAuth) or Tags scope (API token) matches the tag. If Tailscale rejects the tag (`tailscale.tag_denied`), confirm it appears under `tagOwners` in your ACL policy. Detailed error codes go to the server logs.

## Works with

- Tailscale (tailnet — any paid or personal plan with API access enabled)
- Cinatra connection service (stores the API token and OAuth credentials)

## Capabilities

- Provision a deterministic Funnel URL per dev instance so webhooks, OAuth callbacks, and MCP clients reach it without manual tunnel setup
- Mint per-clone, tag-scoped ephemeral auth-keys automatically on clone start
- Connect via a no-expiry OAuth client (secret stays in the connection service) or a Tailscale API access token
- Display the predicted Funnel URL in the dev tab before the sidecar is provisioned
- Show the tailnet name, clone tag, auth mode, and token expiry reminder in the status view
- Disconnect and remove credential storage from the connection service in one action
