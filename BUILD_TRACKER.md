# Findor build tracker

This file is the engineering truth for Findor. It records the locked product
scope, the evidence required to move between phases, and the difference between
implemented behavior and planned behavior.

Last reviewed: 2026-09-14
Current owner: Findor build team
Product: Findor
Supported scope: generic local-service procurement; roof replacement is the first live campaign
Hard implementation deadline: 3 days from product-build authorization
Hackathon submission deadline: 2026-09-22 at 12:00 PM PT, confirmed on the official Convex All Gas Hackathon page

## Current status

Phase 0 setup remains PASS. Day 1 is accepted PASS for the verified generic
intake -> authenticated Convex state -> real Firecrawl discovery ->
source-backed contactability -> approval -> real AgentMail send -> external
receipt identifiers -> truthful persisted UI chain. Day 2 inbound-reply work is
BUILDING: the signed AgentMail webhook, thread mapping, deduplication,
quarantine, attachment metadata path, optional interpretation layer, realtime
conversation UI, and deterministic safety suite are implemented and deployed.

The current live reply check is truthful and incomplete: the existing external
thread contains one message and no received timestamp, so the active Day 2
state is WAITING_FOR_EXTERNAL_REPLY. No new outbound message, follow-up,
clarification, booking, quote acceptance, scheduling, payment, or binding
commitment was created during Day 2 work. Day 3 is BUILDING with recovery/control UX, local verification, audit, and release preparation in progress.
Status vocabulary:

- NOT STARTED: no implementation evidence yet
- BUILDING: active work is in progress
- PARTIAL: some required evidence exists, but the phase gate is not complete
- BLOCKED: a specific blocker prevents safe progress
- PASS: the phase gate has been proven against its stated evidence

## Product-correction classification

The director clarified that Findor is a generic local-service procurement engine,
not a roofing-only product. The current implementation is classified as follows.

GENERIC ALREADY:

- Convex Auth, server-derived identity, tenant ownership checks, and parent-child authorization.
- Job ownership, status transitions, timestamps, indexed event history, approval gates, and persisted external state.
- Firecrawl and AgentMail are isolated behind server-side actions; website-only providers cannot enter the email path.
- The UI already expresses user review before provider research and user approval before outreach.

NEEDS SMALL REFACTOR (COMPLETED IN THIS CHANGE):

- Intake fields, brief fields, and UI labels need generic names and category-neutral copy.
- Firecrawl search construction needs to use service category, request details, and location.
- Outreach drafting needs to use the approved generic brief instead of roofing language.
- Documentation, tracker language, and hackathon history need to describe the generic engine while retaining roofing as the first live campaign.

ROOFING-COUPLED / MUST FIX (REMOVED FROM THE CORE PATH):

- The old jobs schema fields rawDescription, serviceArea, propertyType, timing, roofIssue, and knownDetails.
- Deterministic analysis that required a roof issue and generated a residential roof scope.
- UI copy that framed Findor as a homeowner roofing product.
- A hard-coded residential roof Firecrawl query and a roofing-specific email draft.

This refactor preserves the working generic authorization, persistence, evidence,
contactability, and approval boundaries; it does not reclassify those components
as failed merely because the product scope was corrected.
## Locked product contract

Findor is a local-service procurement engine for anyone getting a local job
done: moving, cleaning, roofing, electrical, plumbing, HVAC, painting,
landscaping, handyman work, or another local service. It moves an unclear
service need to truthful, comparable provider options by building a
standardized job brief, researching suitable providers, coordinating approved
email outreach, and interpreting replies and quote documents that arrive.

The core product journey is:

LAND -> SIGN UP -> DESCRIBE A LOCAL SERVICE NEED -> IDENTIFY MISSING INFORMATION
-> USER ANSWERS -> CREATE STANDARDIZED JOB BRIEF -> USER REVIEWS BRIEF ->
RESEARCH REAL PROVIDERS FOR THE CATEGORY AND LOCATION -> USER REVIEWS PROVIDERS
-> USER APPROVES OUTREACH -> SEND REAL EMAILS -> RECEIVE AND PERSIST REPLIES ->
FOLLOW UP WHEN APPROPRIATE -> RECEIVE EMAIL OR PDF QUOTES -> STORE ORIGINAL
MATERIAL -> EXTRACT STRUCTURED QUOTE DATA -> IDENTIFY MISSING OR UNCLEAR SCOPE
-> SEND SAFE CLARIFICATION QUESTIONS WHERE AUTHORIZED -> RECEIVE ANSWERS ->
UPDATE THE COMPARISON -> SHOW TRUTHFUL APPLES-TO-APPLES OPTIONS -> PAUSE,
CANCEL, OR COMPLETE -> RECOVER AFTER REFRESH OR RETURN.

The data model is generic: service category, natural-language description,
location, desired timing, optional budget or context, structured requirements,
brief, evidence, contactability, outreach, and external state. Category-specific
details belong in validated structured requirements, not in separate hard-coded
vertical implementations.

Safety boundaries:

- The user remains the decision maker for accepting a quote, hiring, payment,
  deposits, contracts, binding scheduling commitments, and material scope
  changes.
- AI may understand, extract, summarize, draft routine approved follow-ups,
  and request ordinary non-binding clarification.
- External websites, emails, PDFs, attachments, and provider content are
  untrusted data. Prompt injection in those sources never grants authority.
- Provider suitability and contactability are separate facts. The product will
  not pretend every discovered provider can be contacted by email.
- Verification means retained evidence, checked time where appropriate, result,
  and uncertainty. An AI interpretation alone never creates a verified claim.
- Quote fields must preserve included, excluded, not stated, and unclear as
  distinct states. Missing information must not silently become included or
  excluded.
## Locked architecture

| Product job | Locked implementation direction | Why it is load-bearing |
|---|---|---|
| User interface | React, TypeScript, Vite, Tailwind | The normal user must complete and observe the generic local-service workflow in a deployed UI. |
| Durable application state | Convex database, queries, mutations, realtime subscriptions | Jobs, approvals, threads, quotes, evidence, and recovery state must survive refresh and return. |
| Server-side work | Convex actions, scheduled functions, and HTTP actions | External API calls, webhook intake, follow-ups, and processing need server-side authority and durable triggers. |
| Authentication | Convex Auth | Each user must see and mutate only their own jobs and associated data. |
| Provider discovery | Firecrawl | Real provider discovery and evidence collection are required sponsor work. |
| Email transport | AgentMail | Real outbound messages, inbound replies, threads, and attachments are required sponsor work. |
| Language understanding | OpenAI | Job understanding, extraction, clarification drafting, and summaries require language interpretation. |
| File evidence | Convex file storage | Original emails, PDFs, and attachments must remain accessible as source material. |
| Public frontend host | Convex static hosting on convex.site | The final product must be reachable without a local builder terminal. |

No PostgreSQL, Supabase, Firebase, Redis, Express backend, VPS, Kubernetes,
Docker infrastructure, vector database, or separate mail server is approved
unless a real requirement is proven and the director approves it.

## Phase roadmap and gates

| Phase | Objective | Required evidence | Status |
|---|---|---|---|
| 0. Takeover and hackathon setup | Prove the machine and project baseline, install the official skill, initialize public-safe records | Isolated project Git repo, Node/npm/Git/Windows versions, Convex plugin enabled, active monitor call, CLI MCP entrypoint, official skill files read, hackathon.md, BUILD_TRACKER.md, secret-safe baseline | PASS |
| 1. Product foundation | Build the minimum authenticated generic local-service loop and standardized brief | New user can sign up, create a job, answer missing-information questions, generate a brief, and review it through the normal UI with persistent state | BUILDING |
| 2. Provider research | Discover real local-service providers and preserve evidence | Firecrawl-backed discovery returns providers for the requested category and location with contactability, source evidence, checked time, result, and uncertainty; no fabricated verification | BUILDING |
| 3. Approval and first outreach | Make user approval the gate for real email | User reviews providers, approves at least one, and the UI causes a real AgentMail email to an external destination; delivery state is persisted | BUILDING |
| 4. Inbound email loop | Receive and persist replies safely | Signed webhook, deterministic thread mapping, duplicate webhook handling, reply state changes, follow-up cancellation, and attachment persistence are proven with a real external reply | NOT STARTED |
| 5. Quote interpretation | Turn email and documents into truthful structured options | Original source remains accessible; OpenAI extraction writes versioned quote data; missing, excluded, not stated, and unclear remain distinct | NOT STARTED |
| 6. Clarification and comparison | Close safe information gaps and compare like with like | Authorized non-binding clarification loop, deterministic comparison logic, live UI updates, and transparent uncertainty are proven | NOT STARTED |
| 7. Recovery and release | Make the product safe to return to and ship | Pause, resume, cancel, retry, duplicate protection, refresh/reconnect, tenant isolation, loading/error/empty UX, responsive basics, and security checks pass | NOT STARTED |
| 8. Deployment and UAT | Prove the product outside the builder machine | Public convex.site deployment, production integration checks, manual UAT on a fresh user journey, README, hackathon log, and demo evidence are complete | NOT STARTED |

## Three-day execution schedule

### Day 1: foundation and first real outreach

Target result: a normal user can create a real local-service job, receive a
useful standardized brief, see real provider candidates for that category and
location, approve at least one, and cause a real email to be sent to an
external destination. Roof replacement remains the first live campaign for
convenient end-to-end testing, but the architecture and UI are generic.

Priority order:

1. Product contract, journey, data model, and state vocabulary.
2. Convex app foundation and authentication.
3. Generic natural-language intake and job creation.
4. Missing-information loop and standardized job brief.
5. Dynamic Firecrawl discovery and evidence-backed provider qualification.
6. Provider review and explicit outreach approval.
7. AgentMail outbound send with persisted delivery status.
8. Start the first real local-service provider campaign as early as safe; do
   not make the software deadline depend on replies arriving.

