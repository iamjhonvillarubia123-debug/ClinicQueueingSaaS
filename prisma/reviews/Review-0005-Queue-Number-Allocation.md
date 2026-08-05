# Review-0005 - Queue Number Allocation

---

# Review Information

| Item | Value |
|------|-------|
| Review ID | Review-0005 |
| Module | Queue Number Allocation |
| Review Level | 3 - Architectural |
| Review Status | In Progress |
| Review Version | 0.1 |
| Review Date | 2026-08-03 |
| Product Owner | Product Owner |
| Technical Reviewer | ChatGPT |

---

# Purpose

This review defines how permanent Queue Numbers are allocated safely when
a BookingDraft is converted into a confirmed Appointment or when
authorized clinic staff accepts a walk-in patient.

The review shall ensure that Queue Numbers remain:

- unique,
- permanent,
- understandable,
- concurrency safe,
- and consistent with the approved queue-first philosophy.

No Queue Number allocation logic shall be implemented until this review
is approved.

---

# Scope

## Included

This review covers:

- Queue Number sequence boundary
- Queue Number reset rules
- First Queue Number of the service date
- Online booking allocation
- Secretary-created booking allocation
- Walk-in allocation
- Concurrent allocation requests
- Duplicate prevention
- Cancellation behaviour
- Missed-patient behaviour
- Queue Number reuse policy
- Transaction requirements
- Database constraints
- Required indexes
- Failure and retry behaviour

## Excluded

This review does not define:

- Patient matching
- BookingDraft fields
- OTP verification
- Appointment lifecycle statuses
- Missed-patient reinsertion order
- Medical-priority overrides
- Daily booking capacity
- Doctor schedule and emergency closure
- Public queue display
- Frontend implementation

Those topics remain governed by their existing or future reviews.

---

# Background

The approved booking workflow assigns a permanent Queue Number only after
successful OTP verification.

```text
BookingDraft created
        ↓
OTP verified
        ↓
Patient created or matched
        ↓
Queue Number allocated
        ↓
Appointment created
        ↓
BookingDraft consumed
```

Authorized clinic staff may also create an Appointment for an accepted
walk-in patient.

Both online and staff-created Appointments require the same safe Queue
Number allocation process.

The current Appointment design requires Queue Numbers to be unique within
one:

```text
Practice Location
+
Service Date
```

However, the method used to allocate the next number has not yet been
approved.

A simple implementation such as:

```text
highest Queue Number + 1
```

is unsafe without concurrency protection because two simultaneous
requests may calculate the same next number.

---

# Governing Principles

This review shall remain consistent with:

- PHIL-0001 - Product Philosophy
- PHIL-0002 - Queue Philosophy
- PHIL-0003 - Patient Experience Philosophy
- PHIL-0004 - Doctor Workflow Philosophy
- 06 - Engineering Principles
- Review-0001 - Appointment
- Review-0002 - BookingDraft
- Review-0003 - OTP Verification
- Review-0004 - Booking System Consistency

The following approved queue principles apply:

- Queue Numbers are assigned only to confirmed Appointments.
- Queue Numbers never change after assignment.
- Queue Numbers are not renumbered after cancellation or absence.
- Queue position and operational serving order are related but distinct.
- Human judgment may affect serving order without changing Queue Numbers.
- Booking conversion must be atomic.
- Concurrent requests must not receive the same Queue Number.

---

# Expected Queue Number Boundary

The expected Version 1 sequence boundary is:

```text
One Practice Location
+
One Service Date
```

Example:

```text
Main Clinic
2026-08-03

Queue Numbers:
1, 2, 3, 4, ...
```

Another Practice Location may begin its own sequence for the same date.

A new Service Date begins a new sequence.

This remains pending approval during the review.

---

# Decision Log

The following decisions form the approved Queue Number allocation
specification.

Additional decisions will be added below as the review progresses.

## Decision 1

### Title

Queue Number Sequence Boundary

### Current Design

The Appointment design requires Queue Numbers to identify a patient's
permanent position in the clinic queue.

