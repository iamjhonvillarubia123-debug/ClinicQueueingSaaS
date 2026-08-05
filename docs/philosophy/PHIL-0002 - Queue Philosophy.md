# PHIL-0002 - Queue Philosophy

---

# Document Information

| Item | Value |
|------|-------|
| Document ID | PHIL-0002 |
| Title | Queue Philosophy |
| Status | Approved |
| Version | 1.0 |
| Date | 2026-08-02 |

---

# Purpose

This document defines the philosophy that governs the queueing system of the Clinic Queueing SaaS.

It explains how fairness, efficiency, flexibility, and patient experience should be balanced when managing a clinic queue.

All queue-related specifications, database models, APIs, and user interfaces must follow this philosophy.

---

# Core Philosophy

The queue is the center of the clinic operation.

Appointments exist only to reserve a place in the queue.

The queue exists to organize patients fairly while allowing doctors and clinics to work naturally.

The software should assist clinic operations rather than forcing clinics to adapt to software limitations.

---

# Guiding Principles

## 1. Queue Before Schedule

This system is not a traditional appointment scheduler.

Patients reserve a place in the clinic queue rather than an exact consultation time.

The consultation time is estimated and continuously updated throughout the day.

---

## 2. Fairness Comes First

The queue must always feel fair to patients.

Fairness is determined by the order in which confirmed bookings enter the queue.

Queue position must never depend on:

- Internet speed
- Device performance
- OTP typing speed
- Technical delays

Every patient should understand why they received their queue number.

---

## 3. Queue Numbers Never Change

Once assigned, a queue number becomes part of the patient's booking.

Queue numbers are never renumbered.

Even if patients are skipped or reinserted later, their original queue number remains unchanged.

This provides reassurance to patients and transparency within the clinic.

---

## 4. The Queue Is Dynamic

Although queue numbers remain permanent, estimated consultation times are dynamic.

The estimate changes according to:

- Consultation duration
- Doctor availability
- Walk-in patients
- Temporary delays
- Missed patients

Patients should understand that estimated time is a prediction rather than a guarantee.

---

## 5. Respect the Doctor's Workflow

Doctors should never feel controlled by the software.

Doctors decide:

- Consultation duration
- Breaks
- Emergency interruptions
- Actual treatment order when medically necessary

The queue adapts to the doctor's workflow.

---

## 6. Empower the Secretary

The secretary remains responsible for managing exceptional situations.

The system assists but does not replace human judgment.

Examples include:

- Reinserting missed patients
- Handling emergencies
- Accommodating clinic-specific policies
- Resolving unexpected situations

---

## 7. Missing One Queue Call Is Not Cancellation

Patients may miss their queue call for many legitimate reasons.

Examples include:

- Restroom break
- Pharmacy visit
- Parking
- Childcare
- Confusion inside the clinic

Missing one queue call does not automatically cancel the booking.

The patient's booking remains valid for the remainder of the clinic day.

---

## 8. Reinsertion Requires Clinic Approval

Patients who miss their turn may:

- Approach the secretary, or
- Press the "I'm Here" button in the application.

The secretary decides when the patient is reinserted into the queue.

This balances fairness with practical clinic operations.

---

## 9. Human Judgment Overrides Automation

The software provides recommendations.

Clinic staff make operational decisions.

Medical practice contains many exceptions that software cannot predict.

The system should support staff rather than restrict them.

---

## 10. Reduce Patient Anxiety

Patients often arrive:

- Sick
- Worried
- In pain
- Financially stressed

The queue should reduce uncertainty by always displaying:

- Queue Number
- Patients Ahead
- Estimated Consultation Time
- Current Queue Status

Patients should never wonder whether their booking still exists.

---

## 11. Simplicity Over Optimization

A perfectly optimized queue is often too complicated for patients.

The system should prefer rules that are:

- Easy to understand
- Easy to explain
- Easy to operate

A slightly less efficient queue is preferable if it creates significantly less confusion.

---

## 12. Transparency Builds Trust

Patients should always understand:

- Why they are waiting
- What happens next
- Whether their booking remains active

The system should avoid hidden rules whenever possible.

---

## 13. Queue Information Is Live

The patient application should display real-time queue information.

Examples include:

- Current serving number
- Patients ahead
- Estimated consultation time
- Booking status

Patients should not rely on SMS for live queue updates.

---

## 14. SMS Is Reserved for Important Events

SMS should be used only for meaningful actions.

Examples:

- OTP
- Booking confirmation
- Secure booking access
- Next-in-queue reminder
- Follow-up recommendation
- Cancellation confirmation

Routine queue movement belongs inside the application.

---

## 15. Balance All Participants

Every queue decision should consider four groups equally:

- Patients
- Doctors
- Secretaries
- Clinic owners

No workflow should optimize one group while creating unnecessary burden for another.

---

# Queue Success Criteria

The queue succeeds when:

Patients trust the queue.

Doctors work naturally.

Secretaries resolve problems quickly.

Clinics reduce administrative work.

Developers can understand and maintain the queue logic.

---

# Relationship to Other Philosophy Documents

This document expands the Product Philosophy by defining how queue management should operate.

Related philosophy documents include:

- PHIL-0001 - Product Philosophy
- PHIL-0003 - Patient Experience Philosophy
- PHIL-0004 - Doctor Workflow Philosophy
- PHIL-0005 - Notification Philosophy
- PHIL-0006 - Data Philosophy

---

# Version History

| Version | Date | Description |
|---------|------|-------------|
| 1.0 | 2026-08-02 | Initial Queue Philosophy |