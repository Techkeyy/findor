# Findor

Findor is a local-service procurement assistant. It turns an unclear service need into a structured brief, lets the user review what is known and unknown, researches relevant public provider evidence, and prepares non-binding outreach only after explicit approval.

Findor is a generic local-service workflow. Moving, roofing, cleaning, electrical, plumbing, HVAC, landscaping, painting, and other categories use the same intake, brief, evidence, approval, and communication model. Category-specific details are represented as structured requirements rather than separate category pages.

## Product journey

1. A signed-in user describes the service, location, timing, and context in ordinary language.
2. Findor validates required information and prepares a standardized Job Brief.
3. The user reviews and approves the brief before any external research begins.
4. Findor runs bounded public-web discovery and stores source URLs and evidence for relevant providers.
5. Public contactability remains truthful: a provider needs retrieved evidence that explicitly publishes a business email before it can enter the automated email path. Website-only and phone-only providers remain blocked.
6. The user approves a provider and reviews a non-binding outreach draft.
7. The user explicitly approves the send action. Only then may the real AgentMail action run.
8. Findor persists external identifiers only after a successful external response and displays the resulting state.
9. Signed inbound events are routed by inbox and thread identity. Original messages remain visible, and structured comparison is an interpretation layer rather than a replacement for source text.

Findor never accepts a quote, hires a provider, signs a contract, commits payment, or changes scope on the user's behalf.

## Current release state

Day 1 is accepted as PASS for the verified real discovery-to-AgentMail-send chain. Day 2 implementation is present and remains WAITING_FOR_EXTERNAL_REPLY until a genuine provider reply is received and processed through the deployed webhook. Day 3 local recovery/control UX is implemented and locally verified.

The Convex backend and static frontend are deployed to production deployment laudable-fly-396. The public app is available at https://laudable-fly-396.convex.site. Production environment names are configured for the existing integrations and Convex Auth without exposing their values. The single AgentMail message.received webhook is migrated to the production endpoint and verified without duplicate subscriptions. Production UAT covers fresh authenticated Moving intake, real Firecrawl discovery and bounded contactability, truthful email/source evidence, and recovery controls. The reviewed public repository is available at https://github.com/Techkeyy/findor. The final secret scan passed before push, and the public release package is ready for director review. Social publication and hackathon submission remain outside scope.

The optional OpenAI provider-response interpreter has truthful fail-safe behavior when unavailable. OPENAI_API_KEY is not a release or hackathon gate and is not required for this README or release status.
## Architecture

- React, TypeScript, and Vite provide the web UI.
- Convex Auth provides password sign-up and sign-in.
- Convex stores jobs, structured briefs, provider candidates, source evidence, outreach drafts, external receipts, inbound messages, attachments, provider responses, clarifications, and auditable events.
- Convex queries and realtime subscriptions keep the private workspace current.
- Convex mutations enforce ownership, approval boundaries, recovery controls, and post-send persistence rules.
- Convex actions perform external Firecrawl, AgentMail, storage, and optional OpenAI work; external results are persisted only through internal mutations.
- Firecrawl is used for bounded public provider discovery and same-domain contact-page checks.
- AgentMail is used only for user-approved outbound outreach and inbound webhook delivery.
- Convex file storage can retain inbound attachments for safe user retrieval; attachments are treated as untrusted files.
- The generic Job Brief stores raw context, labeled structured requirements, and explicit unknowns so the schema and UI do not drift into category-specific architecture.

## Safety and truthfulness

- Every user-visible job and provider query is scoped to the authenticated owner.
- Unauthenticated users cannot trigger outreach.
- A second send claim is rejected while an initial send is in progress.
- Failed sends are recorded as FAILED and do not receive success identifiers.
- Message and thread identifiers are written only after AgentMail returns a successful receipt.
- Inbound webhook signatures are checked before event processing.
- Full messages are fetched and identity-checked before their content is trusted.
- Unknown or unmatched inbound threads are quarantined rather than attached to a user's job.
- Provider emails are never inferred or generated from a domain or provider name.
- External pages, email bodies, PDFs, and attachments are treated as untrusted data.
- Pause, resume, cancel, and complete controls are owner-only and auditable. Controls are locked while provider research, contact discovery, or outreach send is in flight.
- The interface tells the user when an action is paused, closed, sending, failed, or externally accepted.

## Configuration

Configure secrets on the Convex deployment rather than committing them. This repository intentionally documents names only:

- AGENTMAIL_API_KEY
- AGENTMAIL_INBOX_ID
- AGENTMAIL_WEBHOOK_SECRET
- FIRECRAWL_API_KEY
- OPENAI_API_KEY (optional)
- OPENAI_MODEL (optional)
- Convex Auth configuration as required by the deployment

Never commit .env, .env.local, .env.convex, deployment keys, cookies, or secret values.
## Local development

Prerequisites: Node.js and an authenticated Convex CLI session.

1. Install dependencies with npm install.
2. Start the development workflow with npm run dev.
3. Complete the browser sign-in flow when prompted.
4. Configure Convex deployment environment names listed above when integrations are in scope.
5. Push/check backend functions with npx convex dev --once.
6. Run npm run typecheck.
7. Run npm run lint.
8. Run npm run build.
9. Run npm test -- --run.

The deterministic test suite covers parsing and signature verification, prompt-injection-resistant interpretation boundaries, message identity merging, duplicate and unmatched inbound events, unauthenticated and cross-user denial, website-only provider blocking, send-claim idempotency, failed-send state, and job recovery controls.

## Demo and external scope

The intended demo follows one generic request from intake to brief approval, real provider discovery with visible evidence, provider approval, draft review, explicit send approval, and truthful receipt state. A second segment shows a real inbound reply when one is available; otherwise it is labeled as waiting for external input.

The demo does not claim automated hiring, payment, contract execution, quote acceptance, inferred contact details, fabricated provider replies, or fabricated external receipts. The prepared demo script and submission copy are kept in separate working-tree artifacts and are not published or sent automatically.

## Evidence and release tracking

BUILD_TRACKER.md is the engineering source of truth. hackathon.md is the public-safe build log. The release checklist must distinguish local verification from deployed production evidence.

The public Convex host, production UAT, deployed recovery/control verification, and integration checks are complete for this release package. The Day 2 live-reply gate remains waiting for a genuine provider reply; the optional OpenAI interpreter remains fail-safe and is not a release blocker. Public-repository publication is being completed under the current authorization. Social publication, final hackathon submission, and any new external commitment remain explicitly out of scope.

No provider, customer, inbox, real email address, message identifier, thread identifier, secret, or personal address is included in this README.
## License

This project is licensed under the terms in LICENSE.txt.
