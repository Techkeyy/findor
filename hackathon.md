Last updated: 2026-09-13 UTC

# Hackathon log

- **Project:** Findor
- **Event:** Convex All Gas Hackathon
- **What it does:** Local-service procurement assistant that turns natural-language service needs into reviewable briefs and prepares evidence-backed provider outreach.
- **Live app:** not deployed
- **Repo:** no public remote yet
- **Frontend:** Convex static hosting
- **Convex deployment:** https://laudable-fly-396.convex.cloud
- **Components:** @convex-dev/static-hosting
- **Convex features:** schema, tables, indexes, queries, mutations, actions, realtime queries
- **Auth:** Convex Auth
- **AI models:** none
- **Started:** 2026-09-12T09:28:47Z
- **Last updated:** 2026-09-13T01:17:35Z

## Log

### 2026-09-12 - working tree

Generalized the first authenticated workflow from a roofing-only intake into one
generic local-service engine: natural-language request, service category,
location, timing, structured context, reviewable brief, dynamic provider
research, and category-neutral outreach draft (convex/schema.ts, convex/jobs.ts,
convex/providerResearch.ts, convex/outreach.ts, src/App.tsx).

Configured the required Convex Auth signing pair on the dev deployment without
recording its values. An initial real browser run passed ordinary sign-up,
generic job creation, brief approval, and provider-research readiness. The
director-approved Firecrawl control was exercised before the integration
configuration was complete and stopped truthfully; no provider result was
fabricated or saved. Added an atomic send-claim state before the AgentMail
action so a double-click cannot create parallel initial sends. The later real
Firecrawl discovery rerun and its no-contactable-provider boundary are recorded
below; AgentMail delivery remains unclaimed.
The real Firecrawl discovery path was then rerun through the normal Findor UI
using the approved bounded Austin roof-replacement campaign. Generic
source-quality filtering retained two relevant provider pages, Aurum Roofing
and Altitude Roofing, with source evidence shown in the UI. Both were
truthfully classified as website-only because no public business email was
supported by retrieved evidence. No provider was approved, no draft was
created,
and no AgentMail call or external email was attempted. Day 1 remains unpassed.
### 2026-09-13 - working tree

Director-reviewed live evidence now covers the generic Moving flow through real
Firecrawl Search and bounded same-domain Map/Scrape. The standardized brief
handled Moving-specific requirements through generic fields, and the UI kept
source URLs and truthful website-only contactability visible. The deployed run
also exposed two generic provider-quality false positives—a publisher page and
a comparison marketplace—so a host-level provider-source correction was staged
in `convex/providerResearch.ts`; deployment and the corrected rerun are still
pending explicit deployment authorization. A bounded roofing contact check also
recovered an accepted source-backed public business route for Altitude Roofing,
with no unnecessary personal details copied into this public log. No provider
approval, outreach draft send, AgentMail call, message identifier, or external
receipt is claimed. Day 1 remains incomplete.
The later normal UI review also approved the evidence-backed Altitude Roofing candidate and persisted an unsent plain-text draft; the send boundary was not crossed. Source-backed checks confirm owner authorization, website-only blocking, authenticated send entry, and the atomic sending claim. A fresh unauthenticated UI showed no outreach controls.

The post-deployment Moving verification also passed the generic filter correction: the personal development deployment was updated, Forbes and HireAHelper disappeared, three legitimate moving businesses remained with source evidence, and bounded contact discovery stayed truthful with no public email routes and three unresolved providers. AgentMail send remained blocked at the direct-authorization boundary; no external receipt or identifier is claimed. Day 1 remains incomplete.

## 2026-09-13 — Day 1 final external-send verification

The director-authorized outreach approval boundary was completed through the normal authenticated Findor UI. Exactly one real AgentMail send was initiated for the accepted provider; Findor showed the external send as accepted, received non-empty external identifiers, and persisted the truthful sent state only after that external success. A refresh and reopen preserved the sent state and message details without another send. No credentials, secrets, private addresses, personal employee contact data, or external identifiers are recorded in this public-safe log. Day 1 is PASS for the verified chain, and work stops here for director review; no Day 2 external or irreversible action was started.
Scope note: the exact-one-send authorization intentionally did not permit duplicate-send or failed-external-send fault injection; those live negative scenarios remain unexecuted, and no claim about them is made here.

### 2026-09-13 - working tree

Added the generic inbound-reply foundation: a signed Convex HTTP Action for AgentMail message.received, identity-checked full-message retrieval, thread-first routing, duplicate protection, unmatched-event quarantine, attachment metadata, realtime conversation/comparison UI, safe Convex storage retrieval, optional Structured Outputs interpretation, and clarification drafts that never send automatically (convex/http.ts, convex/inbound.ts, convex/inboundParsing.ts, convex/schema.ts, src/App.tsx). Exactly one passive AgentMail webhook is registered for the existing case inbox; no new outbound message was created. Deployment, unsigned-request rejection, and the passive external-thread check were real; the deterministic local safety suite passed 9 tests. No provider reply has arrived yet, so this milestone remains waiting for external input rather than claiming a live inbound PASS.

### 2026-09-13 - working tree

Added owner-controlled pause, resume, cancel, and completion states with server-side ownership checks, auditable events, and active-operation locks for provider search, bounded contact discovery, and outreach send (convex/schema.ts, convex/jobs.ts, convex/providerResearch.ts, convex/outreach.ts). The UI now explains paused and closed requests, blocks send controls outside the explicit approval state, and lets a user start a new request after completion or cancellation (src/App.tsx, src/index.css).

Local evidence is green: typecheck, lint, production frontend build, and 11 deterministic Convex safety tests pass across two test files. The dev push was attempted twice but the Convex authorization/network fetch timed out before deployment; the public app remains not deployed. The optional OpenAI interpreter is not treated as a release gate. No new external email, reply, credential, or private application record is claimed in this milestone.