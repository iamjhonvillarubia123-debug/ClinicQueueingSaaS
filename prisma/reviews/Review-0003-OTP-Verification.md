# Review-0003 - OTP Verification Architecture

---

# Review Information

| Item | Value |
|------|-------|
| Review ID | Review-0003 |
| Module | OtpVerification |
| Review Level | 3 - Architectural |
| Review Status | Approved |
| Review Version | 1.0 |
| Review Date | 2026-08-02 |
| Decisions Approved | 10 |
| Overall Result | Approved |
| Product Owner | Product Owner |
| Technical Reviewer | ChatGPT |

---

# Purpose

This review defines the architecture, lifecycle, ownership, and security
rules of the OtpVerification model.

The review determines how one purpose-driven OTP model may support the
current booking workflow and future verification workflows without mixing
unrelated responsibilities.

No changes shall be made to the production Prisma schema until this review
and the corresponding OTP draft are approved.

---

# Scope

## Included

- OTP purposes
- OTP ownership
- BookingDraft relationship
- OTP expiration
- Incorrect-attempt handling
- Resend behaviour
- Invalidation
- Verification
- Consumption
- Hash storage
- Required indexes
- Future extensibility

## Excluded

- SMS provider integration
- Password-reset implementation
- User login implementation
- Mobile-number change workflow
- Frontend OTP screen implementation
- NotificationLog redesign

---

# Background

The current public booking workflow is:

```text
BookingDraft created
        ↓
OTP generated
        ↓
OTP sent
        ↓
OTP verified
        ↓
Patient created or matched
        ↓
Appointment created
        ↓
BookingDraft consumed

## Decision 1

### Title

OTP Purpose

### Current Design

Version 1 uses OTP only to verify a patient's identity during the
BookingDraft process.

No other OTP workflow exists.

### Approved Design

The system shall support one OTP purpose.

```prisma
enum OtpPurpose {
  BOOKING_VERIFICATION
}
```

Additional OTP purposes shall be added only after their corresponding
business workflow has been reviewed and approved.

### Decision

Approved

### Reason

The database shall represent implemented business functionality rather
than future possibilities.

This keeps the OTP model simple, easier to maintain, and aligned with the
current booking workflow.

### Impact

Version 1 supports OTP only for BookingDraft verification.

## Decision 2

### Title

Booking OTP Ownership

### Current Design

During the public booking process, the patient submits booking
information before a Patient or Appointment record exists.

The system creates a temporary BookingDraft and sends an OTP to verify
ownership of the submitted mobile number.

### Approved Design

For the booking workflow, every OTP shall belong to exactly one
BookingDraft.

Relationship:

```text
BookingDraft
        ↓
OtpVerification
```

An OtpVerification record shall not belong directly to:

- Patient
- Appointment
- PracticeLocation

during the booking process.

The BookingDraft is the sole owner of the booking OTP.

### Business Rules

- One BookingDraft may have multiple OtpVerification records.
- Only one OTP may be active at any time.
- Older OTPs become invalid when a replacement OTP is generated.
- An OTP cannot exist without a BookingDraft.

### Decision

Approved

### Reason

The OTP exists only to verify the BookingDraft owner's mobile number.

Patient and Appointment records are created only after successful OTP
verification.

Making BookingDraft the owner keeps the lifecycle simple, consistent, and
aligned with the approved booking workflow.

### Impact

#### Database

OtpVerification shall contain a required relationship to BookingDraft for
booking verification.

#### Backend

All booking OTP validation begins by locating the BookingDraft.

#### Frontend

The patient continues verifying the current BookingDraft until it is
consumed, cancelled, or expired.

## Decision 3

### Title

Required BookingDraft Relationship

### Current Design

Version 1 supports only one OTP purpose:

```text
BOOKING_VERIFICATION
```

Every booking OTP is generated after a BookingDraft is created.

Therefore an OTP has no valid business meaning without its parent
BookingDraft.

### Approved Design

The BookingDraft relationship shall be required.

Every OtpVerification record shall reference exactly one BookingDraft.

A BookingDraft may own multiple OtpVerification records throughout its
lifecycle.

Examples include:

- original OTP,
- replacement OTP,
- resend OTP.

Only one OTP may remain active at any time.

### Business Rules

The system shall not create an OtpVerification record unless a valid
BookingDraft already exists.

Deleting or consuming a BookingDraft shall follow the approved OTP
lifecycle rules.

An orphaned OtpVerification record is not permitted.

### Decision

Approved

### Reason

A booking OTP exists solely to verify the BookingDraft owner's mobile
number.

Making the relationship required enforces the approved ownership model at
the database level and prevents invalid orphan records.

### Impact

#### Database

The BookingDraft foreign key shall be required for booking-purpose OTP
records.

#### Backend

OTP generation must always begin with an existing BookingDraft.

#### Frontend

No change.

## Decision 4

### Title

OTP Lifecycle

### Current Design

Every OTP progresses through a well-defined lifecycle.

The system must determine the current OTP state without storing duplicate
status information.

### Approved Design

An OtpVerification record shall progress through one of the following
lifecycles.

Successful verification:

```text
Created
    ↓
