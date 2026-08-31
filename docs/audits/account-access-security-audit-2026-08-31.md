# Doctor and Secretary Account Access Audit

**Audit date:** 2026-08-31  
**Repository state reviewed:** branch `f5-secretary-authority-frontend`, through commit `7dfd3b4` plus the read-only audit working state  
**Scope:** Doctor and Secretary account creation, email verification, onboarding transition, sign-in, sessions, sign-out, forgot/reset password, voluntary disablement, reactivation, permanent closure, and the directly supporting notification, retention, configuration, CI, and deployment infrastructure.  
**Out of scope:** patient authentication/recovery except where it shares infrastructure, clinic authorization after sign-in, billing, queue operations, and penetration testing against a deployed environment.

## 1. Executive conclusion

The account-access implementation has a sound transactional core, but it is **not production-ready yet**.

The strongest parts are token generation and consumption, server-side session storage, session revocation, generic password-recovery responses, database-backed rate limiting, protected notification payloads, concurrency handling, and role/state eligibility checks. The focused backend test suites all pass and cover many important race conditions.

The principal release blocker is operational: verification and password-reset messages are written as `EMAIL` notifications, but the only running provider adapter is PhilSMS. The worker claims notifications without selecting by channel and is always given the SMS adapter. Consequently, real Doctor/Secretary verification and recovery email delivery is not implemented, and an `EMAIL` row can repeatedly enter processing failure/reconciliation behavior.

There is also a material security mismatch: the UI advertises a strong password policy, while the backend accepts any nonblank password. Other high-priority issues are plaintext account mobile numbers, missing legal-consent evidence, incomplete account-token cleanup wiring, incomplete proxy-aware/layered abuse controls, and bearer tokens/PII remaining in browser URLs.

### Overall decision

| Area | Result | Summary |
|---|---|---|
| Doctor registration | Partially conforms | Atomic account + verification creation works; password, consent, mobile privacy, and production email gaps remain. |
| Secretary registration | Partially conforms | Generic self-registration and blank-until-assigned model conform; same shared gaps remain. |
| Email verification | Partially conforms | Strong, one-time, transactional token lifecycle; approved auto-session onboarding works; no real email adapter and no scheduled expiry cleanup. |
| Sign-in and sessions | Generally sound with improvements required | Eligibility, hashed sessions, cookie flags, idle/absolute expiry, logout and revocation work; timing, proxy/rate-limit, CSP, and session-management improvements remain. |
| Forgot/reset password | Partially conforms | Neutral request response, 30-minute single-use token, concurrency safety and all-session revocation work; backend password policy and delivery/cleanup gaps remain. |
| Disable/reactivate | Conforms to current product rules | Fresh credentials required; no automatic session; Secretary authority is not restored; restricted/permanently closed accounts cannot reactivate. |
| Permanent closure | Strong core, incomplete UX/compliance integration | Irreversible state and session controls exist; registration consent/notice provenance remains incomplete. |
| Production infrastructure | Not ready | Email provider/channel routing, maintenance wiring, proxy trust, frontend lockfile/security scanning, and deployment gates need work. |

## 2. Sources and verification performed

The audit traced controllers, DTO validation, services, Prisma constraints, frontend flows, notification workers, maintenance workers, production configuration, deployment runbooks, CI workflows, and focused tests.

Executed checks:

- Backend TypeScript typecheck: passed.
- 11 focused backend suites: **76/76 tests passed**.
- Covered registration, sign-in, session authentication, verification, password reset, reset maintenance, password hashing, CSRF origin enforcement, Doctor lifecycle, Secretary lifecycle, and production configuration.
- Current backend dependency advisory query: four high-severity advisories reported; applicability is discussed in finding A-09.
- Frontend dependency audit could not run because `frontend/package-lock.json` is deliberately not tracked and was absent from the audited package boundary.

This was a static/source and automated-test audit. It did not include a live provider test, browser security-header capture from the intended production host, distributed rate-limit simulation, or dynamic penetration test.

## 3. Intended workflow and observed behavior

### 3.1 Account creation

The public registration endpoint accepts only `DOCTOR` or `SECRETARY`, normalizes email and mobile input, hashes the password with bcrypt cost 12, creates the user and initial verification record/outbox atomically, and prevents more than one current non-terminal account for a normalized email. See `src/auth/account-registration.service.ts`, `src/auth/dto/register-account.dto.ts`, `src/auth/security/password-security.service.ts`, and the partial unique index introduced by `prisma/migrations/20260814083813_m1s1_account_authority_foundation/migration.sql`.

