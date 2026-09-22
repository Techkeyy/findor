# Convex All Gas Hackathon Log

Last updated: 2026-09-22 UTC

## Project

- **Project:** Findor
- **Event:** [Convex All Gas Hackathon](https://www.convex.dev/hackathons/all-gas)
- **What it does:** Turns an unclear local-service request into a reviewable brief, source-backed provider options, approved outreach, and truthful recovery state under human control.
- **Thesis:** Turn an unclear local-service need into a reviewable brief, source-backed provider options, approved outreach, and truthful recovery state.
- **Live app:** [laudable-fly-396.convex.site](https://laudable-fly-396.convex.site)
- **Repository:** [github.com/Techkeyy/findor](https://github.com/Techkeyy/findor)
- **Stack:** Convex control plane and static hosting, OpenAI Responses API, Firecrawl, and AgentMail.
- **Demo video:** [https://youtu.be/yz-MJlzX8-0](https://youtu.be/yz-MJlzX8-0) (2:05 / 125 seconds)
- **Submission:** Submitted to Vibe Apps with the demo video linked above.
- **Started:** 2026-09-12
- **Current owner state:** UAT paused at the external-action boundary

## Architecture and sponsor use

Convex is the application control plane: authenticated identity, ownership, schema, queries, mutations, server-side actions, realtime subscriptions, scheduled transitions, audit events, and static hosting.

Firecrawl runs from server-side Convex actions for bounded provider discovery and source inspection. AgentMail handles approved outbound messages, external receipt persistence, signed inbound webhooks, and thread-aware routing. OpenAI runs server-side through the Responses API to interpret untrusted provider text into strict structured facts. Findor validates that output again and fails closed when the model or transport cannot provide a safe result.

The user approves the brief and the external-action boundaries. Findor does not accept quotes, hire providers, pay, sign contracts, disclose a private address without approval, or materially change scope on the user's behalf.

## Official checklist

The official event requires a public repository, a root hackathon.md, a public app, real Convex use, relevant sponsor work, a public social post tagging the participating sponsors, and a final submission with a repository, live URL, and video under three minutes.

| Requirement | Evidence | Status |
| --- | --- | --- |
| Eligible build period | Repository build history begins on 2026-09-12; the event page lists the kickoff on 2026-08-25 | Confirmed |
| Public GitHub repository | github.com/Techkeyy/findor is public and uses main | Confirmed |
| Root hackathon.md | This file is committed at the repository root | Confirmed |
| Public Convex app | laudable-fly-396.convex.site is the deployed app | Confirmed |
| Convex backend | Auth, schema, queries, mutations, actions, realtime state, scheduling, and static hosting are in the runtime | Confirmed |
| Firecrawl integration | Bounded provider discovery and source evidence are implemented and have production evidence | Confirmed |
| AgentMail integration | Approved outbound receipt persistence and inbound webhook foundations are implemented and have production evidence | Confirmed |
| OpenAI integration | Server-only Responses API interpreter is deployed; bounded synthetic connectivity proof passed | Confirmed, genuine provider-reply UAT pending |
| Social post and sponsor tags | No post is claimed in this repository | Owner action required |
| Video under three minutes | [Submitted demo](https://youtu.be/yz-MJlzX8-0), 2:05 / 125 seconds | Confirmed |
| Final submission | Findor submitted to Vibe Apps with the public repository, live app, and demo linked above | Confirmed |

## Milestones

### 2026-09-12: generic product foundation

Findor was generalized from a narrow service flow into a category-neutral local-service engine. The authenticated workflow captures a natural-language request, structured location, timing, budget, a reviewable Job Brief, provider research, source evidence, and an outreach draft.

Initial Firecrawl checks were bounded. When the integration or contactability evidence was insufficient, the product stopped without fabricating a provider or email route. Website-only candidates stayed website-only.

### 2026-09-13: discovery, approval, and outbound evidence

Moving-service verification covered real bounded Firecrawl search, source URLs, contactability classification, and generic filtering. An approved outreach boundary was exercised through the normal UI, and the AgentMail acceptance was persisted only after external success. Refresh and reopen preserved the sent state.

The inbound foundation added signed webhook handling, thread mapping, duplicate protection, unmatched-event quarantine, attachment metadata, and safe clarification drafts that never send automatically. No provider reply was fabricated.

### 2026-09-14 to 2026-09-15: bounded autonomy and recovery

Mandate-triggered autonomy stores an approved provider cap and permissions for source-backed initial outreach, routine non-binding clarification, and at most one follow-up. Follow-up scheduling rechecks current state, ownership, pause or cancel state, revocation, and caps before any send. Bounded non-response recovery excludes prior providers, preserves original campaign history, and records truthful no-response or delivery-failure state.

These paths are implementation and deployment evidence. They have not been represented as owner UAT or as proof of a new live provider campaign.

### 2026-09-21: OpenAI provider-reply interpreter

The active reply interpreter moved to the official OpenAI JavaScript SDK and Responses API. Provider text remains untrusted data. Strict JSON Schema output is validated again by Findor. Missing configuration, refusal, timeout, API error, rate limit, or malformed output fails closed to review state.

A bounded synthetic connectivity call returned structured quote facts without touching a job, provider, Firecrawl, AgentMail, recovery, or live database record. No genuine provider reply has been used as UAT evidence.

## Verification

The current automated suite passes 206 tests across 11 files. Typecheck, lint, production build, bundle assertion, and whitespace validation pass. The code and public assets have also been checked for raw user-facing enum leaks, provider-specific runtime hardcoding, development URLs, secret-shaped values, retired-model runtime consumers, and stale assets.

No new Firecrawl search, AgentMail send, provider contact, provider follow-up, recovery run, genuine provider-reply processing, or social post is part of this repository cleanup. The completed Vibe Apps submission and its submitted demo link are recorded above.

## Evidence boundary

This log separates confirmed repository, deployment, and Vibe Apps submission evidence from remaining owner-controlled social-post work. It does not claim universal provider coverage, a genuine provider reply, or a social post until those artifacts exist and are linked.
