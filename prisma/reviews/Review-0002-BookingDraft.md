# Review-0002 - BookingDraft Model

---

# Review Information

| Item | Value |
|------|-------|
| Review ID | Review-0002 |
| Module | BookingDraft |
| Review Level | 3 - Architectural |
| Review Status | APPROVED |
| Review Version | 1.0 |
| Review Date | 2026-08-02 |
| Approval Date | 2026-08-02 |
| Product Owner | Product Owner |
| Technical Reviewer | ChatGPT |

---

# Purpose

This review defines the exact database design and lifecycle rules for the
BookingDraft model.

BookingDraft temporarily stores an unverified public booking request while
the patient completes OTP verification.

The review will determine the model's:

- fields,
- relationships,
- constraints,
- indexes,
- expiration rules,
- consumption rules,
- security requirements,
- and conversion workflow.

No changes shall be made to the production Prisma schema until this review
and the corresponding BookingDraft draft are approved.

---

# Scope

## Included

This review covers:

- BookingDraft creation
- Temporary booking data
- Consultation service date
- Practice Location relationship
- Patient name storage before verification
- Mobile number encryption and hashing
- OTP Verification relationship
- Expiration
- Invalidation
- Consumption
- Duplicate or repeated booking attempts
- Required constraints and indexes
- Conversion into Patient and Appointment

## Excluded

The following require separate reviews:

- Queue-number generation algorithm
- Patient model
- Appointment model
- Booking Access Token model
- Notification Log model
- Doctor-configurable booking questions
- AppointmentAnswer
- BookingDraftAnswer
- Frontend implementation
- SMS provider implementation

---

# Background

The approved booking workflow is:

```text
Patient submits booking information
        ↓
BookingDraft is created
        ↓
OTP is sent
        ↓
OTP is verified
        ↓
Patient is created or matched
        ↓
Appointment is created
        ↓
Queue Number is assigned
        ↓
BookingDraft is consumed
        ↓
Booking Access Token is issued
```

The permanent Appointment model requires a Patient.

The Patient must not be created before successful OTP verification.

BookingDraft therefore provides temporary storage between booking
submission and OTP verification.

---

# Related Architecture Decision

This review implements the architecture approved in:

```text
prisma/decisions/ADR-0001-BookingDraft.md
```

The ADR approves the existence of BookingDraft.

This review does not reconsider whether BookingDraft should exist. It
determines how the model should be designed.

---

# Current Proposed Responsibilities

BookingDraft is expected to:

- store the minimum unverified booking information,
- preserve the chosen Practice Location,
- preserve the requested consultation date,
- store the patient's submitted full name,
- store the mobile number in encrypted and hashed forms,
- connect OTP attempts to one booking attempt,
- expire abandoned booking attempts,
- prevent reuse after successful conversion,
- and support transactional conversion into Patient and Appointment.

---

# Prohibited Responsibilities

BookingDraft must not:

- represent a confirmed Appointment,
- receive a permanent Queue Number,
- appear in the live clinic queue,
- replace the Patient model,
- store raw mobile numbers,
- store raw OTP values,
- store raw booking access tokens,
- or remain reusable after successful consumption.

---

# Decision Log

# Decision Log

## Decision 1

### Title

BookingDraft Creation Trigger

### Current Design

The active database schema does not contain a model for storing booking information before OTP verification.

Without temporary persistent storage, the system would need to retain booking information only in the browser or create permanent Patient and Appointment records too early.

### Proposed Design

Create a `BookingDraft` immediately after the patient successfully submits the booking form and passes basic validation.

The `BookingDraft` must be created before the OTP is generated and sent.

The approved workflow is:

```text
Patient submits booking form
        ↓
Basic validation succeeds
        ↓
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
Queue Number assigned
        ↓
BookingDraft consumed

## Decision 2

### Title

BookingDraft and OTP Lifecycle Separation

### Current Design

The BookingDraft and OTP verification process have not yet been formally separated.

Without a clear lifecycle boundary, an incorrect or expired OTP could incorrectly invalidate the entire booking attempt.

### Proposed Design

BookingDraft and OtpVerification shall maintain separate lifecycles.

The approved BookingDraft statuses are:

```prisma
enum BookingDraftStatus {
  PENDING_OTP
  CONSUMED
  EXPIRED
  CANCELLED
}

## Decision 3

### Title

BookingDraft Expiration Policy

### Current Design

The BookingDraft and OTP expiration periods have not yet been formally defined.

Without separate expiration rules, an expired OTP could incorrectly end the entire booking session, or repeated OTP resends could keep an abandoned BookingDraft alive indefinitely.

### Proposed Design

BookingDraft and OtpVerification shall use separate expiration periods.

#### OTP Expiration

Each OTP shall expire 5 minutes after it is created.

If an OTP expires:

- the expired OTP cannot be used,
- the BookingDraft remains active if its own expiration time has not passed,
- the patient may request a new OTP, subject to resend and rate-limit rules.

#### BookingDraft Expiration

Each BookingDraft shall expire 30 minutes after it is created.

The BookingDraft expiration time is fixed at creation.

Resending an OTP does not extend or reset the BookingDraft expiration time.

When the 30-minute BookingDraft lifetime ends:

- its status becomes `EXPIRED`,
- no new OTP may be issued for that draft,
- existing OTP records can no longer convert it,
- it cannot create a Patient or Appointment,
- the patient must begin a new booking.

### Approved Timeline

```text
BookingDraft lifetime: 30 minutes

OTP #1 lifetime: 5 minutes
OTP #2 lifetime: 5 minutes
OTP #3 lifetime: 5 minutes

All OTP attempts must occur within the original
30-minute BookingDraft lifetime.

## Decision 4

### Title

Temporary Patient Identity Structure

### Current Design

The patient has not yet been created.

However, the system must temporarily preserve the patient's identity information until OTP verification succeeds.

The temporary identity should already follow the same logical structure that will later be stored in the Patient model.

### Proposed Design

BookingDraft shall temporarily store the patient's name using individual components instead of a single Full Name field.

The approved identity fields are:

```text
firstName

middleName

lastName