However, the exact boundary of each Queue Number sequence must be defined
before allocation can be implemented safely.

### Approved Design

Each Queue Number sequence shall belong to exactly one:

```text
Practice Location
+
Service Date
```

The sequence key is therefore:

```text
practiceLocationId
+
serviceDate
```

Queue Numbers are not globally unique across the entire SaaS.

Different Practice Locations may use the same Queue Number on the same
Service Date.

The same Practice Location may reuse the same Queue Number on a different
Service Date because each date has its own sequence.

### Examples

#### Same Practice Location and Same Service Date

```text
Main Clinic
2026-08-03

Queue Numbers:
1
2
3
4
```

These Queue Numbers must be unique within this sequence.

#### Different Practice Locations on the Same Service Date

```text
Main Clinic
2026-08-03
Queue Number: 1
```

and:

```text
Branch Clinic
2026-08-03
Queue Number: 1
```

This is valid because the Practice Locations are different.

#### Same Practice Location on Different Service Dates

```text
Main Clinic
2026-08-03
Queue Number: 1
```

and:

```text
Main Clinic
2026-08-04
Queue Number: 1
```

This is valid because the Service Dates are different.

### Doctor Relationship

The Queue Number sequence does not require a separate doctor identifier.

The selected Practice Location already belongs to one doctor account.

The backend must still verify that the Practice Location belongs to the
correct doctor account before allocating a Queue Number.

### Decision

Approved

### Reason

Clinics operate separate daily queues at each Practice Location.

Using Practice Location and Service Date as the sequence boundary reflects
the real clinic workflow while keeping Queue Numbers short and easy for
patients and staff to understand.

A globally unique Queue Number would provide no operational benefit and
would make the patient-facing queue unnecessarily confusing.

### Impact

#### Database

Appointment must enforce Queue Number uniqueness using:

```text
practiceLocationId
+
serviceDate
+
queueNumber
```

The exact Prisma constraint will be approved in a later decision.

#### Backend

Queue Number allocation must resolve the sequence using the selected
Practice Location and Service Date.

#### Frontend

The displayed Queue Number remains a simple number such as:

```text
12
```

The frontend does not need to display a global or cross-location sequence.

#### Documentation

The Appointment and Queue Workflow specifications must use the same
location-and-date sequence boundary.

## Decision 2

### Title

First Queue Number and Daily Reset

### Current Design

Each Queue Number sequence belongs to one Practice Location and one
Service Date.

The starting Queue Number and reset behaviour must be defined to ensure a
consistent experience for patients and clinic staff.

### Approved Design

Each new Queue Number sequence shall begin with the integer value:

```text
1
```

Queue Numbers shall be stored internally as positive integers.

The frontend shall display Queue Numbers using a minimum two-digit format.

Examples:

| Stored Value | Display |
|--------------|---------|
| 1 | 01 |
| 2 | 02 |
| 9 | 09 |
| 10 | 10 |
| 25 | 25 |
| 99 | 99 |
| 100 | 100 |

The sequence shall increase by one for every successfully created
Appointment.

A new sequence begins automatically whenever:

- the Service Date changes, or
- a different Practice Location is used.