Both roles use the same registration and verification foundation. This conforms to the approved product decision that a Secretary creates a basic account first and has no clinic authority until assigned by a Doctor.

Doctor-specific profile creation is intentionally deferred in the generic approved registration UI; onboarding routes the verified Doctor to Settings. Secretary onboarding routes to an empty account state and explains that clinics appear only after assignment.

### 3.2 Email verification and onboarding

Verification tokens contain 256 bits of randomness, only SHA-256 hashes are stored, expiration is 24 hours, a unique active key allows one current token per user, replacement revokes the old credential, and consumption locks the token row. Concurrent consumption produces one success and one rejection. Raw links exist only inside authenticated-encryption envelopes in the outbox.

On successful verification, the service marks `emailVerifiedAt`, consumes the verification, creates a hashed server-side session, and returns only role metadata plus an HTTP-only cookie. The frontend refreshes the authenticated profile and continues to the approved role-specific “Account ready” journey without asking the user to sign in again. This matches the latest explicitly approved workflow.

### 3.3 Sign-in and session behavior

Ordinary login requires:

- correct email and password;
- `ACTIVE` account status;
- verified email for Doctor and Secretary;
- no Doctor administrative restriction.

The browser receives an opaque 32-byte random session token in an HTTP-only cookie. Only its SHA-256 hash is stored. Sessions have a two-hour idle lifetime, a twelve-hour absolute lifetime, a five-minute touch throttle, and bounded sliding idle renewal. Multiple sessions are allowed. Logout revokes only the current session and is idempotent. Account disablement, password reset, and permanent closure revoke sessions as appropriate.

### 3.4 Forgot/reset password

Reset requests are non-enumerating and return `{ accepted: true }` for both known and unknown emails. A new request serializes per user, revokes the previous pending token, creates a new 256-bit token, stores only the hash, and creates an encrypted email notification. The link lasts 30 minutes.

Consumption locks the reset row and user, rejects expired/revoked/consumed tokens, changes only the password, consumes and erases the token hash, cancels pending delivery, and revokes every active session. It does not verify an email, remove an administrative restriction, or reactivate a disabled account. These boundaries conform to the tests and product rules.

### 3.5 Disablement, reactivation, and closure

Voluntary disablement revokes active sessions. Secretary disablement also removes active clinic assignment authority and related exceptional capabilities. Reactivation requires the correct role endpoint, normalized email, current password, voluntary-disabled state, and—for Doctors—no administrative restriction. Reactivation creates no session and does not restore Secretary assignments. A new sign-in is required.

Permanent closure is separate and irreversible. Closed identities cannot log in or reactivate, but the same email can later create a new, distinct user identity under the approved historical/current-account constraint.

## 4. Positive security controls to preserve

1. **Raw bearer credentials are not stored standalone.** Session, verification, and reset tokens are generated with `randomBytes(32)` and stored as hashes (`src/auth/security/session-security.ts`, `src/auth/email-verification.service.ts`, `src/auth/password-reset.service.ts`).
2. **Atomicity and race handling are strong.** Registration creates user + verification + outbox in one transaction. Verification and reset use row locks; resend/replacement uses per-user advisory locks.
3. **Recovery enumeration is controlled.** Password-reset and verification-resend requests return generic accepted responses for unknown/ineligible accounts.
4. **Reset invalidates sessions.** All active staff sessions are revoked after password replacement (`src/auth/password-reset.service.ts:190`).
5. **Session cookies have sound baseline flags.** `HttpOnly`, production `Secure`, `SameSite=Lax`, path `/`, and bounded max age are set (`src/auth/auth.controller.ts:64-70`). Domain is omitted, which avoids unnecessarily broad cookie scope.
6. **Server-side session state enables immediate revocation.** Session eligibility is rechecked on every authenticated request.
7. **CSRF origin enforcement is fail-closed in production.** Cookie-authenticated unsafe requests require the configured exact origin; production refuses missing `WEB_APP_ORIGIN`.
8. **Production config rejects placeholders, non-HTTPS public origins, and disabled rate limiting.**
9. **Notification recipient and message bodies are encrypted with AES-256-GCM, purpose-bound AAD, random IVs, and a derived account-notification key.**
10. **Lifecycle boundaries are explicit.** Password reset does not reactivate; reactivation does not create a session; Secretary reactivation does not restore delegated authority.
11. **Frontend does not persist passwords.** “Remember me” stores only the email address and explains that behavior accessibly.
12. **Errors carry correlation IDs without exposing unhandled production exception details.**