suffix
```

The BookingDraft shall not contain a Patient ID because no Patient record exists before successful OTP verification.

### Decision

Approved

### Reason

Using structured name fields provides consistent data throughout the patient's lifecycle.

This avoids unreliable parsing of a Full Name after OTP verification and supports future requirements such as:

- Patient search
- Medical certificates
- Prescriptions
- Insurance documents
- Government reporting
- Future integrations

Collecting the information once in the correct structure improves long-term data quality.

### Business Rules

The BookingDraft stores temporary identity information only.

After successful OTP verification:

1. The Patient is created or matched.
2. The structured name fields are copied into the Patient record.
3. BookingDraft remains unchanged until it is consumed.

### Impact

#### Database

BookingDraft stores structured temporary identity fields.

#### Backend

No name parsing is required during Patient creation.

#### Frontend

The booking form shall collect:

- First Name
- Middle Name (optional)
- Last Name
- Suffix (optional)

#### Documentation

The Patient Workflow and Booking Workflow specifications must describe the structured identity collection process.

## Decision 5

### Title

Mobile Number Normalization, Encryption, and Hashing

### Current Design

The BookingDraft requires the patient's mobile number for OTP delivery and later patient matching.

Storing the mobile number in plain text would expose sensitive personal information.

Using encryption alone would make reliable duplicate matching difficult because secure encryption may produce different ciphertext values for the same number.

Using hashing alone would prevent the system from recovering the number when sending SMS messages.

### Proposed Design

BookingDraft shall store both:

```text
mobileNumberEncrypted
mobileNumberHash
```

The system must never store the mobile number in plain text.

Before encryption or hashing, the backend shall:

1. Trim surrounding whitespace.
2. Remove spaces, hyphens, parentheses, and other formatting characters.
3. Convert valid Philippine mobile numbers into one canonical format.
4. Validate the normalized value.
5. Encrypt the normalized value.
6. Hash the same normalized value.
7. Store only the encrypted value and hash.

### Canonical Philippine Mobile Format

The approved internal format is:

```text
639171234567
```

Rules:

- Country code `63` is included.
- The local leading `0` is removed.
- Only digits are stored.
- Spaces are not stored.
- Hyphens are not stored.
- Parentheses are not stored.
- The leading plus sign is not stored.

Examples:

| Patient Input | Canonical Value |
|---------------|-----------------|
| `09171234567` | `639171234567` |
| `+63 917 123 4567` | `639171234567` |
| `639171234567` | `639171234567` |
| `0917-123-4567` | `639171234567` |

### Field Responsibilities

#### `mobileNumberEncrypted`

Purpose:

- Recover the normalized mobile number when sending OTP or other approved SMS notifications.
- Protect the mobile number when stored in the database.

#### `mobileNumberHash`

Purpose:

- Match an existing Patient.
- Detect repeated booking attempts.
- Search by normalized mobile identity without decrypting every stored value.

The hash must be deterministic for the same normalized mobile number.

The exact encryption algorithm, key-management method, and hash construction require a separate security review.

### Decision

Approved

### Reason

Encryption and hashing serve different responsibilities.

Encryption protects the number while allowing authorized recovery for communication.

Hashing supports deterministic lookup and duplicate detection without exposing the original number.

Using one canonical format prevents the same mobile number from being treated as different identities because of formatting differences.

### Impact

#### Database

BookingDraft requires:

```text
mobileNumberEncrypted
mobileNumberHash
```

No plain-text mobile field is permitted.

#### Backend

The backend must normalize and validate the mobile number before encryption and hashing.

All Patient matching and duplicate checks must use the hash generated from the canonical value.

#### Frontend

The frontend may accept common Philippine mobile-number formats.

The backend remains authoritative for normalization and validation.

#### Documentation

The Patient, BookingDraft, OTP, and data-security documentation must use the same canonical mobile format and storage policy.

## Decision 6

### Title

Requested Services and Estimated Service Duration

### Current Design

The booking workflow requires the patient to indicate which service or
services they want to receive.

The selected services are required so the system can estimate how much
consultation or service time the booking will add to the clinic queue.

A formal doctor service-catalog model has not yet been specified.

### Proposed Design

The doctor-specific booking page shall allow the patient or secretary to
select the requested service or services offered by that doctor.

The available services must be limited to services configured for the
doctor account represented by the booking link or QR code.

The BookingDraft shall preserve:

```text
selected requested services
estimatedServiceMinutes

## Decision 7

### Title

Reuse Existing Active BookingDraft

### Current Design

A patient may submit the booking form more than once before completing OTP verification.

Without a duplicate-draft rule, repeated submissions could create multiple active BookingDraft records for the same patient, Practice Location, and Service Date.

### Proposed Design

Only one active BookingDraft may exist for the same:

```text
mobileNumberHash
+
practiceLocationId
+
serviceDate

## Decision 8

### Title

OTP Attempt, Resend, and Cooldown Policy

### Current Design

The BookingDraft review already separates the BookingDraft lifecycle from the OtpVerification lifecycle.

However, the system still requires explicit limits for:

- incorrect OTP attempts,
- OTP resend frequency,
- OTP resend count,
- and invalidation of older OTP records.

Without these limits, the system could allow brute-force attempts, unnecessary SMS costs, and several valid OTP records for the same BookingDraft.

### Proposed Design

Each OTP verification record shall follow these default rules:

```text
OTP lifetime: 5 minutes
Maximum incorrect attempts per OTP: 5
Resend cooldown: 60 seconds
Maximum resend requests per BookingDraft: 3
BookingDraft lifetime: 30 minutes

