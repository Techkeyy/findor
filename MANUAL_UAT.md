# Findor owner manual UAT

Status: **UAT READY = YES; UAT PASS = NO.** Owner manual UAT is still paused and has not started after the automated auth remediation. RELEASE READY, SUBMISSION READY, and FINISHED are not claimed.

Production URL: [https://laudable-fly-396.convex.site](https://laudable-fly-396.convex.site)

Use a fresh ordinary-user account. Do not use a terminal, Convex dashboard, database viewer, developer tools, internal IDs, curl, or builder/admin setup. Do not enter an exact residential address or unnecessary personal information. This first pass stops before any new outbound email. The future mandate-triggered path is implemented but must not be exercised during this paused review package. A genuine provider reply, not a fixture or seeded record, is required for the later inbound pass.

## Authorization boundaries

The owner authorizes one boundary at a time: account creation; generic request creation/editing; Job Brief approval; real provider research; bounded contact discovery; and internal provider approval/draft preparation. Stop before `Send this email`. A new AgentMail send requires separate director authorization.

## One-step walkthrough

### 1. Open production

Open the URL above.

Expected: Findor loads at the production `convex.site` host, without a localhost URL, development banner, exposed secret, or error, and offers normal sign-in/account creation.

Stop if this is not true.

### 2. Create an ordinary account

Choose `Create account` and use an email/password you control. Do not report credential values.

Expected: you are signed in and see your private request workspace.

Verify: refresh keeps you signed in and shows no other user's request.

Stop if hidden setup is required or another user's data appears.

### 3. Create a generic request

Start a request and choose a normal category such as `Residential cleaning`, `Moving`, `Handyman`, `Painting`, or `Landscaping`. Enter a service area such as Austin, TX, timing such as next week, and plain-language work details. Omit an exact address.

Expected: the generic form accepts category, location, timing, title/details, and context/budget.

Verify: the request is private and editable. Saving does not contact a provider.

Stop if the flow requires roofing-only fields, a hard-coded provider, an exact address, or hidden admin action.

### 4. Complete missing information

If Findor identifies missing required information, provide only service-relevant details.

Expected: the request saves and advances to a brief containing the supplied details.

Stop if required information cannot be completed in the normal UI or saving triggers external contact.

### 5. Review the standardized brief

Click `Create my job brief` or `Update and review brief`. Read all sections.

Expected: `Review your standardized brief` shows requested outcome, category, service area, timing, structured requirements, context, and unknowns without invented facts.

Stop and correct the request if it is inaccurate.

### 6. Approve the brief

Click `Approve brief` only after review.

Expected: status becomes `Brief approved`; the UI says approval permits research and does not hire anyone or send an email.

Stop if that boundary is absent or an external action occurs.

### 7. Run real provider research

Click `Find local providers` once.

Expected: a bounded set of genuinely relevant local provider entities appears, each with name, website, service/location description, and source URL/evidence. Directories, marketplaces, articles, listicles, calculators, and other discovery sources are not presented as providers.

Verify: candidates match the chosen category and area; no exact address is disclosed.

Stop if results are fabricated, unrelated, excessive, duplicated, or missing source evidence.

### 8. Check the evidence

Open each displayed source URL through the normal UI and compare it with the provider claim.

Expected: the source supports the provider's category/location relevance and is retained. Malformed or failed sources are shown truthfully, not replaced.

Stop if a source does not support the claim.

### 9. Run bounded contact discovery

Click `Check contact pages` once.

Expected: only a small same-domain set of likely contact pages is checked and a result is shown per provider.

Verify: the result distinguishes `Email found` from website-only/phone-only/unresolved. No email is claimed unless retrieved public evidence explicitly publishes it as a business route.

Stop if unrelated domains, private employee addresses, inferred emails, or unbounded scraping appear.

### 10. Verify contactability

Read the exact public email and exact source URL for each `Email found` provider. Confirm website/form/phone-only providers have no automated email path.

Expected: the email exactly matches the source-backed business route; no provider is contactable merely because its domain suggests an address.

Stop if an email was inferred or a website-only provider can enter outreach.

### 11. Approve a provider and prepare, without sending

If the owner wants to inspect a draft, choose one legitimate `email_found` candidate and click `Approve provider and prepare email`.

Expected: an unsent draft shows exact recipient, subject, and body; it includes only authorized service details, says the inquiry is exploratory, and does not authorize work.

Verify: recipient equals the published evidence email; there is no exact address or unnecessary personal information.

Stop before `Send this email`. Report the draft and evidence for director review. Do not send a follow-up, clarification, booking, payment, quote acceptance, or other external message.

## Recovery and persistence checks

Before any send, on the same owner-created request:

1. Refresh and verify the request, approved brief, providers, evidence, and contactability persist.
2. In a safe idle state, use `Pause request`; verify the no-new-external-work message; use `Resume request`; verify active state returns.
3. If closure is desired, use `Cancel request`, read the in-product confirmation, and choose `Keep request` or `Confirm cancellation` deliberately. A closed request must not expose research/send controls.
4. Do not mark complete unless the owner intentionally wants to close this no-send request.

Stop if refresh loses state, pause starts work, closed state exposes send controls, or any action affects another request.


## Future mandate campaign proof — not run in this package

The final production UI now presents a generic Job Brief plus an operating-mandate review. A later owner-authorized campaign may use Start finding options, which can research relevant providers, retain source evidence, select only source-backed public-email candidates within the approved cap, and initiate the bounded initial outreach path. That action is an external communication boundary.

Do not click Start finding options during this review package. Do not create a new campaign, send an initial email, send a clarification, send a follow-up, book, pay, accept a quote, change scope, disclose an exact residential address, or make any other external commitment. Director review is required before the first real autonomous campaign.

When that later campaign is authorized, verify:

- the mandate shows the exact provider cap and routine/one-follow-up boundary;
- historical jobs without an explicit mandate have no autonomous action;
- only relevant provider entities with source-backed public business email evidence enter automated outreach; discovery sources never satisfy this gate.
- provider records show truthful Queued, Sent, Failed, needs_user, and waiting states;
- AgentMail identifiers appear only after successful external acceptance;
- a sensitive clarification stops in needs_user;
- pause, cancel, reply, and completion prevent further autonomous action;
- duplicate owner actions do not create duplicate initial outreach.

The future follow-up action is bounded in code and automatic scheduling is now deployed: after a confirmed initial receipt, Findor plans at most one centrally configured 24-hour follow-up, rechecks current state immediately before any send, and records planned/due/skipped/sent/failed outcomes. This implementation was not exercised against a real provider in this package.
## Later real-reply pass (not current authorization)

Only after a genuine external provider reply and separate director authorization:

1. Open the request and verify `Reply received` or `Reply understood`.
2. Confirm sender, subject, timestamp, and original provider body remain visible.
3. Review structured price/availability/timing, included/excluded work, information needed, assumptions, unclear items, and evidence back to the original message.
4. Review comparison and any clarification record; a no-mandate historical job keeps clarification as a draft-only owner action, while a mandate job may send only a classified routine question and must stop at needs_user for sensitive decisions.
5. Report missing or untruthful state; do not repair it through a dashboard.

The inbound journey is not PASS until the actual reply traverses AgentMail, signed production webhook, authenticated Convex persistence, realtime UI, original-message display, and truthful structured/comparison state.


## Deployed follow-up scheduler readiness — not live-run in this package

The implementation is now deployed to production and owner-UAT ready. During the later authorized live campaign, verify only after an initial AgentMail receipt is real and persisted:

- the product shows `Follow-up planned` with a truthful due time and does not expose scheduler identifiers;
- a provider reply before the due time results in `Follow-up skipped` and no follow-up send;
- pause, cancel, complete, revocation, duplicate callback, and a reached cap prevent another external action;
- a successful follow-up shows a real receipt, while a failed attempt shows FAILED without success identifiers;
- a legacy job without an explicit mandate never creates a schedule.

Do not start those live checks in this package. They require the owner-authorized production campaign and a fresh external-communication approval boundary.

## Future bounded recovery implementation — 2026-09-15

The production tree now contains the authorized once-per-job recovery path for new `recoveryEnabled` campaigns. The owner must still opt in a historical campaign explicitly before this path can schedule a final response check. The current Reis/CLEANLY campaign was not opted in and was not changed.

For a future owner-authorized run, verify only after a provider reaches `no_response` or `delivery_failed`: the remaining approved provider capacity, absence of eligible retained candidates, active mandate, one-cycle recovery bound, redacted Firecrawl query, same-origin contact limits, source-backed email gate, and truthful UI state. No live recovery run occurred in this checkpoint. UAT remains paused and is not PASS.