Queue Numbers shall never continue from a previous Service Date.
```

The sequence shall increase by one for every successfully created
Appointment.

A new sequence begins automatically whenever:

- the Service Date changes, or
- a different Practice Location is used.

Queue Numbers shall never continue from a previous Service Date.

### Cancellation Rule

Cancelled, expired, deleted, or missed Appointments shall not cause Queue
Numbers to be renumbered.

Example:

```text
1
2
3 (Cancelled)
4
5
```

Queue Numbers 4 and 5 remain unchanged.

Unused Queue Numbers are acceptable.

### Decision

Approved

### Reason

Patients and clinic staff naturally expect each day's queue to begin with
Queue Number 1.

Never renumbering assigned Queue Numbers avoids confusion in SMS
notifications, printed records, staff dashboards, and patient queue
tracking.

### Impact

#### Database

The allocation strategy must always begin from Queue Number 1 when a new
Practice Location and Service Date sequence is created.

#### Backend

Queue Number allocation shall never renumber existing Appointments.

#### Frontend

#### Frontend

The frontend shall display Queue Numbers using a minimum two-digit format.

Examples:

```text
01
02
03
...
09
10
11
```

Numbers containing three or more digits shall be displayed without
truncation.

Examples:

```text
100
101
```

Formatting shall be handled by the presentation layer.

The database shall continue storing Queue Numbers as positive integers.

## Decision 3

### Title

Queue Numbers Are Permanent and Never Reused

### Current Design

Queue Numbers identify confirmed Appointments within one Practice
Location and one Service Date.

The architecture must define whether an assigned Queue Number may be
reused after cancellation, absence, deletion, or other changes.

### Approved Design

Once a Queue Number has been assigned to an Appointment, it becomes
permanent.

Assigned Queue Numbers shall never be:

- reused,
- reassigned,
- renumbered,
- or transferred to another Appointment.

If an Appointment is cancelled, the Queue Number remains part of the
historical queue for that Service Date.

Future Appointments continue receiving the next available Queue Number in
the sequence.

### Examples

Example:

```text
01
02
03 (Cancelled)
04
05
```

The next Appointment receives:

```text
06
```

Queue Number 03 is never reused.

### Decision

Approved

### Reason

Permanent Queue Numbers ensure consistency across:

- patient confirmations,
- SMS notifications,
- staff dashboards,
- audit history,
- printed reports,
- and public queue displays.

Patients should never arrive at the clinic with a Queue Number that later
changes because another patient cancelled.

### Impact

#### Database

Queue Numbers become immutable after Appointment creation.

#### Backend

Queue allocation shall always allocate the next unused Queue Number.

Cancelled or deleted Appointments shall not release previously assigned
Queue Numbers.

#### Frontend

Patients always retain the Queue Number originally shown in their booking
confirmation.
## Decision 4

### Title

Unified Queue Number Allocation

### Current Design

Appointments may originate from multiple sources, including:

- online patient booking,
- secretary-created booking,
- accepted walk-in patients.

The architecture must define whether each source maintains a separate
queue or contributes to one shared daily queue.

### Approved Design

All confirmed Appointments shall use one shared Queue Number sequence for
each:

- Practice Location
- Service Date

The source of the Appointment shall not affect Queue Number allocation.

Appointments created through:

- online booking,
- secretary booking,
- or accepted walk-in registration

shall receive the next available Queue Number from the same sequence.

### Examples

Example:

```text
01  Online Booking
02  Online Booking
03  Secretary Booking
04  Online Booking
05  Walk-in
06  Walk-in
```

All Queue Numbers belong to the same daily queue.

### Serving Order

Queue Number allocation does not determine the exact order in which
patients are served.

Authorized clinic staff may temporarily adjust the serving order in
accordance with approved clinic workflow policies.

Such operational adjustments shall never change the assigned Queue
Number.

### Decision

Approved

### Reason

The clinic operates one patient queue regardless of how the Appointment
was created.

Maintaining one shared Queue Number sequence keeps the workflow simple
for patients, clinic staff, and doctors while preserving permanent Queue
Number identity.

### Impact

#### Database

Queue Number allocation is independent of Appointment source.

#### Backend

All Appointment creation workflows shall use the same Queue Number
allocation service.

#### Frontend

Patients see one consistent queue regardless of whether they booked
online or were registered by clinic staff.

## Decision 5

### Title

Transactional Queue Number Allocation Strategy

### Current Design

The Queue Number allocation process must safely generate the next Queue
Number when multiple Appointment creation requests occur at nearly the
same time.

The allocation process must also prevent failed booking attempts from
consuming Queue Numbers.

Queue Numbers represent successfully created Appointments.

They must not represent:

- abandoned BookingDrafts,
- failed OTP verification,
- failed capacity validation,
- failed Patient creation,
- or rolled-back Appointment transactions.

### Approved Business Rule

A Queue Number shall be allocated only as part of the successful creation
of an Appointment.

The lower Queue Number belongs to the Appointment whose database
transaction successfully commits first.

Failed booking attempts shall not consume Queue Numbers.

Example:

```text
Successful Appointment A
→ Queue Number 01