Verified
    ↓
Consumed
```

Expired:

```text
Created
    ↓
Expired
```

Invalidated:

```text
Created
    ↓
Invalidated
```

### Business Rules

The system shall determine the OTP state using the existing timestamps.

| Condition | Meaning |
|----------|---------|
| `verifiedAt != null` | Verified |
| `consumedAt != null` | Consumed |
| `invalidatedAt != null` | Invalidated |
| `currentTime >= expiresAt` | Expired |

The OtpVerification model shall not contain a separate status field.

### Decision

Approved

### Reason

The existing lifecycle timestamps already describe every OTP state.

Adding an additional status column would duplicate information and create
the risk of inconsistent data.

### Impact

#### Database

No OTP status field shall be added.

The lifecycle is derived from the approved timestamps.

#### Backend

OTP validation shall use the timestamps to determine the current state.

#### Frontend

No change.

## Decision 5

### Title

One Active OTP Rule

### Current Design

Patients may request another OTP if the original code expires or is not
received.

The system must prevent multiple valid OTPs from existing at the same
time.

### Approved Design

A BookingDraft may have multiple OtpVerification records throughout its
lifecycle.

However, only one OTP may be active at any moment.

Whenever a new OTP is generated:

- the previous unverified OTP shall be invalidated,
- its `invalidatedAt` timestamp shall be recorded,
- the new OTP becomes the only valid OTP.

### Business Rules

The backend shall reject verification attempts for any OTP that has:

- expired,
- been invalidated,
- or already been consumed.

Only the newest active OTP may be successfully verified.

Older OTP records remain stored for audit purposes.

### Decision

Approved

### Reason

Allowing multiple active OTPs creates unnecessary security risks and
complicates verification.

Restricting each BookingDraft to one active OTP simplifies the user
experience while strengthening security.

### Impact

#### Database

OtpVerification shall preserve historical OTP records.

Older OTPs are invalidated rather than deleted.

#### Backend

Generating a replacement OTP must invalidate every previously active OTP
for the same BookingDraft before creating the new OTP.

#### Frontend

Patients always enter the most recently received OTP.

## Decision 6

### Title

OTP Lifetime

### Current Design

The BookingDraft remains active for thirty (30) minutes.

The OTP exists only to verify the patient's mobile number and therefore
does not require the same lifetime as the BookingDraft.

### Approved Design

The default OTP lifetime shall be:

```text
5 minutes
```

The BookingDraft lifetime remains:

```text
30 minutes
```

OTP expiration shall not affect the BookingDraft.

Patients may request another OTP while the BookingDraft remains active.

### Business Rules

- OTP expires five (5) minutes after creation.
- BookingDraft expires thirty (30) minutes after creation.
- OTP expiration does not cancel the BookingDraft.
- A replacement OTP may be requested while the BookingDraft remains active.
- Every replacement OTP receives its own five-minute lifetime.

### Decision

Approved

### Reason

A shorter OTP lifetime improves security while allowing the patient to
continue the booking without restarting the entire process.

Separating the OTP lifetime from the BookingDraft lifetime provides a
better balance between usability and security.

### Impact

#### Database

`expiresAt` for OtpVerification shall be calculated independently from the
BookingDraft expiration.

#### Backend

The backend shall calculate:

```text
OTP expiresAt = createdAt + 5 minutes
```

#### Frontend

The OTP screen shall clearly indicate when the OTP expires and allow the
patient to request another OTP while the BookingDraft remains active.

## Decision 7

### Title

Incorrect OTP Attempt Policy

### Current Design

Patients may accidentally enter an incorrect OTP during the booking
process.

The system must balance usability with protection against repeated
guessing attempts.

### Approved Design

Each OTP shall allow a maximum of:

```text
5 incorrect verification attempts
```

An incorrect attempt shall:

- increase the attempt counter,
- keep the BookingDraft active,
- keep the OTP active until the maximum attempt limit is reached.

When the maximum attempt limit is reached:

- the OTP shall be invalidated,
- further verification attempts using that OTP shall be rejected.

If the BookingDraft is still active, the patient may request a new OTP.

If the BookingDraft has expired, the patient must begin a new booking.

### Business Rules

- Maximum attempts: 5
- Every incorrect OTP increases `attemptCount`.
- Successful verification stops further attempts.
- Invalidated OTPs cannot be verified again.
- Expired OTPs cannot be verified.
- Consumed OTPs cannot be verified.

### Decision

Approved

### Reason

Allowing several attempts improves usability while preventing unlimited
OTP guessing.

Separating OTP invalidation from BookingDraft expiration allows patients
to recover without unnecessarily repeating the booking process.

### Impact

#### Database

The existing fields:

```text
attemptCount
maxAttempts
invalidatedAt
```

fully support this policy.

#### Backend

The backend shall increment `attemptCount` before determining whether the
maximum attempt limit has been reached.

When `attemptCount` reaches `maxAttempts`, the OTP shall be invalidated.

#### Frontend

The patient shall receive a clear message when the OTP becomes invalid and
be offered the option to request a replacement OTP if the BookingDraft is
still active.

## Decision 8

### Title

OTP Replacement, Verification, and Consumption

### Current Design

Patients may request another OTP if the current OTP expires or is not
received.

After successful verification, the OTP must never be accepted again.

### Approved Design

Whenever a replacement OTP is generated:

- the previous active OTP shall be invalidated,
- a new OTP shall be generated,
- the new OTP becomes the only active OTP for the BookingDraft.

Successful OTP verification shall:

1. verify the OTP,
2. record `verifiedAt`,
3. begin the BookingDraft conversion transaction.

When the BookingDraft conversion completes successfully, the OTP shall be
marked consumed by recording:

```text
consumedAt
```

A consumed OTP shall never be accepted again.

### Business Rules

The backend shall reject verification when the OTP:

- has expired,
- has been invalidated,
- has already been consumed,
- exceeds the maximum attempt count.

Verification alone does not complete the booking.

The OTP becomes consumed only after the BookingDraft has been
successfully converted into:

- Patient,
- Appointment,
- Booking Access Token.

### Decision

Approved

### Reason

Separating verification from consumption ensures that an OTP cannot be
lost if a database transaction fails after verification.

The OTP remains fully auditable throughout its lifecycle.

### Impact

#### Database

The existing fields:

```text
verifiedAt
consumedAt
invalidatedAt
```

fully support the approved lifecycle.

#### Backend

Booking conversion shall occur inside one database transaction.

The OTP shall be consumed only after successful completion of the
transaction.

#### Frontend

Patients always verify the latest active OTP.

Once verification succeeds, no further OTP interaction is required.

## Decision 9

### Title

OTP Retention and Cleanup

### Current Design

OTP records remain valuable after verification for security auditing,
operational troubleshooting, and abuse investigation.

However, OTP records do not require permanent storage.

### Approved Design

OtpVerification records shall be retained for ninety (90) days after
reaching a terminal state.

Terminal states include:

- consumed,
- expired,
- invalidated.

After the retention period expires, OTP records may be permanently
removed by an authorized background cleanup process.

### Business Rules

- OTP cleanup shall never occur during an active booking session.
- Cleanup shall execute as a scheduled background task.
- Cleanup shall not remove OTP records whose parent BookingDraft is still
  within its own retention period.
- Cleanup operations shall be idempotent and safe to run repeatedly.

### Decision

Approved

### Reason

A limited retention period preserves sufficient audit history while
preventing unnecessary long-term storage of temporary security records.

### Impact

#### Database

No additional database fields are required.

#### Backend

A scheduled cleanup job shall remove OTP records after the approved
retention period.

#### Frontend

No impact.

## Final Decision

### Review Result

Approved

### Summary

Review-0003 establishes the complete architectural design of the
OtpVerification subsystem.

The review defines:

- OTP purpose,
- ownership,
- lifecycle,
- verification,
- consumption,
- invalidation,
- expiration,
- retry policy,
- retention,
- database constraints.

This review becomes the approved source of truth for all future
OtpVerification implementation.

Any future modification to the OTP architecture shall require a new
approved review before implementation.

## Decision 10

### Title

Database Constraints, Indexes, and Future Extensibility

### Current Design

OtpVerification stores temporary security credentials used during the
BookingDraft verification process.

The database must enforce the approved ownership rules while supporting
efficient verification, cleanup, and future expansion.

### Approved Design

The database shall enforce:

- one required BookingDraft relationship,
- one active OTP per BookingDraft,
- indexed verification lookups,
- indexed expiration cleanup,
- indexed BookingDraft ownership.

### Required Indexes

The implementation shall support indexes equivalent to:

```text
bookingDraftId

