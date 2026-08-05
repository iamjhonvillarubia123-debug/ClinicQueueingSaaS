# Architecture Freeze 0001 - Core Queue Architecture

---

# Freeze Information

| Item | Value |
|------|-------|
| Freeze ID | Architecture-Freeze-0001 |
| Scope | Core Queue Architecture |
| Status | Approved |
| Version | 1.0 |
| Freeze Date | 2026-08-03 |
| Product Owner | Product Owner |
| Technical Reviewer | ChatGPT |

---

# Purpose

This document freezes the approved core architecture of the Clinic
Queueing SaaS before production implementation begins.

The frozen decisions have been developed and validated through:

- approved architecture reviews,
- business-workflow discussions,
- consistency reviews,
- and clinic-day simulations.

The purpose of this freeze is to prevent foundational queue rules from
being changed casually during database, backend, or frontend
implementation.

A frozen decision may be changed only through an approved architecture
review that explains:

- the reason for the change,
- the affected modules,
- required data migration,
- compatibility impact,
- testing requirements,
- and documentation updates.

---

# Governing Documents

This freeze is based on:

- Review-0001
- Review-0002
- Review-0003
- Review-0004
- Review-0005
- Review-0006
- Simulation-0001
- Simulation-0002
- 06 - Engineering Principles
- approved Product Philosophy documents

If a lower-level implementation document conflicts with this freeze, the
implementation document must be corrected.

---

# Frozen Decision 1

## Queue Number Sequence

Each Queue Number sequence belongs to one:

```text
Practice Location
+
Service Date
```

Queue Numbers are not globally unique across the SaaS.

Each daily location sequence begins with the stored integer:

```text
1
```

The frontend displays Queue Numbers using a minimum two-digit format.

Examples:

| Stored Value | Display |
|--------------|---------|
| 1 | 01 |
| 2 | 02 |
| 9 | 09 |
| 10 | 10 |
| 100 | 100 |

Display formatting shall not be stored as part of the Queue Number.

---

# Frozen Decision 2

## Queue Number Permanence

A Queue Number becomes permanent after the complete Appointment creation
transaction commits successfully.

After assignment, the Queue Number shall never be:

- changed,
- reused,
- transferred,
- reassigned,
- or renumbered.

Cancellation, temporary absence, procedure continuation, reinsertion, and
serving-order changes do not modify the Queue Number.

Failed or rolled-back booking transactions do not consume Queue Numbers.

---

# Frozen Decision 3

## Unified Queue

All confirmed Appointments use one shared daily Queue Number sequence for
the applicable Practice Location and Service Date.

The shared queue includes Appointments created through:

- online patient booking,
- secretary-created booking,
- and accepted walk-in registration.

Appointment source does not create a separate queue or special Queue
Number prefix.

---

# Frozen Decision 4

## Queue Number and Serving Order Are Different

Queue Number identifies the Appointment's permanent identity within the
daily clinic queue.

Serving Order identifies the Appointment's current operational position.

Serving State identifies the Appointment's current workflow condition.

These concepts are independent and must not be treated as interchangeable.

Changing Serving Order never changes Queue Number.

---

# Frozen Decision 5

## Queue Number Allocation

Version 1 uses a dedicated Queue Counter for each:

```text
Practice Location
+
Service Date
```

Queue Number allocation occurs inside the same atomic database transaction
that creates the confirmed Appointment.

The Queue Counter increment rolls back if the Appointment transaction
fails.

The lower Queue Number belongs to the transaction that successfully
completes protected allocation first.

The frontend shall never generate or reserve Queue Numbers.

---

# Frozen Decision 6

## Approved Serving States

The approved Version 1 Queue Serving states are:

```text
WAITING
CALLED
TEMPORARILY_ABSENT
OUT_FOR_PROCEDURE
COMPLETED
```

The normal workflow is:

```text
WAITING
↓
CALLED
↓
COMPLETED
```

A missed patient follows:

```text
CALLED
↓
TEMPORARILY_ABSENT
```

A patient sent for a clinic-directed procedure follows:

```text
CALLED
↓
OUT_FOR_PROCEDURE
↓
WAITING
```

after staff-controlled reinsertion.

Temporary actions shall not be introduced as serving states unless an
approved review establishes that they represent meaningful operational
conditions.

---

# Frozen Decision 7

## Secretary-Operated Queue

The secretary or another authorized clinic staff member primarily
operates the queue.

The doctor may view the queue but is not required to perform routine queue
management actions.

The approved secretary controls are:

```text
Next Patient
Reinsert
Undo
```

The approved contextual action is:

```text
Continue After Procedure
```

The system shall not require the doctor to manually select:

```text
Start Consultation
Pause Consultation
Resume Consultation
Complete Consultation
```

for ordinary queue operation.

---

# Frozen Decision 8

## Next Patient Workflow

`Next Patient` is the primary queue-progression action.

When a currently called Appointment exists, selecting `Next Patient`
means that the secretary considers the current patient finished unless
the patient was previously moved to `OUT_FOR_PROCEDURE`.

The system then selects:

> The first Appointment whose state is `WAITING`, ordered by the current
> Serving Order.

Patients in these states are excluded:

```text
TEMPORARILY_ABSENT
OUT_FOR_PROCEDURE
COMPLETED
```

Queue progression must be atomic and concurrency safe.

---

