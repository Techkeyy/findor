# Findor product-promise matrix

As of 2026-09-14. Feature evidence is not an overall release claim.

| Feature | UI | Backend | Real integration | Production | Recovery | Owner UAT | Final |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Sign-up/sign-in | PASS | PASS | Normal-user runs | PASS (automated production auth/persistence/error checks) | Refresh and duplicate normalization observed | STILL PAUSED (owner has not started) | PENDING owner review |
| Generic request + missing info | PASS | PASS | Normal-user runs | PASS | Refresh observed | PENDING | PENDING owner review |
| Standardized Job Brief + approval | PASS | PASS | Generic runs | PASS | State guarded | PENDING | PENDING owner review |
| Provider research | PASS | PASS | REAL Firecrawl | PASS | Operation guard | PENDING | PENDING owner review |
| Relevance/source evidence | PASS | PASS | Real URLs retained | PASS | Failed sources truthful | PENDING | PENDING owner review |
| Bounded contact discovery | PASS | PASS | REAL same-domain Firecrawl | PASS | Operation guard | PENDING | PENDING owner review |
| Email contactability gate | PASS | PASS | Public evidence; no inference | PASS | Website-only blocked | PENDING | PENDING owner review |
| Provider approval + draft | PASS | PASS | Prepared in normal UI | PASS | Owner-only | PENDING | PENDING owner review |
| Real AgentMail send | PASS | PASS | Accepted Day 1 real send | PASS accepted evidence | Send claim lock; failure truthfulness | PENDING fresh owner pass | Feature proven; overall pending |
| External message/thread IDs | PASS | PASS | Accepted Day 1 real IDs | PASS accepted evidence | Persist after successful send | PENDING | Feature proven; overall pending |
| Waiting state | PASS | PASS | Altitude inspected read-only | `ALTITUDE_STATUS = WAITING_FOR_EXTERNAL_REPLY` | Refresh-safe | PENDING | BLOCKED by external reply |
| Signed inbound webhook | N/A | PASS | Signature/inbox/dedup logic | Route + 401 negative check | Quarantine implemented | PENDING | NOT PROVEN end-to-end |
| Real inbound reply | PASS when data exists | PASS | NOT PROVEN; no genuine reply | NOT PROVEN | Not live-proven | PENDING | NOT PASS |
| Original reply + interpretation | PASS in fixtures | PASS | Fixture only | NOT PROVEN | Needs-review exists | PENDING | NOT PASS |
| Quote/offer + comparison | PASS in fixtures | PASS | No real response | NOT PROVEN | Not live-proven | PENDING | NOT PASS |
| Clarification preparation | PASS in fixtures | PASS | No real response | NOT PROVEN | Draft-only | PENDING | NOT PASS |
| Pause/resume/cancel | PASS | PASS | Production UAT PASS | PASS | Recovery UAT PASS | PENDING | PENDING owner review |
| Complete | PASS | PASS | Local regression | PARTIAL | Owner/state guarded | PENDING | PENDING owner review |
| Refresh persistence | PASS | PASS | Observed states | PASS observed states | Partial live coverage | PENDING | PENDING owner review |
| Tenant isolation | PASS UI | PASS owner checks | Deterministic + automated production cross-user checks | PASS automated two-user check | Wrong-user/unauth denied in tests | STILL PAUSED | PENDING security UAT |

## Interpretation

The accepted Day 1 real-send chain is a feature-level PASS; no new outbound send was authorized here. No matching Altitude thread or persisted production sent-outreach record was found, so the exact state is waiting, not fabricated. The signed inbound route is deployed and protected, but no real provider reply has traversed it; inbound display, interpretation, comparison, and the complete Day 2 journey are therefore not PASS. Owner UAT is pending. No overall RELEASE READY, SUBMISSION READY, or FINISHED status is claimed.

See [MANUAL_UAT.md](MANUAL_UAT.md).

## Mandate autonomy implementation checkpoint — 2026-09-14

| Capability | UI | Backend | Synthetic proof | Production | Owner UAT | Final |
| --- | --- | --- | --- | --- | --- | --- |
| Explicit operating mandate | PASS | PASS | Bounded cap/default test | DEPLOYED; not invoked | STILL PAUSED | PENDING |
| Inert legacy records | PASS | PASS | No-mandate queue/send guard | DEPLOYED; not invoked | STILL PAUSED | PENDING |
| Bounded source-backed autonomous initial send | PASS | PASS | Queue cap, website-only exclusion, ownership, claim/receipt tests | Not invoked in this package | Not run | NOT PROVEN live |
| Failed-send truthfulness | PASS | PASS | Failed-state and receipt-idempotency tests | Not invoked in this package | Not run | NOT PROVEN live |
| Routine clarification boundary | PASS | PASS | Routine vs sensitive classifier tests | DEPLOYED; not invoked | Not run | NOT PROVEN live |
| Human stop / needs_user | PASS | PASS | Sensitive-attribute stop test | DEPLOYED; not invoked | Not run | NOT PROVEN live |
| One-follow-up cap and post-receipt scheduling | PASS | PASS | Deterministic receipt/schedule/recheck proof; no real AgentMail run in this package | Deployed; no historical schedules created | PENDING owner UAT | IMPLEMENTATION PASS; live path pending |
| Bounded non-response recovery | PASS | PASS | Deterministic decision and one-cycle bound tests; no external calls in implementation turn | Deployed behind new-campaign `recoveryEnabled` and owner-only opt-in | PENDING owner UAT | IMPLEMENTATION PASS; live path pending |

This checkpoint reports implementation evidence only. No new external communication occurred. The first real autonomous campaign must be initiated by the owner through the final production UI after director review; owner UAT is not PASS.

## Follow-up scheduling completion checkpoint — 2026-09-14

The single previously disclosed implementation gap is closed. A confirmed initial AgentMail receipt is persisted first; Convex then schedules a centrally configured 24-hour follow-up callback. The callback rechecks current mandate, job, thread, reply, pause/cancel/complete, revocation, cap, and ownership state before creating or sending one bounded follow-up. Legacy jobs remain inert, and the production audit found no newly eligible old records or pending follow-up schedules.

This is an implementation and deployment PASS, not a live external-communication proof. No new Firecrawl run, AgentMail initial send, follow-up, provider reply, webhook journey, owner manual UAT, or other external commitment occurred in this package. UAT READY = YES for director review; UAT PASS remains NO.
