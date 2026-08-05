# Simulation-0001 - Complete Clinic Day

## Simulation Principle

The simulation represents one continuous clinic day.

Each event continues directly from the previous event.

Patient states, Queue Numbers, Serving Order, and dashboard contents
must remain consistent throughout the simulation.

The simulation shall never reset the queue between events.

Every event must begin with the exact operational state produced by the
previous event.

---

# Simulation Information

| Item | Value |
|------|-------|
| Simulation ID | Simulation-0001 |
| Module | Queue Serving Workflow |
| Version | 0.1 |
| Status | In Progress |
| Purpose | Validate the complete clinic workflow using approved architecture |

---

# Purpose

This simulation validates the approved Queueing Workflow by walking
through one complete clinic day.

The simulation does not introduce new business rules.

Every action performed during the simulation must already be supported by
approved Reviews and Philosophies.

If the simulation encounters a situation that cannot be completed using
the existing architecture, the simulation stops and the missing rule is
recorded.

---

# Approved References

This simulation follows:

- Review-0001
- Review-0002
- Review-0003
- Review-0004
- Review-0005
- Review-0006

---

# Initial Clinic Setup

Clinic:

ABC Family Clinic

Practice Location:

Main Clinic

Doctor:

Dr. Santos

Secretary:

Maria

Clinic Opens:

8:00 AM

---

# Initial Queue

The following Appointments have been successfully confirmed before the
queue-serving simulation begins.

Queue Numbers are stored internally as integers and displayed using a
minimum two-digit format.

| Queue Number | Patient | Source | Existing Patient Response | Requested Service | Estimated Minutes | Initial State |
|--------------|---------|--------|---------------------------|-------------------|------------------:|---------------|
| 01 | Juan Dela Cruz | Online Booking | YES | General Consultation | 20 | WAITING |
| 02 | Maria Santos | Online Booking | NO | Medical Certificate Consultation | 15 | WAITING |
| 03 | Pedro Reyes | Secretary Booking | UNSURE | General Consultation | 20 | WAITING |
| 04 | Ana Garcia | Online Booking | YES | Consultation and ECG | 35 | WAITING |
| 05 | Jose Mendoza | Online Booking | NO | General Consultation | 20 | WAITING |
| 06 | Carla Ramos | Accepted Walk-in | YES | Follow-up Consultation | 15 | WAITING |

All Appointments belong to:

```text
Practice Location:
Main Clinic

Service Date:
2026-08-03
```

The permanent Queue Number sequence is:

```text
01
02
03
04
05
06
```

The initial Serving Order matches the Queue Number order:

```text
01
02
03
04
05
06
```

No Appointment is currently:

```text
CALLED
TEMPORARILY_ABSENT
OUT_FOR_PROCEDURE
COMPLETED
```

The clinic is ready to begin serving patients.

# Master Scenario List

This simulation shall test the complete clinic day using the approved
architecture.

Each scenario must be completed using existing Reviews and Philosophies.

If a scenario cannot be completed without inventing a new rule, the
simulation shall stop and record the missing rule.

---

## Phase 1 — Clinic Opening

| Event | Scenario | Status |
|------:|----------|:------:|
| 1 | Clinic opens and secretary views the initial queue | ✅ |
| 1A | Queue Number 01 receives the single appointment reminder before clinic opening | ✅ |
| 2 | Secretary calls the first patient | ✅ |

---

## Phase 2 — Normal Queue Progression

| Event | Scenario | Status |
|------:|----------|:------:|
| 3 | First patient completes normally and the queue advances | ✅ |
| 4 | Called patient does not respond and becomes `TEMPORARILY_ABSENT` | ✅ |
| 5 | Temporarily absent patient uses one-time self-service `I'm Here` | ✅ |

---

## Phase 3 — Out for Procedure Workflow

| Event | Scenario | Status |
|------:|----------|:------:|
| 6 | Current patient is sent for ECG and becomes `OUT_FOR_PROCEDURE` | ⏳ |
| 7 | Secretary advances the queue while the patient is out for procedure | ⏳ |
| 8 | Patient returns from ECG and appears ready to continue | ⏳ |
| 9 | Secretary reinserts the returning patient | ⏳ |
| 10 | Patient resumes consultation after reinsertion and completes the Appointment | ⏳ |

---