Kill gate: if real outbound email is not proven by the end of Day 1, treat it
as a critical blocker. Stop cosmetic work and root-cause the failure.
### Day 2: core Findor loop

Target result: a real external reply and a quote-like document can travel from
AgentMail through Convex processing into a truthful comparison UI.

Priority order:

1. Signed inbound webhook and stable thread mapping.
2. Duplicate webhook protection and follow-up scheduling/cancellation.
3. Attachment persistence for required PDF and image cases.
4. OpenAI structured extraction with source linkage and quote versioning.
5. Missing versus excluded logic and apples-to-apples comparison.
6. Authorized clarification questions and reply ingestion.
7. Live Convex UI state updates and regression tests.

Kill gate: prove REAL external reply -> AgentMail -> Convex -> processing -> UI
and REAL quote-like email or document -> ingestion -> extraction -> comparison.

### Day 3: completion and production

Priority order:

1. Pause, resume, cancel, safe retry, duplicate protection, and state recovery.
2. Refresh/reconnect and returning-user behavior.
3. Truthful terminal states and full loading, empty, success, and error UX.
4. Responsive and accessibility basics.
5. Security audit, tenant isolation, secret scan, cost controls, rate controls,
   and dependency review.
6. Production convex.site deployment and production integration verification.
7. Public repository preparation, README, current hackathon.md, and evidence.
8. Real human UAT and demo preparation.

## Core feature completion matrix

`COMPONENT PROVEN` means an isolated implementation check passed. `INTEGRATION
PROVEN` means the real external path passed. `UAT READY`, `UAT PASS`, `RELEASE
READY`, `SUBMISSION READY`, and `FINISHED` are progressively stronger states.
They are not interchangeable.

| Feature | UI | Backend | Real integration | Production | Recovery | Manual test | Final status |
|---|---|---|---|---|---|---|---|
| Landing and first-use explanation | COMPONENT PROVEN | N/A | N/A | NOT STARTED | PARTIAL | PENDING | PARTIAL |
| Sign up and tenant isolation | COMPONENT PROVEN | COMPONENT PROVEN | PENDING | NOT STARTED | PARTIAL | PENDING | PARTIAL |
| Create generic local-service job | COMPONENT PROVEN | COMPONENT PROVEN | N/A | NOT STARTED | PARTIAL | PASS (normal UI) | PARTIAL |
| Missing-information questions | COMPONENT PROVEN | COMPONENT PROVEN | N/A (deterministic foundation; OpenAI planned) | NOT STARTED | PARTIAL | PASS (normal UI path had no missing fields after complete intake) | PARTIAL |
| Standardized Job Brief | COMPONENT PROVEN | COMPONENT PROVEN | N/A (deterministic foundation; OpenAI planned) | NOT STARTED | PARTIAL | PASS (normal UI) | PARTIAL |
| Provider discovery and evidence | COMPONENT PROVEN | COMPONENT PROVEN | INTEGRATION PROVEN (real bounded Firecrawl response and retained evidence) | NOT STARTED | PARTIAL | PASS (normal UI; 2 relevant provider pages, both website_only) | PARTIAL |
| Provider review and approval | COMPONENT PROVEN | COMPONENT PROVEN | N/A (no email-backed candidate available) | NOT STARTED | PARTIAL | PASS (normal UI; website_only providers correctly blocked) | PARTIAL |
| Real outbound email | COMPONENT PROVEN | COMPONENT PROVEN | PENDING: explicit send boundary not exercised | NOT STARTED | PARTIAL | PENDING (no source-backed recipient; send intentionally not attempted) | PENDING |
| Inbound reply and thread persistence | NOT STARTED | NOT STARTED | AgentMail planned | NOT STARTED | NOT STARTED | NOT STARTED | NOT STARTED |
| Follow-up scheduling and cancellation | NOT STARTED | NOT STARTED | AgentMail planned | NOT STARTED | NOT STARTED | NOT STARTED | NOT STARTED |
| Original email, PDF, and image storage | NOT STARTED | NOT STARTED | AgentMail planned | NOT STARTED | NOT STARTED | NOT STARTED | NOT STARTED |
| Structured quote extraction | NOT STARTED | NOT STARTED | OpenAI planned | NOT STARTED | NOT STARTED | NOT STARTED | NOT STARTED |
| Quote versioning and source evidence | NOT STARTED | NOT STARTED | N/A | NOT STARTED | NOT STARTED | NOT STARTED | NOT STARTED |
| Missing versus excluded scope | NOT STARTED | NOT STARTED | N/A | NOT STARTED | NOT STARTED | NOT STARTED | NOT STARTED |
| Authorized clarification loop | NOT STARTED | NOT STARTED | AgentMail and OpenAI planned | NOT STARTED | NOT STARTED | NOT STARTED | NOT STARTED |
| Apples-to-apples comparison | NOT STARTED | NOT STARTED | N/A | NOT STARTED | NOT STARTED | NOT STARTED | NOT STARTED |
| Pause, resume, cancel, complete | NOT STARTED | NOT STARTED | N/A | NOT STARTED | NOT STARTED | NOT STARTED | NOT STARTED |
| Refresh, reconnect, and returning user | NOT STARTED | NOT STARTED | N/A | NOT STARTED | NOT STARTED | NOT STARTED | NOT STARTED |
| convex.site deployment | NOT STARTED | NOT STARTED | Convex planned | NOT STARTED | NOT STARTED | NOT STARTED | NOT STARTED |

## Evidence and verification rules

Every meaningful milestone must report:

- OBJECTIVE
- AUTHORITATIVE CURRENT STATE
- WORK COMPLETED
- REAL EVIDENCE
- TESTS
- REAL OR MOCK DISTINCTION
- LOCAL OR PRODUCTION DISTINCTION
- SECURITY IMPACT
- KNOWN LIMITATIONS
- BLOCKERS
- WHAT REMAINS
- BUILD_TRACKER STATUS
- HACKATHON.MD STATUS
- NEXT RECOMMENDED PHASE

External integrations need doctor-style checks that connect, inspect the real
response shape, and verify the side effect. Exit code alone is not evidence.
Fixtures are allowed for isolated tests and offline demos, but they must be
labelled as fixtures and cannot be reported as real integration proof.

When something breaks, use this sequence:

REPRODUCE -> OBSERVE -> FORM HYPOTHESIS -> COLLECT EVIDENCE -> IDENTIFY ROOT
CAUSE -> APPLY THE SMALLEST CORRECT FIX -> RE-TEST THE ORIGINAL FAILURE -> RUN
REGRESSION CHECK.

## Scope cuts

Must have:

- One generic local-service workflow from job creation through comparable quote options; roof replacement is the first live campaign.
- Convex persistence, realtime updates, auth, and server-side actions.
- Firecrawl-backed provider research with category-aware evidence and contactability status.
- AgentMail real outbound and inbound paths with thread and attachment state.
- OpenAI interpretation and extraction with human approval boundaries.
- Original source material and truthful quote-field states.
- Pause, cancel, retry, refresh recovery, and tenant isolation.
- Deployed convex.site app with manual UAT evidence.

Useful next:

- Deeper category-specific intake hints stored in structured requirements,
  richer provider ranking, additional document formats, more nuanced follow-up
  timing, and improved comparison explanations.

Future:

- Autonomous hiring, payments, deposits, contracts, or binding scheduling.
- Phone-first or contact-form automation.
- Broad marketplace features, contractor ratings, financing, or insurance
  workflows.
## Day 1 evidence record

OBJECTIVE: Build the first authenticated generic local-service workflow and wire
the real provider research and outreach boundaries.

AUTHORITATIVE CURRENT STATE: Day 1 foundation is PARTIAL on the real Convex
development deployment. The normal UI path has passed ordinary sign-up, generic
intake, standardized brief approval, and real Firecrawl discovery. The live
discovery result retained two relevant local provider pages with source
evidence, but both were website_only. No truthful email recipient or draft was
available, so the run stopped before AgentMail.

WORK COMPLETED: Replaced the starter demo with Convex Auth, tenant-scoped
generic local-service jobs, deterministic missing-detail analysis, a
standardized brief with structured context and explicit unknowns, user approval,
indexed job events, dynamic bounded Firecrawl search wiring, generic provider
source-quality filtering, retained evidence rendering, AgentMail draft/send
wiring, an atomic send claim, external receipt persistence, and failure
recovery.

REAL EVIDENCE:

 npx convex dev --once completed successfully against the personal
  development Convex deployment after the generic provider-source
  filter and evidence UI update.
- npm run typecheck, npm run lint, and npm run build completed successfully.
  Vite emitted its existing future config-loader warning about __dirname in
  vite.config.ts; the build still completed.
- npx convex env list --names-only returned the expected integration and auth
  variable names. Secret values were never read or displayed.
- A real Kane browser run completed with result code 100: an ordinary user used
  the visible sign-up flow, created one generic roof-replacement campaign for
  Austin, TX with the approved disclosed test details, reviewed and approved the
  standardized Job Brief, clicked Find local providers, and waited for the
  real result page.
