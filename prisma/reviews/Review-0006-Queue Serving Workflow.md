# Review-0006 - Queue Serving Workflow

---

# Review Information

| Item | Value |
|------|-------|
| Review ID | Review-0006 |
| Module | Queue Serving Workflow |
| Review Level | 3 - Architectural |
| Review Status | In Progress |
| Review Version | 0.1 |
| Review Date | 2026-08-03 |
| Product Owner | Product Owner |
| Technical Reviewer | ChatGPT |

---

# Purpose

This review defines how confirmed Appointments are served after Queue
Numbers have already been allocated.

The review governs clinic operations performed by:

- doctors,
- secretaries,
- authorized staff,
- and patients.

This review does not define Queue Number allocation.

Queue Number allocation is governed by Review-0005.

---

# Scope

## Included

This review covers:

- Calling the next patient
- Current serving patient
- Waiting patients
- Skipped patients
- Temporarily absent patients
- Patient self-service return
- Secretary-assisted reinsertion
- Walk-in serving
- Doctor serving order adjustments
- Queue pause
- Queue resume
- Queue completion
- End-of-day handling
- Serving history
- Operational audit trail

## Excluded

This review does not define:

- Queue Number allocation
- BookingDraft
- OTP verification
- Appointment creation
- Patient matching
- Daily booking capacity
- Notification templates
- Billing
- Medical consultation workflow

---

# Background

Review-0005 defines how permanent Queue Numbers are allocated.

Once an Appointment has received a Queue Number, the clinic begins
serving patients.

Unlike Queue Numbers, the serving order may change throughout the day.

Examples include:

- temporarily absent patients,
- walk-in patients,
- doctor discretion,
- secretary operational adjustments,
- emergency situations.

The Queue Number remains permanent.

Only the serving order changes.

---

# Governing Principles

This review follows:

- PHIL-0001
- PHIL-0002
- PHIL-0003
- PHIL-0004
- Engineering Principles
- Review-0001
- Review-0002
- Review-0003
- Review-0004
- Review-0005

---

# Core Philosophy

The Queue Number represents permanent patient identity within the daily
queue.

Serving Order represents the doctor's operational workflow.

These are independent concepts.

Changing the serving order must never change the assigned Queue Number.

---

# Decision Log

The following decisions define the approved Queue Serving Workflow.

Additional decisions will be added as this review progresses.

## Decision 1

### Title

Appointment Queue State Machine

### Current Design

The clinic requires a consistent way to track where every Appointment is
within the serving workflow.

The earlier draft included intermediate states for patient return and
reinsertion.

Those intermediate values represent actions or transitions rather than
meaningful patient conditions.

### Approved Design

Each Appointment participating in the serving workflow shall occupy one
operational serving state at a time.

The approved Version 1 serving states are:

```text
WAITING
CALLED
TEMPORARILY_ABSENT
IN_SERVICE
COMPLETED
```

### Normal Serving Lifecycle

```text
WAITING
    ↓
CALLED
    ↓
IN_SERVICE
    ↓
COMPLETED
```

### Missed Call Lifecycle

If a patient does not respond after being called:

```text
WAITING
    ↓
CALLED
    ↓
TEMPORARILY_ABSENT
```

If the patient later returns through self-service or staff assistance:

```text
TEMPORARILY_ABSENT
    ↓
WAITING
```

The reinsertion process changes the patient's serving position but does
not require a separate serving state.

### Actions, Not States

The following are actions:

```text
Call Next
Mark Temporarily Absent
I am here
Secretary Reinsert
Start Consultation
Complete Consultation
```

These actions cause valid transitions between serving states.

They are not stored as permanent queue states.

### Queue Number Rule

Throughout the complete serving workflow:

- the Queue Number remains permanent,
- the serving state may change,
- and the serving position may change.

Reinsertion must never change the assigned Queue Number.

### Valid State Transitions

```text
WAITING
→ CALLED

CALLED
→ IN_SERVICE

CALLED
→ TEMPORARILY_ABSENT

TEMPORARILY_ABSENT
→ WAITING

IN_SERVICE
→ COMPLETED
```

Other transitions require a separately approved workflow.

### Decision

Approved

### Reason

A serving state should represent a meaningful operational condition that
may exist for a measurable period of time.