## 5. Findings

### A-01 — Blocker — No production email adapter; worker is single-channel and can mishandle EMAIL rows

**Evidence**

- Verification and password reset create `NotificationChannel.EMAIL` outbox rows (`src/auth/email-verification.service.ts:81`, `src/auth/password-reset.service.ts:252`).
- `NotificationModule` registers only `PhilSmsNotificationProviderAdapter`.
- `notification-worker.ts` always resolves that SMS adapter and passes it to every claimed row.
- `NotificationOutboxClaimService.claimNext` selects the oldest pending row without a channel filter.
- `NotificationDeliveryWorkerService` rejects an adapter whose channel differs from the claimed row before delivery.
- Production configuration and the deployment runbook require only PhilSMS credentials; no email provider is defined.

**Impact**

Real users cannot receive verification, password-reset, invitation, or other email notifications. An EMAIL row at the head of the queue can repeatedly be claimed, fail channel validation, and enter expired-lease reconciliation behavior, potentially delaying SMS work as well.

**Required remediation**

Implement a production email adapter with provider idempotency/reconciliation semantics, configure it through validated production secrets, and route/claim by channel (or dispatch to the correct adapter after claiming). Add an integrated worker test proving mixed SMS/EMAIL queues cannot starve either channel. Add provider acceptance to the deployment gate. Keep local reveal helpers development-only.

### A-02 — High — Backend password policy does not match the UI or a safe authentication policy

**Evidence**

- `PasswordSecurityService.assertValid` rejects only whitespace (`src/auth/security/password-security.service.ts:8-12`).
- Registration and reset DTOs have no password length maximum (`src/auth/dto/register-account.dto.ts:41-44`, `src/auth/dto/consume-password-reset.dto.ts:8-10`).
- The reset UI requires 8 characters, uppercase, lowercase, number, and special character, but direct API clients bypass all of those checks.
- bcrypt cost 12 is used, but bcrypt has an effective 72-byte input boundary that the application does not guard explicitly.

**Impact**

Accounts can be created or reset to trivial passwords through the API. Very long passwords have ambiguous bcrypt behavior and unnecessary request/CPU cost. The UI gives a false assurance that the backend does not enforce.

**Required remediation**

Create one server-owned policy used by registration and reset, with corresponding frontend guidance generated from the same documented rule. Prefer a minimum length of at least 12 for single-factor passwords, permit long passphrases, impose a safe maximum measured in bytes before bcrypt, reject known breached/common passwords, and do not silently truncate. Avoid composition rules unless they remain an explicit product decision; length and breached-password screening are stronger modern controls. Add DTO bounds and tests for Unicode/byte length.

### A-03 — High — Account mobile numbers are stored in plaintext despite existing protected-mobile infrastructure

**Evidence**

- `User.mobileNumber` is plaintext `VarChar(30)` (`prisma/schema.prisma:503`).
- Generic account registration normalizes and stores the canonical value directly (`src/auth/account-registration.service.ts:27-54`).
- Other sensitive patient/recovery models already use encrypted value + keyed lookup hash + last four fields.

**Impact**

A database read compromise exposes every Doctor and Secretary mobile number. It also creates inconsistent privacy guarantees inside the same product.

**Required remediation**

Migrate staff mobile storage to encrypted ciphertext plus a versioned keyed lookup hash and masked display field where required. Define uniqueness/search requirements before migration, rotate via key IDs, backfill transactionally, and remove plaintext only after compatibility verification.

### A-04 — High — Account-email token cleanup and encrypted-payload purge services are not wired into maintenance

**Evidence**

- `PasswordResetMaintenanceService` can expire pending resets and delete terminal shells, but `maintenance-worker.ts` never obtains or calls it.
- `NotificationProtectedPayloadPurgeService` can erase terminal protected payloads after 24 hours, but the maintenance worker never calls it.
- There is no equivalent scheduled EmailVerification maintenance service; expired pending records are changed only when accessed/replaced.
- General security retention cleanup covers OTP and booking recovery, not account email verification/password reset.