- The product invoked the real Firecrawl v2/search action with the approved
  bounded request. The response produced two retained provider candidates:
  - Aurum Roofing — source URL:
    https://aurumroofing.com/
    Evidence claim shown in Findor: “Aurum Roofing provides expert roof repair,
    replacement, and installation in Central Texas. Trusted craftsmanship,
    strong warranties, and free estimates!”
    Contactability: website_only; no public business email was found in the
    retrieved source evidence.
  - Altitude Roofing — source URL:
    https://altituderoofs.com/services/residential-roof-repair-in-austin-tx/
    Evidence claim shown in Findor: “# Roof Repair inAustin, TX ## Residential
    Roof Repair Services We Provide in Austin ### Emergency Roof Repair Active
    leaks don't wait for a convenient appointment. ## Most Common Roof Leak
    Sources We See in Austin ### Improper previous repairs We find this
    regularly.”
    Contactability: website_only; no public business email was found in the
    retrieved source evidence.
- The run recorded candidateCount=2 and websiteOnlyCount=2. No provider was
  approved, no outreach draft was generated, and the normal UI did not invoke
  AgentMail.
- No public business email, AgentMail message_id, AgentMail thread_id,
  external receipt, or persisted successful-send state exists from this gate.
- The browser evidence also confirmed website-only providers display the
  truthful boundary that Findor will not guess a contact address.

REAL OR MOCK DISTINCTION: Authentication, intake, brief approval, the Firecrawl
action, the returned provider pages, their source URLs and evidence claims, the
website-only classifications, and the empty-draft outcome are real. No fixture
provider candidates, guessed email, fake delivery receipt, or simulated
external email was presented as real.

LOCAL OR PRODUCTION DISTINCTION: The backend update and live integration run
used the personal Convex development deployment and a local frontend preview.
The public convex.site frontend and production
deployment are not deployed.

SECURITY IMPACT: Ownership is derived server-side with Convex Auth. Public
queries validate authenticated ownership and parent job ownership. Provider
content is treated as evidence, contactability is separate from suitability,
non-provider source types are filtered generically, website-only providers
cannot be approved for automated email, and the AgentMail send action requires
an approved draft plus an atomic send claim. The disclosed Firecrawl request
did not include an exact residential address or additional personal
information.

KNOWN LIMITATIONS: The live request returned no source-backed public business
email, so provider approval and draft preparation could not truthfully proceed.
AgentMail send, external identifiers, receipt visibility, duplicate-send retry,
failed-send UI, unauthenticated outreach, cross-user isolation tests, and the
website-only automated-email rejection test remain outstanding for the Day 1
kill gate. The deterministic brief is the Day 1 foundation; OpenAI extraction
and quote interpretation are not wired. Inbound AgentMail webhooks, thread
mapping, attachments, quote extraction, comparison, pause/resume, and
production deployment remain future phases.

BLOCKERS: The immediate discovery credential blocker is cleared for the
personal dev deployment, and real Firecrawl discovery is proven. The remaining
Day 1 blocker is the absence of a source-backed public business email in the
bounded retrieved provider evidence; without a truthful recipient, the
explicit AgentMail approval boundary cannot safely be crossed.

WHAT REMAINS: If a later approved discovery result provides a public business
email supported by retrieved evidence, review the exact recipient and draft,
explicitly approve Send this email in the normal UI, send through real
AgentMail, verify returned message_id and thread_id, verify persistence only
after successful send, verify truthful UI state and external sent/received
visibility, and run duplicate/auth/ownership/website_only safeguards.

BUILD_TRACKER STATUS: Phase 1 BUILDING with normal UI evidence; Phase 2
provider discovery is INTEGRATION PROVEN for real Firecrawl and source
evidence but remains PARTIAL because no contactable candidate was available;
Phase 3 remains PENDING before real outbound.

HACKATHON.MD STATUS: Updated with the real Firecrawl discovery milestone and
the truthful no-contactable-provider boundary.

NEXT RECOMMENDED PHASE: Director review of the two real source-backed
website-only candidates and the no-email outcome. Do not mark Day 1 PASS and do
not start Day 2 until real AgentMail delivery and its external identifiers are
proven.
## Phase boundary

Phase 0 setup and evidence are complete. Day 1 implementation is authorized and
partially built. Real Firecrawl discovery and source evidence are now verified,
but the external kill gate remains open until a source-backed recipient and real
AgentMail delivery are verified. This tracker must not claim
provider verification, email delivery, inbound replies, quote extraction,
comparison, production deployment, or submission readiness before their stated
evidence exists.
## Latest live verification update (2026-09-12)

This section supersedes the earlier Day 1 evidence paragraph where it says that
both roofing candidates were website_only and that no source-backed public
business email was available. It does not mark Day 1 PASS.

### Moving generic-product proof

AUTHORITATIVE CURRENT STATE: The normal Findor UI completed a fresh ordinary-user
Moving run using the approved request. The user entered category `Moving`,
request name `Apartment move`, description `I need movers for a two-bedroom
apartment move in Austin, TX next week.`, location `Austin, TX`, timing `Next
week`, and the estimate/inclusions context. No exact residential address was
entered. The standardized brief was approved once, real Firecrawl discovery
was invoked, and bounded same-domain contact discovery was invoked. No provider
was approved, no draft was prepared, and no AgentMail action occurred.

STRUCTURED REQUIREMENTS SHOWN IN THE GENERIC BRIEF:

- Requested outcome: the submitted two-bedroom Austin apartment move request.
- Category: Moving.
- Location: Austin, TX.
- Timing: Next week.
- User-provided context: provide a comparable written estimate and state what
  packing, loading, transport, unloading, insurance, and extra fees are
  included or not included.
- Still to confirm: exact scope, quantities, or measurements; access, materials,
  preparation, or disposal requirements; provider availability and final
  estimate details.

The same generic intake, review, research, evidence, and contactability UI
rendered these fields. No Moving-specific page, schema, or action was added.
Category-specific information remained in the generic structured requirements
and user-provided context fields.

LIVE FIRECRAWL RESULT AS DISPLAYED BY FINDOR:

- The completed UI summary showed `5 provider domain(s) across 10 public
  page(s): 0 public email route(s) found, 5 unresolved provider(s), 0 failed`.
- `Local Moving in Austin, TX - Fast Service - Mountain Movers` — direct
  provider-looking result; primary source URL:
  https://www.mountainmoversatx.com/local-moving-austin
  The displayed claim began `Local Moving in Austin, TX, Fast, Reliable
  Moving Services Near You` and described Mountain Movers as a local moving
  service. Contactability remained `website_only`. The displayed bounded
  sources included:
  https://www.mountainmoversatx.com/,
  https://www.mountainmoversatx.com/moving-and-storage-service-round-rock/moving-estimate-round-rock,
  https://www.mountainmoversatx.com/moving-quote, and
  https://www.mountainmoversatx.com/piano-moving-service-austin/piano-moving-quotes-austin.
- `Last-Minute Movers in Austin, TX | Same-Day Crews` — direct
  provider-looking result for Undergrads Moving; displayed evidence described
  dispatching licensed and trained movers across Austin and gave a two-bedroom
  estimate range. Contactability remained `website_only`. Displayed sources
  included https://undergrads.com/, https://undergrads.com/quote,
  https://undergrads.com/truck-guide,
  https://undergrads.com/movers-san-antonio-tx, and
  https://undergrads.com/movers-knoxville-tn.
- `Best Moving Companies in Austin, Texas - Forbes` — retained by the live
  deployed filter but is a publisher/comparison page, not a local provider.
  Primary source URL:
  https://www.forbes.com/advisor/homeowners-insurance/moving-services/moving-companies-austin-tx/
  It must not be treated as an outreach candidate. Its contactability remained
  `website_only` and contact discovery made no contactability claim.
- `Hire & Compare Top Local Movers in Austin, TX | HireAHelper` — retained by
  the live deployed filter but is a comparison marketplace, not a single local
  provider. Primary source URL:
  https://www.hireahelper.com/movers/austin_tx/
  It must not be treated as an outreach candidate. Its contactability remained
  `website_only` and contact discovery found no public email route.
- `Movers in North Austin, TX | TWO MEN AND A TRUCK` — direct provider-looking
  result; primary source URL:
  https://twomenandatruck.com/movers/tx/austin/north
  Displayed evidence identified North Austin movers and a professional moving
  service. Contactability remained `website_only`. Displayed sources included
  https://twomenandatruck.com/, https://twomenandatruck.com/contact,
  https://twomenandatruck.com/starting-a-moving-quote,
  https://twomenandatruck.com/move-process, and
  https://twomenandatruck.com/movers/mn/rochester/reviews.

The Moving live run therefore proved real search, evidence retention, and
bounded same-domain lookup, but it did not satisfy the stricter requirement
that every retained card be a genuine local provider. A generic host filter
correction for `forbes.com` and `hireahelper.com` is staged locally in
`convex/providerResearch.ts`; publishing that code to the development Convex
deployment was
not performed because the current verification authorization did not explicitly
authorize a new code deployment. The live deployed result must remain recorded
as a partial failure, not silently reclassified as passing.

### Roofing contact-evidence recovery

- Provider: Altitude Roofing.
- Service/location evidence source:
  https://altituderoofs.com/services/residential-roof-repair-in-austin-tx/
  The displayed claim described residential roof repair in Austin, including
  recurring leak sources.
- Public business email: `[recipient redacted for public repository]`.
- Exact source URL supporting the email:
  https://altituderoofs.com/
- Exact displayed evidence: `Public business contact:
  [recipient redacted for public repository] appears in retrieved Firecrawl Markdown:` followed by
  the public Contact Us content naming Altitude Roofing LLC, the Austin business
  address, phone number, and a mailto link for `[recipient redacted for public repository]`.
- Checked timestamp shown in the normal UI: 2026-09-12 11:52:45 PM.
- Aurum Roofing remained `website_only`; its bounded contact check found no
  public business email.
- No roofing provider was approved, no outreach draft was prepared, and no
  AgentMail message_id or thread_id exists from this work package.

### Updated phase status