## Phase 4 — Secretary Error Recovery

| Event | Scenario | Status |
|------:|----------|:------:|
| 11 | Secretary clicks `Next Patient` too many times | ⏳ |
| 12 | `Undo Next Patient` reverses the latest action | ⏳ |
| 13 | Multiple consecutive accidental `Next Patient` actions are undone one at a time | ⏳ |
| 14 | Undo becomes unavailable after another queue-changing action | ⏳ |

---

## Phase 5 — Multiple Returning Patients

| Event | Scenario | Status |
|------:|----------|:------:|
| 15 | Two patients become `TEMPORARILY_ABSENT` | ⏳ |
| 16 | Both patients use `I'm Here` at different times | ⏳ |
| 17 | Two patients use `I'm Here` at the same recorded timestamp | ⏳ |
| 18 | Lower Queue Number wins the timestamp tie | ⏳ |
| 19 | Protected Next Position remains unchanged during multiple returns | ⏳ |

---

## Phase 6 — Reinsertion Limits and Abuse Prevention

| Event | Scenario | Status |
|------:|----------|:------:|
| 20 | Patient uses self-service `I'm Here` once | ⏳ |
| 21 | Same patient misses the queue again | ⏳ |
| 22 | Second self-service reinsertion is rejected | ⏳ |
| 23 | Patient is instructed to approach the secretary | ⏳ |
| 24 | Secretary reinserts the patient manually | ⏳ |

---

## Phase 7 — Staff-Controlled Reinsertion

| Event | Scenario | Status |
|------:|----------|:------:|
| 25 | Secretary reinserts a patient as `Next` | ⏳ |
| 26 | Secretary reinserts a patient as `After Next` | ⏳ |
| 27 | Secretary reinserts a patient at `End of Queue` | ⏳ |
| 28 | Staff-controlled reinsertion preserves Queue Number | ⏳ |

---

## Phase 8 — Walk-In and Secretary-Created Appointment

| Event | Scenario | Status |
|------:|----------|:------:|
| 29 | A new walk-in arrives after the clinic has started | ⏳ |
| 30 | Secretary accepts the walk-in | ⏳ |
| 31 | Walk-in receives the next permanent Queue Number | ⏳ |
| 32 | Walk-in joins the same queue as online bookings | ⏳ |
| 33 | Walk-in does not receive a special queue prefix or separate sequence | ⏳ |

---

## Phase 9 — Live Queue Communication

| Event | Scenario | Status |
|------:|----------|:------:|
| 34 | Patient Queue Pages refresh after `Next Patient` | ⏳ |
| 35 | Public Queue Display shows Queue Number only | ⏳ |
| 36 | Public display never shows patient name or mobile number | ⏳ |
| 37 | Secretary announcement matches the current `CALLED` Queue Number | ⏳ |
| 38 | No additional SMS is sent during live queue movement | ⏳ |

---

## Phase 10 — Queue State and Serving Order Integrity

| Event | Scenario | Status |
|------:|----------|:------:|
| 39 | `Call Next` selects the first `WAITING` Appointment by Serving Order | ⏳ |
| 40 | `TEMPORARILY_ABSENT` patients are excluded from `Call Next` | ⏳ |
| 41 | `OUT_FOR_PROCEDURE` patients are excluded from `Call Next` | ⏳ |
| 42 | `COMPLETED` patients are excluded from `Call Next` | ⏳ |
| 43 | Queue Number remains unchanged after every serving-order change | ⏳ |

---

## Phase 11 — End-of-Day Handling

| Event | Scenario | Status |
|------:|----------|:------:|
| 44 | All normally waiting patients are completed | ⏳ |
| 45 | One `TEMPORARILY_ABSENT` patient remains at clinic close | ⏳ |
| 46 | One `OUT_FOR_PROCEDURE` patient remains at clinic close | ⏳ |
| 47 | Clinic stops accepting further queue progression | ⏳ |
| 48 | End-of-day unresolved Appointment outcomes are recorded | ⏳ |
| 49 | Queue session closes without changing permanent Queue Numbers | ⏳ |

---

## Phase 12 — Final Architecture Validation

