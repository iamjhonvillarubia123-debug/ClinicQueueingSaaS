# ADR-0003: OTP Security

## Status

Draft

---

## Date

2026-08-06

---

## Problem

The Clinic Queueing SaaS generates six-digit one-time passwords for
BookingDraft mobile-number verification.

The application must verify an OTP without storing the plain-text OTP in
PostgreSQL.

A six-digit OTP has a small input space, so an ordinary unkeyed hash can be
tested offline by anyone who obtains the database.

The system must also enforce expiry, attempt limits, invalidation, and
single-use behavior.

---

## Context

Version 1 supports only:

BOOKING_VERIFICATION

Each booking OTP:

- belongs to exactly one BookingDraft;
- proves control of the BookingDraft mobile number;
- expires after five minutes;
- allows no more than five incorrect attempts;
- may be verified only once;
- must be invalidated when replaced;
- must not create a Patient, Appointment, or Queue Number by itself.

The database stores otpHash, never the plain OTP.

OTP generation and OTP hashing are separate responsibilities.

---

## Options Considered

### Option A: Store the plain OTP

Advantages

- Simple verification.
- No cryptographic processing required.

Disadvantages

- Exposes active OTPs if the database is accessed.
- Violates the approved OTP storage requirement.
- Not acceptable.

---

### Option B: Unkeyed SHA-256

Advantages

- Simple and deterministic.
- Plain OTP is not directly stored.

Disadvantages

- Six-digit OTPs have only one million possible values.
- An attacker with database access can calculate all possible hashes offline.
- Does not provide adequate protection for the small OTP input space.
- Not acceptable.

---

### Option C: Password hashing with bcrypt

Advantages

- Slows offline guessing.
- Existing bcrypt dependency is already available.

Disadvantages

- Adds avoidable computational cost to a short-lived, rate-limited OTP flow.
- Requires asynchronous hashing and comparison for every OTP operation.
- Does not provide a simple versioned secret-rotation strategy.
- Password hashing solves a different threat model from keyed application
  verification.

---

### Option D: HMAC-SHA-256 with a dedicated server secret

Advantages

- Plain OTP is never stored.
- Database access alone is insufficient to calculate valid OTP hashes.
- Deterministic output supports verification.
- Efficient for short-lived OTP requests.
- Supports explicit key versioning and rotation.
- Can use constant-time digest comparison.

Disadvantages

- Requires secure management of an additional secret.
- If the OTP HMAC secret is compromised, active database hashes can be tested
  offline.
- Application startup depends on valid OTP security configuration.

---

## Decision

Use Option D.

### 1. OTP generation

Generate a six-digit numeric string using Node.js cryptographically secure
random generation.

Valid range:

000000 through 999999

The OTP must remain a string so leading zeroes are preserved.

The generated plain OTP may exist only briefly in application memory for:

- hash creation;
- delivery to the approved notification provider.

It must not be stored in PostgreSQL, application logs, error messages,
analytics, audit metadata, or source code.

### 2. OTP hash construction

Use HMAC-SHA-256 with a dedicated OTP secret.

The hash input must bind the OTP to its BookingDraft and purpose.

Version 1 conceptual input:

bookingDraftId + ":" + purpose + ":" + otp

Example:

draft-uuid:BOOKING_VERIFICATION:123456

This prevents the same OTP value from producing the same stored digest across
different BookingDraft records.

Encode the HMAC digest as lowercase hexadecimal.

The resulting value is stored in:

otpHash

### 3. Dedicated key

Use a dedicated secret that is separate from:

- mobile-number encryption keys;
- mobile-number lookup HMAC keys;
- JWT secrets;
- password hashes;
- booking access token secrets.

Environment variables:

OTP_HMAC_KEY_V1
OTP_HMAC_ACTIVE_KEY_ID

The OTP HMAC key must:

- be generated from at least 32 cryptographically random bytes;
- be Base64 encoded in configuration;
- decode to at least 32 bytes;
- never be committed to Git;
- never be stored in PostgreSQL;
- never be logged.

Production secrets must come from a managed secret store or protected
deployment environment.

### 4. Hash verification

For verification:

1. Recalculate the expected HMAC using the submitted OTP, BookingDraft ID, and
   OTP purpose.
2. Decode both stored and calculated hexadecimal digests into byte buffers.
3. Confirm both buffers have the same expected length.
4. Compare the buffers using a constant-time comparison function.
5. Never compare OTP hashes with ordinary string equality.

Malformed stored hashes must fail closed.

### 5. OTP expiry

An OTP expires five minutes after creation.

