# Milestone 13 OTP Notification Outbox Verification Evidence

**Date:** 2026-08-22  
**Status:** VERIFIED

## Purpose

This evidence record documents the Milestone 13 correction that makes booking OTP issuance create its `OTP_VERIFICATION` `NotificationOutbox` in the same PostgreSQL transaction as the `OtpVerification` challenge.

## Requirement satisfied

For booking OTP issuance:

- each issued OTP challenge has at most one linked `NotificationOutbox`;
- `OTP_VERIFICATION` outboxes carry `otpVerificationId`;
- the protected recipient and protected OTP message delivery intent are committed transactionally with the challenge;
- the recipient mobile remains encrypted at rest;
- the plaintext OTP is not persisted as an ordinary database field or ordinary log value;
- stale, invalidated, consumed, or expired OTP notification intent remains subject to the existing submission-boundary cancellation controls before provider submission.

## Implementation evidence

The implementation introduces `OtpNotificationOutboxService` and invokes it inside the existing Prisma transaction used by `OtpService.createBookingOtpInTransaction`.

The OTP outbox contains:

- notification type `OTP_VERIFICATION`;
- channel `SMS`;
- linked `otpVerificationId`;
- encrypted recipient mobile envelope copied from the protected BookingDraft;
- encrypted SMS message body containing the generated OTP;
- deterministic provider idempotency identity scoped to the OTP challenge;
- pending delivery state for the notification worker.

The booking OTP concurrency E2E coverage also verifies that concurrent resend contention leaves exactly one replacement challenge active while maintaining exactly one OTP outbox per issued challenge.

## Full regression verification

Full verification executed after the OTP outbox correction on 2026-08-22:

- TypeScript typecheck: PASS;
- ESLint / Prettier gate: PASS;
- unit tests: PASS - 117 / 117 suites, 554 / 554 tests;
- PostgreSQL E2E tests: PASS - 52 / 52 suites, 155 / 155 tests;
- isolated E2E database `clinic_queueing_saas_test`: VERIFIED;
- Prisma migrations: 60 found, none pending;
- Prisma validate: PASS;
- Prisma generate: PASS;
- NestJS production build: PASS.

Known non-failing warnings remained unchanged:

- Node experimental VM Modules warning during E2E execution;
- current Prisma `@prisma/adapter-pg` / `pg` deprecation warning under some contention paths.

## Control conclusion

**PASS.** The booking OTP challenge-to-notification handoff is implemented and regression-verified. Live PhilSMS/provider acceptance remains a separate Milestone 13 acceptance item and is not claimed by this record.
