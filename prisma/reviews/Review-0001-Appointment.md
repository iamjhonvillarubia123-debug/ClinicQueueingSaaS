# Review-0001 - Appointment Model

---

# Review Information

| Item | Value |
|------|-------|
| Review ID | Review-0001 |
| Module | Appointment |
| Review Status | ✅ Approved |
| Review Version | 1.0 |
| Review Date | 2026-08-02 |
| Product Owner | Product Owner |
| Technical Reviewer | ChatGPT |

---

# Purpose

This review documents the approved design decisions for the Appointment model after adopting the simplified queue-based workflow.

The purpose of this review is to ensure that the Appointment model reflects the approved Product Philosophy before any modifications are made to the production Prisma schema.

This review serves as the official engineering decision record for the Appointment model.

---

# Scope

## Included

- Appointment structure
- Queue workflow
- Queue numbering
- Appointment lifecycle
- Appointment timestamps
- Appointment relationships
- SMS notification scope

## Excluded

The following items require separate reviews.

- BookingDraft
- Patient
- NotificationLog
- BookingAccessToken
- Queue Allocation Algorithm

---

# Background

The original Appointment model combined several unrelated responsibilities into a single database model.

Examples included:

- Appointment Scheduling
- OTP Verification
- Queue Management
- Consultation Lifecycle

Following the Product Philosophy review, these responsibilities have been separated.

The Appointment model now represents only a confirmed clinic visit.

---

# Decision Log

## Decision 1

### Title

Remove Exact Time Slot Booking

### Approved

Remove

```prisma
scheduledStartAt
scheduledEndAt
```

Replace with

```prisma
serviceDate DateTime @db.Date
```

### Reason

The clinic operates as a queue rather than a fixed appointment scheduler.

---

## Decision 2

### Title

Queue Number

### Approved

```prisma
queueNumber Int
```

Queue Number is:

- Required
- Permanent
- Never Renumbered

### Reason

Every confirmed booking immediately becomes part of the clinic queue.

---

## Decision 3

### Title

Queue Number Uniqueness

### Approved

Unique by

```
Practice Location
+
Service Date
+
Queue Number
```

### Reason

Queue numbering restarts every clinic day.

---

## Decision 4

### Title

Estimated Consultation Time

### Approved

Do NOT store

```prisma
estimatedTurnAt
```

Calculate dynamically.

### Reason

Estimated consultation time changes continuously.

Persisting it would create stale data.

---

## Decision 5

### Title

Estimated Service Minutes

### Approved

Keep

```prisma
estimatedServiceMinutes Int
```

### Reason

Required for queue estimation.

---

## Decision 6

### Title

Appointment Status

### Approved

```prisma
enum AppointmentStatus {
  WAITING
  CALLED
  MISSED_CALL
  PENDING_REINSERTION
  IN_SERVICE
  COMPLETED
  CANCELLED
}
```

### Reason

Each status now represents an actual clinic event.

---

## Decision 7

### Title

Patient Creation Workflow

### Approved

```
Booking Draft

↓

OTP Verified

↓

Patient Created or Matched

↓

Appointment Created

↓

WAITING
```

### Reason

Only verified patients become permanent records.

---

## Decision 8

### Title

Appointment Timestamp Review

### Removed

```
mobileVerifiedAt
confirmedAt
expiredAt
noShowMarkedAt
```

### Kept

```
arrivedAt
calledAt
serviceStartedAt
serviceCompletedAt
cancelledAt
```

### Reason

Removed timestamps belong to BookingDraft or OTP verification.

Remaining timestamps represent actual clinic events.

---

## Decision 9

### Title

Relationship Review

### Removed

```
otpVerifications
```

Move to

```
BookingDraft
```

### Kept

```
bookingAccessTokens

contactPreference

followUpRecommendations

notificationLogs
```

### Reason

Appointment should only contain relationships belonging to a confirmed clinic visit.

---

## Decision 10

### Title

Version 1 SMS Notification Scope

### Approved

- OTP
- BOOKING_ACCESS_LINK
- NEXT_IN_QUEUE
- FOLLOW_UP_REMINDER
- CANCELLATION_CONFIRMATION

### Deferred

- APPOINTMENT_REMINDER
- QUEUE_UPDATE
- PATIENT_CALLED
- RESCHEDULE_CONFIRMATION

### Reason

SMS should only be used for important patient actions.

Live queue updates belong inside the application.

---

# Impact Assessment

## Database

High

Appointment structure requires significant updates.

---

## Backend

High

Changes affect:

- Appointment creation
- Queue processing
- OTP workflow
- Appointment lifecycle

---

## Frontend

Medium

Patients receive:

- Queue Number
- Estimated Consultation Time

instead of exact appointment times.

---

# Documents Affected

- Product Philosophy
- Booking & Queue Workflow Specification
- Appointment Draft
- Patient Workflow Specification

---

# Pending Questions

The following items remain outside the scope of this review.

- BookingDraft model
- Queue Allocation Algorithm
- Doctor-configurable advance booking window
- Queue numbering strategy for future bookings
- Queue generation algorithm

---

# Lessons Learned

The Appointment model should represent only a confirmed clinic visit.

Temporary booking data, OTP verification, and future booking workflows belong in separate models.

Separating responsibilities produces:

- A simpler database
- Cleaner backend services
- Easier maintenance
- Better long-term scalability

---

# Review Outcome

| Item | Status |
|------|--------|
| Decisions Approved | 10 |
| Decisions Rejected | 0 |
| Decisions Deferred | 5 |
| Overall Result | ✅ APPROVED |

---

# Implementation Checklist

| Task | Status |
|------|:------:|
| ☑ Appointment Draft Updated
| Prisma Schema Updated | ☐ |
| Prisma Migration Created | ☐ |
| Backend Updated | ☐ |
| API Tested | ☐ |
| Frontend Updated | ☐ |
| Integration Tested | ☐ |
| Documentation Updated | ☐ |
| Ready for Production | ☐ |

---

# Governance

This review follows the project engineering governance defined in:

```
docs/governance/Review Process.md
```

The governance document defines:

- Review workflow
- Approval process
- Draft process
- Implementation order
- Review lifecycle
- Engineering standards

All future reviews shall follow the same governance process.

---

# Version History

| Version | Date | Description |
|---------|------|-------------|
| 1.0 | 2026-08-02 | Initial Appointment Model Review |

---

# End of Review