## Decision 9

### Title

Service Date and Practice Location Validation

### Current Design

The booking workflow requires the patient to select one Practice Location
and one Service Date before a BookingDraft is created.

The doctor account already defines a maximum advance-booking period.

The Practice Location already defines whether it is active and whether
new bookings are enabled.

The previous workflow referenced exact time slots, but the approved
Appointment design now uses a date-based queue.

### Proposed Design

A BookingDraft may be created only when all of the following are true:

```text
DoctorAccountSettings.allowOnlineBooking = true

PracticeLocation.isActive = true

PracticeLocation.isBookingEnabled = true

serviceDate is today or later

serviceDate is within maximumAdvanceBookingDays

the Practice Location operates on the selected date

the selected date is not closed by a schedule exception

the clinic has not manually closed booking for that date

## Decision 10

### Title

Booking Capacity, Automatic Online Booking Closure, and Dynamic Reopening

### Current Design

The booking workflow already validates whether a Practice Location and
Service Date are eligible for booking.

However, a valid Service Date may still accumulate more confirmed
appointments than the doctor can realistically complete.

Using only a maximum patient count is not appropriate because different
services require different amounts of consultation time.

The clinic may continue serving patients beyond its normal published
clinic hours when necessary.

Therefore, published clinic hours must not be treated as the maximum
operating limit.

### Proposed Design

Each doctor shall configure a daily:

```text
maximumOperatingUntil
```

Example:

```text
8:00 PM
```

This value represents the latest estimated time the doctor is willing to
continue serving patients for that Service Date.

The system shall continuously calculate the projected finish time using
the accumulated:

```text
estimatedServiceMinutes
```

of all active confirmed appointments.

Before accepting a new online booking, the backend shall calculate the
projected finish time including the new booking.

If accepting the booking would cause the projected finish time to exceed:

```text
maximumOperatingUntil
```

the online booking for that Service Date shall automatically become:

```text
Online full
```

### Online Booking Closure

When a Service Date becomes **Online full**:

- no new public BookingDraft may be created,
- existing BookingDrafts continue normally,
- confirmed appointments remain valid,
- the clinic itself remains open,
- walk-in patients may still be accepted by authorized staff.

Online booking being full does **not** mean the clinic is closed.

### Dynamic Reopening

Unlike manual closure, automatic closure is dynamic.

The system shall continuously recalculate the projected finish time.

Automatic reopening is allowed only when the projected finish becomes at
least:

```text
automaticReopenBufferMinutes
```

earlier than:

```text
maximumOperatingUntil
```

The approved Version 1 default is:

```text
90 minutes
```

Example:

```text
maximumOperatingUntil

8:00 PM

automaticReopenBufferMinutes

90 minutes

Projected Finish

6:20 PM

↓

Online booking automatically reopens
```

If the projected finish is:

```text
7:10 PM
```

online booking remains:

```text
Online full
```

The reopening buffer prevents the calendar from repeatedly switching
between Available and Online full after small queue changes.

### Reasons Capacity May Become Available

The projected finish may decrease because:

- consultations finish earlier than estimated,
- confirmed patients cancel,
- appointments are removed,
- patients are temporarily skipped,
- or clinic staff updates the queue.

### Closure Source

The system shall distinguish between:

```text
AUTOMATIC_CAPACITY

MANUAL_STAFF
```

A Service Date closed because of:

```text
AUTOMATIC_CAPACITY
```

may reopen automatically.

A Service Date closed because of:

```text
MANUAL_STAFF
```

shall never reopen automatically.

Only authorized staff may reopen it.

### Patient Calendar

The public booking calendar shall display three states.

### Available

Patient may continue online booking.

### Online full

The date remains visible.

The patient may tap it.

The patient shall see:

> Online booking is full.
>
> You may still visit as a walk-in.
> Service is not guaranteed and depends on clinic availability.

Buttons:

```text
View Clinic Details

