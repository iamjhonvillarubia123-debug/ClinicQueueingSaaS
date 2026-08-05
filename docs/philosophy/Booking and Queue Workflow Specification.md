# Booking and Queue Workflow Specification

## Status

Approved

---

# Purpose

This document defines the official booking and queue workflow for the Clinic Queueing SaaS.

The design prioritizes:

- Patient simplicity
- Queue fairness
- Clinic efficiency
- Doctor flexibility

The system intentionally favors a simple and predictable workflow over attempting to optimize every possible edge case.

---

# Scope

This document defines the operational workflow of the clinic queue.

It does NOT define:

- Database tables
- API endpoints
- User interface implementation
- Notification implementation

Those topics are documented separately.

This document serves as the single source of truth for how the clinic should operate.

---

# Design Philosophy

The software should support clinic operations rather than replace the judgment of doctors and secretaries.

The system provides recommendations and automation where appropriate while allowing clinic staff to make operational decisions.

Patients should never need to understand the internal queue algorithm.

---

# Patient Booking Workflow

1. Patient selects:

- Clinic
- Doctor
- Consultation Date

2. Patient completes the booking form.

3. System sends an OTP.

4. Patient verifies the OTP.

5. Booking is confirmed.

6. Patient receives:

- Queue Number
- Estimated Consultation Time

Example

Queue Number

15

Estimated Consultation

10:40 AM

The estimated consultation time is dynamic and may change as the queue progresses.

---

# Queue Number

Queue Numbers are assigned after booking confirmation.

The Queue Number remains the patient's permanent queue identifier for that booking.

Queue Numbers are never renumbered.

The secretary calls patients using Queue Numbers instead of patient names.

Example

"Queue Number 15"

This improves patient privacy while giving patients confidence that they are already included in the queue.

---

# Estimated Consultation Time

The system continuously estimates the patient's consultation time based on:

- Current queue progress
- Estimated consultation durations
- Doctor progress

Estimated Consultation Time is NOT a guaranteed appointment time.

It automatically updates throughout the day.

---

# Calling Patients

The secretary calls Queue Numbers sequentially.

Example

Queue Number 15

↓

Queue Number 16

↓

Queue Number 17

---

# Patient Not Present

If the patient does not respond:

The booking is NOT cancelled.

Instead,

the secretary simply skips the patient and continues serving the next available patient.

Example

Queue 15 absent

↓

Secretary presses

Next

↓

Queue 16 is called.

The clinic continues operating without delay.

---

# Missed Queue

A patient who misses their queue DOES NOT lose the booking.

The patient application displays:

--------------------------------

We already called your queue.

Your booking is still active.

Please approach Reception

or tap

I'm Here

--------------------------------

The message should reassure the patient rather than make them think the appointment has been cancelled.

---

# I'm Here

The patient may press

I'm Here

or

approach the secretary personally.

This informs the clinic that the patient has returned.

The patient is NOT automatically placed back into the queue.

---

# Secretary Reinsertion

Only the secretary may reinsert a missed patient into the active queue.

The system suggests the next fair insertion point.

The secretary confirms the reinsertion.

This allows the secretary to consider the current clinic situation while maintaining fairness.

---

# Multiple Missed Patients

If multiple missed patients return,

priority is based on the original Queue Number.

Example

Queue 5 returned

Queue 10 returned

Queue 5 should normally be reinserted before Queue 10.

Patients already being served or already waiting next should never be interrupted.

---

# Booking Validity

A confirmed booking remains valid for the selected consultation date unless:

- Patient cancels
- Clinic cancels
- Clinic closes for operational reasons

Missing one queue call does NOT cancel the booking.

---

# Doctor Workflow

The doctor continues serving available patients.

The doctor may:

- Take breaks
- Resume consultations
- Continue serving walk-in patients
- Continue serving reinserted patients

The software adapts to the doctor's workflow rather than forcing the doctor to follow the software.

---

# Secretary Workflow

Secretary responsibilities include:

- Calling Queue Numbers
- Skipping absent patients
- Reinserting returned patients
- Monitoring queue progress
- Managing clinic flow

The secretary maintains operational control over the live queue.

---

# Patient Interface Principles

Patients may be:

- Sick
- Elderly
- In pain
- Financially stressed
- Emotionally anxious

Therefore,

the patient interface should remain extremely simple.

The application should avoid exposing:

- Queue algorithms
- Booking order
- Scheduling logic
- Internal workflow rules

Instead, every screen should answer only these questions:

- Is my booking confirmed?
- What is my Queue Number?
- Approximately when will I be seen?
- What should I do now?
- Am I still going to be seen today?

---

# Queue Philosophy

The queue prioritizes:

1. Simplicity

2. Predictability

3. Fairness

Perfect optimization is intentionally not the goal.

When conflicts occur,

the system should always choose the simplest rule that patients, doctors, and secretaries can consistently understand.

---

# Core Principles

1. A patient who successfully completes OTP verification has a confirmed booking.

2. A confirmed booking remains valid even if the patient misses one queue call.

3. Missing a queue call never automatically cancels the booking.

4. The clinic must never stop serving patients because someone is absent.

5. The secretary always has operational control over the live queue.

6. The software recommends actions but does not replace the judgment of clinic staff.

7. Queue Numbers never change after they are assigned.

8. The system should reduce patient anxiety by clearly communicating that their booking remains active whenever applicable.

9. Patient-facing screens should always favor reassurance over technical explanations.

10. The software exists to make the clinic's work easier, not more complicated.

---

# Future Enhancements

Possible future improvements include:

- Live queue updates
- Push notifications
- Secretary override audit log
- Dynamic consultation estimates
- Family bookings
- Doctor pause/resume history
- Emergency patient prioritization