- Phase 1 foundation: BUILDING; generic intake, brief approval, and ownership
  boundaries are proven in the normal UI.
- Phase 2 provider research: PARTIAL. Real Firecrawl Search, source evidence,
  contactability, same-domain Map/Scrape bounds, and truthful unresolved states
  are proven. The deployed generic filter still needs the publisher/marketplace
  correction and a rerun.
- Phase 3 approval/first outreach: PENDING. A source-backed roofing recipient
  now exists, but the user explicitly authorized no AgentMail send in this
  package. No message_id, thread_id, successful-send persistence, or external
  receipt is claimed.
- Day 1 kill gate: NOT PASS. Do not begin Day 2.

REAL OR MOCK DISTINCTION: Moving and roofing UI runs, Firecrawl responses,
source URLs, displayed claims, bounded contact checks, and the Altitude source
email evidence were real. No mock Firecrawl result, inferred address, fake
AgentMail receipt, or AgentMail send was used.

NEXT REQUIRED REVIEW: Explicitly authorize deployment of the already-staged
generic host-filter correction if desired, rerun the Moving request through the
normal UI, and then conduct the separate director-approved recipient/draft
review before any AgentMail send. The current work package stops before send.
## Post-review draft-gate update (2026-09-13)

DIRECTOR-REVIEWED STATE: The generic provider-quality correction remains limited
to the generic publisher/comparison-marketplace host filter in
`convex/providerResearch.ts`. Local typecheck, lint, and build pass, and the
focused inspection found no secret values or unrelated behavior in the change.
The requested Convex deployment command was attempted but the deployment guard
requires the authorization to be present in a direct user message rather than
only in pasted attachment content. No new backend deployment or corrected
Moving rerun is therefore claimed yet.

ALTITUDE DRAFT GATE: Through the normal Findor UI, the accepted Altitude Roofing
candidate was approved by an authenticated ordinary user and an outreach draft
was persisted. The draft remains unsent. Findor currently persists and sends a
plain-text body only; HTML body support is not implemented. No AgentMail call,
message identifier, thread identifier, or external receipt exists.

OUTBOUND SAFETY EVIDENCE:

- Fresh unauthenticated UI: passed. Only the auth screen was available; no
  provider approval, outreach draft, send, retry, or AgentMail control appeared.
- Website-only provider boundary: passed in the real Moving UI run. Website-only
  cards showed no approval button and displayed the manual-review boundary.
- Authenticated provider approval, candidate ownership, parent-job ownership,
  and authenticated send entry: source-backed checks passed in
  `convex/outreach.ts`.
- Website-only approval rejection: source-backed check passed; approval requires
  a candidate-owned published contact email.
- Initial-send claim: source-backed check passed. Only `approved` or `failed`
  messages may claim; claiming changes the message to `sending`, so a second
  concurrent claim cannot reuse the same approved state under Convex mutation
  serialization.
- Successful receipt persistence: source-backed check passed. external message
  and thread identifiers are written only by the `markSent` path after a
  `sending` message is validated.
- Dynamic User A/User B and concurrent double-click execution were not run
  against a dedicated test harness because the repository has no runnable test
  suite. The ownership and claim guards remain source-proven, not dynamically
  stress-tested.

DAY 1 STATUS: Still NOT PASS. The next safe step is direct authorization to
publish the already-inspected generic filter correction, rerun Moving, and then
obtain separate explicit authorization before any real AgentMail send.
## Post-deployment Moving verification (2026-09-13)

DEPLOYMENT: The inspected generic publisher/comparison-marketplace filter was
deployed successfully to the personal Convex development deployment
reported that functions were ready. Post-deployment
typecheck, lint, and build passed.

CORRECTED MOVING RUN: The normal UI rerun retained three legitimate provider-
looking businesses and removed both previously observed non-provider cards:
Forbes and HireAHelper. The retained cards were Mountain Movers, Undergrads
Moving, and TWO MEN AND A TRUCK. Their primary source URLs and evidence claims
remained visible. Bounded contact discovery completed with 0 public email
routes, 3 unresolved providers, and 0 failed provider checks. No provider was
approved and no Moving outreach was prepared.

SEND BOUNDARY: The authorized Altitude draft remains persisted and ready, but
the real AgentMail send was blocked before browser execution because the send
authorization was available only in pasted attachment content rather than a
direct user message. No external request, message identifier, thread identifier,
or external receipt was created. Day 1 remains NOT PASS pending direct send
authorization and the single normal-UI send plus receipt verification.
## Day 1 final external-send verification — 2026-09-13

- One authorized real AgentMail send completed through the normal authenticated Findor UI for the previously approved Altitude Roofing outreach.
- The send control was clicked exactly once; no retry or second send was performed. Findor displayed `Sent` / `External email accepted` and real non-empty external `message_id` and `thread_id` values.
- The send path verified that the external identifiers were returned before Findor persisted the successful state. Refresh and reopen preserved the recipient, subject, body, sent status, and external identifiers without sending again.
- Authorized recipient: `[recipient redacted for public repository]`; subject: `Roof replacement inquiry`.
- Source evidence remained attached to the selected provider: service/location source `https://altituderoofs.com/services/residential-roof-repair-in-austin-tx/`; public email source `https://altituderoofs.com/`; retrieved evidence presents the address as a public business `mailto:` contact route for Altitude Roofing LLC.
- Day 1 kill gate: PASS for the completed generic intake → authenticated Convex state → real Firecrawl discovery → source-backed contactability → approval → real AgentMail send → external receipt identifiers → persisted truthful UI chain. Negative-gate evidence recorded earlier remains: unauthenticated outreach controls unavailable; website-only providers blocked from automated email; no duplicate send after refresh/reopen.
- Stop point: no Day 2 external or irreversible action started; awaiting director review.
- Adversarial-test qualification: the unauthenticated UI check and website-only automated-email boundary check passed earlier. This exact-one-send authorization did not permit a literal double-click duplicate attempt or a fault-injected failed external send, and dynamic User A/B isolation plus concurrency stress were not runnable without a test harness. Those cases are not claimed as live-complete; the ownership/claim/FAILED-state protections remain source-reviewed.

## Day 2 inbound-reply implementation — 2026-09-13

OBJECTIVE: Implement the generic inbound-reply foundation after Day 1 PASS, with one passive AgentMail message.received webhook and no new outbound communication.

AUTHORITATIVE CURRENT STATE: The inbound infrastructure is deployed to the personal Convex development deployment. The deployed HTTP Action is POST /agentmail/webhook, and the AgentMail configuration has exactly one enabled webhook for exactly one existing inbox, subscribed only to message.received. The route rejects an unsigned request with HTTP 401. A read-only check of the existing Day 1 external thread found one message and no received timestamp, so the truthful status is WAITING_FOR_EXTERNAL_REPLY; Day 2 is not PASS.

WORK COMPLETED:

- Added generic inbound message, attachment metadata, provider-response, and clarification-draft tables with ownership links and bounded indexes (convex/schema.ts).
- Added raw-body Svix verification with a five-minute replay window, fail-closed signature handling, inbox scoping, event-type filtering, thread-first mapping, duplicate protection by Svix ID and external message ID, unmatched-thread quarantine, and identity-checked full AgentMail message retrieval before persistence (convex/inboundParsing.ts, convex/inbound.ts, convex/http.ts).
- Added realtime conversation and comparison UI. Original provider text is displayed as escaped text; attachments remain metadata-only until an authenticated user requests safe retrieval into Convex storage. No external file is executed.
- Added optional OpenAI Structured Outputs processing with source-grounded prompt-injection resistance and distinct included, excluded, not-stated, and unclear fields. If the optional interpreter key is unavailable, the message remains visible in a truthful needs-review state.
- Added durable clarification suggestions as drafts only. No clarification or follow-up is sent automatically.
- Registered exactly one real AgentMail inbound webhook to the deployed Findor endpoint. No new AgentMail outbound message was created during Day 2 work.

REAL EVIDENCE:

- Convex deploy completed successfully and functions were ready at the personal development target.
- The exact webhook inspection returned one matching enabled subscription, one inbox scope, one event type, and message.received as that event type.
- AGENTMAIL_WEBHOOK_SECRET is configured non-empty; secret values were never printed, copied to a file, or reported.
- The deployed endpoint returned HTTP 401 for an unsigned synthetic POST.
- The existing external thread was found read-only with message count one and no received timestamp. No inbound reply has been observed.
- npm test: 9 deterministic tests passed. Fixtures cover malformed and unsupported events, real-shaped message parsing, attachment metadata, valid/altered/missing/stale Svix signatures, response kinds, missing-versus-excluded semantics, prompt injection, known-thread mapping, unknown-thread quarantine, duplicate delivery, unauthenticated access, wrong-user isolation, website-only outreach blocking, concurrent send claim locking, and failed-state truthfulness.
- npm run typecheck, npm run build, and npm run lint completed successfully. Vite emitted its existing future config-loader warning about __dirname; the production build still completed.

REAL OR MOCK DISTINCTION: Webhook registration, deployment, unsigned-route check, and passive AgentMail thread check were real. The fixture tests are synthetic and are reported only as local regression evidence. No new AgentMail send occurred, no new message or thread identifiers were created, and no external reply or quote extraction is claimed.

SECURITY IMPACT: Only raw-body requests with valid Svix signatures and the configured inbox are accepted. Mapping is thread-first and verifies the owner/job/provider/outreach relationships. Unmatched events are quarantined without owner links. Public UI queries require the authenticated owner. Website-only candidates remain outside automated email. Provider email and attachment content are treated as untrusted data.

