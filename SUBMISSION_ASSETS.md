# Findor submission assets

Status: preparation only. Nothing here has been published, submitted, or posted.

## Project identity

Title: Findor

Tagline: Turn an unclear local-service need into a decision you can trust.

Short description: Findor turns a natural-language service request into a reviewable Job Brief, source-linked local provider evidence, and user-approved non-binding outreach.

Long description: Findor is a generic local-service procurement assistant. A signed-in user describes a need in ordinary language. Findor identifies missing information, prepares a standardized brief with structured requirements and unknowns, and waits for approval before public research. Bounded Firecrawl discovery retains relevant provider pages and source evidence. A provider enters the automated email path only when retrieved evidence explicitly publishes a public business email. After provider approval, Findor prepares a draft and asks again before the real AgentMail send. Signed inbound events route replies by inbox and thread identity; the original message remains visible beside any structured interpretation.

## Convex story

Convex is the authenticated state and control plane: schema, indexed queries, mutations, external actions, HTTP Actions, realtime subscriptions, file storage, and auditable events. Firecrawl and AgentMail run from Convex actions. External receipts are persisted only after successful external responses. The React UI reads authenticated Convex state.

## Trust claims

- Owner-scoped records and owner-only recovery controls.
- No unauthenticated outreach.
- No inferred emails; website-only and phone-only providers stay blocked.
- Explicit approval before research and again before sending.
- Double-send claim rejected while an initial send is active.
- Failed sends remain failed and receive no success identifiers.
- Signed inbound routing with quarantine for unknown threads.
- Untrusted attachments are never executed.
- The server-only OpenAI interpretation path fails safely when unavailable; genuine provider-reply UAT remains owner-controlled.

## Links to fill after review

Public app URL: pending public Convex hosting and production UAT
Public GitHub URL: pending explicit authorization and repository publication
Demo URL: pending recording and review
Build evidence: BUILD_TRACKER.md
Public build log: hackathon.md

## Social post draft

Findor turns an unclear local-service need into a clear brief, source-linked provider evidence, and a user-approved outreach draft. Built with Convex for authenticated realtime state, durable approval boundaries, external actions, and signed inbound routing. No inferred emails, no automatic hiring, and no silent sends.

#Convex #BuildInPublic #LocalServices
