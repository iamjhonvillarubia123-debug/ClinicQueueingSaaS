# 06 - Engineering Principles

---

# Purpose

This document defines the engineering principles used throughout the
Clinic Queueing SaaS.

These principles govern technical decisions across:

- Architecture Reviews
- Architecture Decision Records (ADRs)
- Database Design
- Prisma Schema
- Backend Services
- Frontend Applications
- API Design
- Documentation

Engineering principles describe **how engineering decisions are made**.

They are intended to ensure consistency, maintainability, security,
correctness, and long-term scalability across the entire system.

Whenever possible, Architecture Reviews should reference these principles
instead of repeating the same engineering reasoning.

---

# Engineering Principles

The following Engineering Principles (EP) are the authoritative guidance
for technical design.

Each principle has a unique identifier.

Example:

```text
EP-001
```

Future reviews may reference principles directly.

Example:

> This design follows EP-003.

---

# EP-001

## Title

One Source of Truth

## Principle

Every business fact shall have one authoritative source.

The system shall avoid storing duplicate representations of the same
information unless an approved architectural review explicitly requires
controlled denormalization.

## Purpose

Maintaining one source of truth prevents inconsistent data, simplifies
maintenance, and reduces synchronization errors.

## Examples

Preferred:

- Appointment owns permanent queue information.
- BookingDraft owns temporary booking information.
- OTP lifecycle is determined from timestamps rather than duplicated
  status values.

Avoid:

- Multiple fields representing the same business state.
- Duplicate values requiring manual synchronization.

---

# EP-002

## Title

One Business Responsibility Per Field

## Principle

Each database field shall represent one clearly defined business concept.

Fields shall not combine multiple responsibilities or store information
that belongs to another model.

## Purpose

Single-responsibility fields improve clarity, reduce ambiguity, and make
future maintenance safer.

## Examples

Preferred:

- serviceDate
- estimatedServiceMinutes
- consumedAt

Avoid:

- Generic fields with multiple meanings.
- Fields introduced without a clear business responsibility.

# EP-003

## Title

Model the Real Business Workflow

## Principle

System design shall reflect how the business actually operates rather than
how the software is implemented.

Models shall represent real operational responsibilities, even when those
responsibilities span multiple implementation steps.

## Purpose

Software that mirrors real business workflows is easier for users to
understand, easier for developers to maintain, and more likely to satisfy
operational needs without unnecessary redesign.

## Examples

Preferred:

- BookingDraft represents the clinic's pre-registration process.
- Appointment represents the confirmed clinic visit.
- OtpVerification represents identity verification during booking.

Avoid:

- Designing models solely around technical implementation.
- Ignoring operational workflows performed by clinic staff.
- Separating information that staff require to perform their daily work.


---

# Version History

| Version | Date | Description |
|---------|------|-------------|
| 0.1 | 2026-08-02 | Initial Engineering Principles document |