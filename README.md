# Tailscale

Give every Cinatra dev instance a deterministic public URL through your tailnet. Once the connector is set up, each clone automatically gets a Tailscale Funnel URL (for example, `https://my-clone.acme.ts.net`) so webhooks, OAuth callbacks, and MCP clients can reach your instance without configuring a tunnel each session.

**Setup:** In the Cinatra connector settings, paste a Tailscale API access token (a `tskey-api-…` token from the Tailscale admin console) and choose the Tailscale tag your workspace uses for clone auth-keys (for example, `tag:cinatra-clone`). The connector verifies the token against the Tailscale API and stores it securely via the connection service. You can also enable OAuth-client mode (flag `CINATRA_TAILSCALE_OAUTH_ENABLED=1`) to use Tailscale OAuth credentials instead.

**Credentials required:** A Tailscale API access token with permission to create auth-keys for the tag you specify, and a tailnet policy that includes a `tagOwners` entry for that tag. The token is stored by the connection service at save time; API tokens are valid for up to 90 days and the connector surfaces a reminder as expiry approaches.

**Troubleshooting:** If the connection fails, generate a new API access token in the Tailscale admin console and make sure its Tags scope matches the tag you entered. If Tailscale rejects the tag (code `tailscale.tag_denied`), confirm the tag appears in your tailnet ACL policy under `tagOwners`. Detailed error codes are written to the server logs.

## Works with

- Tailscale (tailnet — any paid or personal plan with API access enabled)
- Cinatra connection service (stores the API token and OAuth credentials)

## Capabilities

- Provision a deterministic Funnel URL per dev instance so webhooks, OAuth callbacks, and MCP clients reach it without manual tunnel setup
- Mint per-clone, tag-scoped ephemeral auth-keys automatically on clone start
- Display the predicted Funnel URL in the dev tab before the sidecar is provisioned
- Show the current tailnet name, clone tag, and API token expiry reminder in the connector status view
- Disconnect and remove credential storage from the connection service in one action