Choose Another Date
```

The system must never promise walk-in acceptance.

Selecting an Online full date shall **not**:

- create a BookingDraft,
- reserve capacity,
- assign a queue number,
- create an Appointment.

### Clinic Closed

The patient may not continue booking.

Walk-in information is not displayed unless separately configured by the
clinic.

### Walk-In Workflow

Walk-in patients remain completely separate from online booking.

When a walk-in patient arrives:

```text
Patient arrives

↓

Secretary evaluates workload

↓

Secretary accepts or declines

↓

If accepted

↓

Patient created or matched

↓

Appointment created

↓

Queue Number assigned
```

Walk-in acceptance always remains under staff control.

### Concurrency

If multiple patients attempt to obtain the final available online booking
simultaneously, the backend shall use a concurrency-safe transaction.

Only bookings that still fit within:

```text
maximumOperatingUntil
```

may succeed.

Others receive:

```text
Online booking is full.
```

### Decision

Approved

### Reason

Using projected service duration instead of patient count produces a much
more realistic estimate of clinic workload.

Dynamic reopening prevents wasted capacity when the queue finishes much
earlier than expected.

Separating automatic closure from manual closure gives clinics full
operational control while allowing the system to recover unused booking
capacity.

Patients receive a clear explanation that online booking is full without
incorrectly assuming the clinic has stopped accepting patients.

### Impact

#### Database

Future scheduling configuration shall support:

```text
maximumOperatingUntil

automaticReopenBufferMinutes

onlineBookingClosureSource
```

These values do not belong inside BookingDraft.

#### Backend

The backend must:

1. Calculate projected finish time.
2. Include the estimated service time of the new booking.
3. Automatically close online booking when capacity is exceeded.
4. Continuously recalculate projected finish time.
5. Automatically reopen online booking when sufficient capacity becomes available.
6. Never reopen manually closed dates.
7. Protect all capacity calculations using concurrency-safe transactions.

#### Frontend

The booking calendar shall clearly display:

```text
Available

Online full

Clinic closed
```

Online full dates remain visible and informative but cannot continue into
the online booking workflow.

#### Documentation

Later specifications shall document:

- Queue Capacity
- Walk-In Workflow
- Practice Location Scheduling
- Staff Override Rules
- Automatic Capacity Management

## Decision 11

### Title

BookingDraft Lifecycle Timestamps and Immutability

### Current Design

The BookingDraft lifecycle requires timestamps for creation, expiration,
successful conversion, cancellation, and later maintenance.

The design must avoid storing timestamps that duplicate information which
can already be derived reliably.

### Proposed Design

BookingDraft shall contain these lifecycle timestamps:

```text
createdAt
updatedAt
expiresAt
consumedAt
cancelledAt

## Decision 12

### Title

BookingDraft Relationships

### Current Design

BookingDraft temporarily stores an unverified booking request before a
Patient and Appointment exist.

Its relationships must support:

- the selected Practice Location,
- OTP verification attempts,
- and future answers to doctor-configured booking questions.

BookingDraft must not become indirectly responsible for permanent clinic
records merely because relational databases enjoy collecting connections.

### Proposed Design

BookingDraft may have direct relationships only to models required during
the temporary booking and OTP-verification process.

### Approved Relationships

#### PracticeLocation

BookingDraft shall belong to one PracticeLocation.

```text
BookingDraft
        ↓
PracticeLocation

## Decision 13

### Title

BookingDraft Design Philosophy

### Current Design

The online booking workflow requires the system to temporarily hold patient
information before permanent healthcare records are created.

Without a dedicated temporary model, the system would either:

- create incomplete Patient records,
- create incomplete Appointment records,
- or require complex rollback logic whenever OTP verification fails.

None of these approaches aligns with the project's design principles.

### Design Philosophy

BookingDraft exists to bridge the gap between:

```text
Patient starts booking