| Event | Scenario | Status |
|------:|----------|:------:|
| 50 | Review all state transitions used during the simulation | ⏳ |
| 51 | Review all Serving Order changes | ⏳ |
| 52 | Review all patient and staff actions | ⏳ |
| 53 | Confirm no unapproved Queue Number changes occurred | ⏳ |
| 54 | Record every missing rule discovered | ⏳ |
| 55 | Determine whether architecture changes are required | ⏳ |

---

# Scenario Completion Rule

A scenario may be marked:

```text
✅
```

only when:

- the event is fully simulated,
- the existing architecture supports it,
- no unapproved rule is invented,
- and any missing rule is recorded.

A scenario remains:

```text
⏳
```

until it is explicitly tested.

A scenario that exposes an unsupported case shall be marked:

```text
⚠ Missing Rule
```

until the corresponding review is updated.

---

# Simulation Log

## Event 1

### Time

```text
8:00 AM
```

### Event

The clinic opens.

The secretary signs in and views three operational panels.

#### Active Queue

```text
01 Juan Dela Cruz
02 Maria Santos
03 Pedro Reyes
04 Ana Garcia
05 Jose Mendoza
06 Carla Ramos
```

#### Temporarily Absent

```text
Empty
```

#### Waiting to Continue

```text
Empty
```

No patient is currently called.

### Result

The queue is ready for the secretary to select:

```text
Next Patient
```

### Architecture Result

```text
Supported
```

No missing rule is found.

---

# Missing Rules

If any workflow cannot continue using approved architecture, record it
here before changing the design.

---

---

---

## Event 2

### Time

```text
8:00 AM
```

### Event

The clinic officially opens.

The secretary signs in to the Queue Dashboard.

The dashboard displays three operational panels.

#### Active Queue

```text
01 Juan Dela Cruz (WAITING)
02 Maria Santos (WAITING)
03 Pedro Reyes (WAITING)
04 Ana Garcia (WAITING)
05 Jose Mendoza (WAITING)
06 Carla Ramos (WAITING)
```

#### Temporarily Absent

```text
Empty
```

#### Waiting to Continue

```text
Empty
```

Since no Appointment is currently in the `CALLED` state, the secretary
selects:

```text
Next Patient
```

The system searches the current Serving Order and selects the first
Appointment whose state is:

```text
WAITING
```

Queue Number:

```text
01
```

Juan Dela Cruz changes from:

```text
WAITING
```

to:

```text
CALLED
```

The patient Queue Page immediately updates to indicate that Queue Number
01 is now being served.

The public Queue Display Board updates to:

```text
NOW SERVING

01
```

The secretary announces:

> "Queue Number 01, please proceed to the consultation room."

No SMS notification is sent because Queue Number 01 already received the
approved readiness reminder five minutes before the clinic session
started.

### Updated Dashboard

#### Active Queue

```text
▶ 01 Juan Dela Cruz (CALLED)

02 Maria Santos (WAITING)

03 Pedro Reyes (WAITING)

04 Ana Garcia (WAITING)

05 Jose Mendoza (WAITING)

06 Carla Ramos (WAITING)
```

#### Temporarily Absent

```text
Empty
```

#### Waiting to Continue

```text
Empty
```

### Result

Queue Number 01 has been successfully called.

The clinic is now waiting for the patient to enter the consultation room.

No other Appointment changes state.

### Architecture Result

```text
Supported
```

The approved Queue Serving Workflow correctly handles the first patient
of the clinic session.

No missing rule is identified.

---

---

## Event 3

### Time

```text
8:18 AM
```

### Event

Juan Dela Cruz completes his consultation.

The patient leaves the consultation room.

The secretary confirms that the consultation has finished.

The secretary selects:

```text
Next Patient
```

The system automatically changes Queue Number 01 from:

```text
CALLED
```

to:

```text
COMPLETED
```

The system then searches the current Serving Order and selects the first
Appointment whose state is:

```text
WAITING
```

Queue Number:

```text
02
```

Maria Santos changes from:

```text
WAITING
```

to:

```text
CALLED
```

The patient Queue Page immediately updates to indicate that Queue Number
02 is now being served.

The public Queue Display Board updates to:

```text
NOW SERVING

02
```

The secretary announces:

> "Queue Number 02, please proceed to the consultation room."

### Live Queue Update

After Queue Number 02 becomes the currently called patient, the Queue
Pages of all active patients automatically refresh.

Patients can view:

- their Queue Number,
- their current Queue Status,
- the current Now Serving Queue Number,
- and the number of patients ahead of them.

No SMS notification is sent.

The Queue Page becomes the primary live communication channel after the
initial appointment reminder.

### Updated Dashboard

#### Active Queue

```text
01 Juan Dela Cruz (COMPLETED)

▶ 02 Maria Santos (CALLED)

03 Pedro Reyes (WAITING)

04 Ana Garcia (WAITING)

05 Jose Mendoza (WAITING)

06 Carla Ramos (WAITING)
```

#### Temporarily Absent

```text
Empty
```

#### Waiting to Continue

```text
Empty
```

### Result

Queue Number 01 successfully completes the Appointment.

Queue Number 02 becomes the currently called patient.

The queue advances normally.

### Architecture Result

```text
Supported
```

The approved Queue Serving Workflow correctly advances to the next
Appointment after a completed consultation.

No missing rule is identified.

---

## Event 4

### Time

```text
8:35 AM
```

### Event

Queue Number 02 is called.

The secretary announces:

> "Queue Number 02, please proceed to the consultation room."

The public Queue Display Board continues to show:

```text
NOW SERVING

02
```

The patient Queue Page indicates that Queue Number 02 is currently being
served.

The secretary waits for the patient to respond.

After a reasonable waiting period, Queue Number 02 does not respond.

The secretary determines that the patient is temporarily absent.

The secretary selects:

```text
Next Patient
```

The system automatically changes Queue Number 02 from:

```text
CALLED
```

to:

```text
TEMPORARILY_ABSENT
```

The Queue Number remains unchanged.

The system then searches the current Serving Order and selects the first
Appointment whose state is:

```text
WAITING
```

Queue Number:

```text
03
```

Pedro Reyes changes from:

```text
WAITING
```

to:

```text
CALLED
```

The patient Queue Page immediately updates.

The public Queue Display Board updates to:

```text
NOW SERVING

03
```

The secretary announces:

> "Queue Number 03, please proceed to the consultation room."

### Live Queue Update

After Queue Number 03 becomes the currently called patient, the Queue
Pages of all remaining active patients automatically refresh.

Patients can view:

- their Queue Number,
- their current Queue Status,
- the current Now Serving Queue Number,
- and the number of patients ahead of them.

No SMS notification is sent.

The Queue Page remains the primary live communication channel after the
initial appointment reminder.

Queue Number 02 immediately sees a different Queue Page indicating that
the Appointment is temporarily absent and that one self-service
reinsertion is available through the **I'm Here** button.

### Updated Dashboard

#### Active Queue

```text
01 Juan Dela Cruz (COMPLETED)

02 Maria Santos (TEMPORARILY_ABSENT)

▶ 03 Pedro Reyes (CALLED)

04 Ana Garcia (WAITING)

05 Jose Mendoza (WAITING)

06 Carla Ramos (WAITING)
```

#### Temporarily Absent

```text
02 Maria Santos
```

#### Waiting to Continue

```text
Empty
```

### Result

Queue Number 02 temporarily loses its current serving opportunity but
keeps the same Queue Number.

Queue Number 03 becomes the currently served patient.

The remaining patients automatically see the updated queue through their
live Queue Pages.

### Architecture Result

```text
Supported
```

The approved Queue Serving Workflow correctly handles a patient who does
not respond when called.

No missing rule is identified.

---

## Event 5

### Time

```text
8:38 AM
```

### Event

Maria Santos arrives at the clinic after missing her turn.

She opens the secure Queue Page using the link previously received in the
appointment reminder SMS.

The Queue Page displays:

```text
Queue Number

02

Status

You were unavailable when your Queue Number was called.

You can still return to today's queue.

Press "I'm Here" to continue.

If you miss your turn again, please proceed to the secretary for
assistance.
```

Maria selects:

```text
I'm Here
```

The system verifies that:

- the Appointment is still active,
- today's Service Date is valid,
- the Appointment state is:

```text
TEMPORARILY_ABSENT
```

- the self-service reinsertion has not previously been used.

All validations succeed.

The system changes the Appointment from:

```text
TEMPORARILY_ABSENT
```

to:

```text
WAITING
```

The Appointment is then reinserted into the current Serving Order using
the approved Protected Next Position Rule.

Current queue before reinsertion:

```text
▶ 03 Pedro Reyes (CALLED)

04 Ana Garcia (WAITING)

05 Jose Mendoza (WAITING)

06 Carla Ramos (WAITING)
```

The next waiting patient (Queue Number 04) keeps the protected next
position.

Maria Santos is inserted immediately after Queue Number 04.

The updated Serving Order becomes:

```text
▶ 03 Pedro Reyes (CALLED)

04 Ana Garcia (WAITING)

02 Maria Santos (WAITING)

05 Jose Mendoza (WAITING)

06 Carla Ramos (WAITING)
```

The Queue Number remains:

```text
02
```

The patient receives confirmation.

Example:

> You have successfully returned to today's queue.
>
> Please continue monitoring your Queue Page for live updates.

No SMS notification is sent.

### Updated Dashboard

#### Active Queue

```text
01 Juan Dela Cruz (COMPLETED)

▶ 03 Pedro Reyes (CALLED)

04 Ana Garcia (WAITING)

02 Maria Santos (WAITING)

05 Jose Mendoza (WAITING)

06 Carla Ramos (WAITING)
```

#### Temporarily Absent

```text
Empty
```

#### Waiting to Continue

```text
Empty
```

### Result

Queue Number 02 successfully returns to the active queue using the
approved one-time self-service reinsertion workflow.

The next waiting patient retains priority.

Only the current Serving Order changes.

Queue Numbers remain permanent.

### Architecture Result

```text
Supported
```

The approved Protected Next Position Rule preserves fairness for both the
next waiting patient and the returning patient.

No missing rule is identified.


---

## Event 6

### Time

```text
8:55 AM
```

### Starting State

The queue begins this event in the exact state produced by Event 5.

#### Active Queue

```text
01 Juan Dela Cruz (COMPLETED)

▶ 03 Pedro Reyes (CALLED)

04 Ana Garcia (WAITING)

02 Maria Santos (WAITING)

05 Jose Mendoza (WAITING)

06 Carla Ramos (WAITING)
```

#### Temporarily Absent

```text
Empty
```

#### Waiting to Continue

```text
Empty
```

### Event

Pedro Reyes completes his consultation.

The patient leaves the consultation room.

The secretary confirms that Pedro's consultation has finished.

The secretary selects:

```text
Next Patient
```

The system automatically changes Queue Number 03 from:

```text
CALLED
```

to:

```text
COMPLETED
```

The system searches the current Serving Order and selects the first
Appointment whose state is:

```text
WAITING
```

Queue Number:

```text
04
```

Ana Garcia changes from:

```text
WAITING
```

to:

```text
CALLED
```

The public Queue Display Board updates to:

```text
NOW SERVING

04
```

Ana's private Queue Page updates to indicate that her Queue Number is now
being served.

The secretary announces:

> "Queue Number 04, please proceed to the consultation room."

No SMS notification is sent.

### Clinic-Directed Procedure

During the consultation, the doctor instructs Ana to complete an ECG
before the consultation can continue.

Ana leaves the consultation room and informs the secretary.

The secretary selects the contextual action:

```text
Continue After Procedure
```

The system changes Ana's Appointment from:

```text
CALLED
```

to:

```text
OUT_FOR_PROCEDURE
```

Ana is removed from the active Serving Order.

Her permanent Queue Number remains:

```text
04
```

Ana appears in the separate:

```text
Waiting to Continue
```

panel.

The system does not automatically call another patient during this
action.

The secretary must separately select:

```text
Next Patient
```

when ready to advance the queue.

### Updated Dashboard

#### Active Queue

```text
01 Juan Dela Cruz (COMPLETED)

03 Pedro Reyes (COMPLETED)

02 Maria Santos (WAITING)

05 Jose Mendoza (WAITING)

06 Carla Ramos (WAITING)
```

#### Temporarily Absent

```text
Empty
```

#### Waiting to Continue

```text
04 Ana Garcia (OUT_FOR_PROCEDURE)

Required activity:
ECG
```

No Appointment is currently in the:

```text
CALLED
```

state.

### Live Queue Update

The private Queue Pages of active patients refresh automatically.

The public Queue Display Board no longer presents Queue Number 04 as
currently being served.

Until the secretary selects `Next Patient`, the display may show:

```text
NOW SERVING

Please wait
```

No additional SMS notification is sent.