Set:

expiresAt = creation time + five minutes

The five-minute OTP lifetime is independent of the BookingDraft’s thirty-minute
lifetime.

An expired OTP must not be verified.

An expired OTP does not automatically expire its BookingDraft.

### 6. Attempt limits

Each OTP begins with:

attemptCount = 0
maxAttempts = 5

For an incorrect OTP:

- increment attemptCount atomically;
- reject verification;
- when the maximum is reached, invalidate the OTP.

A correct OTP submitted after the maximum attempts have been reached must
still be rejected.

### 7. Replacement and active OTP rules

Before creating a replacement OTP for the same BookingDraft and purpose:

- invalidate every earlier active OTP;
- set invalidatedAt to the current time.

An OTP is active only when all are true:

- verifiedAt is null;
- consumedAt is null;
- invalidatedAt is null;
- expiresAt is in the future;
- attemptCount is less than maxAttempts.

Only one active OTP may exist for a BookingDraft and purpose after a successful
creation transaction.

### 8. Successful verification

When the submitted OTP is correct:

- set verifiedAt to the current time;
- do not increment attemptCount;
- do not create a Patient;
- do not create an Appointment;
- do not allocate a Queue Number;
- do not consume the BookingDraft yet.

Successful verification proves control of the mobile number associated with
the BookingDraft.

The later BookingDraft conversion transaction may consume the verified OTP.

### 9. Consumption

The OTP is considered consumed only when the later successful BookingDraft
conversion transaction sets:

consumedAt

A verified but unconsumed OTP must not be reusable for another BookingDraft.

### 10. Transaction boundaries

OTP replacement must be atomic:

1. validate the BookingDraft;
2. invalidate previous active OTP records;
3. generate and hash the new OTP;
4. create the new OtpVerification record;
5. commit.

Incorrect-attempt updates must be atomic to prevent concurrent attempts from
bypassing maxAttempts.

Successful verification must atomically check eligibility and set verifiedAt.

### 11. Logging and error responses

Never log:

- plain OTP values;
- OTP HMAC keys;
- complete OTP hashes;
- notification payloads containing OTPs.

Client-facing verification failures should use a generic message and must not
reveal whether:

- the OTP was wrong;
- the OTP expired;
- the maximum attempt count was reached;
- the OTP was invalidated.

Operational logs may record redacted reason codes and OtpVerification IDs but
must not contain secrets.

### 12. Testing

Unit tests must cover:

- generated OTP contains exactly six digits;
- leading-zero OTP values remain six characters;
- the same BookingDraft, purpose, OTP, and key produce the same hash;
- a different OTP produces a different hash;
- a different BookingDraft ID produces a different hash;
- a different purpose produces a different hash;
- constant-time comparison accepts a valid digest;
- comparison rejects an invalid digest;
- malformed digest input fails closed;
- missing or malformed configuration rejects service startup;
- expired OTP rejection;
- invalidated OTP rejection;
- consumed OTP rejection;
- maximum-attempt rejection;
- incorrect attempt increment;
- successful verification timestamp;
- replacement invalidates prior active OTPs;
- tests never print real secrets or OTP values.

Use dedicated non-production test keys and fixed test OTP values.

---

## Consequences

Positive consequences:

- Plain OTP values are not stored.
- Database compromise alone does not reveal active OTP values.
- OTP hashes are bound to the BookingDraft and purpose.
- Verification comparison avoids ordinary timing-sensitive string equality.
- Key versioning provides a future rotation path.
- OTP lifecycle rules are centralized and testable.

Negative consequences:

- One additional protected secret must be managed.
- OTP verification depends on application access to the HMAC key.
- Secret rotation requires support for previously issued unexpired OTPs or
  invalidation of those OTPs.
- Atomic persistence and verification logic require careful transaction tests.

---

## Related Specifications

- 10A - Booking Draft Table
- 11 - OTP Verification Table
- 15 - Notification Log Table
- 16 - Patient Workflow Specification
- 17 - Patient Business Rules
- ADR-0001 - BookingDraft
- ADR-0002 - Mobile Number Security

---

## Notes

This ADR does not approve:

- plain-text OTP storage;
- unkeyed SHA-256;
- reuse of the mobile-number HMAC key;
- reuse of the JWT secret;
- unlimited verification attempts;
- OTP verification after expiry;
- logging OTP values;
- creation of Patient, Appointment, or Queue records during OTP generation or
  standalone verification.

Before changing the OTP format, lifetime, attempt limit, hash construction, or
key-rotation behavior, create a superseding ADR and review the migration and
operational impact.