**Impact**

Expired token hashes and encrypted email addresses/message bodies can remain longer than intended. Pending expired rows are not guaranteed to become terminal, which can interfere with retention cleanup and notification processing.

**Required remediation**

Wire password-reset expiry/deletion and protected-notification payload purge into the maintenance worker. Add a bounded EmailVerification maintenance service with the same locking/retention discipline. Add operational metrics for pending-expired and protected-payload age, plus an end-to-end maintenance test.

### A-05 — High — Abuse protection is not proxy-aware or layered enough for internet deployment

**Evidence**

- Login, registration, reset request, and resend use database rate limits keyed by `policy + request.ip + email`.
- `main.ts` does not configure a trusted reverse proxy, while `RateLimitGuard` relies on `request.ip` (`src/rate-limit/rate-limit.guard.ts:41`).
- There is no independent per-IP ceiling, per-account ceiling across IPs, progressive delay, credential-stuffing detection, or account security alert.
- Token-consumption endpoints `/auth/verify-email` and `/auth/reset-password` have no endpoint rate-limit decoration.
- Unknown-user login skips bcrypt, creating a potential timing distinction.
- Every reset/resend revokes the previously pending link; distributed requests can repeatedly invalidate a victim’s newest link.

**Impact**

Behind a proxy, all clients may share one apparent IP (availability problem), or unsafe proxy configuration may permit spoofing. Distributed credential stuffing and link-invalidation denial of service remain possible. Login timing may aid account discovery despite generic text.

**Required remediation**

Define explicit trusted-proxy topology and tests. Layer per-IP, per-account, and global/provider-cost limits; normalize rate-limit subjects before validation; consider progressive backoff and security notifications. Perform a dummy password hash comparison for missing users. Rate-limit token-consumption failures without making legitimate one-click consumption fragile. Avoid CAPTCHA as the only control.

### A-06 — High — Registration consent is cosmetic and legal documents are not connected

**Evidence**

- The frontend requires a local checkbox, but Terms of Service and Privacy Policy are inert buttons (`frontend/src/auth/CreateAccountPage.tsx:117`).
- The registration DTO and service do not receive or persist accepted versions/timestamps.
- No account-level consent/notice provenance exists for this flow.

**Impact**

The system cannot prove what terms/privacy notice a user accepted, and users cannot open the documents they are asked to accept. Direct API registration bypasses consent entirely.

**Required remediation**

Publish real versioned documents, use real links, add server-required version identifiers and acknowledgment timestamps, and persist immutable provenance. Confirm with legal/privacy review whether consent or acknowledgment is the correct basis for each document; do not label privacy notice acknowledgment as consent unless appropriate.

### A-07 — Medium — Sensitive email addresses and bearer tokens remain in browser query strings

**Evidence**

- The check-email route places the registration email in `?email=` and displays it from `location.search` (`frontend/src/auth/PostRegistrationPages.tsx:63`).
- Verification and reset pages read live bearer tokens from query parameters (`frontend/src/auth/AccountAccessPages.tsx:126`, `frontend/src/auth/PasswordRecoveryPages.tsx:89`).
- API responses set `Referrer-Policy: no-referrer`, but the repository does not define equivalent headers for the separately hosted frontend/static page.

**Impact**

URLs can be retained in browser history, copied, captured in screenshots, proxy/access logs, analytics, crash reports, or referrers if the static host does not enforce policy. Verification now creates a session, increasing the sensitivity of the verification URL.

**Required remediation**

After reading a token, immediately replace browser history with a clean URL while retaining the token only in memory for the request. Pass the registration email through transient navigation state or mask it; do not put it in a URL. Configure the frontend host/CDN with `Referrer-Policy: no-referrer`, `Cache-Control: no-store` on token pages, a restrictive CSP, and log redaction for query strings.

### A-08 — Medium — Authentication response timing and registration responses can disclose account existence

**Evidence**

- Login performs bcrypt only when a user exists (`src/auth/auth.service.ts:36-51`).
- Registration explicitly returns `A current account already uses this email` (`src/auth/account-registration.service.ts:40`).
- Reactivation correctly groups wrong account type/email/password into a neutral frontend error after the latest UI change.

**Impact**

Attackers may enumerate current accounts using registration responses or repeated timing measurements. Whether explicit registration conflict is acceptable is a product/security decision, but staff emails are valuable targets.

