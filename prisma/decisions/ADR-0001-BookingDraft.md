# ADR-0001 - Introduce BookingDraft

---

# Document Information

| Item | Value |
|------|-------|
| ADR ID | ADR-0001 |
| Title | Introduce BookingDraft |
| Status | Accepted |
| Version | 1.0 |
| Date | 2026-08-02 |

---

# Context

The Clinic Queueing SaaS requires patients to complete OTP verification before a permanent Patient record and Appointment are created.

The approved workflow is:

```text
Patient submits booking information
        ↓
OTP is sent
        ↓
OTP is verified
        ↓
Patient is created or matched
        ↓
Appointment is created
        ↓
Queue Number is assigned