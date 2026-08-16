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

## Closure reminder

Milestone 5 closure must reconcile older source wording that still mentions BookingQuestion duration adjustments with Amendment 1 above, and must preserve the requirement that Milestone 6 final conversion revalidates current Service and BookingQuestion eligibility before durable Appointment creation.