**Required remediation**

Use a fixed dummy hash for missing-user login. Decide and document whether signup may disclose existing accounts; a safer pattern is a neutral response plus an account-help email to the owner. Preserve generic password-reset/resend behavior.

### A-09 — Medium — Dependency and CI supply-chain gates are incomplete

**Evidence**

- Current root `npm audit --omit=dev` reported four high findings: `deepmerge-ts` through Prisma configuration, `fast-uri`, `@prisma/config`, and `prisma`.
- `npm ls` shows `fast-uri` primarily through build/CLI tooling and `deepmerge-ts` through Prisma tooling; exploitability in the deployed API is not established by this audit.
- Frontend audit failed because no frontend lockfile is available in the repository; `.gitignore` excludes it.
- CI uses `npm install`, not deterministic `npm ci`.
- Backend CI runs selected lint/tests rather than the repository’s complete static gate, has no dependency audit/SBOM step, and does not syntax-check the two new account-link development helpers.
- Frontend push CI is restricted to the historical `f0-frontend-foundation` branch.

**Impact**

Builds are less reproducible, vulnerability status is harder to govern, and account-access regressions can miss CI depending on the changed path/branch.

**Required remediation**

Track lockfiles for both applications, use `npm ci`, run the complete backend and frontend gates on protected branches/PRs, add audit/SBOM review with an explicit triage policy, and update affected transitive dependencies without blindly applying a Prisma downgrade. Record why tooling-only advisories are or are not reachable in production.

### A-10 — Medium — Encryption key rotation supports only the active key

**Evidence**

`ProtectedAccountPayloadService` embeds a key ID in each envelope but initializes only one active key and rejects envelopes whose key ID differs from the current active ID.

**Impact**

Changing the encryption key can make still-pending verification/reset/invitation messages undecryptable. Emergency key rotation could interrupt account recovery.

**Required remediation**

Support a key ring: one active encryption key and bounded previous decryption keys, each versioned by key ID. Document rotation, re-encryption/expiry behavior, rollback, and revocation. Keep purpose-derived keys.

### A-11 — Medium — Frontend/static security headers are not defined in this repository

**Evidence**

The Nest API emits HSTS, frame denial, no-referrer, MIME sniffing, permissions, and CORP headers. The login/registration application is a separately built Vite artifact, and no static-host configuration defining equivalent headers or a Content Security Policy was found.

**Impact**

The actual credential pages may not receive the API’s headers. Missing CSP increases the impact of a future XSS/dependency compromise; missing no-store/no-referrer policies increase token leakage risk.

**Required remediation**

Define and test headers at the real frontend CDN/reverse proxy: CSP using nonces/hashes where needed, HSTS, `frame-ancestors 'none'`, no-referrer, no-sniff, permissions policy, and appropriate cache controls. Add a deployment smoke test that captures the login, verification, and reset page headers.

### A-12 — Low/Medium — Session governance is functional but lacks user controls and operational limits

**Evidence**

Multiple sessions are intentionally allowed; there is no active-session list, “sign out all devices,” session count cap, device metadata, or suspicious-login notification in the audited UI/services. Revoked/expired session cleanup depends on broader retention behavior rather than a user-facing control.

**Impact**

Users cannot inspect or terminate other active sessions after device loss unless they reset their password or disable the account. Unlimited successful logins can accumulate session rows.

**Required remediation**

Add session inventory and revoke-one/revoke-all actions, cap or prune active sessions per account, notify on meaningful sign-in events, and expose last-used timestamps without collecting unnecessary fingerprinting data.

### A-13 — Low — “JWT_SECRET” is required even though ordinary staff sessions are opaque database tokens

**Evidence**

Production configuration requires `JWT_SECRET`, while the audited ordinary Doctor/Secretary session implementation uses random opaque tokens and SHA-256 database hashes, not JWTs.

**Impact**

This creates configuration ambiguity and may lead operators to believe JWT rotation controls staff sessions when it does not.

**Required remediation**

Document the exact consumer of `JWT_SECRET`, rename it if it belongs to another subsystem, or remove it from the account-access production gate if unused. Maintain a data-flow inventory for every secret.

## 6. Flow conformance details

### Doctor

