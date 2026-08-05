# Review-0004 - Booking System Consistency

---

# Review Information

| Item | Value |
|------|-------|
| Review ID | Review-0004 |
| Module | Booking System |
| Review Level | 3 - Architectural |
| Review Status | In Progress |
| Review Version | 0.1 |
| Review Date | 2026-08-02 |
| Product Owner | Product Owner |
| Technical Reviewer | ChatGPT |

---

# Purpose

This review audits the consistency of the approved booking-system
architecture before any related models are promoted into the production
Prisma schema.

The review compares the approved designs for:

- Appointment
- BookingDraft
- OtpVerification

Its purpose is to identify contradictions, missing relationships,
duplicated responsibilities, unsupported assumptions, and incomplete
conversion rules across the full booking workflow.

This review does not replace the individual model reviews.

It verifies that the approved models work correctly together as one
system.

---

# Scope

## Included

This review covers:

- BookingDraft creation
- OTP generation and ownership
- OTP verification
- Patient creation or matching
- Appointment creation
- Queue-number assignment
- Estimated service-minute transfer
- BookingDraft consumption
- OTP consumption
- Booking Access Token creation
- Model ownership boundaries
- Naming consistency
- Lifecycle consistency
- Relationship consistency
- Transaction requirements
- Index and constraint alignment
- Retention dependencies
- Notification boundaries

## Excluded

The following require separate reviews:

- Patient model redesign
- Doctor service catalog
- BookingDraftAnswer
- AppointmentAnswer
- Queue-number generation algorithm
- Doctor schedule and emergency closure management
- Walk-in workflow
- Booking Access Token redesign
- NotificationLog redesign
- ContactPreference redesign
- Follow-up workflow
- Frontend implementation
- SMS provider implementation
- Database migration generation

---

# Reviews Being Audited

This consistency review compares:

```text
Review-0001 - Appointment Model
Review-0002 - BookingDraft Model
Review-0003 - OTP Verification Architecture
```

The related architecture decision is:

```text
ADR-0001 - Introduce BookingDraft
```

---

# Approved End-to-End Workflow

The booking system is expected to follow this lifecycle:

```text
Patient opens doctor-specific booking link or QR code
        ↓
Doctor account is resolved
        ↓
Patient selects Practice Location
        ↓
Patient selects Service Date
        ↓
Patient selects requested service or services
        ↓
Estimated Service Minutes are calculated
        ↓
Patient enters structured name and mobile number
        ↓
Input and business validation succeed
        ↓
BookingDraft is created
        ↓
OTP is generated and sent
        ↓
Patient enters OTP
        ↓
OTP is verified
        ↓
Patient is created or matched
        ↓
Queue Number is generated
        ↓
Appointment is created
        ↓
Booking Access Token is created
        ↓
OTP is consumed
        ↓
BookingDraft is consumed
        ↓
Patient receives booking confirmation and secure queue access
```

The permanent Patient and Appointment records must not exist before
successful OTP verification.

---

# Model Responsibilities

## BookingDraft

BookingDraft represents the temporary and unverified booking request.

It owns:

- selected Practice Location,
- Service Date,
- structured temporary patient name,
- encrypted mobile number,
- mobile-number hash,
- mobile-number display suffix,
- Estimated Service Minutes,
- BookingDraft expiration,
- BookingDraft lifecycle,
- OTP verification records.

BookingDraft must not own permanent Patient, Appointment, Queue Number, or
Booking Access Token relationships.

---

## OtpVerification

OtpVerification represents one verification credential issued for one
BookingDraft.

It owns:

- OTP hash,
- OTP purpose,
- OTP expiration,
- incorrect-attempt count,
- verification time,
- invalidation time,
- consumption time.

For Version 1:

```text
OtpPurpose = BOOKING_VERIFICATION
```

Every OTP must belong to exactly one BookingDraft.

---

## Appointment

Appointment represents one confirmed clinic visit after OTP verification.

It owns:

- Patient relationship,
- Practice Location relationship,
- Service Date,
- permanent Queue Number,
- Estimated Service Minutes,
- queue lifecycle,
- consultation lifecycle,
- cancellation information,
- Booking Access Tokens,
- Contact Preference,
- Follow-up Recommendations,
- Notification Logs.

Appointment must not own booking-purpose OTP records.

---

# Audit Areas

## Audit 1

### Title

Naming Consistency

Verify that related models use the same approved terminology.

Expected terms include:

```text
serviceDate
estimatedServiceMinutes
practiceLocationId
mobileNumberHash
```

The audit must identify obsolete or conflicting terms such as:

```text
scheduledStartAt
scheduledEndAt
appointmentDate
requestedServiceDate
fullName
```

---

## Audit 2

### Title

BookingDraft and OTP Ownership

Verify that:

- one BookingDraft may own multiple OTP records,
- every Version 1 OTP belongs to exactly one BookingDraft,
- Patient and Appointment do not own booking-purpose OTP records,
- no OTP record may exist without its parent BookingDraft.

---

## Audit 3

### Title

BookingDraft and Appointment Boundary

Verify that BookingDraft does not contain:

```text
patientId
appointmentId
queueNumber
bookingAccessTokenId
```

Verify that Appointment is created only after successful OTP verification.

---

## Audit 4

### Title

Estimated Service Minutes

Verify that:

1. Requested services determine the estimated duration.
2. BookingDraft stores the calculated estimate.
3. The same estimate is copied to Appointment during conversion.
4. The estimate is not silently recalculated if service configuration
   changes before conversion.
5. The selected-service relationship remains deferred until the doctor
   service catalog is reviewed.

---

## Audit 5

### Title

Service Date

Verify that:

- BookingDraft uses a date-only `serviceDate`,
- Appointment uses the same date-only `serviceDate`,
- exact consultation times are not stored,
- Service Date validation occurs before BookingDraft creation,
- capacity is checked before conversion into Appointment.

---

## Audit 6

### Title

Lifecycle Compatibility

Verify these compatible lifecycles.

BookingDraft:

```text
PENDING_OTP
        ↓
CONSUMED
```

or:

```text
PENDING_OTP
        ↓
EXPIRED
```

or:

```text
PENDING_OTP
        ↓
CANCELLED
```

OtpVerification:

```text
Created
        ↓
Verified
        ↓
Consumed
```

or:

```text
Created
        ↓
Expired
```

or:

```text
Created
        ↓
Invalidated
```

Appointment:

```text
WAITING
        ↓
CALLED
        ↓
IN_SERVICE
        ↓
COMPLETED
```

with approved missed-call, reinsertion, and cancellation paths.

---

## Audit 7

### Title

Expiration Compatibility

Verify that:

```text
OTP lifetime = 5 minutes
BookingDraft lifetime = 30 minutes
```

Verify that:

- OTP expiration does not expire BookingDraft,
- OTP resend does not extend BookingDraft expiration,
- no OTP may be generated or verified after BookingDraft expiration,
- expired BookingDrafts cannot create permanent records.

---

## Audit 8

### Title

One Active OTP Rule

Verify that:

- only one usable OTP exists for one BookingDraft,
- issuing a replacement OTP invalidates older unverified OTPs,
- invalidated, expired, verified-consumed, or attempt-exhausted OTPs cannot
  be reused.

---

## Audit 9

### Title

Active BookingDraft Reuse

Verify that duplicate active BookingDraft lookup uses:

```text
mobileNumberHash
+
practiceLocationId
+
serviceDate
+
PENDING_OTP
+
unexpired expiresAt
```

Verify that reuse does not reset:

```text
createdAt
expiresAt
```

---

## Audit 10

### Title

Conversion Transaction

Verify that successful conversion performs one atomic database
transaction.

The transaction must:

1. Lock or otherwise protect the active BookingDraft.
2. Confirm BookingDraft status is `PENDING_OTP`.
3. Confirm BookingDraft has not expired.
4. Confirm the Practice Location and Service Date remain valid.
5. Confirm online booking capacity remains available.
6. Confirm the OTP is verified, unconsumed, and valid.
7. Create or match the Patient.
8. Generate the next Queue Number safely.
9. Create the Appointment.
10. Copy `estimatedServiceMinutes` into Appointment.
11. Create the Booking Access Token.
12. Mark the OTP consumed.
13. Mark BookingDraft `CONSUMED`.
14. Record `BookingDraft.consumedAt`.

If any operation fails, none of the conversion changes may remain
committed.

---

## Audit 11

### Title

Concurrency Safety

Verify concurrency protection for:

- duplicate BookingDraft creation,
- OTP resend,
- OTP verification,
- final available booking capacity,
- Queue Number generation,
- double consumption of one BookingDraft.

Application checks alone are not sufficient where concurrent requests can
violate business rules.

---

## Audit 12

### Title

Relationship Completeness

Verify that Prisma opposite relations are defined consistently for:

