# Figma integration (free plan)

**Design file:** [LV Design Suite — Design System](https://www.figma.com/design/QbuEPgIWcPo129tBQDwjhX) (Drafts of the project owner's Figma account)

## What was set up

| Page / asset | Contents |
|---|---|
| Variables · `Theme/Dark` | 23 colour tokens, the dark theme |
| Variables · `Theme/Light` | the same 23 names, light values |
| Variables · `Dimension` | spacing (4–24), radius (6/9/12), control heights (32/26), font sizes (11/12/13) |
| **Components** | Button (Default/Primary/Danger × Default/Disabled), Input (Default/Focus/Error/Disabled), Status badge (Pass/Warning/Fail), Tab, Nav item, Table cell |
| **Screens** | Voltage drop study, dark and light, at 1280 × 800 (illustrative data) |

Every Figma variable's **code syntax** is the real CSS name, e.g. `surface/panel` → `var(--panel)`. A designer inspecting any layer in Dev Mode or the Inspect panel sees the exact variable to use in `src/theme/tokens.css`.

## Free-plan limits (checked 21 Oct 2026)

| Item | Limit on Starter / View seat | Effect here |
|---|---|---|
| Figma MCP server, read tools (`get_design_context`, `get_screenshot`, `get_variable_defs`…) | Up to **20 calls per month** on Starter and on any View/Collab seat; a Figma staff reply in Sept 2026 cited 6, so treat the cap as moving | Use reads sparingly: one screenshot per review, not per tweak |
| MCP write tools (`use_figma`, creating files) | Exempt from that rate limit | Building and updating the file from code costs no quota |
| Variable modes | **1 mode per collection** on Starter | Dark and Light are two parallel collections instead of two modes |
| REST API, file reads (Tier 1) | Up to about 20 per month on View/Collab seats | Not used; MCP covers the workflow |
| Variables REST API | **Enterprise only** | Not available; tokens sync through MCP instead |
| Code Connect | Organization/Enterprise | Not available; the variable code syntax plus `DESIGN-SYSTEM.md` stand in for it |

Sources: [Figma MCP rate limits & access](https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/), [REST API rate limits](https://developers.figma.com/docs/rest-api/rate-limits), [Variables REST API](https://developers.figma.com/docs/rest-api/variables).

## Workflow

**Code is the source of truth.** Figma mirrors it for design review; it never overwrites it.

1. **Design a change.** Edit or duplicate a frame on *Screens* (free, unlimited edits in the Figma app). Use only the `Theme/*` and `Dimension` variables, so every colour maps to a CSS token.
2. **Hand it to code.** Share the frame link in a Claude session. One `get_design_context` or `get_screenshot` read (counts toward the monthly cap) is enough to implement it.
3. **Implement** against `src/theme/tokens.css` and the classes in `DESIGN-SYSTEM.md`. A Figma colour without a matching variable is a new token: add it to `tokens.css` first (both themes), then to both Figma collections.
4. **Sync back.** After a token change in code, have Claude update the Figma variables with `use_figma`. Writes are free.

### Adding a token (checklist)

- [ ] `src/theme/tokens.css`: in `:root` **and** `:root[data-theme="light"]`
- [ ] `src/theme/tokens.test.ts` still passes (it checks contrast and that every used variable is defined)
- [ ] Figma: same name in `Theme/Dark` **and** `Theme/Light`, scopes set, WEB code syntax `var(--name)`

## What you need to provide

Nothing further for the current setup. The Figma connector is authenticated through claude.ai (OAuth); no password or token was requested or stored, and none is in the repository.

Optional upgrades, **not** required and not paid for:

- A Figma **Professional** plan would allow a single Theme collection with Light/Dark modes and much higher MCP read limits. Not needed for this workflow.
- If a teammate designs in the file, share it with them from Figma (check the current Starter-plan file and editor limits first).