mobileNumberHash + purpose + expiresAt

expiresAt
```

Additional indexes shall only be introduced when justified by approved
business requirements.

### Referential Integrity

An OtpVerification record shall never exist without its parent
BookingDraft.

Deleting a BookingDraft shall follow the separately approved BookingDraft
retention policy.

The database shall prevent orphaned OTP records.

### Future Extensibility

The architecture intentionally supports additional OTP purposes.

Future examples include:

- password reset,
- login verification,
- mobile number change.

These purposes shall not be implemented until their own architectural
reviews have been approved.

Future extensions shall preserve the principle that each OTP belongs to
exactly one business workflow.

### Decision

Approved

### Reason

The approved constraints provide strong database integrity while allowing
the OTP architecture to evolve without redesigning the model.

### Impact

#### Database

The Prisma model shall implement the approved relationships and indexes.

#### Backend

The backend shall rely on database constraints to prevent invalid OTP
ownership.

#### Documentation

Future OTP purposes require independent architectural reviews before
implementation.

## Final Decision

### Review Result

Approved

### Summary

Review-0003 establishes the complete architectural design of the
OtpVerification subsystem.

The review defines:

- OTP purpose,
- ownership,
- lifecycle,
- verification,
- consumption,
- invalidation,
- expiration,
- retry policy,
- retention,
- database constraints.

This review becomes the approved source of truth for all future
OtpVerification implementation.

Any future modification to the OTP architecture shall require a new
approved review before implementation.