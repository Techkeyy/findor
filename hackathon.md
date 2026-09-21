# Convex All Gas Hackathon Log

Last updated: 2026-09-21 UTC

## Project

- **Project:** Findor
- **Event:** [Convex All Gas Hackathon](https://www.convex.dev/hackathons/all-gas)
- **What it does:** A local-service procurement assistant that turns a natural-language request into a reviewable brief, evidence-backed provider discovery, approved outreach, and truthful recovery state.
- **Live app:** [laudable-fly-396.convex.site](https://laudable-fly-396.convex.site)
- **Repository:** [github.com/Techkeyy/findor](https://github.com/Techkeyy/findor)
- **Backend:** Convex database, auth, queries, mutations, actions, realtime state, scheduling, and static hosting
- **Sponsors in the runtime:** Convex, Firecrawl, AgentMail, and OpenAI
- **Started:** 2026-09-12T09:28:47Z
- **Current owner state:** UAT paused at the external-action boundary

## Official checklist

The official hackathon page describes a public repository, a root hackathon.md, a live public app, real Convex use, real sponsor work where applicable, a social post tagging the participating sponsors, and a submission that includes a repository, live URL, and video under three minutes.

| Requirement | Current evidence | Status |
| --- | --- | --- |
| Started during the eligible build window | Repository log records the first build work on 2026-09-12; the event page lists the kickoff on 2026-08-25 | Confirmed by repo and official page |
| Public GitHub repository | github.com/Techkeyy/findor is public and uses main | Confirmed |
| Root hackathon.md | This file is at the repository root | Confirmed |
| Public Convex site | laudable-fly-396.convex.site returns the live app | Confirmed |
| Convex backend | Auth, schema, queries, mutations, actions, realtime state, and scheduling are in the runtime | Confirmed by source and deployment |
| Firecrawl real work | Production discovery and bounded source-page evidence are recorded in the dated history | Confirmed by release evidence |
| AgentMail real work | Approved outbound receipt persistence and inbound webhook foundations are recorded in the dated history | Confirmed by release evidence |
| OpenAI real runtime path | Server-only Responses API interpreter is deployed; bounded synthetic connectivity proof passed | Confirmed; genuine provider reply UAT remains pending |
| Social post and sponsor tags | No public post is claimed in this repository | Owner action required |
| Video under three minutes | No placeholder or fabricated link is claimed | Owner action required |
| VibeApps or final submission | Not claimed | Owner action required |

## Build history

### 2026-09-12: generic product foundation

Findor was generalized from a narrow service flow into a category-neutral local-service engine. The authenticated workflow captures a natural-language request, service category, structured location, timing, budget, a reviewable brief, dynamic provider research, source evidence, and an outreach draft.

The first real Firecrawl checks were intentionally bounded. When the integration or contactability evidence was insufficient, the product stopped without fabricating a provider or an email route. Website-only candidates stayed website-only. The first real provider-search run also exposed the need for generic source-quality filtering rather than trusting publisher or comparison pages.

An atomic send claim was added before the AgentMail action so a repeated click cannot create parallel initial sends.

### 2026-09-13: real discovery, approval, and outbound evidence

The moving-service verification covered real Firecrawl search, bounded same-domain inspection, source URLs, contactability classification, and generic filtering. A correction removed publisher and comparison-marketplace false positives from the retained provider set.

The approved outreach boundary was exercised once through the normal authenticated UI. Findor showed the external AgentMail send as accepted and persisted the receipt only after the external success. Refresh and reopen preserved the sent state. No duplicate-send or failed-external-send fault injection was performed, so those live negative scenarios are not claimed.

The inbound foundation was then added: signed webhook handling, identity-checked message retrieval, thread-first routing, duplicate protection, unmatched-event quarantine, attachment metadata, and safe clarification drafts that never send automatically. No provider reply was fabricated.

### 2026-09-13: production release package

The authorized production package deployed the public Convex site and verified the production environment names without exposing values. A single production AgentMail webhook was migrated without duplicates, and an unsigned webhook request was rejected.

Fresh public UI verification covered authenticated generic intake, real discovery, bounded contact discovery, source-backed email evidence, non-email blocking, and pause, resume, and cancel controls. No new provider email, follow-up, clarification, booking, payment, quote acceptance, social post, or submission was claimed in this package.

### 2026-09-14: autonomy and recovery safeguards

The mandate-triggered autonomy boundary was implemented as an inert-capable production path. A job brief stores the approved provider cap and permissions for source-backed initial outreach, routine non-binding clarification, and at most one follow-up. Historical jobs without that mandate remain inert.

Follow-up scheduling was completed with a post-commit trigger, fresh state checks, ownership checks, cap enforcement, revocation checks, and durable planned, due, skipped, cancelled, sent, and failed outcomes. Recovery work preserves prior outreach history, reuses address-redacted research, applies generic provider-quality gates, and records truthful no-response or delivery-failure state.

No real Firecrawl search, AgentMail send, follow-up, provider reply, owner UAT, social post, or submission was performed during these implementation packages.

### 2026-09-15: bounded non-response recovery

The once-per-job recovery path was implemented and deployed for new mandate-approved campaigns. It runs only after an eligible no-response or delivery-failed state, within the approved provider cap, with no eligible retained provider left, and with an active mandate. The original campaign history is not opted in or mutated.

### 2026-09-21: OpenAI provider-reply interpreter

The active reply interpreter was moved to the official OpenAI JavaScript SDK and Responses API. Provider text remains untrusted data. Strict JSON Schema output is validated again by Findor before persistence. The interpreter is server-only, uses an explicit model, disables Responses storage, has no model fallback, and fails closed on missing configuration, timeout, API error, refusal, rate limit, or malformed output.

The contract suite covers normal quotes, declines, acknowledgements, ambiguity, exact-address questions, deposits, prompt injection, malformed output, unavailable OpenAI, and unchanged human-stop policy. A bounded synthetic connectivity call returned structured quote facts without touching a job, provider, Firecrawl, AgentMail, recovery, or live database record. No genuine provider reply has been used as UAT evidence.

## Current architecture evidence

- **Convex:** source of truth for schema, auth, ownership, realtime project state, outreach ledger, inbound transitions, recovery cycles, audit events, and scheduling.
- **Firecrawl:** server-side provider discovery and bounded source inspection; evidence is retained and provider quality is filtered before approval.
- **AgentMail:** approved outbound email, external receipt persistence, signed inbound webhook handling, and thread-aware message routing.
- **OpenAI:** server-only provider-reply interpretation into strict structured facts. Invalid or unsafe results become review state.
- **Frontend:** React and Vite static site with explicit state copy, no raw timing enum presentation, and active Findor logo and favicon assets.

## Final release posture

- Final automated suite: 206 tests across 11 files; typecheck, lint, production build, bundle assertion, and whitespace validation pass.
- Production code and assets have been audited for raw user-facing enum leaks, provider-specific runtime hardcoding, development URLs, secret-shaped values, retired-model runtime consumers, and unused old image assets.
- Generic authored examples use US-first neutral values. User-entered country, location, budget, currency, and provider data remain untouched.
- Local forensic exports and generated audit artifacts are ignored and are not part of the public repository.
- The public-safe Director handoff keeps the workflow contract and release decisions without owner identifiers, production record IDs, provider email addresses, or local filesystem paths.
- Owner UAT remains paused. No new provider contact or provider follow-up is part of this audit.
- Social publication, the short demo, and the final submission remain owner actions and are not implied by this log.

## Evidence boundary

This file distinguishes confirmed repository and deployment evidence from owner-controlled submission work. It does not claim universal provider coverage, a genuine provider reply, a social post, a video, or a completed hackathon submission until those artifacts exist and are linked by the owner.
