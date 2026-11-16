# Publishing schema-diff-tools (zero-background walkthrough)

This guide takes you from a fresh clone to "live on npm + listed in the official MCP registry + auto-listed on Glama". You run every command yourself; nothing here is automated against a real registry.

Prerequisites: Node ≥ 20.19, npm ≥ 10, a free [npmjs.com](https://www.npmjs.com) account, a GitHub account. Everything below is offline except the explicitly marked steps.

## 0. Pre-flight (offline)
> **One-time scope setup (do this first):** the npm org **nopilot** is already created (2026-11-16). Just run `npm adduser --scope=@nopilot` so `npm publish --access public` works for all four repos.


```bash
cd schema-diff-tools
npm install
npm test   # build + typecheck + 36 vitest tests + determinism harness — must be all green
npm run publish:dry   # shows exactly what each tarball would contain
```

## 1. Create the GitHub repo (user manual step)

1. Create an empty repo named `schema-diff-tools` under your account (no README/license — local ones win).
2. Push:

```bash
git init -b main && git add -A && git commit -m "schema-diff-tools v1.0.0"
git remote add origin git@github.com:latbert/schema-diff-tools.git
git push -u origin main
```

The GitHub repo URL feeds both npm (`repository` field) and the MCP registry (namespace verification), so do this before publishing.

## 2. npm login & publish (the only registry-touching step)

```bash
npm login                 # opens browser, one-time 2FA
npm whoami                # sanity: your username

cd packages/schema-diff-engine && npm publish --access public && cd ../..
cd packages/schema-mcp    && npm publish --access public && cd ../..
```

Notes:

- `@nopilot/*` is a scope; `--access public` is required on first publish of scoped packages.
- The `@nopilot` org is already created; no org setup needed.
- Verification: `npm view @nopilot/schema-mcp version` should print `1.0.0`.
- Rollback within 72h: `npm unpublish @nopilot/schema-mcp@1.0.0 --force` (only if catastrophic; prefer a patch release).

## 3. Official MCP registry (github-verified, free)

Submitted through the `mcp-publisher` CLI using your GitHub identity:

```bash
npm install -g mcp-publisher@latest
mcp-publisher login          # GitHub OAuth device flow
```

The server description JSON is already prepared at `packages/schema-mcp/registry.json` (urls already point to `latbert/<repo>`). Then:

```bash
cd packages/schema-mcp
mcp-publisher publish registry.json
```

The CLI verifies the GitHub namespace (repo URL must match your GitHub account), then lists the server in the official registry. After ~15 minutes, search "schema" at <https://registry.modelcontextprotocol.io>.

## 4. Glama (automatic — nothing to do)

Glama continuously imports the **official MCP registry**; the server appears on `glama.ai/mcp/servers` within a day. Do not pay for the $49/mo promotion tier; the free organic listing is the point.

## 5. Post-publish checklist

- [ ] `npm view @nopilot/schema-diff-engine dist.tarball` downloads and contents match `publish:dry` output
- [ ] `npx @nopilot/schema-mcp --help` prints usage (global smoke test)
- [ ] registry.modelcontextprotocol.io lists `schema-mcp`
- [ ] Watch weekly downloads: `curl -s https://api.npmjs.org/downloads/point/last-week/@nopilot/schema-mcp`

## Kill criteria (from the project brief)

If after 4 weeks combined official-registry + Glama weekly visits < 100 and GitHub has zero issues/stars → stop maintaining, archive the repo. No sunk-cost nursing.