# Frozen Decision 9

## Missed Patient Behaviour

When the secretary selects `Next Patient` while the currently called
patient did not respond, that patient becomes:

```text
TEMPORARILY_ABSENT
```

The Appointment remains active.

The Queue Number remains valid and unchanged.

No separate `Mark Temporarily Absent` action is required.

The system does not impose an automatic absence timer.

The secretary decides when clinic operations should move to the next
patient.

---

# Frozen Decision 10

## One-Time Self-Service Reinsertion

A patient in:

```text
TEMPORARILY_ABSENT
```

may use:

```text
I'm Here
```

once during the same Appointment and Service Date.

The action changes the Appointment from:

```text
TEMPORARILY_ABSENT
↓
WAITING
```

If the patient misses another call, self-service reinsertion is no longer
available.

The patient must approach authorized clinic staff for assistance.

Repeated clicking shall not improve the patient's Serving Order.

---

# Frozen Decision 11

## Protected Next Position Rule

Self-service reinsertion protects the patient who is already next to be
called.

The approved order is:

```text
Current CALLED Appointment

↓

Next WAITING Appointment (Protected)

↓

Returning Appointment

↓

Remaining WAITING Appointments
```

The returning patient does not displace the protected next patient.

If multiple self-service reinsertion requests have the same recorded
timestamp:

1. earlier reinsertion request time has priority;
2. if equal, the lower Queue Number has priority.

This rule applies only to self-service reinsertion.

---

# Frozen Decision 12

## Staff-Controlled Reinsertion

Authorized clinic staff may reinsert eligible Appointments at any valid
position in the active Serving Order.

The frontend shall visually display valid insertion points.

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

Staff-controlled reinsertion:

- is not limited to one use,
- does not use the Protected Next Position Rule,
- changes only Serving Order,
- and never changes Queue Number or Appointment identity.

---

# Frozen Decision 13

## Out for Procedure Workflow

When the current patient must temporarily leave for a clinic-directed
activity, authorized staff may select:

```text
Continue After Procedure
```

The Appointment becomes:

```text
OUT_FOR_PROCEDURE
```

Examples include:

- laboratory work,
- imaging,
- ECG,
- diagnostic procedures,
- payment,
- insurance processing,
- or another clinic-directed activity.

The Appointment appears in a separate:

```text
Waiting to Continue
```

panel.

The patient does not use:

```text
I'm Here
```

when returning.

Authorized staff reinserts the Appointment into the active Serving Order.

Procedure-based reinsertion may occur multiple times during the same
Appointment when operationally necessary.

---

# Frozen Decision 14

## Undo Queue Advancement

The interface displays:

```text
Undo
```

when one or more uninterrupted successful `Next Patient` transitions can
be reversed.

Undo restores one successful `Next Patient` transition at a time in
reverse order.

Undo restores:

- the previous current Appointment,
- previous serving states,
- previous Serving Order,
- patient Queue Pages,
- and the public Queue Display.

Undo never changes Queue Numbers.

Only successful queue transitions are added to Undo history.

Button clicks that produce no queue state change do not create Undo
entries.

Undo becomes unavailable after another type of queue-changing action,
including:

- self-service `I'm Here`,
- staff-controlled reinsertion,
- `Continue After Procedure`,
- cancellation,
- another queue override,
- or queue closure.

The system does not independently judge whether a consultation truly
finished.

The secretary decides whether Undo is appropriate.

---

# Frozen Decision 15

## Patient Communication

Version 1 uses one appointment-reminder SMS containing the secure queue
link.

The reminder is sent before the clinic session according to the approved
notification schedule.

The SMS shall not promise an exact consultation time.

Live queue movement shall not generate repeated SMS messages.

After the initial reminder, live communication is provided through:

- the private Patient Queue Page,
- the public Queue Display Board,
- and the secretary's verbal announcement.

The Patient Queue Page is the authoritative patient-facing source for live
queue progress.

---

# Frozen Decision 16

## Public Queue Privacy

The public Queue Display Board may show operational Queue Numbers.

It must not show:

- patient full name,
- mobile number,
- requested service,
- consultation reason,
- existing-patient response,
- or other private booking information.

Authorized staff dashboards may show approved patient details required for
clinic operations.

---

# Frozen Decision 17

## Architecture Change Control

The frozen architecture shall not be changed directly during:

- Prisma schema implementation,
- migration creation,
- backend coding,
- frontend development,
- or testing.

When implementation exposes a possible conflict, the team shall:

1. Stop the affected implementation work.
2. Record the conflict.
3. Review the relevant frozen decision.
4. Create or update an architecture review.
5. Approve or reject the proposed change.
6. Update this freeze if the foundational rule changes.
7. Resume implementation only after alignment is restored.

Bug fixes that merely correct implementation to match the frozen
architecture do not require changing this document.

---

# Freeze Outcome

| Item | Status |
|------|--------|
| Core Queue Architecture | Frozen |
| Approved for Prisma Design | Yes |
| Approved for Backend Design | Yes |
| Approved for Frontend Design | Yes |
| Casual Changes Permitted | No |
| Architecture Review Required for Foundational Changes | Yes |

---

# Version History

| Version | Date | Description |
|---------|------|-------------|
| 1.0 | 2026-08-03 | Initial freeze of the approved core queue architecture |

---

# End of Architecture Freeze