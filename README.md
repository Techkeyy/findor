# Findor

Autonomous local-service procurement with evidence-backed discovery, bounded outreach, and human control over consequential decisions.

**[Live app](https://laudable-fly-396.convex.site)** · **[Hackathon build log](hackathon.md)** · **Convex All Gas Hackathon**

**Demo video:** Pending owner publication. No placeholder link is claimed.

> “Who can actually do this job, what will it cost, and what happens if the first answer never arrives?”

Findor is for people who need a local job done and do not want to spend an afternoon searching, checking contact routes, writing the same inquiry repeatedly, and comparing incomplete replies. It turns an unclear request into a reviewable brief, source-backed provider options, approved outreach, and a truthful comparison state. The user remains in control of hiring, payment, contracts, and other consequential actions.

## What Findor does

1. **Captures** a natural-language local-service request, location, timing, budget, and context.
2. **Standardizes** the request into a Job Brief with structured requirements and explicit unknowns.
3. **Discovers** relevant providers through bounded Firecrawl search and source inspection.
4. **Qualifies** candidates by separating provider relevance, public evidence, and contactability.
5. **Coordinates** approved AgentMail outreach, inbound messages, bounded follow-ups, and recovery state.
6. **Interprets** provider replies with a server-only OpenAI Responses API path that returns validated structured facts.
7. **Protects** the decision boundary with Convex-owned authorization, state transitions, audit events, and deterministic fail-closed policy.

A provider can be relevant but website-only. A message can be drafted but not approved. An external send can fail. A reply can be incomplete or ambiguous. Findor keeps those states distinct instead of presenting every step as success.

## Why this exists

Existing search results answer “what pages mention this service?” They do not reliably answer “which provider is relevant to my request, does the public evidence expose a real contact route, was my message accepted, and what exactly did the provider say?” Findor focuses on the gap between a lead and a decision.

The product is category-neutral. A request such as replacing bathroom light fixtures in Brooklyn, New York uses the same core workflow as moving, cleaning, roofing, plumbing, HVAC, painting, landscaping, or handyman work. Provider availability and source quality still depend on the requested area and the live evidence returned by discovery.

## How it works

1. **Describe the job.** The user enters the outcome, service category, location, timing, budget, and useful context.
2. **Review the brief.** Findor identifies missing details and prepares a standardized Job Brief before provider research.
3. **Approve a bounded mandate.** The user chooses what Findor may research, contact, clarify, and follow up on.
4. **Find real providers.** Firecrawl supplies bounded search and source evidence. Directory pages and unsupported claims do not become providers automatically.
5. **Verify contactability.** Only a retrieved public business email can enter the email path. Website-only and phone-only candidates remain visibly blocked.
6. **Approve outreach.** Findor prepares the exact recipient, subject, and body. AgentMail sends only after the user-approved boundary is crossed.
7. **Receive and interpret.** Signed inbound messages are routed by identity and thread. OpenAI structures provider facts, while the original message remains the source material.
8. **Compare and decide.** Convex applies deterministic policy and keeps the user in charge of quotes, hiring, payment, scope, and commitments.
9. **Recover truthfully.** Pause, cancel, retry, follow-up, and bounded recovery paths preserve history and expose failed, waiting, skipped, and no-response outcomes.

## Human control

Findor never autonomously:

- accepts a quote;
- makes a booking;
- pays a deposit or invoice;
- signs a contract;
- hires a provider;
- reveals a private address without approval;
- materially changes the requested scope; or
- negotiates outside the boundaries the user approved.

AI interprets untrusted provider content. Convex authorization and deterministic policy decide what may be persisted or sent. A successful search or scheduled callback is never treated as proof that a provider was contacted, a quote is valid, or a commitment was authorized.

## Sponsor stack

| Sponsor | Real role in Findor | Boundary |
| --- | --- | --- |
| **Convex** | Authenticated state, schema, queries, mutations, actions, realtime subscriptions, scheduling, recovery, policy, audit events, and static hosting | Application source of truth and control plane |
| **Firecrawl** | Provider discovery and bounded source-page inspection with retained evidence | Discovery and evidence only |
| **AgentMail** | Approved outbound inquiries and follow-ups, external receipt persistence, signed inbound webhooks, and message threading | External communication after approval |
| **OpenAI** | Server-only interpretation of inbound provider text into strict structured procurement facts | Interpretation only, fail-closed on invalid output |

## Architecture

~~~mermaid
flowchart LR
    U[User] <--> UI[React and TypeScript UI]
    UI <--> C[Convex auth and application state]
    C --> F[Firecrawl discovery and source evidence]
    C --> A[AgentMail outbound and inbound messages]
    C --> O[OpenAI reply interpretation]
    C --> P[Deterministic policy and recovery]
    P --> C
    C --> UI
~~~

Convex owns the durable state and authenticated transitions. Firecrawl, AgentMail, and OpenAI are called from server-side Convex actions. External content remains untrusted input. Structured interpretation is validated again before it can affect the application state.

## A real product journey

A user can request a local repair, review a generated brief, inspect source-backed candidates, and approve a specific outreach draft. If no candidate exposes a usable public email, the workflow stops with that truth. If an approved external send is accepted, the receipt is persisted only after the external response. If no provider reply arrives, the UI shows waiting or no-response state rather than inventing a quote.

The current release includes verified production paths for generic intake, source-backed discovery, contactability separation, approved AgentMail outreach, inbound routing foundations, bounded recovery logic, and the server-only OpenAI interpreter. Genuine provider-reply UAT and owner acceptance of a new autonomous campaign remain paused.

## Global service areas

Findor stores structured country, region, city, locality, postal code, and address context when supplied. Search and validation use the user's location rather than forcing a US-only assumption. Findor-authored generic examples use neutral US-first values such as Brooklyn, New York and postal code 10001, while user-entered values such as Lagos, Nigeria remain unchanged.

Coverage is evidence-backed, not universal. Results depend on the requested service, location, public source quality, and whether a provider publishes a real contact route.

## Safety architecture

- Owner-scoped Convex reads and writes derive identity from authentication, not from a client-supplied owner ID.
- Provider relevance, source evidence, and contactability are separate facts.
- External email sends use an atomic claim and persist provider identifiers only after external success.
- Signed inbound events are checked, routed by thread identity, deduplicated, and quarantined when unmatched.
- Attachments and provider text are treated as untrusted data.
- OpenAI output is schema-constrained and validated again by Findor. Refusals, unavailable configuration, errors, timeouts, rate limits, and malformed output fail closed to review state.
- Recovery excludes prior providers, preserves original outreach history, enforces caps, and exposes failed or no-response states.

## Tech stack

- React 19, TypeScript 6, and Vite 8
- Convex 1.44 with Convex Auth and static hosting
- OpenAI SDK 7.20
- Firecrawl and AgentMail through server-side Convex actions
- Vitest, ESLint, and production bundle assertions

## Repository structure

- convex/: schema, auth, queries, mutations, actions, integrations, scheduling, and backend policy.
- src/: React UI, state presentation, formatters, error boundaries, and safe client actions.
- tests/: Convex and UI regression coverage for auth, outreach safety, recovery, provider quality, and authored copy.
- public/: active Findor logo, favicon, touch icon, and hero image.
- scripts/: production build and bundle assertions.
- hackathon.md: complementary build log and submission-readiness record.

## Local setup

Prerequisites are Node.js, npm, a Convex project, and credentials for any external integration you want to exercise.

~~~bash
npm install
Copy-Item .env.example .env.local
# Fill the environment names below, then:
npm run dev
~~~

For an offline validation path that does not contact providers or mutate production state:

~~~bash
npm test -- --run
~~~

The required environment variable names are:

- CONVEX_DEPLOYMENT
- VITE_CONVEX_URL
- FIRECRAWL_API_KEY
- AGENTMAIL_API_KEY
- AGENTMAIL_INBOX_ID
- AGENTMAIL_WEBHOOK_SECRET
- OPENAI_API_KEY

The values are intentionally absent from this repository. Do not commit .env files or credentials.

## Quality and adversarial checks

The current automated suite passes 206 tests across 11 files. The suite covers authenticated ownership, duplicate-send prevention, failed external sends, source-backed contactability, website-only and phone-only rejection, signed inbound routing, duplicate webhook handling, prompt-injection-resistant interpretation, malformed or unavailable OpenAI output, pause and cancel behavior, recovery bounds, and preservation of prior outreach history.

The release gates are:

~~~bash
npm test -- --run
npm run typecheck
npm run lint
npm run build:prod
npm run assert-bundle
git diff --check
~~~

The production build and bundle assertion target the configured production Convex host and reject development URLs and secret-shaped values in the shipped bundle.

## Production deployment

Production deployment is explicit:

~~~bash
npm run deploy:prod
~~~

This publishes the current frontend and Convex functions through the configured production target. Deployment itself does not trigger Firecrawl search, AgentMail send, provider outreach, recovery, or real provider-reply processing.

## Current limitations

- Owner UAT is paused at the external-action boundary.
- No genuine provider reply is claimed as current UAT evidence.
- Provider coverage depends on live public evidence and local business availability.
- A public social post, a recorded demo under three minutes, and the final hackathon submission still require owner action.
- Historical release artifacts are preserved in Git history; this cleanup does not rewrite history or force-push.

## Hackathon

Findor is built for the [Convex All Gas Hackathon](https://www.convex.dev/hackathons/all-gas). See [hackathon.md](hackathon.md) for the dated evidence log and submission checklist.

## License

Findor is released under the [Apache License 2.0](LICENSE.txt).
