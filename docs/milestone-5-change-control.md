# Milestone 5 Change-Control Carry-Forward

This implementation record supplements the approved Project Sources for Milestone 5 closure. It does not replace the canonical requirements; it records Product Owner amendments and implementation clarifications approved during Milestone 5.

## Approved amendments

1. BookingQuestions are informational/preparation inputs only in Version 1. They contribute zero minutes to estimated service duration.
2. Per-patient estimated service duration is the sum of selected active Service durations, capped by the optional Doctor-wide `maximumEstimatedServiceMinutesPerPatient`. If the cap is NULL, the full Service-duration sum applies.
3. Active Services require a valid positive duration. Public booking requires Service-based duration data and does not fall back to `defaultConsultationMinutes`.
4. MULTI_PERSON BookingDrafts may temporarily contain 1-5 prospective members while being edited. Final initial confirmation must enforce 2-5 members.
5. BookingQuestion answers are owned directly by the BookingDraft in INDIVIDUAL mode and by the exact BookingDraftMember in MULTI_PERSON mode. One member's answer never satisfies another member's required question.
6. Required BookingQuestion answers must be complete before a booking-purpose OTP is authoritative. An editable incomplete draft may exist without an active booking OTP.
7. BookingQuestion answer content never changes `estimatedServiceMinutes`.
8. Unfinished BookingDraft continuity is browser-local only in Version 1. The browser may retain a temporary cryptographically random draft-control token and use it silently to continue editing the same unexpired draft without requiring OTP merely to resume it. The backend stores only a secure hash of that token; the raw token is not stored as an access credential in the database.
9. Version 1 does not provide cross-browser, cross-device, cleared-browser-storage, or otherwise lost-token recovery for an unfinished BookingDraft. If browser-local draft control is lost before durable Appointment creation, the patient starts a new BookingDraft. BookingDraft IDs, BookingDraftMember IDs, booking references, mobile numbers, and other identifiers must not themselves grant edit authority.
10. After durable Appointment creation, later loss-of-access or continuity problems use the approved Appointment Recovery process rather than BookingDraft recovery.
11. The browser-local draft-control token authorizes control of the unfinished draft only; it does not prove control of the submitted mobile number and does not replace booking-purpose OTP verification. If an already OTP-verified BookingDraft is materially edited, the prior OTP verification is invalidated and the patient must successfully verify again before proceeding through a stage that requires authoritative booking OTP verification.
12. The browser-local draft-control mechanism does not create an Appointment, reserve capacity, allocate a Queue Number, or extend the BookingDraft lifetime. Editing/resuming a draft must preserve the original `createdAt` and `expiresAt` lifecycle boundaries.

## Closure reminder

Milestone 5 closure must reconcile older source wording that still mentions BookingQuestion duration adjustments with Amendment 1 above, must record the Version 1 browser-local-only BookingDraft continuity and no-draft-recovery policy in Amendments 8-12, and must preserve the requirement that Milestone 6 final conversion revalidates current Service and BookingQuestion eligibility before durable Appointment creation.