Failed booking transaction
→ No Queue Number

Successful Appointment B
→ Queue Number 02
```

The second successful patient must not receive Queue Number 03 merely
because another booking attempt failed.

### Approved Technical Strategy

Version 1 shall use a dedicated Queue Counter model.

Each Queue Counter shall represent exactly one:

```text
Practice Location
+
Service Date
```

The Queue Counter shall store:

```text
lastAllocatedQueueNumber
```

Queue Number allocation shall occur inside the same database transaction
that creates the Appointment.

The transaction shall:

1. Validate that the booking or staff-created Appointment request may
   proceed.
2. Locate the Queue Counter for the selected Practice Location and Service
   Date.
3. Create the Queue Counter if the sequence does not yet exist.
4. Lock or otherwise protect the Queue Counter from concurrent updates.
5. Increment `lastAllocatedQueueNumber`.
6. Use the new value as the Appointment Queue Number.
7. Create the Appointment.
8. Complete all other required booking-conversion operations.
9. Commit the transaction.

### Rollback Behaviour

If any part of the transaction fails:

```text
ROLLBACK
```

The Queue Counter increment shall also roll back.

The failed transaction therefore consumes no Queue Number.

The next successful Appointment receives the next consecutive number.

Example:

```text
Current last allocated number: 02

Transaction attempts to allocate: 03

Appointment creation fails

Transaction rolls back

Counter remains: 02

Next successful Appointment receives: 03
```

### Successful Allocation

A Queue Number becomes permanently allocated only after the complete
Appointment creation transaction commits successfully.

After commit, the Queue Number shall never be:

- reused,
- reassigned,
- renumbered,
- or transferred.

If the confirmed Appointment is later cancelled or missed, the assigned
Queue Number remains part of the historical queue.

### Concurrent Requests

When multiple Appointment creation transactions run concurrently, the
database must serialize access to the relevant Queue Counter.

Competing transactions must not read and allocate the same Queue Number.

Example:

```text
Current counter: 14

Transaction A commits first
→ Queue Number 15

