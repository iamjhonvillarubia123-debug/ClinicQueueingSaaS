# Clinic Queueing SaaS Version 1 Product Owner Acceptance Runbook

## Purpose

This is the final Milestone 13 business-level acceptance checklist for Version 1.

It follows the approved end-to-end sequence:

Doctor onboarding -> PracticeLocation setup -> Secretary governance -> Services/schedule -> patient booking -> multi-person booking -> Appointment confirmation -> live queue -> patient access -> notifications -> subscription -> public profile/QR -> privacy lifecycle.

This runbook does not replace automated verification. Product Owner acceptance confirms that the integrated user/business workflow behaves as intended after the automated gates are green.

## Preconditions

Before beginning final acceptance:

- the release-candidate commit is identified;
- `npm run verify:static` has passed for that commit;
- `npm run test:load` has passed;
- `npm run test:db-drill` has passed;
- rollback compatibility has been verified against the previous known-good release;
- production configuration preflight has passed in the deployment environment or remains explicitly pending until deployment;
- the PhilSMS live/provider acceptance step is available, or is explicitly marked BLOCKED and no final Milestone 13 closure is claimed;
- test accounts and test mobile numbers contain no real patient medical information.

## Acceptance evidence convention

For each section record:

- PASS / FAIL / BLOCKED;
- date/time;
- actor role used;
- short observed result;
- screenshot/reference when useful;
- defect reference if failed.

Do not place passwords, OTP values, access tokens, patient free text, or full mobile numbers in acceptance evidence.

## 1. Doctor onboarding and account access

Acceptance objective: a new Doctor can establish an account under the approved verification and access rules.

Verify:

1. Doctor registration accepts valid required data and rejects invalid input.
2. Registration does not create an unintended logged-in session before the approved verification/login flow.
3. Verification establishes the approved account state.
4. Ordinary Doctor login succeeds after verification.
5. Incorrect credentials fail without exposing sensitive internal information.
6. Account disable/reactivation behavior matches the approved lifecycle.
7. Permanent-delete authentication is protected and cannot be performed accidentally.

Result: ____________________
Evidence: __________________

## 2. PracticeLocation setup

Acceptance objective: the Doctor can create and configure an independent PracticeLocation without weakening Doctor-wide governance.

Verify:

1. A PracticeLocation can be created in the approved initial/draft state.
2. Required clinic-hour configuration can be supplied.
3. Doctor-wide defaults can be applied only when explicitly selected.
4. Existing non-selected PracticeLocations are not silently rewritten.
5. Location activation requires the approved prerequisites.
6. Disable/reactivate preserves the stable public identity where required.
7. Permanent deletion follows the approved lifecycle and public routing retirement rules.

Result: ____________________
Evidence: __________________

## 3. Secretary governance

Acceptance objective: Doctor authority remains distinct from Secretary operating authority.

Verify:

1. The Doctor can assign a Secretary to the intended PracticeLocation.
2. Secretary access is limited to authorized PracticeLocation scope.
3. Secretary configuration changes that require approval remain pending until Doctor approval.
4. Approval applies the intended changes atomically.
5. Rejection/withdrawal does not partially alter live clinic configuration.
6. Secretary replacement/deactivation does not grant access outside the approved lifecycle.

Result: ____________________
Evidence: __________________

## 4. Services and schedule

Acceptance objective: booking-visible services and availability derive from approved configuration.

Verify:

1. Services can be configured and activated for the intended PracticeLocation.
2. Clinic schedule and exceptions produce the expected available dates/times.
3. Doctor cross-location conflicts are prevented.
4. Schedule approval does not create overlapping Doctor obligations.
5. Public availability reflects approved active configuration rather than draft settings.

Result: ____________________
Evidence: __________________

## 5. Individual patient booking

Acceptance objective: a patient can create one valid individual booking through the public flow.

Verify:

1. Public Doctor/PracticeLocation entry reaches valid booking availability.
2. BookingDraft accepts the approved temporary patient information.
3. Required booking questions are enforced.
4. Duplicate-mobile and active-booking controls behave as approved.
5. OTP/verification rules are enforced where required.
6. Confirmation creates exactly one Appointment and assigns a permanent Queue Number.
7. Repeated/idempotent confirmation does not create duplicate Appointments.

Result: ____________________
Evidence: __________________

## 6. Multi-person booking

Acceptance objective: BookingGroup behavior preserves individual queue identity while applying the approved group controls.

Verify:

1. A valid multi-person booking can be created within the approved group-size rules.
2. Each member receives an individual Appointment and permanent Queue Number.
3. Group ordering/protection behaves as approved.
4. Cancelling one member does not renumber remaining members.
5. Adding an eligible person before clinic start does not rewrite existing Queue Numbers.
6. A cancelled historical member does not reopen an already-used group capacity slot when the approved historical-cap rule applies.
7. Group members do not gain the individual I'M HERE self-reinsertion exception that the approved design disables for the group flow.

Result: ____________________
Evidence: __________________

## 7. Appointment confirmation and clinic start

Acceptance objective: confirmed bookings become an authoritative clinic-day queue without race-induced duplication or renumbering.

Verify:

1. START CLINIC creates/opens the intended clinic-day queue once.
2. Concurrent confirmation/start boundaries do not admit invalid late changes.
3. Permanent Queue Numbers remain stable.
4. Serving Order can differ from Queue Number only through approved queue operations.
5. Starting the clinic is subject to the approved subscription/commercial gate.

Result: ____________________
Evidence: __________________

## 8. Live queue

Acceptance objective: staff can operate the queue while preserving the approved audit and ordering rules.

Verify at minimum:

1. Next Patient advances the authoritative serving state.
2. I'M HERE behaves correctly for eligible individual patients.
3. Staff reinsertion behaves according to temporary-absence rules.
4. Out-for-procedure return behavior follows the approved insertion/protected-next rules.
5. BookingGroup protected-next behavior is preserved except for approved exceptions.
6. Cancel Appointment removes only the intended patient from future service.
7. UNDO is limited to approved reversible actions and does not erase audit history.
8. Close Clinic reaches the approved terminal state and prevents invalid later queue mutation.

Result: ____________________
Evidence: __________________

## 9. Patient access and recovery

Acceptance objective: patients can access only the exact Appointment or BookingGroup scope granted to them.

Verify:

1. Individual Appointment access displays only the authorized Appointment/queue state.
2. VIEW_ONLY versus management authority behaves as approved.
3. BookingGroup controller access controls only the intended BookingGroup.
4. Appointment and BookingGroup credentials are not interchangeable.
5. Expired/revoked/invalid credentials fail safely.
6. BookingGroup recovery verifies the controlling mobile identity and rotates prior credentials.
7. Recovery does not expose unrelated patient history.

Result: ____________________
Evidence: __________________

## 10. Notifications and PhilSMS provider acceptance

Acceptance objective: committed notification intents are delivered through the real provider boundary without bypassing durable outbox controls.

This section contains the external Milestone 13 blocker until a controlled supported-network test recipient is available.

Verify with a controlled test recipient only:

1. A business action creates the expected NotificationOutbox intent before provider delivery.
2. The notification worker claims and submits the intent after commit.
3. The intended SMS is received by the controlled recipient.
4. Provider reference/status is recorded without storing forbidden provider payload data in ordinary logs.
5. A retry/reconciliation scenario, if safely reproducible, does not create an unbounded duplicate-send loop.
6. ScheduledReminder cancellation prevents a cancelled unsent reminder from later being delivered.
7. Operational logs do not contain full mobile numbers, OTP values, SMS bodies, access tokens, or provider authorization secrets.

Provider acceptance result: ____________________
Recipient network: ____________________
Evidence reference: ____________________

If this section is BLOCKED, Milestone 13 remains open.

## 11. Subscription and financial lifecycle

Acceptance objective: commercial entitlement controls clinic operation without corrupting financial history.

Verify:

1. Subscription purchase creates the approved entitlement/financial result.
2. Paid-through, grace, and suspension transitions occur according to approved dates.
3. Suspension blocks the intended commercial operations without erasing clinic data.
4. Successful payment restores commercial entitlement without resurrecting unrelated old state.
5. Refund request/reservation/completion/failure preserves monetary integrity.
6. Historical credit recovery transfers value without rebinding historical ownership or duplicating credit under repeat execution.

Result: ____________________
Evidence: __________________

## 12. Public profile, PracticeLocation route, queue and QR

Acceptance objective: public discovery works without exposing private account/billing/administrative information.

Verify:

1. Doctor public route resolves through the stable public identifier.
2. PracticeLocation public route resolves through its stable public identifier.
3. QR payloads resolve to the canonical intended public routes.
4. Public identifiers remain stable through ordinary edits and temporary disable/reactivation where approved.
5. Subscription or administrative restriction produces neutral public unavailability rather than disclosing the private reason.
6. Permanent closure/deletion retires the applicable public route.
7. Public queue exposes only the approved queue information.

Result: ____________________
Evidence: __________________

## 13. Privacy and retention lifecycle

Acceptance objective: temporary patient identity is removed according to the approved privacy lifecycle while required anonymous/administrative/financial evidence remains.

Verify:

1. Data & Privacy profile/acknowledgement behavior is available through the implemented authority.
2. Appointment erasure removes protected patient correlation at the approved lifecycle point.
3. Notification protected payloads are purged according to policy.
4. Security/recovery artifacts expire and are cleaned up according to policy.
5. Anonymous analytics are preserved without re-identifying the patient.
6. Backup-erasure replay removes protected data resurrected by restoration without double-counting analytics.
7. Account closure administrative/financial evidence remains only where the approved policy requires it.

Result: ____________________
Evidence: __________________

## 14. Production-operability acceptance

Acceptance objective: the release can be deployed and recovered using the verified operational controls.

Confirm evidence already produced for:

- full automated verification gate;
- performance/load test;
- clean migration-from-zero drill;
- PostgreSQL backup/restore drill;
- privacy-erasure replay after restore;
- migration-aware rollback compatibility gate;
- production configuration validation;
- API liveness/readiness probes;
- separate notification worker process;
- separate maintenance worker process;
- privacy-safe operational logging;
- production deployment runbook.

Result: ____________________
Evidence: __________________

## Final Product Owner decision

All sections other than explicitly approved non-release-blocking observations must be PASS.

PhilSMS/provider acceptance is a release blocker unless the Product Owner explicitly changes the approved Milestone 13 scope.

Final decision:

- [ ] PASS - Version 1 accepted for release-candidate checkpoint.
- [ ] FAIL - release candidate rejected; defects require correction.
- [ ] BLOCKED - acceptance cannot complete because an external prerequisite remains unavailable.

Product Owner acceptance date: ____________________
Release-candidate commit SHA: ____________________
Provider acceptance status: ____________________
Known accepted limitations: ____________________

## Release-candidate checkpoint

Only after all required acceptance sections pass:

1. run the final full automated verification on the exact candidate commit;
2. confirm working tree clean and branch synchronized;
3. record provider acceptance evidence;
4. record Product Owner PASS;
5. create/recommend the `version-1-release-candidate` Git checkpoint;
6. update the Milestone 13 completion and consolidated implementation-control documents.
