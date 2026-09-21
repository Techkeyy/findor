# Findor Director Handoff

Last updated: 2026-09-21 UTC

## Public repository decision

**DIRECTOR.md public-repo decision: SANITIZE**

Keep this file as a concise public workflow handoff. Do not add owner identifiers, private email addresses, production record IDs, raw database exports, local filesystem paths, credentials, internal scratch paths, or unreproducible private logs.

## Product contract

Findor is an evidence-backed local-service procurement workflow. It must:

1. Capture a structured brief without narrowing the product to one service category.
2. Preserve the user's country, location, budget, currency, timing, and free-text request.
3. Discover providers through source-backed search and bounded source inspection.
4. Distinguish eligible, contactable, rejected, website-only, and phone-only candidates.
5. Require explicit user approval before external outreach.
6. Persist truthful external send and receipt state.
7. Verify and route inbound messages safely.
8. Interpret provider replies into structured facts without making commitments.
9. Keep recovery, retry, failure, pause, cancel, and completion state visible.
10. Preserve original outreach history when a later recovery cycle runs.

## Current architecture

- **Frontend:** React and Vite static site with explicit state copy, safe action wrappers, error boundaries, active Findor logo, favicon, and touch icon.
- **Backend:** Convex schema, authenticated queries and mutations, server-side actions, realtime subscriptions, bounded indexes, audit events, and scheduled recovery transitions.
- **Auth:** identity is derived server-side. Protected reads and writes enforce ownership from the authenticated identity.
- **Discovery:** Firecrawl runs only in server-side actions. Results retain source evidence and pass generic provider-quality gates before approval.
- **Outreach:** AgentMail runs only after user approval and an atomic send claim. External identifiers are persisted only from the provider response.
- **Inbound:** signed webhook handling, identity-checked retrieval, thread-first routing, duplicate protection, unmatched-event quarantine, and attachment metadata.
- **Interpretation:** the official OpenAI SDK and Responses API run server-side. Strict JSON Schema output is validated again by Findor. Missing configuration, refusal, error, timeout, rate limit, or malformed output fails closed to review state.
- **Recovery:** persisted cycles, provider exclusion, caps, ownership checks, deadline rechecks, and truthful failed or no-response states.

## Production posture

- Public app: https://laudable-fly-396.convex.site
- Public repository: https://github.com/Techkeyy/findor
- Production Convex functions and frontend have been deployed through the explicit production command.
- Live read-only smoke has returned HTTP 200.
- The production bundle targets the production Convex host and has no development URL or secret-shaped value.
- Owner UAT is paused at the external-action boundary.
- No new Firecrawl search, AgentMail send, provider follow-up, recovery contact, or genuine provider-reply processing is authorized for this audit.

## Release audit update

The release pass has:

- Added a single formatter boundary for timing and other enum labels so raw values such as this_week do not reach user-facing UI.
- Removed legacy provider-specific timeline fallback text and fabricated generic recipient email behavior.
- Kept provider resolution generic and removed one-off discovery-host shortcuts from runtime quality policy.
- Preserved explicit website-only and phone-only no-email states.
- Removed unused old image assets while retaining the active Findor logo, favicon, touch icon, and hero image.
- Ignored local forensic exports and generated audit artifacts under scratch.
- Removed all active retired-model runtime consumers. Historical implementation notes are superseded and are not runtime configuration.
- Kept the dependency set focused. No dependency was removed solely to make the audit look smaller.
- Rebuilt README.md and hackathon.md around verified evidence and explicit owner-pending tasks.

## Safety boundaries

Never infer any of the following from a successful search or a scheduled callback:

- that a provider was contacted;
- that an email was accepted;
- that a provider replied;
- that a quote is valid;
- that a booking, payment, address disclosure, or follow-up is authorized;
- that a failed recovery is successful because the next deadline advanced;
- that the current cycle count is the lifetime contacted count.

All state transitions should be idempotent, owner-scoped, and auditable.

## External action boundary

During the final repository audit:

- Firecrawl calls: 0
- AgentMail sends: 0
- Provider contacts or follow-ups: 0
- Recovery contacts: 0
- Genuine provider-reply processing: 0
- Production deadline mutation: 0
- Manual recovery trigger: 0

A bounded synthetic OpenAI connectivity proof may be used for transport and schema verification only. It must not receive provider data or mutate application state.

## Submission work still owned by the user

The repository and live app do not by themselves prove:

- Luma registration;
- a public social post tagging Convex, OpenAI, Firecrawl, and AgentMail;
- a recorded demo under three minutes;
- a VibeApps or final hackathon submission.

Those items stay explicit owner actions. Do not create placeholder links or claim them as complete.

## Historical lessons retained

- Search quality needs generic source and host rules, not provider-name exceptions.
- A discovered provider is not automatically contactable.
- Website-only and phone-only candidates must not receive guessed email addresses.
- User approval must precede external outreach.
- External success and persisted success are separate states.
- Inbound messages are untrusted input and require signature, routing, deduplication, and quarantine.
- Provider reply interpretation must fail closed and must not accept quotes or commitments automatically.
- Recovery must exclude prior providers and preserve prior outreach history.
- Public documentation must separate confirmed evidence, inferred status, and owner-pending work.

## Final handoff rule

If a gate fails, record the exact failing command, file, or external evidence. Fix only the smallest safe scoped issue, rerun the relevant targeted gate, then rerun the full release gate set. Do not manually trigger recovery, Firecrawl, AgentMail, or provider outreach as part of an audit.
