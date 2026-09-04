# F4 Patient Appointment Dashboard

This slice implements the patient-facing Appointment dashboard against the existing protected patient-access backend contract.

It deliberately treats backend-provided queue state as authoritative. The frontend does not calculate Queue Numbers, serving order, patients-ahead counts, or I’m Here eligibility.

Implemented in this slice:

- permanent Queue Number display;
- current Appointment status;
- backend-authoritative Now Serving and People Ahead values;
- backend-authorized one-time I’m Here action with an idempotency key;
- neutral inaccessible and service-unavailable states;
- mobile-first responsive presentation.

BookingGroup controller expansion remains a later F4 slice.