### Result

Queue Number 03 completes normally.

Queue Number 04 begins consultation but temporarily leaves under clinic
instruction to complete an ECG.

Ana remains part of the same Appointment and retains Queue Number 04.

She is not treated as temporarily absent and cannot use the self-service:

```text
I'm Here
```

workflow.

### Architecture Result

```text
Supported
```

The approved Out for Procedure workflow correctly separates a
clinic-directed interruption from a missed patient.

No missing rule is identified.

---

## Event 7

### Time

```text
8:57 AM
```

### Starting State

The queue begins this event in the exact state produced by Event 6.

#### Active Queue

```text
01 Juan Dela Cruz (COMPLETED)

03 Pedro Reyes (COMPLETED)

02 Maria Santos (WAITING)

05 Jose Mendoza (WAITING)

06 Carla Ramos (WAITING)
```

#### Temporarily Absent

```text
Empty
```

#### Waiting to Continue

```text
04 Ana Garcia (OUT_FOR_PROCEDURE)

Required Activity:
ECG
```

No Appointment is currently in the:

```text
CALLED
```

state.

### Event

With Ana temporarily completing her ECG, the secretary continues normal
clinic operations.

The secretary selects:

```text
Next Patient
```

The system searches the current Serving Order.

Appointments whose state is:

```text
COMPLETED
OUT_FOR_PROCEDURE
TEMPORARILY_ABSENT
```

are skipped.

The first Appointment whose state is:

```text
WAITING
```

is:

```text
Queue Number 02
Maria Santos
```

Maria Santos changes from:

```text
WAITING
```

to:

```text
CALLED
```

The public Queue Display Board updates to:

```text
NOW SERVING

02
```

Maria's Queue Page updates immediately.

The secretary announces:

> "Queue Number 02, please proceed to the consultation room."

### Updated Dashboard

#### Active Queue

```text
01 Juan Dela Cruz (COMPLETED)

03 Pedro Reyes (COMPLETED)

▶ 02 Maria Santos (CALLED)

05 Jose Mendoza (WAITING)

06 Carla Ramos (WAITING)
```

#### Temporarily Absent

```text
Empty
```

#### Waiting to Continue

```text
04 Ana Garcia (OUT_FOR_PROCEDURE)

Required Activity:
ECG
```

### Result

Clinic operations continue normally while Ana completes her ECG.

Patients in:

```text
OUT_FOR_PROCEDURE
```

are excluded from normal queue progression until the secretary performs
an approved reinsertion.

### Architecture Result

```text
Supported
```

The approved Queue Serving Workflow correctly skips patients in
`OUT_FOR_PROCEDURE` when selecting the next patient.

No missing rule is identified.

---

## Event 8

### Time

```text
9:12 AM
```

### Starting State

The queue begins this event in the exact state produced by Event 7.

#### Active Queue

```text
01 Juan Dela Cruz (COMPLETED)

03 Pedro Reyes (COMPLETED)

▶ 02 Maria Santos (CALLED)

05 Jose Mendoza (WAITING)

06 Carla Ramos (WAITING)
```

#### Temporarily Absent

```text
Empty
```

#### Waiting to Continue

```text
04 Ana Garcia (OUT_FOR_PROCEDURE)

Required Activity:
ECG

Out Since:
8:55 AM
```

### Event

Ana Garcia completes her ECG.

She returns to the secretary desk and informs the secretary that the
required procedure is finished.

The secretary locates Ana in the:

```text
Waiting to Continue
```

panel.

Ana remains in the state:

```text
OUT_FOR_PROCEDURE
```

The system does not automatically return Ana to the active queue.

The secretary must explicitly select Ana and use:

```text
Reinsert
```

before Ana may participate in the Serving Order again.

### Waiting to Continue Panel

The panel now shows:

```text
04 Ana Garcia

Status:
Ready to Continue

Required Activity:
ECG

Out Since:
8:55 AM

Returned At:
9:12 AM
```

### Active Queue

The active Serving Order remains unchanged:

```text
▶ 02 Maria Santos (CALLED)

05 Jose Mendoza (WAITING)

06 Carla Ramos (WAITING)
```

### Queue Number Rule

Ana keeps her permanent Queue Number:

```text
04
```

No new Queue Number is generated.

### Patient Action Rule

Ana does not use:

```text
I'm Here
```

because she did not miss her call.

She left under clinic instruction and therefore returns through the
staff-controlled procedure continuation workflow.

### Result

Ana successfully returns from the ECG and is ready for staff-controlled
reinsertion.

Her Appointment remains outside the active Serving Order until the
secretary chooses an approved reinsertion position.

### Architecture Result

```text
Supported
```

The approved workflow correctly distinguishes returning from a procedure
from returning after a missed call.

No missing rule is identified.

---

## Event 9

### Time

```text
9:13 AM
```

### Starting State

The queue begins this event in the exact state produced by Event 8.

#### Active Queue

```text
01 Juan Dela Cruz (COMPLETED)

03 Pedro Reyes (COMPLETED)

▶ 02 Maria Santos (CALLED)

05 Jose Mendoza (WAITING)

06 Carla Ramos (WAITING)
```

#### Temporarily Absent

```text
Empty
```

#### Waiting to Continue

```text
04 Ana Garcia (OUT_FOR_PROCEDURE)

Status:
Ready to Continue

Required Activity:
ECG

Out Since:
8:55 AM

Returned At:
9:12 AM
```

### Event

The secretary selects Ana Garcia from the:

```text
Waiting to Continue
```

panel.

The secretary selects:

```text
Reinsert
```

The secretary chooses to place Ana:

```text
After Jose
Before Carla
```

The system changes Ana's Appointment from:

```text
OUT_FOR_PROCEDURE
```

to:

```text
WAITING
```

Ana is inserted into the active Serving Order after Queue Number 05 and
before Queue Number 06.

### Updated Serving Order

```text
▶ 02 Maria Santos (CALLED)

05 Jose Mendoza (WAITING)

04 Ana Garcia (WAITING)

06 Carla Ramos (WAITING)
```

### Updated Dashboard

#### Active Queue

```text
01 Juan Dela Cruz (COMPLETED)

03 Pedro Reyes (COMPLETED)

▶ 02 Maria Santos (CALLED)

05 Jose Mendoza (WAITING)

04 Ana Garcia (WAITING)

06 Carla Ramos (WAITING)
```

#### Temporarily Absent

```text
Empty
```

#### Waiting to Continue

```text
Empty
```

### Queue Number Rule

Ana keeps her permanent Queue Number:

```text
04
```

Only her Serving Order changes.

### Reinsertion Rule

This is a staff-controlled reinsertion.

The secretary may choose the placement according to clinic circumstances.

The automatic Protected Next Position Rule does not apply because Ana did
not use the self-service:

```text
I'm Here
```

workflow.

### Result

Ana returns to the active queue after Jose and before Carla.

Her Queue Number remains unchanged.

The clinic may continue serving patients normally.

### Architecture Result

```text
Supported
```

The approved staff-controlled reinsertion workflow correctly places a
returning procedure patient at a secretary-selected position.

No missing rule is identified.

---

## Event 10

### Time

```text
9:25 AM
```

### Starting State

The queue begins this event in the exact state produced by Event 9.

#### Active Queue

```text
01 Juan Dela Cruz (COMPLETED)

03 Pedro Reyes (COMPLETED)

▶ 02 Maria Santos (CALLED)

05 Jose Mendoza (WAITING)

04 Ana Garcia (WAITING)

06 Carla Ramos (WAITING)
```

#### Temporarily Absent

```text
Empty
```

#### Waiting to Continue

```text
Empty
```

### Event

Maria Santos completes her consultation.

The secretary confirms that the consultation has finished.

The secretary selects:

```text
Next Patient
```

The system automatically changes Queue Number 02 from:

```text
CALLED
```

to:

```text
COMPLETED
```

The system searches the current Serving Order.

The first Appointment whose state is:

```text
WAITING
```

is:

```text
Queue Number 05
Jose Mendoza
```

Jose Mendoza changes from:

```text
WAITING
```

to:

```text
CALLED
```

The public Queue Display Board updates to:

```text
NOW SERVING

05
```

The secretary announces:

> "Queue Number 05, please proceed to the consultation room."

Jose completes his consultation normally.

The secretary again selects:

```text
Next Patient
```

The system changes Queue Number 05 from:

```text
CALLED
```

to:

```text
COMPLETED
```

The next Appointment in the current Serving Order is:

```text
Queue Number 04
Ana Garcia
```

Ana Garcia changes from:

```text
WAITING
```

to:

```text
CALLED
```

The public Queue Display Board updates to:

```text
NOW SERVING

04
```

The secretary announces:

> "Queue Number 04, please proceed to continue your consultation."

Ana returns to the consultation room.

The doctor reviews the ECG results.

The consultation is completed.

The secretary selects:

```text
Next Patient
```

The system changes Queue Number 04 from:

```text
CALLED
```

to:

```text
COMPLETED
```

Queue Number 06 becomes the next patient to be called.

### Updated Dashboard

#### Active Queue

```text
01 Juan Dela Cruz (COMPLETED)

03 Pedro Reyes (COMPLETED)

02 Maria Santos (COMPLETED)

05 Jose Mendoza (COMPLETED)

04 Ana Garcia (COMPLETED)

06 Carla Ramos (WAITING)
```

#### Temporarily Absent

```text
Empty
```

#### Waiting to Continue

```text
Empty
```

### Queue Number Rule

Throughout the entire workflow:

```text
04
```

remains Ana Garcia's permanent Queue Number.

The Appointment remains the same Appointment from beginning to end.

Only the Serving Order changed during the procedure.

### Result

Ana successfully completes her Appointment after returning from the
required ECG.

No new Appointment is created.

No new Queue Number is assigned.

The Out for Procedure workflow is completed successfully.

### Architecture Result

```text
Supported
```

The approved Out for Procedure workflow correctly supports temporary
departure, staff-controlled reinsertion, consultation continuation, and
final Appointment completion.

No missing rule is identified.


---

## Event 11

### Time

```text
9:40 AM
```

### Starting State

The queue begins this event in the exact state produced by Event 10.

#### Active Queue

```text
01 Juan Dela Cruz (COMPLETED)

03 Pedro Reyes (COMPLETED)

02 Maria Santos (COMPLETED)

05 Jose Mendoza (COMPLETED)

04 Ana Garcia (COMPLETED)

06 Carla Ramos (WAITING)
```

#### Temporarily Absent

```text
Empty
```

#### Waiting to Continue

```text
Empty
```

No Appointment is currently in the:

```text
CALLED
```

state.

### Event

The secretary selects:

```text
Next Patient
```

The system correctly selects Queue Number 06 as the first `WAITING`
Appointment in the current Serving Order.

Carla Ramos changes from:

```text
WAITING
```

to:

```text
CALLED
```

The public Queue Display Board updates to:

```text
NOW SERVING

06
```

Carla's private Queue Page updates to indicate that her Queue Number is
being called.

The secretary then accidentally selects:

```text
Next Patient
```

a second time.

Because Queue Number 06 is the currently called Appointment, the system
interprets the second action as completion.

Carla Ramos changes from:

```text
CALLED
```

to:

```text
COMPLETED
```

No remaining Appointment is in the:

```text
WAITING
```

state.

The public Queue Display Board updates to indicate that no patient is
currently being called.

The secretary immediately realizes that the second `Next Patient` action
was accidental.

The Secretary Dashboard displays:

```text
Undo
```

The system does not attempt to determine whether Carla's consultation
actually finished.

The secretary decides whether Undo is appropriate based on the actual
clinic workflow.

### Updated Dashboard

#### Active Queue

```text
01 Juan Dela Cruz (COMPLETED)

03 Pedro Reyes (COMPLETED)

02 Maria Santos (COMPLETED)

05 Jose Mendoza (COMPLETED)

04 Ana Garcia (COMPLETED)

06 Carla Ramos (COMPLETED)
```

#### Undo Status

```text
Undo Available
```

### Result

Queue Number 06 was correctly called by the first `Next Patient` action.

The second `Next Patient` action incorrectly marked Queue Number 06 as
completed.

The latest queue advancement remains available for secretary-controlled
Undo.

### Architecture Result

```text
Supported
```

The approved workflow correctly treats `Next Patient` as completion of
the current patient while allowing the secretary to reverse an accidental
advancement.

The system does not attempt to independently determine whether the
consultation was completed.
---

# Simulation Result

| Item | Status |
|------|--------|
| Completed Successfully | Pending |
| Missing Rules Found | 0 |
| Architecture Changes Required | Pending |

---

# End of Simulation