```text
PracticeLocation ↔ BookingDraft
BookingDraft ↔ OtpVerification
Patient ↔ Appointment
PracticeLocation ↔ Appointment
```

Verify that removed relationships are removed from both sides.

---

## Audit 13

### Title

Notification Boundaries

Verify that:

- OTP delivery occurs before Appointment creation,
- OTP notification context does not require Appointment,
- booking confirmation and secure queue access occur after Appointment
  creation,
- next-in-queue and cancellation messages belong to Appointment,
- follow-up messages retain consultation context.

The exact pre-appointment NotificationLog relationship remains deferred
until NotificationLog is reviewed.

---

## Audit 14

### Title

Retention Dependencies

Verify that:

- terminal OTP records follow the approved retention policy,
- BookingDraft retention is defined before cleanup implementation,
- OTP cleanup does not create orphaned or contradictory records,
- consumed drafts remain immutable during retention.

---

# Initial Consistency Findings

No findings have been approved yet.

Each finding shall be reviewed and recorded individually.

---

# Pending Audit Questions

1. Does the current BookingDraft draft exactly match Review-0002?
2. Does the current OTP draft exactly match Review-0003?
3. Does the Appointment draft use `serviceDate` consistently?
4. Are all removed OTP relationships also removed from opposite models?
5. Is Patient matching fully specified?
6. Is Queue Number generation concurrency-safe?
7. Is booking capacity rechecked during conversion?
8. Is Booking Access Token creation included in the same transaction?
9. Is BookingDraft retention duration formally approved?
10. Are referential delete actions defined?
11. Are all indexes justified by actual queries?
12. Does the active Prisma schema still contain obsolete relationships?
13. Does NotificationLog require a pre-appointment owner?
14. Which issues block schema promotion?

---

# Impact Assessment

## Database

High

This review determines whether the approved models may safely be promoted
into the production Prisma schema.

## Backend

High

The full booking transaction depends on consistency across all three
reviewed models.

## Frontend

Low

This review primarily audits backend and database architecture.

## Documentation

High

Any inconsistency found may require changes to one or more approved
reviews, drafts, specifications, or ADRs.

## Finding 1

### Title

Selected Services Are Not Persisted

### Observation

BookingDraft currently stores only:

- estimatedServiceMinutes

The BookingDraft does not preserve which services were selected by the
patient.

As a result, the system cannot later explain how the estimated duration
was calculated.

### Impact

Potentially High

Future modules including billing, analytics, audit history, service
reporting, and appointment review may require the originally selected
services.

### Recommendation

Do not modify BookingDraft during this review.

Instead, defer implementation until the Doctor Service Catalog review is
completed.

That review shall determine:

- Service Catalog model,
- BookingDraft selected-service relationship,
- Appointment selected-service relationship,
- duration snapshot policy.

### Status

Deferred

### Blocking

No

BookingDraft may still proceed because Version 1 requires only the
calculated duration.

However, selected-service persistence must be resolved before implementing
the Service Catalog module.


## Finding 2

### Title

Booking Conversion Must Be Atomic

### Observation

The approved reviews define the booking conversion workflow but do not
explicitly require every conversion step to execute within a single
database transaction.

Without transactional protection, partial failures could leave the
system in an inconsistent state.

Examples include:

- Patient created without Appointment.
- Appointment created without Booking Access Token.
- OTP consumed while Appointment creation fails.
- BookingDraft marked consumed without a completed Appointment.

### Impact

Critical

Partial booking conversion would compromise data integrity and make
automatic recovery difficult.

### Recommendation

Booking conversion shall execute as one atomic database transaction.

The transaction shall include:

1. Validate BookingDraft.
2. Validate OTP.
3. Create or match Patient.
4. Generate Queue Number.
5. Create Appointment.
6. Create Booking Access Token.
7. Consume OTP.
8. Consume BookingDraft.

If any operation fails, the transaction shall roll back completely.

### Status

Approved

### Blocking

Yes

The production implementation must not perform these operations in
separate transactions.

## Finding 3

### Title

Booking Capacity Validation Must Be Concurrency Safe

### Observation

The approved reviews require capacity validation before creating an
Appointment.

However, they do not explicitly require protection against concurrent
booking confirmations.

Without concurrency control, multiple BookingDraft conversions may
simultaneously observe the same remaining capacity and both succeed,
resulting in overbooking.

### Impact

Critical

Concurrent booking confirmations could exceed the doctor's configured
maximum operating time for the selected service date.