KNOWN LIMITATIONS: No external provider reply has arrived yet, so the deployed AgentMail-to-Convex-to-UI reply path and live OpenAI interpretation remain unproven. The optional OpenAI interpreter remains in truthful needs-review mode until its deployment key is configured. The full AgentMail attachment retrieval path is implemented but has not been exercised against a real inbound attachment.

BUILD_TRACKER STATUS: Phase 1 foundation PASS by the accepted Day 1 result. Phase 2 provider research and Phase 3 approval/first outreach remain supported by the accepted Day 1 evidence. Phase 4 inbound email loop is BUILDING with deployed signed webhook, mapping, deduplication, quarantine, UI, and regression fixtures; the real-reply gate is still pending. Phases 5–8 remain NOT STARTED for their live gates.

NEXT RECOMMENDED PHASE: Wait for a real external provider reply to the existing thread, then verify signed webhook receipt, Convex persistence, UI update, and truthful processing state. Stop for director review before beginning Day 3.
## Day 3 recovery, release, and submission preparation — 2026-09-13

OBJECTIVE: Complete the remaining local recovery/control UX, security/repository review, release documentation, demo preparation, and production-readiness assessment without treating the optional OpenAI key as a blocker.

AUTHORITATIVE CURRENT STATE: Day 1 remains accepted PASS. Day 2 remains BUILDING and WAITING_FOR_EXTERNAL_REPLY because no genuine provider reply has arrived on the existing external thread. Day 3 is BUILDING. No new outbound email or inbound reply was created during this work.

WORK COMPLETED:
- Added generic owner-only pause, resume, cancel, and complete mutations with auditable job events.
- Added pausedFromStatus and activeOperation state to the job model. Provider search, bounded contact discovery, and outreach send claim and clear their operation markers.
- Added server-side active-operation guards so refreshes and repeated clicks cannot start contact discovery or outreach concurrently.
- Added recovery UX for paused, cancelled, completed, failed, and in-flight states. Closed requests can start a new request; send controls are unavailable outside the explicit outreach-approved state.
- Added focused recovery tests for owner-only transitions, active-operation locking, cross-user denial, and completion. The deterministic suite now passes 11 tests across two files.
- Updated README.md, DEMO_SCRIPT.md, and SUBMISSION_ASSETS.md with secret-safe, truthful preparation content. No recording, post, submission, repository publication, or deployment was performed.

LOCAL EVIDENCE:
- npm run typecheck: PASS.
- npm run lint: PASS.
- npm run build: PASS.
- npm test -- --run: PASS, 11 tests across 2 files.
- Existing .env.local and .env.convex files are ignored; only .env.example is allowlisted. No Git remote is configured. Filename-only scans did not expose secret values.

- The required local project-specific UX skills named in the director package are not installed in this workspace; the corresponding audits were performed directly and this absence is recorded rather than hidden.

DEPLOYMENT AND UAT:
 Two attempts to push the Day 3 backend with npx convex dev --once failed before deployment during Convex authorization/network fetch with connect ETIMEDOUT. No code/schema error was reported, but deployed verification of the Day 3 UX remains pending.
- No production deployment was attempted. The public convex.site app is not deployed, and production UAT has not started.
 The OpenAI interpreter is server-only and fail-closed. A bounded connectivity proof is recorded separately; genuine provider-reply UAT remains owner-controlled.

14-GATE STATUS:
1. Generic local-service product contract: PASS by accepted Day 1 evidence.
2. Authenticated normal-user journey: PASS by accepted Day 1 evidence.
3. Standardized brief and explicit approval: PASS by accepted Day 1 evidence.
4. Real Firecrawl discovery: PASS by accepted Day 1 and Moving evidence.
5. Source-backed contactability: PASS for the accepted Day 1 provider evidence.
6. Website-only and phone-only outreach block: PASS by live/source checks and deterministic fixture.
7. Real AgentMail send: PASS by accepted Day 1 evidence.
8. External message and thread identifiers: PASS by accepted Day 1 evidence.
9. Truthful persisted sent state: PASS by accepted Day 1 evidence.
10. Signed inbound webhook foundation: BUILDING; deployed signed route and quarantine foundation are proven, genuine reply receipt remains pending.
11. Reply interpretation and comparison: BUILDING; implementation and fixtures exist, real reply gate remains pending.
12. Recovery, retry, and tenant controls: LOCAL PASS; deployed Day 3 UAT pending.
13. Public convex.site deployment and production UAT: NOT STARTED; deployment/network boundary remains open.
14. Security, public repository, README, demo, social, and hackathon submission: PARTIAL; local audit and preparation artifacts are complete, public GitHub/publish/record/submit actions remain unauthorized or pending.

BUILD_TRACKER STATUS: Day 3 is BUILDING. Local recovery UX, tests, README, demo, submission preparation, and audit work are complete. Production deployment, deployed UAT, genuine inbound reply, public GitHub, demo recording, social publication, and submission remain open. OPENAI_API_KEY is explicitly not a release blocker.

NEXT SAFE STEP: Obtain the fresh direct authorization required for production Convex deployment and, separately, public GitHub publication if desired. Then deploy, run production UAT, and stop for director review before any public submission or social publication.
## Day 3 production backend and static-hosting wiring — 2026-09-13

STATUS: PARTIAL. The authorized production Convex backend deploy completed successfully, while the public static-site publication and production UAT remain pending.

EVIDENCE:

- Preflight passed: typecheck, lint, 11 automated tests across 2 files, and production frontend build.
- Production target was resolved as laudable-fly-396; npx convex deploy completed schema validation, TypeScript validation, function bundling, and push to https://laudable-fly-396.convex.cloud.
- @convex-dev/static-hosting was installed and configured. Existing auth and /agentmail/webhook routes remain registered before the static catch-all.
- Local post-wiring typecheck, lint, tests, and build all pass. The official static-hosting deploy script is present as npm run deploy.
- Public convex.site publication was not completed because the deployment command requires a direct active-turn confirmation for the external publication action. No workaround was attempted.
 A local npx convex codegen run during component setup uploaded the generated hosting component definitions to the selected development deployment; no data deletion, production frontend upload, or external email action occurred. This is recorded as an unintended dev-side effect and is not claimed as a clean dev-unchanged result.
- Production environment variable values, production webhook migration, and clean-user production UAT remain pending until the public frontend and production configuration are available.

REMAINING RELEASE GATES:

- Production environment names/configured status and the production AgentMail webhook destination require verification.
- Public convex.site publication and manual URL smoke test.
- Clean production UAT using a fresh non-roofing request.
- Production recovery/control, authz, unsigned-webhook, website-only blocking, and no-secret frontend checks.
- Public GitHub repository creation, final push, and unauthenticated accessibility check.
- Final README URL update, demo update, compliance review, and director review.

OpenAI remains optional and is not a release gate. Do not send additional provider email, publish the social post, or submit the hackathon entry.

## Day 3 production completion — 2026-09-13

STATUS: Production deployment and authorized release-package verification completed; stop for director review before social publication or hackathon submission.

PRODUCTION CONFIGURATION:

- Names-only verification passed for the required production names: AGENTMAIL_API_KEY, AGENTMAIL_INBOX_ID, AGENTMAIL_WEBHOOK_SECRET, FIRECRAWL_API_KEY, JWKS, and JWT_PRIVATE_KEY. Values were never printed, copied into documentation, committed, or reported. OPENAI_API_KEY remains optional and was not treated as a gate.
- The existing AgentMail configuration was inspected before mutation: exactly one enabled webhook, one inbox scope, and message.received only.
- The documented update endpoint does not mutate the webhook URL. The authorized migration therefore removed the old single subscription and created one replacement using the same inbox scope and event type, then set the replacement signing secret on production through stdin only. Final read-only verification returned exactly one enabled webhook at https://laudable-fly-396.convex.site/agentmail/webhook, subscribed only to message.received; no duplicate remained.
- An unsigned POST to the production webhook returned HTTP 401. No inbound message or external email was created by this check.

PUBLIC HOSTING:

- Target: production deployment laudable-fly-396.
- Backend: https://laudable-fly-396.convex.cloud.
- Frontend: https://laudable-fly-396.convex.site.
- npm run deploy completed after the deployment target was made explicit; Convex schema/type validation passed and four static files were uploaded atomically.
- Public HTTP smoke test returned 200 HTML with the React bundle and no secret-shaped or local-development URL content.

PRODUCTION UAT:

- Fresh ordinary-user Moving journey passed through the public UI: authenticated sign-up, Austin/TX request, next-week timing, standardized brief creation and approval, exactly one real Firecrawl provider search, relevant local provider result, visible source URL/evidence, exactly one bounded contact-page check, source-backed public business email evidence for the email_found candidate, and truthful website-only/phone-only/unclear blocking for providers without public business email. No provider was approved and no outreach was sent in this UAT.
- Recovery UAT passed on the public UI: pause showed Request paused and the no-new-external-work message; resume showed the active confirmation; cancellation showed an explicit in-product Cancel this request? boundary with Keep request and Confirm cancellation, and one confirmation produced Request cancelled, the closed-request message, and Start another request. No provider discovery or email occurred in the recovery run.
- An earlier headless-browser attempt used the native window.confirm path and stopped without accepting a browser dialog; source review showed the mutation was correct. The UI was changed to the explicit in-product confirmation boundary, redeployed, and the end-to-end cancellation run then passed. This is recorded as a testability/control-UX correction, not hidden as a clean first attempt.
- The deployed production backend and frontend were not used for any additional provider email, follow-up, clarification, booking, payment, quote acceptance, social post, or submission.

LOCAL REGRESSION EVIDENCE AFTER THE CONTROL-UX FIX:

- npm run typecheck: PASS.
- npm run lint: PASS.
- npm test -- --run: PASS, 11 tests across 2 files.
- npm run build: PASS.
- The dev-side convex/_generated hosting-component upload noted in the earlier section remains an acknowledged incidental effect; no data deletion or email action occurred.

REMAINING REVIEW BOUNDARY:

- Day 1 remains accepted PASS.
- Day 2 remains BUILDING / WAITING_FOR_EXTERNAL_REPLY until a genuine provider reply is received and processed through the signed production webhook. No reply is fabricated or claimed.
- Public GitHub creation/push and final secret-scan verification are part of this explicitly authorized package. Stop afterward for director review; do not publish socially or submit the hackathon entry.
## Day 3 public repository and final audit — 2026-09-13

- Created and pushed the reviewed public repository: https://github.com/Techkeyy/findor.
- Public repository visibility was verified as public, and the pushed main branch points to the reviewed release commit.
- Final staged-tree scan before push: zero secret/private-pattern matches; zero localhost or loopback URL matches; zero staged ignored environment files; zero staged local builder metadata. The only staged environment file is .env.example, which documents names/placeholders only.
- The repository contains no AgentMail recipient, message identifier, thread identifier, API key, webhook secret, private key, cookie, password, or exact residential address from the live work package.
- README and hackathon.md now point to the live production app and public source repository. No social publication or hackathon submission was performed.
- Final stop boundary: director review is required before any social post, hackathon submission, or new external commitment. The optional OpenAI integration remains fail-safe and is not a release blocker.
## Master director standard checkpoint — 2026-09-13

STATUS: **BUILDING / UAT READY**, not RELEASE READY, SUBMISSION READY, or FINISHED.

AUTHORITATIVE GATE RESULT:

- The read-only inspection of the previously approved Altitude thread found no matching thread for the approved subject, and production Convex has no persisted sent-outreach record for that path. No database state was edited and no message was sent. Required status: `ALTITUDE_STATUS = WAITING_FOR_EXTERNAL_REPLY`.
- The real inbound journey remains unproven. The signed production webhook, thread mapping, deduplication, quarantine, authenticated queries, and UI are implemented and regression-tested, but no genuine provider reply has been received through the deployed chain.
- The optional OpenAI provider-response interpreter remains fail-safe and is not a release blocker.

SECOND CAMPAIGN PREPARATION (NO SEND):

- A fresh ordinary-user production run used generic `Residential cleaning`, a two-bedroom Austin request for next week, and no exact residential address.
- Real Firecrawl retained three relevant candidates with source URLs. The strongest source-backed contactable candidate is Tidy Hands Cleaners, `https://www.tidyhandstx.com/`, with public business email `support@tidyhandstx.com` supported by the exact retrieved source URL `https://www.tidyhandstx.com/`.
- The other retained candidates were Care.com Austin cleaning (`https://www.care.com/house-cleaning/austin-tx`) and Maids and Moore (`https://maidsandmoore.com/`); both remain website-only because no public business email was supported by retrieved evidence.
- Tidy Hands was approved only to prepare an unsent draft. Subject: `Residential cleaning inquiry`. No AgentMail message or thread identifier was created during this work package.
- A second real provider outreach requires separate director authorization. No new provider email, follow-up, clarification, booking, payment, quote acceptance, social post, or hackathon submission was performed.

AUDIT ARTIFACTS:

 [MANUAL_UAT.md](MANUAL_UAT.md) is the owner-facing production walkthrough and stops before `Send this email`.
 [PRODUCT_PROMISE_MATRIX.md](PRODUCT_PROMISE_MATRIX.md) separates UI, backend, real integration, production, recovery, owner-UAT, and final status.
- Convex production read-only insights returned no issues over the last 72 hours. Deployed function metadata confirms authenticated job/provider/outreach/inbound entry points and internal-only receipt/webhook transitions.
- Source audit found no hard-coded Altitude/provider identifiers in product code. Ownership checks are present on jobs, providers, outreach, inbound mapping, attachments, and recovery actions. Deterministic tests cover unauthenticated access, wrong-user isolation, website-only blocking, send-claim locking, failed-state truthfulness, inbound deduplication/quarantine, and recovery controls.

REMAINING RELEASE GATES:

1. Owner manual UAT on production is pending.
2. A genuine external provider reply is pending; the full inbound-to-comparison journey is not PASS.
3. The second campaign is prepared but unsent; director authorization is required before any new AgentMail send.
4. Social publication and final hackathon submission remain out of scope.

NEXT SAFE STEP: Give the owner [MANUAL_UAT.md](MANUAL_UAT.md) for manual production review and wait for a genuine reply. Stop at the outbound boundary for director review.

## Generic marketplace-filter correction and production recheck — 2026-09-13

STATUS: **UAT READY = YES; UAT PASS = NO.** Owner manual UAT has not started.

CORRECTION:

- Added `care.com` to the existing generic rejected-host policy used for directory, marketplace, publisher, and comparison pages in `convex/providerResearch.ts`.
- No cleaning-specific branch, hard-coded cleaning page, giant classifier, or database patch was added.
- Source evidence and truthful contactability rules remain unchanged for retained providers.

VERIFICATION:

- `npm run typecheck`: PASS.
- `npm run lint`: PASS.
- `npm test -- --run`: PASS, 11 tests across 2 files.
- `npm run build`: PASS.
- Production deploy: PASS to `laudable-fly-396`; backend and four static files published at `https://laudable-fly-396.convex.site`.
- Fresh generic Residential cleaning production discovery through the normal UI: PASS. Exactly one provider search and one bounded contact-page check were performed. No email was sent.

EXACT PRODUCTION PROVIDER RESULTS:

1. Tidy Hands Cleaners: Top-Rated Cleaning Services Austin, TX — `https://www.tidyhandstx.com/` — `email_found`.
2. Austin House Cleaning & Maid Services | The Cleaning Authority — `https://www.thecleaningauthority.com/austin/` — `website_only`.
3. Maids and Moore: Top-Rated Residential Cleaning Company in ... — `https://maidsandmoore.com/` — `website_only`.
4. House Cleaning Services in Austin, Texas - Spruce — `https://getspruce.com/austin-cleaning-service/` — `email_found`.

- Care.com is absent; no `care.com` URL was retained.
- Tidy Hands and Maids and Moore survived and remained relevant individual provider/business results.
- Legitimate providers were not removed. Source URLs/descriptions remained attached.
- Website-only providers did not receive an automated email approval path.

TIDY HANDS CONTACT EVIDENCE:

- Provider: Tidy Hands Cleaners.
- Public business recipient: `support@tidyhandstx.com`.
- Exact evidence source: `https://www.tidyhandstx.com/`.
- The retrieved source visibly published the address as a public business contact route. It was not inferred.

FRESH UNSENT DRAFT STATE:

- A new ordinary-user production job was used; no prior production IDs were reconstructed or patched.
- Tidy Hands was approved only through the normal UI to prepare a draft.
- The new draft exists in a valid production state with recipient `support@tidyhandstx.com`, subject `Residential cleaning inquiry`, and status unsent.
- No AgentMail message or thread ID was created.

THREAD-MAPPING ACCEPTANCE:

- The previous Altitude send is not the final production inbound acceptance test because its old production relationship is absent from current production state.
- No old Altitude relationship was fabricated or reconstructed.
- The final acceptance campaign is the fresh production Residential cleaning path: production user -> cleaning job -> provider -> outreach record -> real AgentMail send -> persisted identifiers -> real provider reply -> signed webhook -> production thread mapping -> inbound record -> UI -> interpretation/comparison.

OWNER UAT BOUNDARY:

- `MANUAL_UAT.md` is marked `UAT READY = YES`.
- Owner manual UAT must begin only after director review.
- `UAT PASS` is not claimed. No provider email, follow-up, clarification, booking, payment, quote acceptance, social post, or hackathon submission occurred.

## Owner-UAT auth remediation and automated production verification — 2026-09-14

STATUS: **AUTH UNIQUENESS = PASS; AUTH UX = PASS; PRODUCTION FIX = PASS; OWNER UAT = STILL PAUSED.**

ROOT CAUSE AND SCOPE:

- Convex Auth remains the only identity authority. No second application password or user system was added.
- The installed Password provider keyed accounts by the raw email string. The fix applies trim + lowercase normalization only; Gmail dot/plus rewriting is intentionally not performed.
- The pinned Convex Auth release returned InvalidSecret/InvalidAccountId tokens that became a generic server error in the provider action. The compatibility wrapper preserves the official Password provider's hashing, account, and session machinery and converts only those expected credential tokens into safe ConvexError data.
- Duplicate signup in the normal UI now checks the Convex Auth users table by normalized email, switches directly to Sign in, retains the email, and does not create a second identity.

THIRTEEN-GATE EVIDENCE:

1. Auth implementation diagnosed from installed Convex Auth source: PASS; raw email keying, duplicate behavior, Convex Auth users table, and InvalidSecret server-error path were verified.
2. Convex Auth identity authority preserved: PASS; no parallel users/password table was introduced.
3. Minimum email normalization: PASS; trim + lowercase only, with Gmail dot/plus forms preserved.
4. Explicit duplicate signup safety: PASS; normalized duplicate signup showed the existing-account message and switched to Sign in without a second identity.
5. Duplicate email retention: PASS; the case/whitespace variant remained in the form for sign-in.
6. Fresh-account persistence: PASS; a fresh ordinary account created a generic job brief, sign-out/sign-in restored the same job, and refresh preserved it.
7. Wrong-password UX: PASS after the final production redeploy; the UI showed exactly “Email or password is incorrect.” and did not show InvalidSecret.
8. Short-password UX: PASS; the UI showed exactly “Password must be at least 8 characters.” and did not show Invalid password or raw backend details.
9. Sign-up/sign-in distinction and loading controls: PASS in source and production normal-UI flow; labels are Creating account… and Signing in…, with submit disabled during work.
10. Invalid/temporary error safety: PASS for the covered invalid-credential and short-password paths; unknown failures remain on the generic retry-safe message.
11. Tenant isolation: PASS in production automated UI; User B saw only its private job and not User A's job, and User A saw its own job and not User B's job.
12. Verification and deployment: PASS; typecheck, 13 automated tests across 3 files, lint, build, production backend deployment, and static publish all passed.
13. Production health and release boundary: PASS for automated verification; Convex insights reported no issues over 72 hours. Owner manual UAT remains paused, UAT PASS is not claimed, and no email/provider/reply action occurred in this package.