↓

Patient identity is verified

↓

Permanent healthcare records are created
```

BookingDraft is therefore a temporary transaction record.

It represents a booking attempt.

It is not a medical record.

It is not a Patient.

It is not an Appointment.

It is not a Queue Entry.

It is not part of the patient's permanent clinical history.

Its sole responsibility is to safely preserve the information required to
complete booking while the patient's identity is still being verified.

### Core Principles

BookingDraft shall follow these principles.

#### Principle 1

Temporary before permanent.

Permanent records shall never be created until the patient successfully
completes OTP verification.

#### Principle 2

Single responsibility.

BookingDraft manages only the temporary booking process.

Patient manages patient identity.

Appointment manages the confirmed consultation.

Queue manages patient flow.

Each model owns its own responsibility.

#### Principle 3

One-way lifecycle.

A BookingDraft progresses through its lifecycle but never becomes active
again after reaching a terminal state.

```text
PENDING_OTP
        ↓
CONSUMED
```

or

```text
PENDING_OTP
        ↓
EXPIRED
```

or

```text
PENDING_OTP
        ↓
CANCELLED
```

Terminal states are immutable.

#### Principle 4

Safe conversion.

Successful OTP verification does not modify BookingDraft into another
entity.

Instead, the backend performs one database transaction that creates:

- Patient,
- Appointment,
- Queue Number,
- Booking Access Token,

then marks the BookingDraft as consumed.

BookingDraft remains as the historical record of the booking attempt.

#### Principle 5

No duplicate responsibilities.

BookingDraft stores only information required before verification.

Permanent operational and clinical information belongs to the models that
own those responsibilities.

#### Principle 6

Patient-first recovery.

Patients may recover from:

- incorrect OTP entry,
- expired OTP,
- resend requests,
- temporary interruptions,

without restarting the booking form unless the BookingDraft itself has
expired or been cancelled.

The system should forgive ordinary mistakes while protecting data
integrity and security.

### Architectural Benefits

Using BookingDraft provides:

- cleaner database design,
- simpler transaction management,
- fewer incomplete permanent records,
- easier recovery from interrupted bookings,
- better auditability,
- clearer model responsibilities,
- improved future maintainability.

### Decision

Approved

### Reason

BookingDraft exists because identity verification and appointment creation
are separate business events.

Separating them prevents incomplete permanent records and keeps the system
aligned with the project's patient-first, queue-first philosophy.

This design also supports future expansion without changing the
fundamental booking workflow.

### Impact

#### Database

BookingDraft remains a dedicated temporary model.

It shall not gradually accumulate responsibilities belonging to Patient,
Appointment, Queue, or Notification.

#### Backend

All booking logic before OTP verification is centered on BookingDraft.

All permanent record creation occurs only during the approved conversion
transaction.

#### Frontend

The patient experiences one continuous booking flow, even though the
backend separates temporary and permanent records internally.

#### Documentation

This philosophy becomes the governing principle for all future BookingDraft
changes.

Any proposed field or relationship added to BookingDraft must answer:

> Does this belong to the temporary booking process?

If the answer is no, it belongs in another model.

## Decision 14

### Title

Safe Mobile Number Display Suffix

### Current Design

BookingDraft stores:

```text
mobileNumberEncrypted
mobileNumberHash

---

# Pending Decisions

1. Exact BookingDraft field list
2. Required and optional fields
3. Service-date data type
4. Full-name length
5. Mobile encryption storage type
6. Mobile hash length
7. Expiration duration
8. Consumption behavior
9. Invalidation behavior
10. OTP Verification relationship
11. Practice Location relationship
12. Duplicate active draft policy
13. Future booking-window validation
14. Cleanup strategy
15. Constraints
16. Indexes
17. Transactional conversion requirements
18. Notification relationship for OTP messages

---

# Impact Assessment

## Database

High

