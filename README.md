# Findor

Evidence-backed local-service procurement with explicit approval and truthful external state.

**Try the live app:** [Findor on Convex](https://laudable-fly-396.convex.site)

**Demo video:** Pending owner publication. There is no placeholder video link.

**Sponsor stack:** Convex, Firecrawl, AgentMail, and OpenAI are used in the runtime.

## What Findor does

Findor turns a local service request into a controlled procurement workflow:

1. Capture the brief, location, timing, and budget.
2. Discover local providers with source evidence.
3. Separate eligible, contactable, and rejected candidates.
4. Let the user approve the exact providers and message before outreach.
5. Send through AgentMail only after approval and persist the external receipt.
6. Receive and quarantine inbound messages, then interpret provider replies into structured facts.
7. Keep failures, retries, recovery rounds, and next actions visible.

The product is designed for real-world ambiguity. A provider can be discovered but not contactable. A send can fail. A reply can be incomplete. Those states remain explicit instead of becoming a green success badge.

## Why it exists

Finding a local provider is easy to prototype and hard to make trustworthy. Search results can be aggregators, a website can lack a usable email route, and an outbound email can fail after the UI has changed. Findor focuses on the boundary between discovery and action: evidence, user approval, durable state, and honest recovery.

## Try a representative journey

A user can request a leaking pipe repair in Camden Town, London, review the source-backed candidates, approve a message, and see whether the approved outreach was accepted, failed, or awaiting a reply. The same structured location model supports places such as Brooklyn, New York and Lagos, Nigeria without replacing user-entered values with a default country.

The current release includes production evidence for real discovery and AgentMail outreach. OpenAI provider-reply interpretation is wired as a server-only, fail-closed path and has a bounded connectivity proof. A genuine provider reply interpreted through the live path remains owner-controlled UAT.

## Human control and safety

- The user controls the brief, provider selection, and final send approval.
- Website-only and phone-only candidates do not become fabricated email recipients.
- Provider identities are evidence-backed and generic. There is no provider-specific production shortcut.
- Tenant authorization is checked on protected data and transitions.
- Inbound messages are verified, deduplicated, quarantined when needed, and linked to the right outreach record.
- Recovery does not silently rewrite the original outreach history.
- User-entered locations, budgets, currencies, and provider data are preserved.

## Architecture

The browser is a React and Vite client. Convex is the application backend and source of truth. Public reads are bounded and authenticated writes flow through typed mutations or actions.

- **Convex database:** jobs, briefs, provider candidates, source evidence, outreach rows, receipts, inbound messages, recovery cycles, and audit events.
- **Convex auth:** authenticated user identity is derived server-side and ownership is enforced in backend functions.
- **Convex realtime:** queries drive the project state, outreach ledger, reply timeline, and recovery view.
- **Convex scheduling and workflows:** delayed follow-up and recovery work use persisted state and idempotent transitions.
- **Static hosting:** the production frontend is served from the public Convex site.

### Sponsor integrations

| Sponsor | Real work in Findor | Boundary |
| --- | --- | --- |
| Convex | Database, auth, reactive queries, mutations, actions, scheduling, inbound transitions, and recovery state | Application source of truth |
| Firecrawl | Server-side local discovery and bounded source-page inspection with evidence retention | Discovery only, never automatic approval |
| AgentMail | Approved outbound email, external receipt persistence, signed inbound webhook handling, and message threading | External communication after user approval |
| OpenAI | Server-only Responses API interpreter that converts provider reply text into strict structured facts | Interpretation only, fail-closed on invalid output |

## Global location support

Findor stores structured country, region, city, locality, postal code, and address context where available. Search and validation use the user's location rather than forcing a US-only assumption. Generic authored examples are US-first for clarity, but real user data remains unchanged. Provider coverage still depends on discovery quality and local business availability.

## Tech stack

- React 19 and Vite 8
- TypeScript 6
- Convex 1.44 with Convex Auth and static hosting
- OpenAI SDK 7.20
- Firecrawl and AgentMail integrations through server-side Convex actions
- Vitest, ESLint, and production bundle assertions

## Repository layout

- **convex/**: schema, auth, queries, mutations, actions, scheduling, integrations, and backend policy.
- **src/**: UI, state presentation, formatters, error boundaries, and safe client actions.
- **tests/**: Convex and UI regression coverage, including auth, outreach safety, recovery, provider quality, and copy guards.
- **public/**: active Findor logo, favicon, touch icon, and hero image.
- **scripts/**: release checks and bundle assertions.
- **hackathon.md**: dated build log and submission-readiness record.
- **MANUAL_UAT.md** and **PRODUCT_PROMISE_MATRIX.md**: owner-facing verification and contract references.

## Run locally

Prerequisites: Node.js, npm, a Convex project, and the required integration credentials for the path you want to exercise.

    npm install
    npm run dev

For a backend-only validation, use the Convex CLI with the project configured for your environment.

Required environment names are documented in **.env.example**:

- **CONVEX_DEPLOYMENT** or the standard Convex project configuration
- **FIRECRAWL_API_KEY** for real discovery
- **AGENTMAIL_API_KEY**, **AGENTMAIL_INBOX_ID**, and **AGENTMAIL_WEBHOOK_SECRET** for email flows
- **OPENAI_API_KEY** for provider-reply interpretation

Do not commit environment files or credentials. The application fails closed when an integration is unavailable.

## Quality gates

The release gates are:

    npm test
    npm run typecheck
    npm run lint
    npm run build:prod
    npm run assert-bundle
    git diff --check

The final audit also scans tracked files and the production bundle for secret-shaped values, development URLs, raw enum labels, provider-specific runtime hardcoding, retired-model consumers, and emoji or long-dash regressions in authored frontend copy.

The current automated suite passes 206 tests across 11 files. The production build and bundle assertion pass against the production Convex host.

## Production deployment

Production deployment is intentionally explicit:

    npm run deploy:prod

The deploy command publishes the current frontend and Convex functions through the configured production target. No provider outreach, Firecrawl search, AgentMail send, or real provider-reply processing is part of a release deployment.

## Current release constraints

- Owner UAT is paused at the external-action boundary.
- No new provider contacts are authorized as part of this repository audit.
- The current public app and repository are real release artifacts, but a short demo, social post, and final hackathon submission still require owner action.
- Provider coverage is evidence-backed rather than universal.

See [hackathon.md](hackathon.md) for the dated build record and [DIRECTOR.md](DIRECTOR.md) for the public-safe release handoff.

## License

Findor is released under the Apache License 2.0. See [LICENSE.txt](LICENSE.txt).
