# Deferred Database Designs

This folder contains database designs that are intentionally not part of
the active Prisma schema.

These drafts exist because either:

- the business workflow is not yet finalized,
- another table specification is missing,
- or implementation has been intentionally deferred.

---

## BookingDraft

Status: Draft

Purpose:

Temporarily stores an unverified booking while OTP verification is in
progress.

Depends on:

- PracticeLocation
- OtpVerification

Blocks:

- Public Booking workflow

---

## BookingQuestion

Status: Waiting for specification

Purpose:

Doctor-configurable booking questions.

Blocks:

- AppointmentAnswer
- BookingDraftAnswer

---

## AppointmentAnswer

Status: Draft

Purpose:

Stores answers to BookingQuestion after appointment confirmation.

Depends on:

- BookingQuestion

---

## BookingDraftAnswer

Status: Deferred

Purpose:

Temporary answers before OTP verification.

Depends on:

- BookingDraft
- BookingQuestion