BookingDraft is a new model and requires changes to related models.

## Backend

High

The booking, OTP verification, Patient creation, and Appointment creation
workflows depend on this model.

## Frontend

Medium

The frontend must preserve the booking attempt while OTP verification is
pending.

## Documentation

High

The booking workflow, OTP workflow, and data-retention documents may
require updates.

---

# Documents Affected

- ADR-0001 - Introduce BookingDraft
- Review-0001 - Appointment Model
- BookingDraft Prisma Draft
- Patient Workflow Specification
- OTP Verification Specification
- Patient Data Retention Policy


## Decision 15

### Title

Existing Patient Response

### Current Design

Clinic staff prepare patient folders, previous records, and registration
documents before consultation.

The current BookingDraft design does not record whether the patient
believes they already have an existing record with the selected clinic.

Without this information, the secretary cannot easily distinguish between:

- a returning patient whose existing record should be prepared,
- a new patient who requires initial registration,
- and a patient who is unsure whether a previous record exists.

### Approved Design

The booking form shall ask:

> Have you visited this clinic before?

The approved answers are:

```text
Yes
No
I'm not sure
```

The internal database values shall be:

```prisma
enum ExistingPatientResponse {
  YES
  NO
  UNSURE
}
```

BookingDraft shall contain:

```prisma
existingPatientResponse ExistingPatientResponse
```

The field is required.

### Business Meaning

The response provides operational guidance to authorized clinic staff.

It does not prove that an existing Patient record has been found.

The response must not automatically determine whether the backend:

- creates a new Patient,
- matches an existing Patient,
- or merges Patient records.

Actual Patient matching remains governed by a separate approved Patient
Matching review.

### Staff Use

Authorized doctors and secretaries may use the response to:

- prepare an existing paper or electronic patient record,
- prepare new-patient registration documents,
- identify bookings requiring record verification,
- and organize the clinic's daily preparation work.

Recommended staff labels are:

| Stored Value | Staff Display |
|--------------|---------------|
| `YES` | Returning patient |
| `NO` | New patient |
| `UNSURE` | Record needs checking |

### Public Display Restriction

The existing-patient response must not appear on the public queue display.

It may be displayed only in authorized clinic workflows.

### Decision

Approved

### Reason

The question reflects the clinic's actual preparation workflow.

Using three values instead of a Boolean preserves uncertainty and prevents
the system from incorrectly treating an unsure patient as definitely new.

The response helps clinic staff prepare records without pretending that
patient-provided information is a verified database match.

### Impact

#### Database

Add:

```prisma
enum ExistingPatientResponse {
  YES
  NO
  UNSURE
}
```

BookingDraft requires:

```prisma
existingPatientResponse ExistingPatientResponse
```

#### Backend

The backend must validate one of the three approved values.

The value must not be used as the sole Patient-matching rule.

#### Frontend

The booking form shall ask:

> Have you visited this clinic before?

with these choices:

```text
Yes
No
I'm not sure
```

#### Documentation

The following documents require later alignment:

- Booking Workflow Specification
- Patient Matching Review
- Secretary Dashboard Specification
- Doctor Dashboard Specification



---

# Review Outcome

| Item | Status |
|------|--------|
| Decisions Approved | 0 |
| Decisions Rejected | 0 |
| Decisions Deferred | 0 |
| Overall Result | In Progress |

---

# Implementation Checklist

| Task | Status |
|------|:------:|
| BookingDraft Review Completed | ☐ |
| BookingDraft Draft Updated | ☐ |
| Related Models Reviewed | ☐ |
| Prisma Schema Updated | ☐ |
| Migration Created | ☐ |
| Backend Updated | ☐ |
| API Tested | ☐ |
| Integration Tested | ☐ |
| Documentation Updated | ☐ |
| Ready for Production | ☐ |

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
| 0.1 | 2026-08-02 | Initial BookingDraft review document |

---

# End of Review