Transaction B commits next
→ Queue Number 16
```

The exact arrival millisecond of the requests does not determine the
result.

The order of successful transaction commits determines the permanent
Queue Number order.

### Rejected Alternatives

#### `MAX(queueNumber) + 1`

Rejected because concurrent requests may calculate the same next Queue
Number.

#### Allocate Before Appointment Transaction

Rejected because a failed booking could consume a Queue Number even
though no confirmed Appointment exists.

#### Frontend-Generated Queue Numbers

Rejected because Queue Number allocation is a backend and database
responsibility.

#### Permanently Incrementing Counter Outside the Transaction

Rejected because rolled-back bookings would create artificial gaps that
may mislead or discourage patients.

### Decision

Approved

### Reason

Queue Numbers should reflect successfully confirmed Appointments rather
than unsuccessful booking attempts.

Allocating and incrementing the Queue Counter inside the Appointment
creation transaction provides:

- concurrency safety,
- rollback safety,
- consecutive numbering for successful Appointments,
- and accurate patient expectations.

This prevents situations where only three confirmed patients exist but a
patient receives Queue Number 99 because many earlier booking attempts
failed.

### Impact

#### Database

A dedicated Queue Counter model is required.

The Queue Counter update and Appointment creation must participate in the
same database transaction.

#### Backend

All Appointment creation workflows shall use one Queue Number allocation
service.

The service must not allocate or persist a Queue Number before all
required validations pass and the Appointment transaction begins.

#### Frontend

Patients see Queue Numbers that correspond to successful confirmed
Appointments.

The frontend must never reserve or generate Queue Numbers.

#### Testing

Concurrency tests must verify that:

- simultaneous successful Appointments receive different Queue Numbers,
- failed transactions do not consume Queue Numbers,
- rolled-back counter increments are restored,
- and the next successful Appointment receives the correct consecutive
  number.

  ## Decision 6

### Title

Queue Number Transaction Boundary and Retry Behaviour

### Current Design

Decision 5 requires Queue Number allocation and Appointment creation to
occur inside one database transaction.

The transaction boundary and retry behaviour must now be defined so that:

- failed bookings consume no Queue Number,
- duplicate Appointments are not created,
- and temporary concurrency conflicts may recover safely.

### Approved Transaction Boundary

All validation that does not require Queue Number allocation should occur
before the allocation transaction begins.

Examples include:

- validating request fields,
- confirming the BookingDraft exists,
- confirming the OTP has been verified,
- confirming the Practice Location is valid,
- confirming the Service Date is valid,
- and confirming the requested services are valid.

The final transaction shall then:

1. Lock or otherwise protect the BookingDraft from double consumption.
2. Confirm the BookingDraft remains `PENDING_OTP`.
3. Confirm the BookingDraft has not expired.
4. Confirm the OTP remains verified, valid, and unconsumed.
5. Recheck booking capacity.
6. Create or match the Patient using the separately approved matching
   rules.
7. Locate or create the Queue Counter for the Practice Location and
   Service Date.
8. Atomically increment the Queue Counter.
9. Create the Appointment using the allocated Queue Number.
10. Create the Booking Access Token.
11. Mark the OTP as consumed.
12. Mark the BookingDraft as `CONSUMED`.
13. Set `BookingDraft.consumedAt`.
14. Commit the transaction.

A Queue Number becomes permanent only when this complete transaction
commits successfully.

### Rollback Rule

If any transaction step fails, the complete transaction shall roll back.

Rollback must include:

- the Queue Counter increment,
- Patient creation performed by that transaction,
- Appointment creation,
- Booking Access Token creation,
- OTP consumption,
- and BookingDraft consumption.

After rollback:

- no Appointment exists from the failed transaction,
- no Queue Number is consumed,
- the BookingDraft is not marked consumed,
- and the OTP is not marked consumed.

### Automatic Retry

The backend may automatically retry the complete transaction only when the
failure is temporary and retry-safe.

Approved retryable examples include:

- transaction serialization conflict,
- deadlock,
- or another recognized transient database-concurrency error.

The backend shall use a small, bounded retry limit.

The approved Version 1 maximum is:

```text
3 transaction attempts in total
```

This means:

```text
Original attempt
+
Maximum 2 automatic retries
```

Each retry must rerun the complete protected transaction and all
authoritative validations.

### Non-Retryable Failures

The backend must not automatically retry when the failure is caused by a
business-rule rejection.

Examples include:

- BookingDraft expired,
- BookingDraft already consumed,
- OTP invalid or already consumed,
- Practice Location unavailable,
- Service Date unavailable,
- online capacity full,
- or invalid patient data.

The patient or staff member shall receive the appropriate business error
instead.

### Idempotency and Duplicate Prevention

A repeated request for the same BookingDraft must not create another
Appointment after the first conversion succeeds.

Before conversion, the transaction must confirm that the BookingDraft has
not already been consumed.

After successful conversion, subsequent requests shall return the existing
booking result or an approved already-completed response rather than
allocating another Queue Number.

The exact API idempotency-key design may be defined during backend
implementation.

### Queue Ordering

Queue Number order is determined by successful protected allocation.

When two valid transactions compete:

- one transaction obtains and commits the lower Queue Number,
- the next successful transaction receives the following Queue Number.

Failed or rolled-back transactions do not appear in the Queue Number
sequence.

### Decision

Approved

### Reason

A clear transaction boundary prevents partial bookings and artificial
Queue Number gaps.

Bounded automatic retry allows the system to recover from temporary
database conflicts without retrying permanent business failures or
creating duplicate Appointments.

### Impact

#### Database

The Queue Counter, Appointment, BookingDraft, OTP, Patient, and Booking
Access Token operations must support one atomic transaction.

#### Backend

The backend must:

1. Separate preliminary validation from the final protected transaction.
2. Recheck authoritative rules inside the transaction.
3. Roll back every related change on failure.
4. Retry only recognized transient database errors.
5. Limit processing to three total transaction attempts.
6. prevent double consumption of one BookingDraft.

#### Frontend

The frontend shall not retry booking confirmation indefinitely.

If the backend returns a temporary failure after exhausting its retries,
the frontend may show:

> We could not complete your booking due to a temporary system issue.
> Please try again.

The frontend must not generate another Queue Number or assume that the
booking succeeded.

#### Testing

Tests must verify:

- successful transaction commit,
- rollback after Appointment creation failure,
- rollback of Queue Counter increment,
- retry after a transient concurrency error,
- no retry after business-rule rejection,
- and no duplicate Appointment from repeated requests.

---

# Pending Decisions

1. Exact Queue Number sequence boundary
2. First Queue Number of each Service Date
3. Daily reset behaviour
4. Permanent Queue Number rule
5. Cancellation and no-show behaviour
6. Queue Number reuse prohibition
7. Online booking and walk-in allocation consistency
8. Concurrency-safe allocation strategy
9. Required database constraint
10. Allocation transaction boundary
11. Retry behaviour after conflicts
12. Handling of failed booking conversion
13. Staff override limitations
14. Audit requirements
15. Required indexes

---

# Initial Architectural Requirements

The final design must guarantee:

- no duplicate Queue Numbers within one Practice Location and Service Date,
- no Queue Number allocation before Appointment confirmation,
- no reuse of cancelled, missed, or removed Queue Numbers,
- no renumbering of later patients,
- no allocation outside the booking or walk-in creation transaction,
- and no reliance on frontend-generated Queue Numbers.

---

# Candidate Allocation Strategies

The following strategies require review.

## Strategy A

Read the highest Queue Number and add one.

```text
MAX(queueNumber) + 1
```

This approach is not safe without locking or equivalent concurrency
protection.

## Strategy B

Use a dedicated daily queue counter record for each Practice Location and
Service Date.

The counter is updated atomically when allocating a Queue Number.

## Strategy C

Use database-level advisory locking or another PostgreSQL-specific locking
strategy around allocation.

The final choice shall be based on:

- correctness,
- clarity,
- Prisma compatibility,
- transaction safety,
- maintainability,
- and operational recovery.

No strategy has been approved yet.

---

# Impact Assessment

## Database

High

The design may require:

- a dedicated queue counter model,
- a composite unique constraint,
- transaction locking,
- and supporting indexes.

## Backend

High

BookingDraft conversion and staff-created walk-in Appointments depend on
safe allocation.

## Frontend

Low

The frontend displays the assigned Queue Number but must never generate it.

## Documentation

High

The Appointment, booking conversion, queue workflow, and walk-in
specifications must follow the approved allocation design.

---

# Review Outcome

| Item | Status |
|------|--------|
| Decisions Approved | 6 |
| Decisions Rejected | 0 |
| Decisions Deferred | 0 |
| Overall Result | In Progress |

---

# Implementation Checklist

| Task | Status |
|------|:------:|
| Sequence Boundary Approved | ☐ |
| Allocation Strategy Approved | ☐ |
| Concurrency Strategy Approved | ☐ |
| Database Constraint Approved | ☐ |
| Transaction Boundary Approved | ☐ |
| Retry Behaviour Approved | ☐ |
| Appointment Review Aligned | ☐ |
| Booking Conversion Aligned | ☐ |
| Prisma Draft Created | ☐ |
| Prisma Schema Updated | ☐ |
| Migration Created | ☐ |
| Concurrency Tests Passed | ☐ |
| Review Approved | ☐ |

---

# Governance

This review follows:

```text
docs/governance/engineering/01 - Engineering Review Process.md
docs/governance/engineering/02 - Database Governance.md
docs/governance/engineering/05 - Review Template.md
docs/governance/engineering/06 - Engineering Principles.md
```

---

# Version History

| Version | Date | Description |
|---------|------|-------------|
| 0.1 | 2026-08-03 | Initial Queue Number allocation review |

---

# End of Review