- **Create account:** Works through the generic role-aware endpoint and creates a verification requirement. Current frontend intentionally collects only basic identity data; professional profile and first clinic are deferred to onboarding/Settings.
- **Verify:** Works atomically and now creates the session required by the approved no-second-login onboarding flow.
- **Onboarding:** “Start setup” points to protected `/app/settings`; current Settings content is still a placeholder, which is known and outside this audit’s implementation request.
- **Sign in:** Correctly blocks unverified, disabled, closed, and administratively restricted Doctors.
- **Reset:** Correctly changes credentials without removing restrictions or changing lifecycle state.
- **Reactivate:** Correctly requires voluntary disablement, no administrative restriction, and current credentials; creates no session.

### Secretary

- **Create account:** Correctly permits independent basic account creation before invitation.
- **Verify:** Uses the same secure generic verification lifecycle.
- **Initial state:** Correctly has no clinic authority and explains that assignments come from Doctors; multiple-clinic capability is represented in the product UI.
- **Sign in:** Correctly permits an active verified Secretary even with no assignments, yielding the blank/basic workspace.
- **Reset:** Uses the same reset flow and does not grant clinic authority.
- **Disable/reactivate:** Disablement removes assignments/capabilities; reactivation does not restore them. A Doctor must assign the Secretary again.

## 7. Prioritized remediation plan

### Release blockers

1. Implement channel-aware production email delivery and mixed-channel worker tests (A-01).
2. Enforce one backend password policy across registration/reset and align UI/tests (A-02).
3. Wire EmailVerification/PasswordReset expiration and protected-payload purge into maintenance (A-04).
4. Define production proxy trust and layered authentication throttling (A-05).

### Before handling real user data

5. Encrypt/migrate account mobile numbers (A-03).
6. Implement real Terms/Privacy pages and server-side versioned acknowledgment provenance (A-06).
7. Remove email/token query data from browser history and configure static-host headers (A-07, A-11).
8. Resolve timing/account enumeration policy (A-08).
9. Track frontend lockfile, make CI deterministic, and triage advisories (A-09).

### Hardening backlog

10. Implement encryption key-ring rotation (A-10).
11. Add session inventory, revoke-all, caps/pruning, and security notifications (A-12).
12. Clarify/remove the apparent unused `JWT_SECRET` requirement (A-13).
13. Consider phishing-resistant MFA/passkeys for Doctor and system-administration access in a later security milestone; do not add SMS as the sole high-assurance factor.

## 8. Recommended acceptance tests for the next hardening slice

1. Registration and reset reject weak/common/over-byte-limit passwords through direct HTTP calls, not just the UI.
2. Mixed pending EMAIL and SMS outboxes are delivered by the correct adapters without starvation.
3. Email provider retries, uncertainty, idempotency, and reconciliation never send duplicate live links unexpectedly.
4. Expired verification/reset records become terminal and protected payloads are purged on schedule.
5. Requests behind the production proxy resolve the intended client IP; spoofed forwarding headers do not bypass limits.
6. Distributed login/reset abuse triggers per-account/global controls while a legitimate user can recover.
7. Verification/reset URLs disappear from browser history immediately after page load and are absent from frontend access logs/referrers.
8. Registration persists exact Terms/Privacy versions and timestamps and rejects missing/unknown versions server-side.
9. Staff mobile plaintext no longer exists after migration and rollback/rotation drills pass.
10. Login, verification, reset, reactivation, and closure pages return the expected production security headers.

## 9. External security baselines used for interpretation

- OWASP Authentication Cheat Sheet: <https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html>
- OWASP Forgot Password Cheat Sheet: <https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html>
- OWASP Session Management Cheat Sheet: <https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html>
- OWASP Password Storage Cheat Sheet: <https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html>
- OWASP Cross-Site Request Forgery Prevention Cheat Sheet: <https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html>
- OWASP ASVS project: <https://owasp.org/www-project-application-security-verification-standard/>

These references guide risk interpretation; this report does not claim formal ASVS certification.

## 10. Final audit position

The product behavior is largely coherent and the security-sensitive database transitions are better designed than the current UI/infrastructure maturity might suggest. The implementation should not be rewritten wholesale. Preserve the transactional token/session/lifecycle core, then close the delivery, password-policy, retention, privacy, proxy, and deployment gaps in that order.

Until A-01, A-02, A-04, and A-05 are resolved and retested, production account creation and recovery should remain blocked.