AUTOMATED PRODUCTION EVIDENCE (credentials and secret values intentionally omitted):

- Fresh account/job/brief: Kane session 6f607309-3cb3-419e-ae71-b39ed3bd189b, evidence pack bccc7ec8-f1ea-4567-a469-788c2937c603.
- Sign-in persistence, refresh, duplicate normalization, retained email, and re-login: session 81d1cb5d-d5c2-4906-9e0d-215bbb7e2271, evidence pack a5b79a8f-b722-403a-8203-ea848335300e.
- Final wrong-password production check after the wrapper deploy: session 3b9bcb2a-5173-449c-8051-016c5ba64a82, evidence pack 00dcbe70-c8ee-49ff-b30f-c23b7dfd472a.
- Final short-password production check: session fe96bd9f-0096-4e6f-a153-86e502b3dc31, evidence pack 424b5686-20a4-4c86-a285-80f02b5842d7.
- Two-user production tenant isolation: session 0488a59d-271c-4d09-9778-e374d4a0492b, evidence pack da5a0f9d-fb9e-42ab-8642-6058cf57cfa5.
- Production target: laudable-fly-396; frontend https://laudable-fly-396.convex.site; Convex insights: no issues over the last 72 hours.

BOUNDARY:

- UAT READY = YES for director review of the automated remediation; UAT PASS = NO until the owner performs manual UAT.
- Do not resume owner manual UAT in this package. Do not send any email or begin provider/reply work.
- Day 2 remains BUILDING / WAITING_FOR_EXTERNAL_REPLY; no genuine external provider reply is fabricated or claimed.

## Director-authorized mandate autonomy implementation — 2026-09-14

STATUS: IMPLEMENTATION VERIFIED LOCALLY; PRODUCTION DEPLOYMENT PASS; OWNER UAT STILL PAUSED.

Authorization scope: implement the future mandate-triggered real AgentMail path, but do not run it in this work package. No provider email, clarification, follow-up, booking, payment, quote acceptance, or other external commitment was initiated.

Architecture and safety evidence:

- New generic intake persists normalized country, country code, region, city, optional locality/postal code, and a category-neutral Job Brief. Exact street address is not required for initial research.
- Approving the brief creates an explicit per-job operating mandate with a provider cap clamped to 1–5, a selection preference, initial-outreach permission, routine-clarification permission, and a maximum of one follow-up.
- Only a job with that explicit mandate can enter startFindingOptions. The action performs the existing bounded Firecrawl search/contact path, retains source evidence, queues only source-backed public-email candidates, then calls the bounded internal send batch.
- Historical jobs and outreach records without the optional mandate remain inert-safe. The legacy manual approval/send path is rejected for mandate jobs, and a re-run of autonomous queueing is idempotent.
- Initial send claims are atomic. A record is persisted as sent only after a non-empty AgentMail message_id and thread_id are returned. Failed external attempts remain failed with no success identifiers.
- Routine clarification automation is limited to attributes classified as availability, timing, materials, disposal, included/excluded items, warranty, tax, or similar ordinary non-binding facts. Price, quote, estimate, address/location, scope, payment/deposit, contract, hire, booking, negotiation, or other ambiguous attributes patch the job to needs_user and emit autonomous_action_blocked.
- Pause, cancel, complete, tenant, ownership, active-operation, provider-evidence, and public-email checks are enforced server-side. Inbound clarification creation is deduped by job and attribute.
- A bounded follow-up creation/send action and one-record cap are implemented. Automatic scheduling from the initial receipt is intentionally not wired in this implementation pass because the current work package must remain inert and must not create a near-term external action. This is an explicit remaining implementation gap, not a claim of live follow-up capability.

Local evidence:

- npm run typecheck: PASS.
- npm test -- --run: PASS, 21 tests across 4 files.
- Production frontend build: PASS.
- Changed-file ESLint: PASS with zero warnings; the repository-wide command is slow/silent on this Windows workspace, so the changed-file result is the auditable lint result.
- git diff --check: PASS.
- Secret-like scan excluding dependencies, generated code, build output, and Git metadata: zero matches. Integration names were checked without printing values.
- No current job was started through the new UI action. No real Firecrawl or AgentMail call was made during this implementation work package.
- Production deploy completed to laudable-fly-396. The public convex.site smoke check returned HTTP 200 HTML, contained the React root, and had no localhost or secret-shaped content.

Production/deployment boundary:

- Target: production Convex deployment laudable-fly-396; public frontend https://laudable-fly-396.convex.site.
- Deployment and read-only public smoke check completed. Do not run owner manual UAT, click Start finding options, or create a real autonomous campaign.
- OPENAI_API_KEY remains optional and is not a release or hackathon blocker.
- UAT PASS, RELEASE READY, SUBMISSION READY, and FINISHED are not claimed. Director review remains required before the first real autonomous campaign.

## Director-authorized follow-up scheduling completion — 2026-09-14

STATUS: AUTONOMY IMPLEMENTATION = PASS; PRODUCTION DEPLOYMENT PASS; OWNER UAT READY = YES; OWNER UAT PASS = NO.

The previously disclosed gap is closed using Convex's built-in scheduled-function primitives (`ctx.scheduler.runAfter` for the post-commit trigger and `ctx.scheduler.runAt` for the 24-hour callback). No second queue, worker, VPS, Redis service, workflow engine, or orchestration system was introduced.

Lifecycle and safety evidence:

- The initial AgentMail action still requires the existing authenticated mandate path. It must receive non-empty `message_id` and `thread_id`; the `markSent` mutation persists those identifiers and the sent state first.
- Only after that successful `markSent` transaction commits does Convex enqueue the internal scheduling trigger. That trigger re-reads the current parent outreach/job/thread state and creates one 24-hour scheduled callback only when the mandate enables follow-up, the cap is positive, the job is active, the initial receipt is present, and no provider reply is already mapped.
- The 24-hour delay is centralized in `convex/autonomy.ts` as `FOLLOW_UP_DELAY_MS`; there is no cadence editor or scattered delay value.
- Durable parent state records scheduling, due, skipped, cancelled, sent, and failed outcomes, the next due time, the follow-up record identity, the scheduled-function identity, and any follow-up failure reason. The child outreach record carries its own approved/sending/sent/failed state and parent link.
- The callback rechecks job status, active operation, mandate enablement, follow-up permission/cap, structured location, parent sent state, external thread identity, existing child record, and provider reply state immediately before creation and again before the external send claim.
- A provider reply resolves the callback to no send. Pause, cancel, complete, revocation, pending human-decision state, an existing child, duplicate callback, retry, or a second claim cannot create a second external follow-up. Cancel and complete also cancel pending scheduled functions where possible; correctness still relies on the callback recheck.
- Follow-up failures are marked FAILED/needs_user with no success identifiers. A failed or unclaimed race is not reported as sent.
- Historical jobs and records without the explicit mandate are not eligible. No retroactive schedules are created for old sends.

Deterministic evidence:

- `npm run typecheck`: PASS.
- `npm test -- --run`: PASS, 23 tests across 4 files.
- Strict changed-file ESLint: PASS with zero warnings.
- `npm run build`: PASS.
- `git diff --check`: PASS.
- Strict secret-value pattern scan: zero matches; no secret values were printed or written.
- Read-only production eligibility audit before deployment: 15 jobs, 0 mandate-enabled jobs, 0 confirmed initial sends, 0 newly eligible follow-ups, and 0 pending follow-up states.

Production evidence:

- Convex backend deployed successfully to `laudable-fly-396` (`https://laudable-fly-396.convex.cloud`) with schema validation passing.
- Production frontend published successfully at `https://laudable-fly-396.convex.site`.
- Public smoke check: HTTP 200, HTML root present, no localhost reference, no secret-shaped content.
- Post-backend and post-frontend production schedule audits: 0 scheduled functions and 0 `sendScheduledFollowUp` schedules. Deployment generated no schedule for an old record.
- No real Firecrawl discovery, AgentMail initial send, AgentMail follow-up, provider reply, clarification, booking, payment, quote acceptance, social publication, or hackathon submission occurred in this work package.

Boundary:

- Do not click `Start finding options`, start a campaign, send Tidy Hands or any other provider email, or begin owner manual UAT in this package.
- Owner UAT is READY for director review of the deployed implementation, not PASS. Day 2 remains waiting for a genuine external provider reply. The active server-only OpenAI interpreter has a bounded synthetic connectivity proof; genuine provider-reply UAT remains owner-controlled.
- Remaining owner-UAT work is the authorized live production campaign and genuine external reply/webhook journey, subject to fresh director approval at the external-communication boundary.
## Former provider-reply prototype - superseded 2026-09-15

STATUS: SUPERSEDED by the official OpenAI Responses API implementation on 2026-09-21.

The earlier provider-reply prototype used a different model adapter and is retained in this dated log only as historical context. It is not part of the active runtime, production configuration, dependency graph, or frontend bundle.

CURRENT TRUTH:

- Active interpreter: convex/openaiProviderReply.ts and convex/providerReplyInterpreter.ts.
- Active runtime consumer: the inbound provider-reply action path.
- Active model key: OPENAI_API_KEY, server-only.
- Failure behavior: needs_review with no external commitment.
- Current validation: strict schema contract suite and a bounded synthetic connectivity proof.
- Genuine provider reply UAT: pending owner-controlled production UAT.
- No provider text, job, provider, Firecrawl, AgentMail, recovery, or production contact was used by the synthetic proof.

This historical entry is superseded. Do not use it as current architecture or release evidence.

## Generic provider-entity quality gate correction — 2026-09-15

PROVIDER QUALITY GATE = PASS after correction. AUTONOMOUS OUTREACH SAFETY = PASS for new eligibility decisions. OWNER UAT = PAUSED.

Historical owner-UAT truth, read from production before repair:

- Production deployment: laudable-fly-396.
- Job: residential cleaning in Oshodi Road, Lagos, Nigeria; status was reply_received; active operation was empty; approved provider cap was 3.
- The job had 5 retained candidate records and 3 initial outreach records.
- Real recipients and states were: support@viscorner.com SENT, info@cleanly.ng SENT, and info@neatflow.ng SENT.
- All three historical records had real external message and thread identifiers and one send attempt.
- CLEANLY was contacted. VisCorner and NeatFlow were also contacted. QMclean was not contacted. No cancellation, follow-up, or corrective external message was sent.
- This history was not deleted, rewritten, or manually repaired.

Root cause:

- The prior generic filter combined a small host denylist with loose page-copy signals such as service/contact language.
- It did not distinguish a source page that discussed many providers from the specific provider entity Findor intended to hire.
- Email extraction accepted a public email found on any retained source page; source-backed email evidence was treated as sufficient without proving that the source page represented the provider entity.
- The autonomous queue selected email_found records within the cap without an entity-role gate, so the cap was effectively filled by invalid source pages.

Correction:

- Added a generic provider-quality classifier with provider and discovery_source entity roles.
- Discovery-source signals cover directories, marketplaces, comparison and aggregator pages, listicles, best/list-of company pages, calculator/content pages, article/blog/news paths, professional-registration and multiple-quote language, and similar source structure.
- Known marketplace/list/article/calculator hosts remain only as an additional defense; the primary decision is based on generic source structure and page intent.
- Search results retain source evidence but discovery_source records cannot enter provider options or automated contact discovery.
- New candidates only receive email_found when they classify as provider entities and their retrieved public email is grounded in provider evidence.
- Legacy obvious discovery hosts are quarantined at read-time and send-time without mutating the historical records.
- Manual approval and autonomous queue/send paths now require provider-entity status plus source-backed public business email evidence.
- The frontend keeps discovery sources separate from hireable provider cards and explains that they are retained as evidence, not provider options.
- The mandate rail now derives completion from persisted brief/mandate approval state and shows the five-step contract: Describe the service; Review the brief; Approve Findor's mandate; Findor finds and contacts providers; Review replies and options.

Regression evidence:

- Official provider-owned page survives.
- Provider-owned public business email survives.
- VisCorner-like marketplace support email is rejected.
- NeatFlow-like listicle/article is rejected.
- TrustAm-like calculator/content page is rejected.
- Generic article/blog path is discovery-only.
- A third-party discovery source cannot satisfy autonomous eligibility without provider-entity resolution.
- A maxProviders value of 3 does not force three sends; one valid provider produces at most one queued outreach.
- Website-only providers remain unsent.
- Persisted mandate approval marks the rail step complete.
- npm run typecheck: PASS.
- npm run lint: PASS with zero warnings.
- npm test -- --run: PASS, 36 tests across 5 files.
- npm run build: PASS.
- git diff --check: PASS.
- Secret-shaped scan: zero matches.

Production evidence:

- Backend deployed successfully to https://laudable-fly-396.convex.cloud.
- Frontend deployed successfully to https://laudable-fly-396.convex.site.
- Public smoke: HTTP 200, React root present, corrected mandate/provider/discovery-source copy present, no secret-shaped frontend content.
- Post-deploy read-only inspection confirmed the owner-UAT job remains reply_received with 3 historical outreach records and no active operation.
- The owner-UAT job has zero related scheduled callbacks. Global scheduled-function count was 7 for unrelated existing records.
- No new campaign was started. No Firecrawl request, AgentMail request, provider message, cancellation, follow-up, or other external commitment occurred during the correction or verification.

Boundary:

- The historical send defect is disclosed and preserved.
- Do not mark OWNER UAT PASS.
- Do not start another real campaign or send any provider message until director review decides whether to create a fresh UAT request.

## Bounded non-response recovery — 2026-09-15

Authorized implementation and production deployment completed for a future recovery path. New mandate-approved jobs opt in once; historical jobs, including the current Reis/CLEANLY campaign, remain opt-out unless separately enabled by the owner.

- Recovery can proceed only after `no_response` or `delivery_failed`, while the approved provider cap has unused capacity, no eligible uncontacted retained provider remains, the job is active, and the mandate still permits autonomous research/contact.
- At most one recovery discovery cycle is persisted per job. Recovery research reuses the address-redacted `buildResearchQuery(job)` and the existing bounded same-origin contact lookup; no exact address or private contact data is added.
- Recovery candidates pass the same generic provider-entity, relevance, and source-backed public-email gate as the initial path. Website-only, phone-only, marketplace, and directory records cannot enter automated email outreach.
- Recovery sends are queued behind an owner-scoped claim and the existing AgentMail receipt gate. No receipt is persisted before successful external acceptance; failed sends become `send_failed`/`needs_user`.
- The UI now distinguishes provider state such as Waiting for reply, Provider replied, No response, Delivery failed, and Needs your review.
- Deterministic recovery decision tests pass. This implementation/deployment turn made no Firecrawl request, AgentMail request, provider contact, follow-up, or external commitment.

Implementation status: PASS. Live recovery execution: NOT RUN. Owner UAT: PAUSED.

## Decline recovery correction — 2026-09-16

Director-authorized correction deployed to production. A genuine provider decline is now persisted as the terminal state for that provider, cancels any still-pending follow-up for that provider, and evaluates unused approved provider capacity. When another usable provider response exists, the decline path can still select the next eligible already-discovered provider; when none exists, it can schedule only the existing one-cycle bounded recovery search. The declining provider remains deduplicated and cannot be selected again automatically. Existing pause, cancel, complete, needs-user, owner/job authorization, provider-quality, cap, and one-cycle guards remain in place.

- Deterministic recovery coverage: 13 tests in `tests/recovery.test.ts`, including genuine decline persistence, duplicate interpretation idempotency, no follow-up after decline, existing-provider replacement, bounded recovery search, cap exhaustion, declined-provider deduplication, and paused/cancelled/completed/needs-user blocking.
- Local verification: `npm run typecheck` PASS; `npm run lint` PASS; `npm run test` PASS (57 tests across 6 files); `npm run build` PASS; `git diff --check` PASS; secret-pattern scan PASS with no reported matches.
- Production backend deployed to `laudable-fly-396` (`https://laudable-fly-396.convex.cloud`) with schema validation and function bundling successful. The frontend was not changed in this backend-only correction; read-only HTTP smoke remained 200 for both the public `convex.site` frontend and Convex backend endpoint.
- Read-only production verification of the historical job found: status `outreach_sent`; recovery disabled; recovery cycles absent; no active operation; 7 provider-candidate records; 2 initial outreach records; 0 follow-up children; 0 provider-resolution fields; 0 recovery events; 0 recovery-enabled production jobs. The precise outreach-ID scheduler join found the existing 4 follow-up scheduler records for the two historical outreach IDs (two scheduling callbacks plus two follow-up-send callbacks), with 2 persisted follow-up schedule fields and 0 final-response/recovery callbacks; this matches the pre-deploy campaign shape and was not changed. Global scheduled-function count was 11.
- No Firecrawl request, AgentMail request, provider contact, follow-up, recovery callback, new campaign, or other external commitment occurred during implementation, deployment, or verification. The Reis/CLEANLY campaign was not opted into or mutated.

DECLINE RESOLUTION = PASS
RECOVERY AUTONOMY = PASS
CURRENT CAMPAIGN UNCHANGED = PASS
OWNER UAT = PAUSED

## Bounded non-response recovery — 2026-09-15

Authorized implementation and production deployment completed for a future recovery path. New mandate-approved jobs opt in once; historical jobs, including the current Reis/CLEANLY campaign, remain opt-out unless separately enabled by the owner.

- Recovery can proceed only after `no_response` or `delivery_failed`, while the approved provider cap has unused capacity, no eligible uncontacted retained provider remains, the job is active, and the mandate still permits autonomous research/contact.
- At most one recovery discovery cycle is persisted per job. Recovery research reuses the address-redacted `buildResearchQuery(job)` and the existing bounded same-origin contact lookup; no exact address or private contact data is added.
- Recovery candidates pass the same generic provider-entity, relevance, and source-backed public-email gate as the initial path. Website-only, phone-only, marketplace, and directory records cannot enter automated email outreach.
- Recovery sends are queued behind an owner-scoped claim and the existing AgentMail receipt gate. No receipt is persisted before successful external acceptance; failed sends become `send_failed`/`needs_user`.
- The UI now distinguishes provider state such as Waiting for reply, Provider replied, No response, Delivery failed, and Needs your review.
- Deterministic recovery decision tests pass. This implementation/deployment turn made no Firecrawl request, AgentMail request, provider contact, follow-up, or external commitment.

Implementation status: PASS. Live recovery execution: NOT RUN. Owner UAT: PAUSED.
