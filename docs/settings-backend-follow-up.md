# Settings backend follow-up and implementation checkpoints

## User decisions — September 3, 2026

Follow-up approval: “ok lets do that all” authorizes the remaining Settings work and recommendations, with #2 profile details still deferred and account-only exports mandatory. The original discussion below is historical; checkpoint sections record actual delivery.

## Checkpoint: General defaults and additive copying (#5–6)

- GET/PATCH account settings now expose timezone, advance-booking days (1–365), and online-booking permission, with server validation and current owner/account-state predicates. Omitted fields remain unchanged. Existing clinic configuration is never rewritten. Existing booking logic uses advance-booking/online permission practice-wide for new bookings; the UI explicitly says so. Changing timezone does not rewrite existing clinic timezones.
- Copy services, questions, or both; copy all missing or selected templates. Explicit empty selection means none of that kind; omitted selection retains compatibility by selecting all of that kind.
- Copy is additive only. Existing source-linked service/question rows are skipped, including inactive or locally edited copies. New questions append after existing order. No historical answers or existing clinic entries are modified.
- Backend rechecks ownership and active account state, locks the actor and clinic rows, validates all targets and five-active-question capacity before writing, and applies atomically. Idempotency fingerprints include selections. The UI reviews selections and preserves retry keys after uncertain failures.
- No schema change. Seven historical-question database tests passed against the isolated test database, with only test-designated fixtures modified. Backend: 141 suites / 671 tests passed; frontend full run: 134 passed and one outdated retry mock failed, then both affected suites passed (14 tests) after fixing the mock to return a fresh response per request. Type checks, lint, and both builds passed. Existing frontend bundle-size warning remains.

Remaining: password workflows, notification expansion, audit read model, account-only export/backup, privacy inventory/status, and template-management follow-up. They are not claimed complete by this checkpoint.

This records the discussion following checkpoint `8956061`. It is not a claim that every item below is implemented.

1. Account disablement: user requested clarification. Existing route does not verify a password. No change authorized specifically to this workflow yet.
2. Profile details: explicitly leave unchanged for now.
3. Password changes: user requested a recommendation, not implementation yet. Recommend current-password verification, strong passphrases, secure hashing, server-side validation and throttling, revocation/rotation of sessions, and an account security notification. No periodic password rotation without a reason. Password policy needs a final decision before changing registration/recovery/change behavior.
4. Active Sessions: approved. Implemented in this checkpoint as described below.
5. General defaults: user expects reusable Doctor defaults that can be copied to clinics. Storage exists, but public account-settings API does not expose these settings. Clarify distinction between changing a default and explicitly applying it to existing clinics; existing clinic overrides must be preserved.
6. Applying templates: approved additive-only behavior. Must not remove or modify existing clinic services/questions. Proposed UI: copy all missing templates or select individual templates to copy; repeated copies skip previously copied templates. Existing clinic edits and order must stay intact. Backend must recheck ownership, duplicates, and the five-active-question limit; when capacity would be exceeded, reject with a useful message rather than silently removing anything. This is queued, not yet implemented.
7. Reordering/deletion of default templates: user requested explanation; do not silently add destructive template operations. Existing edit/inactivate options remain.
8. Notifications: approved expansion to account-related payment events, developer announcements/updates, secretary onboarding and invitation acceptance. Only trusted server event producers and authorized administrative publishing may create these notices; scope delivery to the affected account. Queued, not implemented in this checkpoint.
9. Notification display details: user requested explanation. Current notification payload has IDs but not names. Safe historical display details must not enable unrelated-secretary discovery.
10. Doctor audit log: approved. Read-only, Doctor-scoped, retention-safe history and totals required. Queued; no generic unrestricted audit-data endpoint should be created.
11. Export/backup: approved with explicit follow-up: **no patient-related information; account data only**. Use backend-selected allowlists. Never include password hashes, tokens, other accounts' private data, appointments, patient identities, booking answers, or patient-linked queue data. Do not assume permission for restore/import workflows. Queued, not implemented in this checkpoint.
12. Privacy status: user requested explanation. Missing worker-health visibility does not prove erasure is absent. Do not show “Active” without evidence or infer that patient data is retained forever.

Security requirement applies throughout: backend authorization, ownership, validation, concurrency controls, password checks where required, and privacy restrictions are authoritative. UI checks are for usability, never a substitute.

## Checkpoint: Active Sessions (#4)

### Backend

- `GET /auth/sessions`: only the signed-in, active, verified, unrestricted Doctor's live sessions. No token/hash fields. Response is non-cacheable.
- `POST /auth/sessions/:sessionId/revoke`: owner-only revocation; rejects the current session and invalid IDs. Repeating a completed revocation is harmless.
- `POST /auth/sessions/revoke-others`: verifies the current password on the server, preserves the calling session, and revokes only that Doctor's other live sessions.
- All routes require authentication; mutations require the existing trusted-origin check. Existing global rate limiting policies cover listing, individual revocation, and password attempts.
- Transactions lock the account, then the calling session, and recheck current status/expiry. Bad passwords, stale sessions, or foreign target IDs cannot cause revocation.
- Sessions whose sign-in commits after revocation are new sign-ins, not blocked future access. This action does not change the password or lock the account.
- No database migration. Browser names, IP locations, and device fingerprints were not previously stored and are not fabricated or newly collected. UI shows actual timestamps.

### Frontend

- Active sessions are loaded in Account & Security.
- Current session is identified and cannot be revoked using the other-session controls.
- Individual sign-out requires confirmation; bulk sign-out requires the current password.
- Success refreshes the list. Failure leaves the form and list intact; cancellation makes no request.
- The Manage Active Sessions panel and sidebar quick actions use the same controls.

### Verification

Unit and HTTP-boundary tests cover account ownership, role/state changes, current-session protection, session expiry, incorrect passwords, safe output selection, unauthenticated access, cross-origin requests, malicious identity fields, UUID validation, and rate-policy metadata. Frontend tests cover confirmation, endpoint payloads, list refresh, cancellation, and error preservation. Tests use mocked data; no real user's sessions were revoked during verification.

Verification results: 140 backend suites / 663 tests passed; 35 frontend suites / 134 tests passed (two workers, 15-second UI-test allowance). Backend and frontend type checks and builds passed. Frontend retains the existing non-blocking large-bundle warning. No database reset or migration was performed.

## Next authorized checkpoint

Implement #6's additive-only defaults workflow, including copy-all-missing and selected-copy modes, impact/capacity checks, and regression coverage preserving clinic-local configuration. Then proceed with #8, #10, and the account-only scope of #11 in separate tested checkpoints. Do not treat profile work (#2) or clarification-only items as newly approved changes.