Return requests and reinsertion are actions that immediately move the
Appointment from `TEMPORARILY_ABSENT` back to `WAITING`.

Removing unnecessary intermediate states produces a simpler and more
accurate model of real clinic operations.

### Impact

#### Database

The Version 1 serving-state design requires only:

```text
WAITING
CALLED
TEMPORARILY_ABSENT
IN_SERVICE
COMPLETED
```

No states are required for:

```text
RETURN_REQUESTED
WAITING_FOR_REINSERTION
```

#### Backend

Every serving action must validate the current state before applying a
transition.

Examples:

- `Call Next` requires `WAITING`.
- `Mark Temporarily Absent` requires `CALLED`.
- `I am here` requires `TEMPORARILY_ABSENT`.
- `Secretary Reinsert` requires `TEMPORARILY_ABSENT`.
- `Start Consultation` requires `CALLED`.
- `Complete Consultation` requires `IN_SERVICE`.

#### Frontend

Available actions shall depend on the Appointment's current serving state.

The interface must not expose actions that are invalid for the current
state.

#### Documentation

Future decisions shall describe reinsertion as an action and serving-order
change, not as an additional serving state.

## Decision 2

### Title

Secretary Queue Controls

### Current Design

The queue shall be operated primarily by the secretary.

The design goal is to minimize the number of actions required during
normal clinic operations while preserving flexibility for exceptional
situations.

The doctor is not required to manage the operational queue.

### Approved Design

The secretary shall operate the queue using three primary controls.

```text
Next Patient

Reinsert

Undo Next Patient
```

A contextual action is available only for the currently called patient:

```text
Continue After Procedure
```

This action is used when the consultation cannot yet be completed because
the patient must temporarily leave to complete another required clinic
activity before returning to the doctor.

Examples include:

- laboratory work,
- imaging,
- diagnostic procedures,
- vaccination,
- payment,
- insurance processing,
- or other clinic-directed activities.

Selecting this action changes the Appointment state to:

```text
OUT_FOR_PROCEDURE
```

The Appointment is removed from the active queue and displayed within a
separate:

```text
Waiting to Continue
```

panel.

The Queue Number remains unchanged.

### Automatic Behaviour

The secretary is not required to perform separate actions for:

- completing a finished consultation,
- marking a missed patient temporarily absent,
- or calling the next patient.

These outcomes occur automatically through the approved queue workflow.

### Doctor Responsibilities

The doctor may:

- view the queue,
- optionally view the current patient.

The doctor is not required to:

- start consultation,
- pause consultation,
- complete consultation,
- manage reinsertion,
- or manage queue progression.

Queue operation remains the responsibility of authorized clinic staff.

### Decision

Approved

### Reason

Reducing the number of required controls lowers training requirements,
reduces accidental errors, and better reflects the real workflow of
small and medium clinics where the secretary manages patient flow while
the doctor focuses on medical care.

### Impact

#### Frontend

The secretary dashboard shall expose only the approved queue controls.

Additional actions shall appear only when context requires them.

#### Backend

Queue operations shall remain staff-driven while preserving Queue Number
immutability and serving-order flexibility.

## Decision 3

### Title

Next Patient Workflow

### Current Design

The secretary advances the clinic queue using one primary action:

```text
Next Patient
```

This action must support the normal completion of consultations, missed
patients, and patients who temporarily leave for additional clinic
activities.

The secretary should not need different buttons for each routine
scenario.

### Approved Design

`Next Patient` is the primary queue progression action.

When selected, the system first evaluates the currently active
Appointment.

The resulting state depends on that Appointment's current condition.

#### Scenario 1 — Consultation Finished

The current Appointment becomes:

```text
COMPLETED
```

The next eligible Appointment becomes:

```text
CALLED
```

---

#### Scenario 2 — Patient Did Not Respond

If the currently called Appointment never entered consultation before the
secretary advances the queue, the Appointment automatically becomes:

```text
TEMPORARILY_ABSENT
```

The Queue Number remains unchanged.

The next eligible Appointment becomes:

```text
CALLED
```

---

#### Scenario 3 — Continue After Procedure

If the secretary previously selected:

```text
Continue After Procedure
```

the Appointment already occupies:

```text
OUT_FOR_PROCEDURE
```

Selecting:

```text
Next Patient
```

does not modify that Appointment.