### Recommendation

Capacity validation and Appointment creation shall execute within the
same protected database transaction.

The implementation shall ensure that once one transaction reserves the
remaining capacity, competing transactions must observe the updated
state before creating another Appointment.

The backend shall not rely solely on frontend validation.

### Status

Approved

### Blocking

Yes

Production implementation shall prevent concurrent overbooking.

## Finding 4

### Title

Patient Matching Strategy Not Yet Defined

### Observation

The approved booking workflow requires the system to create or match a
Patient after successful OTP verification.

However, the criteria used to determine whether an existing Patient
should be reused have not yet been formally specified.

The current architecture therefore assumes patient matching without
defining the approved matching algorithm.

### Impact

Medium

Inconsistent patient matching could result in duplicate Patient records
or unintended reuse of existing records.

### Recommendation

Do not modify the booking workflow.

Create a dedicated architectural review for Patient Matching before
implementing BookingDraft conversion.

That review shall define:

- patient matching criteria,
- duplicate prevention,
- conflict handling,
- manual review requirements,
- audit requirements.

### Status

Deferred

### Blocking

No

Booking architecture remains valid.

Patient matching rules must be approved before backend implementation of
BookingDraft conversion.

## Finding 5

### Title

Authorized Staff Visibility and Existing Patient Preparation

### Observation

The clinic workflow requires the doctor and secretary to identify patients,
contact them when necessary, understand the requested service, and prepare
existing clinic records before consultation.

The current booking architecture stores patient identity and requested
service information but does not yet formally define which information is
visible to authorized clinic staff.

The booking workflow also does not currently ask whether the person
believes they already have an existing record with the clinic.

### Approved Staff View

Authorized doctors and secretaries may view:

- Queue Number
- Patient Full Name
- Mobile Number
- Requested Service or Consultation Reason
- Existing Patient Response
- Service Date
- Estimated Service Minutes
- Queue Status

This information supports:

- confirming the patient being called,
- contacting the patient,
- preparing paper or electronic records,
- preparing clinic documents,
- and understanding the expected consultation workload.

### Public Queue Restriction

The public queue display must not show:

- Patient Full Name
- Mobile Number
- Requested Service
- Consultation Reason
- Existing Patient Response

The public queue shall identify patients primarily through Queue Number.

### Mobile Number Display

The full mobile number remains encrypted in storage.

The backend may decrypt it only for an authorized doctor or secretary
workflow.

Patient-facing screens should use the approved masked display suffix when
the complete number is unnecessary.

### Existing Patient Question

The booking form shall ask:

```text
Do you already have a patient record with this clinic?

## Finding 6

### Title

BookingDraft Retention Period Is Not Defined

### Observation

Review-0003 defines a ninety-day retention period for terminal
OtpVerification records.

However, Review-0002 does not define how long terminal BookingDraft
records shall remain in the database.

Terminal BookingDraft states include:

```text
CONSUMED
EXPIRED
CANCELLED

## Finding 7

### Title

Queue Number Generation Strategy Is Not Defined

### Observation

The approved booking workflow assigns a Queue Number when a BookingDraft
is successfully converted into an Appointment.

The Appointment rules require Queue Numbers to be unique within one:

```text
Practice Location
+
Service Date

---

# Review Outcome

| Item | Status |
|------|--------|
| Audit Findings Approved | 7 |
| Blocking Issues | 4 |
| Non-Blocking Issues | 3 |
| Overall Result | In Progress |

---

# Implementation Checklist

| Task | Status |
|------|:------:|
| Appointment Review Audited | ☐ |
| BookingDraft Review Audited | ☐ |
| OTP Review Audited | ☐ |
| Appointment Draft Audited | ☐ |
| BookingDraft Draft Audited | ☐ |
| OTP Draft Audited | ☐ |
| Relationship Matrix Verified | ☐ |
| Transaction Workflow Verified | ☐ |
| Blocking Issues Resolved | ☐ |
| Review Approved | ☐ |
| Prisma Schema Updated | ☐ |
| Migration Created | ☐ |
| Integration Tested | ☐ |

---

# Governance

This review follows:

```text
docs/governance/engineering/01 - Engineering Review Process.md
docs/governance/engineering/02 - Database Governance.md
docs/governance/engineering/05 - Review Template.md
```

---

# Version History

| Version | Date | Description |
|---------|------|-------------|
| 0.1 | 2026-08-02 | Initial booking-system consistency review |

---

# End of Review