# Frontend F5 Closure Record

Clinic Queueing SaaS Version 1

Milestone: F5 - Authentication and Account Lifecycle
Closure date: 2026-08-23
Status: CLOSED
Branch: `f5-auth-account-lifecycle`

## 1. Scope closed

F5 implemented and accepted the staff authentication and account-lifecycle experience required by the approved frontend authority, including:

- Doctor account registration;
- email verification;
- staff sign-in;
- password-reset request and reset-link completion;
- session revocation after password replacement;
- account/security settings;
- voluntary Doctor account disablement;
- current-password re-authentication before disablement;
- voluntary account reactivation without automatic sign-in;
- permanent Doctor account closure warnings and explicit irreversible confirmation;
- credential confirmation before permanent closure;
- permanent-closure terminal-state behavior;
- client authentication-state reconciliation after session-invalidating lifecycle actions.

The approved frontend authority defines F5 as Doctor registration, verification, login, Secretary login, password reset, account/security settings, disable/reactivate, and Permanent Delete warnings/workflows.

## 2. Product Owner browser acceptance performed

The Product Owner manually exercised the F5 workflows in the browser using a disposable Doctor account.

Observed acceptance evidence included:

- new Doctor registration routed to email verification;
- development verification-link flow completed successfully;
- verified Doctor sign-in reached the Doctor workspace;
- sign-out and subsequent sign-in worked;
- password-reset request produced the privacy-neutral confirmation screen;
- password-reset link allowed a new password to be set;
- successful password replacement revoked existing staff sessions and required fresh sign-in;
- account-security page exposed password reset, voluntary disablement, and permanent closure separately;
- voluntary disablement required a current password after the Product Owner security finding;
- a wrong current password was rejected and left the account active;
- a correct current password disabled the account and revoked the active session;
- disabled-account reactivation succeeded but did not automatically sign the user in;
- permanent-closure review clearly warned that the action cannot be undone and that the Doctor public profile/booking route is retired;
- permanent closure required account type, email, password, and explicit irreversible acknowledgement;
- wrong permanent-closure credentials were rejected;
- successful permanent closure produced the completion screen and returned the user to the public home page;
- the permanently closed Doctor could not sign in again;
- the permanently closed Doctor could not be reactivated.

## 3. Acceptance findings and corrections

### 3.1 Current-password re-authentication for voluntary disablement

Initial browser acceptance showed that a signed-in Doctor could disable the account without re-entering the current password.

Product Owner decision:

- disabling an account is a vital account-control action and must require the Doctor to re-enter the current password before the action takes effect.

Correction:

- backend disable endpoints are protected by a current-password guard;
- frontend disable confirmation requires the current password;
- wrong password fails closed;
- successful disablement revokes the session.

Automated regression coverage was added for the current-password guard and frontend submission behavior.

### 3.2 Disable-account confirmation layout

Browser acceptance found the password field and confirmation buttons visually crowded/overlapping.

Correction:

- the password control, error area, and action buttons were spaced as distinct rows within the existing monochrome clinical design;
- no business rule or backend behavior changed.

### 3.3 Permanent-closure credential error clarity

The first wrong-password permanent-closure test returned only `Unable to permanently close account.`

Correction:

- authenticated permanent-closure UI now presents `Email or current password is incorrect.` for the generic invalid-credential case;
- this improves usability without revealing which credential failed or whether a supplied email exists;
- other business-rule blockers retain their specific backend messages.

Regression coverage verifies that invalid permanent-closure credentials do not transition to the completion screen.

### 3.4 Stale frontend authentication state after permanent closure

After the first successful permanent closure, clicking `Return home` and then `Staff sign in` could reopen the Doctor workspace in the same browser even though the backend account had already been permanently closed and its sessions revoked.

Root cause:

- backend controls were already correct: permanent closure revoked unrevoked sessions and changed the account out of `ACTIVE` state;
- ordinary-session authentication independently rejects non-`ACTIVE` accounts;
- the frontend `AuthContext` still held the old Doctor profile in memory after the destructive command and could redirect based on stale client state.

Correction:

- after successful permanent closure, the frontend immediately refreshes the authenticated profile;
- the revoked/non-active server session resolves the client to anonymous before the completion journey continues;
- regression coverage verifies that permanent closure refreshes authentication state.

Product Owner retest then confirmed:

- public `Staff sign in` stayed on the sign-in surface rather than reopening `/app`;
- the permanently closed Doctor's old credentials returned `Invalid email or password.`;
- `Reactivate disabled account` returned `Unable to reactivate account.` for the permanently closed identity.

## 4. Automated verification actually performed

Verified branch-head implementation commit before this documentation-only closure commit:

- `d142f5cc63e281f6eac2d5ce7ea3685c06db52d2`.

Final implementation CI at that commit:

- Backend CI #128: PASS;
- Frontend CI #206: PASS.

Earlier accepted correction checkpoints also passed both backend and frontend CI, including:

- current-password re-authentication implementation;
- disable-confirmation layout cleanup.

The final CI run covers the cumulative F5 implementation, including the permanent-closure credential-message correction and stale-authentication-state regression fix.

## 5. Security and lifecycle conclusion

F5 preserves backend authority for account lifecycle and session eligibility.

Important controls proven during acceptance:

- password replacement invalidates existing staff sessions;
- voluntary disablement requires current-password confirmation and revokes sessions;
- voluntary reactivation does not create a session automatically;
- permanent closure requires explicit irreversible confirmation plus account credentials;
- permanent closure is terminal and cannot be reactivated;
- permanently closed identities cannot regain ordinary authenticated access;
- frontend authentication state is reconciled after server-side session-invalidating commands rather than trusting stale in-memory state;
- ordinary login remains privacy-neutral and does not disclose whether a credential belongs to a permanently closed account.

## 6. Deferred final hardening item

The Product Owner requested a later final-stage security/usability hardening rule for sensitive current-password confirmation fields:

- manual clipboard paste, including Ctrl+V and context-menu Paste, should be blocked;
- browser/password-manager saved-credential autofill should remain allowed;
- if no saved credential is available, the user must type the password manually.

This is intentionally DEFERRED to the final project hardening stage and does not reopen F5.

The implementation should revisit exact field scope at that stage so normal password-manager use is not accidentally impaired.

## 7. Deferred / not part of F5 closure

The previously documented live PhilSMS provider acceptance remains deferred pending the supported Globe test SIM. That external-provider acceptance belongs to Milestone 13/release-candidate work and does not reopen F5.

F6 - Doctor Practice Administration is the next approved frontend milestone.

## 8. Git checkpoint

F5 is authorized as a verified implementation checkpoint after Product Owner browser acceptance and the final branch-head CI passes.

Recommended next working milestone: F6 - Doctor Practice Administration.