The system simply calls the next eligible WAITING Appointment.

### Selection Rule

The next patient shall always be:

> The first Appointment in the current Serving Order whose state is
> `WAITING`.

### Queue Number Rule

Queue Number is never modified by:

- Next Patient,
- completion,
- temporary absence,
- or continuation after procedure.

### Decision

Approved

### Reason

One primary workflow greatly simplifies secretary operation while still
supporting the most common clinic situations.

Routine workflow becomes predictable and requires minimal training.

Exceptional situations remain available through contextual actions rather
than additional permanent buttons.

### Impact

#### Frontend

The secretary primarily operates the queue using one button:

```text
Next Patient
```

#### Backend

The backend determines the correct state transition before selecting the
next WAITING Appointment.

The queue progression transaction must remain atomic.

#### Documentation

Future workflow decisions shall build upon the approved Next Patient
behavior rather than introducing alternative progression methods.

## Decision 4

### Title

Patient Reinsertion Workflow

### Current Design

Patients may temporarily leave the active queue for different reasons.

Examples include:

- the patient missed their call,
- the patient returned after becoming temporarily absent,
- the patient returned after completing a clinic-directed procedure,
- or authorized clinic staff must place the patient back into the active
  Serving Order.

The system must provide a fair and predictable reinsertion process while
preventing abuse.

### Approved Design

The Queue Number shall never change during reinsertion.

Reinsertion changes only the Appointment's current Serving Order.

The reinsertion workflow depends on why the patient is returning.

---

### Workflow A — Self-Service Reinsertion

A patient whose Appointment is in the following state:

```text
TEMPORARILY_ABSENT
```

may use the self-service:

```text
I'm Here
```

feature.

Business Rules:

- Available only once per Appointment.
- Available only on the scheduled Service Date.
- Available only while the Appointment remains active.
- Available only before the Appointment is cancelled.

The system automatically changes the Appointment from:

```text
TEMPORARILY_ABSENT
```

to:

```text
WAITING
```

The Appointment is then reinserted into the current Serving Order using
the approved Protected Next Position Rule.

After successful reinsertion, the patient may no longer use:

```text
I'm Here
```

during the same Appointment.

If the patient later misses another call, the Queue Page shall instruct
the patient to approach the secretary for assistance.

---

### Workflow B — Staff-Controlled Reinsertion

Authorized clinic staff may reinsert:

- temporarily absent patients,
- patients returning after clinic-directed procedures,
- or other approved operational cases.

The secretary initiates reinsertion by selecting:

```text
Reinsert
```

The system displays the current active Serving Order and presents every
valid insertion point.

Example:

```text
▶ 02 Maria Santos

05 Jose Mendoza

──────────────
Insert Here
──────────────

06 Carla Ramos
```

The secretary selects the desired insertion point.

The Appointment is inserted at the selected position.

Only the current Serving Order changes.

Queue Number, Appointment identity, and Appointment history remain
unchanged.

Staff-controlled reinsertion is not limited to one use.

The secretary may perform staff-controlled reinsertion whenever clinic
operations require it.

---

### Workflow C — Patient Returning After Procedure

Patients whose Appointment is:

```text
OUT_FOR_PROCEDURE
```

shall not use:

```text
I'm Here
```

Instead, the secretary selects the patient from:

```text
Waiting to Continue
```

and performs a staff-controlled reinsertion.

This workflow has no predefined reinsertion limit.

The patient may temporarily leave and return multiple times during the
same Appointment if clinically required.

---

### Protected Next Position Rule

The automatic self-service reinsertion workflow shall protect the
patient who is already next to be called.

The reinsertion order shall be:

```text
Current CALLED Appointment

↓

Next WAITING Appointment (Protected)

↓

Returning Appointment

↓

Remaining WAITING Appointments
```

The protected next patient always retains priority.

The returning patient is inserted immediately after that protected
position.

All remaining WAITING Appointments shift one position later in the
Serving Order.

This rule applies only to the approved self-service reinsertion
workflow.

Staff-controlled reinsertion does not use this rule.

Instead, the secretary selects the desired insertion point within the
current active Serving Order.

If multiple patients request self-service reinsertion at exactly the
same recorded time:

1. Earlier reinsertion request time has priority.
2. If equal, the lower Queue Number has priority.

---

### Queue Number Rule

Reinsertion never changes:

- Queue Number,
- Appointment identity,
- Appointment history.

Only the current Serving Order changes.

### Decision

Approved

### Reason

The approved reinsertion workflow balances patient fairness with
operational flexibility.

Patients who miss their turn receive one limited opportunity to
rejoin the queue through the Protected Next Position Rule.

Staff-controlled reinsertion gives the secretary complete control over
where a patient should be placed within the active Serving Order,
allowing the workflow to match real clinic operations without changing
Queue Numbers or Appointment history.

### Impact

#### Backend

The backend shall distinguish:

- self-service reinsertion,
- staff-controlled reinsertion,
- and procedure continuation.

Each workflow follows different business rules.

Automatic reinsertion shall apply the Protected Next Position Rule.

Staff-controlled reinsertion shall insert the Appointment at the
specific Serving Order position selected by the secretary.

The backend shall validate that the selected insertion point is valid
and update only the current Serving Order.

Queue Number and Appointment identity shall remain unchanged.

#### Frontend

The Patient Queue Page displays:

```text
I'm Here
```

only when the Appointment is eligible for one-time self-service
reinsertion.

The Secretary Dashboard provides:

```text
Reinsert
```

When selected, the dashboard visually displays every valid insertion
point within the current active Serving Order.

The secretary chooses the desired insertion position directly from the
queue instead of selecting predefined placement options.

Patients awaiting continuation appear separately under:

```text
Waiting to Continue
```

#### Documentation

Future workflow decisions shall build upon the approved reinsertion
workflows and the Protected Next Position Rule rather than introducing
alternative reinsertion behaviour.

## Decision 5

### Title

Out for Procedure Workflow

### Current Design

During an active consultation, the doctor may instruct the patient to
temporarily leave in order to complete another required clinic activity
before the consultation can continue.

Examples include:

- laboratory tests,
- imaging,
- diagnostic procedures,
- vaccinations,
- payment,
- insurance processing,
- or other clinic-directed activities.

These patients have not completed their Appointment and must not be
treated as missed patients.

### Approved Design

The secretary may select:

```text
Continue After Procedure
```

for the currently active Appointment.

The Appointment immediately changes to:

```text
OUT_FOR_PROCEDURE
```

The Appointment is removed from the active serving queue.

The Queue Number remains unchanged.

The Appointment appears in a dedicated:

```text
Waiting to Continue
```

list.

### Returning to the Queue

When the patient returns, the secretary selects the Appointment from the
Waiting to Continue list and performs:

```text
Reinsert
```

The secretary may choose:

```text
Next

After Next

End of Queue
```

according to clinic workflow.

The patient may enter the Out for Procedure workflow multiple times during
the same Appointment.

There is no predefined limit.

### Relationship to Temporary Absence

An Appointment in:

```text
OUT_FOR_PROCEDURE
```

shall never use:

```text
I am here
```

This workflow is staff-controlled.

It is separate from the patient self-service workflow for temporarily
absent patients.

### Queue Number Rule

Entering or leaving:

```text
OUT_FOR_PROCEDURE
```

never changes:

- Queue Number,
- Appointment identity,
- Appointment history.

Only the current Serving Order changes.

### Decision

Approved

### Reason

Patients who temporarily leave under clinic instruction remain part of
the same consultation.

Separating this workflow from temporary absence accurately reflects
clinical operations while allowing unlimited continuation when medically
necessary.

### Impact

#### Backend

The backend shall distinguish:

- TEMPORARILY_ABSENT
- OUT_FOR_PROCEDURE

These states follow different business rules.

#### Frontend

Appointments in:

```text
OUT_FOR_PROCEDURE
```

shall appear in a separate:

```text
Waiting to Continue
```

panel.

The secretary may reinsert these patients without limitation.

#### Documentation

Future consultation-related workflow shall build upon the approved Out
for Procedure state.

## Decision 6

### Title

Undo Next Patient

### Current Design

During busy clinic operations, authorized staff may accidentally select
`Next Patient` more than once.

Examples include:

- accidental double-clicks,
- touchscreen mistakes,
- staff distraction,
- patients approaching the secretary after an unintended queue advance,
- or other operational errors.

The system must allow immediate correction without changing permanent
Queue Numbers or requiring manual queue reconstruction.

### Approved Design

The system shall support undoing accidental use of:

```text
Next Patient
```

Undo restores the queue to the exact operational state immediately
before the most recent uninterrupted `Next Patient` action occurred.

The system restores:

- the previously called Appointment,
- the previously waiting Appointment,
- the previous Serving Order,
- the previous Appointment serving states,
- the Patient Queue Pages,
- and the public Queue Display Board.

Queue Numbers shall never change.

Undo is an operational recovery feature.

It shall not be used to reorganize or reprioritize the queue.

---

### Undo Scope

Undo restores only queue progression.

Undo does not reverse:

- completed consultations,
- cancelled Appointments,
- patient bookings,
- Appointment edits,
- staff configuration changes,
- or any action outside the active queue workflow.

Version 1 supports Undo only for accidental queue advancement.

---

### Undo Availability

Undo is available only when:

- the most recent queue-changing action was `Next Patient`,
- no other queue-changing action has occurred afterwards,
- the queue remains in a reversible state,
- and the incorrectly called patient has not yet begun consultation.

If another queue operation occurs, Undo immediately becomes unavailable.

Examples include:

- Reinsert,
- Continue After Procedure,
- patient self-service `I'm Here`,
- another staff queue override,
- Appointment cancellation,
- queue closure,
- or consultation beginning for the incorrectly called patient.

Once invalidated, Undo cannot be restored for that queue state.

---

### Multiple Consecutive Mistakes

If the secretary accidentally selects:

```text
Next Patient

Next Patient

Next Patient
```

without performing any other queue-changing action,

the system may undo each action individually in reverse order.

Example:

```text
06 CALLED

↓

Next Patient

↓

07 CALLED

↓

Next Patient

↓

08 CALLED

↓

Undo

↓

07 CALLED

↓

Undo

↓

06 CALLED
```

Each Undo reverses only one `Next Patient` action.

---

### Queue Number Rule

Undo shall never modify:

- Queue Number,
- Appointment identity,
- Appointment history,
- Booking information.

Undo restores only:

- the current Serving Order,
- Appointment serving states,
- and the currently called Appointment.

---

### Audit Requirements

Every Undo action shall be recorded in the audit history.

The audit record shall include:

- staff member,
- date and time,
- affected Appointments,
- restored states,
- and the queue action that was reversed.

---

### Decision

Approved

### Reason

Immediate recovery from accidental queue advancement prevents confusion,
reduces staff stress, and eliminates the need to manually reconstruct the
queue while preserving permanent Queue Numbers and Appointment history.

Limiting Undo to uninterrupted queue progression prevents conflicting
queue histories and keeps the workflow predictable for clinic staff.

### Impact

#### Backend

The backend shall:

1. Record sufficient queue history to reverse the latest uninterrupted
   `Next Patient` action.
2. Support multiple consecutive Undo operations while no other
   queue-changing action has occurred.
3. Prevent Undo immediately after any other queue-changing action.
4. Restore the previous Serving Order, Appointment serving states,
   Patient Queue Pages, and Queue Display atomically.

#### Frontend

The Secretary Dashboard shall display:

```text
Undo
```

only when a valid Undo is available.

The button shall automatically disappear or become disabled once the
Undo window becomes invalid.

Patients shall immediately see the restored queue through their live
Queue Pages.

The public Queue Display Board shall immediately return to the restored
currently called Queue Number.

#### Documentation

Future queue workflow decisions shall treat Undo as an operational queue
recovery feature rather than a general-purpose system-wide undo
mechanism.
---

# Initial Questions

The review will answer:

1. How is the next patient selected?
2. What happens when a patient is skipped?
3. What is a temporarily absent patient?
4. When may a patient click "I am here"?
5. How many times may self-service reinsertion occur?
6. How does secretary reinsertion work?
7. How are multiple returning patients ordered?
8. How are walk-ins inserted?
9. When may the doctor override serving order?
10. How is every override audited?
11. How does the queue pause?
12. How does the queue end?

---

# Review Outcome

| Item | Status |
|------|--------|
| Decisions Approved | 6 |
| Decisions Rejected | 0 |
| Decisions Deferred | 0 |
| Overall Result | In Progress |

---

# Version History

| Version | Date | Description |
|---------|------|-------------|
| 0.1 | 2026-08-03 | Initial Queue Serving Workflow review |

---

# End of Review