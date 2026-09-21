# Time-Slot backend integration

## Approved baseline

On 2026-09-19 the Product Owner explicitly approved the current backend as the
baseline in place of the unavailable F6 documents. The clean starting revision
is `cb3505e713e9b50aac7b716a3f9ce71f44069a82`, checkpoint
`checkpoint/pre-backend-2026-09-19`. This records source authority, not a new
claim that every existing behavior has been independently audited.

Time-Slot specializations are governed by the [Existing-SaaS Reconciliation
and Backend Implementation Authority v1.0](authority/time-slot-reconciliation-v1.0-2026-09-19.txt)
and [Business Rules v1.0](authority/time-slot-business-rules-v1.0-2026-09-19.txt),
both dated 2026-09-19. Reconciliation takes precedence. These are unchanged
copies of the Product Owner-provided sources, retained for future repository work.
Queue Mode behavior remains the approved current behavior where not specialized.

Owner clarification during implementation: continuous group members receive
distinct half-hour reservations. Apply inclusive tolerance between members, but
advance at least one half-hour; include resulting gaps when checking that the
group fits. Thus allotments 60/10/30 total 100 minutes, but from 09:00 the member
starts are 09:00/10:00/10:30 and the occupied span is 120 minutes. Preserve actual
Service durations separately from both allotments and the occupied span.

## Implementation

1. Extend DoctorAccountSettings, PracticeLocation, existing configuration drafts,
   BookingDraft/Member and Appointment. Add dated configuration revisions and
   durable reservation history. Backfill existing appointments as Queue Mode.
2. Keep authentication, capability grants/password reentry, secretary submission
   and doctor approval, OTP lifetime, patient tokens, Services, ClinicDay,
   permanent queue numbers, notification outbox and command idempotency shared.
3. Implement one pure availability policy plus database-backed orchestration:
   local half-hour slots, inclusive 15-minute completion rounding, independent
   workloads, protected periods, individual limits and group allotments.
4. Use existing doctor schedule/capacity locks for atomic finalization and
   configuration changes. Pin populated dates to their original mode, never
   silently convert appointments. Enforce mixed-mode protection in PostgreSQL.
5. Extend existing public conversion and authenticated staff creation; keep
   service snapshots and actual duration intact. Preserve verified OTP on slot
   conflict and allow reservation reselection within the valid draft.
6. Add atomic rescheduling using existing management tokens/command protection;
   preserve queue number, original reservation and audit history. Share
   cancellation and release capacity based on current durable status.
7. Extend live queue policies, expose reservation separately from serving order,
   reject patient I'M HERE for Time-Slot, enforce secretary expired-slot rules.
8. Verify policy cases, authorization, real database races/rollback/idempotency,
   migrations and existing Queue Mode regression. Record actual results below.

## Configuration and shared API contracts

No frontend redesign is included. The existing clinic list/configuration API now
returns dated `appointmentModeConfigurations` and the saved Doctor draft's
`appointmentModeProposal`. Existing account settings accept/return
`defaultAppointmentMode`.

A clinic configuration proposal uses:

```json
{
  "appointmentMode": "TIME_SLOT_MODE",
  "effectiveServiceDate": "YYYY-MM-DD",
  "maximumBookableMinutes": 60,
  "protectedPeriods": [{ "weekday": 1, "startMinute": 720, "endMinute": 780 }]
}
```

`maximumBookableMinutes: null` means no configured maximum. Weekdays are Sunday
0 through Saturday 6; periods use the clinic's local minutes after midnight.
Mode changes take effect on a future clinic-local Service Date. Populated dates
retain their mode, including dates with terminal appointments. A transition
conflicting with already-booked future dates is rejected with the protected date.
The Doctor must select a later valid effective date; appointments are not moved.

- Existing Doctor configuration save/apply accepts `appointmentModeProposal`.
  Existing password and ownership controls continue to apply.
- Existing Doctor defaults apply accepts `appointmentModeEffectiveServiceDate`.
  `serviceTemplateIds: []` and `bookingQuestionTemplateIds: []` select mode only.
  Only the selected clinic IDs receive an effective configuration revision.
- `PUT /secretary-settings-drafts/:draftId/appointment-mode` accepts
  `{ "proposal": { ... } }`. It requires the current regular Secretary and
  existing Clinic Configuration Drafting authority. Existing submission and
  owning-Doctor approval make the proposal effective. Substitute status alone
  cannot grant drafting access.
- `GET /booking/public/availability/:publicIdentifier/:serviceDate` includes
  the effective mode, maximum, and protected periods.
- `POST /booking/public/time-slots/:publicIdentifier` accepts `serviceDate` and
  `members: [{ selectedServiceIds: [...] }]`. It returns current reservation
  instants, actual durations, scheduling allotments and per-member availability.
  When no continuous fit exists it also calculates up to three alternate dates
  across the next 31 days, respecting the configured advance-booking window.
  `alternativeSearchThrough` reports the searched boundary; callers can request
  a later date to search further. Other publicly bookable clinics belong to the
  same Doctor and explicitly require selection of that clinic's Services.
  Suggestions create no holds and finalization always checks again.
- Existing draft creation/edit accepts `reservationAt` and, for groups,
  `fragmentedReservations` plus member-level `reservationAt`.
- Draft replacement with `continueVerifiedTimeSlot: true` preserves an already
  verified, unconsumed OTP only for unchanged patient identities/mobile and the
  same Doctor. Existing expiry is not extended. Final availability remains
  authoritative; changing Services does not preserve obsolete duration values.
- Existing staff appointment creation accepts `reservationAt` and
  `confirmAvailabilityOverride`. An unavailable reservation requires explicit
  confirmation; the staff actor and override are recorded. This remains the
  shared, authorized staff-assisted/walk-in path.

New protected reservation endpoints:

| Endpoint | Authority / input |
| --- | --- |
| `POST /appointments/:appointmentId/reschedule` | Existing staff session, CSRF, Idempotency-Key; reservationAt and optional confirmAvailabilityOverride |
| `POST /appointments/:appointmentId/start-service` | Existing authorized staff; currently CALLED patient in a STARTED clinic day; Idempotency-Key |
| `POST /patient-bookings/:bookingReference/reschedule` | Existing patient management cookie and CSRF; reservationAt; Idempotency-Key |
| `POST /patient-bookings/:bookingReference/cancel` | Existing patient management cookie and CSRF; Idempotency-Key |
| `POST /patient-booking-groups/:bookingGroupId/members/:bookingReference/reschedule` | Existing group controller cookie and CSRF; reservationAt; Idempotency-Key |

Rescheduling is within the appointment's existing clinic/Service Date, retains
Queue Number and original reservation, releases the old reservation atomically,
and resets current waiting placement. Patient recovery stops when active service
begins. Group cancellation continues through the existing shared member
cancellation endpoint. Existing queue operations retain their authorization,
undo, group-protection and audit paths. Time-Slot patient I'M HERE is rejected.
Staff reinsertion requires a priority warning acknowledgement; a Secretary may
not reinsert into an expired reservation.

## Persistence, concurrency and retention

Changes are additive. Existing appointments default to QUEUE_MODE. Database
constraints/triggers enforce durable original mode/reservation and prevent
mixed-mode clinic dates. Confirmation re-reads effective mode after acquiring
the shared configuration lock. A stale Time-Slot selection cannot silently
become a Queue Mode booking.

Existing doctor-schedule, booking-capacity, queue and idempotency locks protect
final writes. Group finalization and reservation replacement are transactional.
Staff operations use existing authority, clinic-day and lifecycle controls.
Reservation events contain timestamps, actor IDs, order/status and override
metadata; they do not copy patient names or mobile numbers.

Testing exposed two integration issues that were corrected:

1. Staff appointment command creation now supplies `createdAt` from the same
   completion instant as expiry, satisfying the existing exact retention check.
2. The old command scope matrix required an appointment result even during the
   existing privacy unlink operation. A guarded `privacyErasedAt` marker allows
   the existing erasure ledger/empty-group cleanup to unlink references while
   retaining the receipt's original expiry. New command inserts cannot use the
   erasure marker. Reservation history cascades only when its parent is erased
   through the existing retention gate. Backup erasure replay uses the same
   unlink behavior.

The migrations do not drop existing application tables or reset either database.
A Prisma-generated schema diff contained unrelated destructive drift and was
not applied. The prior checkpoint and database backup remain the rollback
reference. Restore code and database together using the existing checkpoint's
RESTORE.md; do not simply run old code against assumed reversed migrations.

## Verification

Verification completed on 2026-09-21. Local logs are under `.local-checkpoints/`.

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm run lint:check` | Passed |
| `npm test -- --runInBand` | 152 suites, 776 tests passed |
| All database E2E files through `test/run-e2e.mjs` | 75 suites, 262 tests passed, including 23 Time-Slot integration cases |
| `npm run build` | Passed |
| `npx prisma validate` | Passed |
| `git diff --check` | Passed |
| Authority document SHA-256 comparison | Both repository copies match the supplied originals |

All seven additive migrations were applied to the separate local development
and test databases (105 total migrations). Prisma Client was regenerated.

The database regression run enumerated every `test/*.e2e-spec.ts` file and ran
seven bounded batches with `--runInBand --testTimeout=60000 --runTestsByPath`.
Batch suite/test counts were 12/43, 12/35, 12/30, 12/26, 12/43, 12/53 and 3/32.
An earlier single-process attempt exhausted Node's heap; it is not counted as
a passing run. The complete batched rerun passed. Earlier stale test fixtures
were corrected to match existing verified-user lookup and identifier-based
secretary authentication contracts. Longer database test timeouts accommodated
the full regression workload without changing application timeout behavior.

Coverage includes concurrent claims and reschedules, atomic group rollback,
OTP-preserving reselection, authority and approval controls, staff overrides,
mode-transition protection, queue ordering, cancellation and privacy erasure.
Existing Queue Mode and shared subsystem regression suites passed as part of
the complete run. Product Owner acceptance and frontend integration remain
separate from these automated backend checks.

On 2026-09-21 the Product Owner authorized saving this implementation as a Git
checkpoint: `checkpoint/time-slot-backend-2026-09-21`, following
`checkpoint/pre-backend-2026-09-19`. This is a source checkpoint, not a new
database snapshot or production release. Frontend acceptance remains pending.

## Product Owner acceptance checklist

Use test accounts/clinics through the existing authenticated APIs until the
frontend is connected to the new fields. No new Time-Slot screen is claimed.

1. Keep an existing Queue Mode clinic unchanged; complete a booking and use
   START/NEXT/CLOSE to confirm the existing workflow.
2. Save TIME_SLOT_MODE as Doctor default, apply it to one selected test clinic
   for a future date, and verify an unselected clinic remains unchanged.
3. With a Secretary lacking configuration authority, attempt to save a proposal
   and confirm denial. Grant existing authority through the Doctor's normal
   password-protected flow, submit a proposal, and verify it is ineffective
   until Doctor approval.
4. Configure 30-minute Services and a protected period. Request public times;
   check half-hour boundaries, protected slots and clinic-local timestamps.
5. Verify two drafts for the same slot. Confirm both concurrently: exactly one
   succeeds. Reselect the loser's time using its existing control token and
   `continueVerifiedTimeSlot`; confirm without renewing its OTP expiry.
6. With maximum 60, book members with actual durations 90/90/90 and 90/10/30.
   Check scheduling totals 180 and 100, distinct half-hour member starts, and
   unchanged actual Service durations. Test fragmented choices and a conflict
   affecting one member; no partial group may be created.
7. Fill a date so a group cannot fit. Verify alternate-date suggestions and
   same-Doctor clinic alternatives; select Services again at another clinic.
8. Start a day with a later reservation booked first. The earlier reservation
   gets normal call priority despite its higher Queue Number. Use NEXT for an
   absent patient; their appointment and reservation remain. I'M HERE is denied.
9. Reschedule to an occupied time as patient: reject and keep the old time.
   As authorized staff, acknowledge the warning and verify a deliberate overlap
   is accepted/audited. Reorder without changing Reservation Time. Verify a
   Secretary cannot reinsert into an expired reservation.
10. Start active service and confirm patient reschedule/cancel is denied.
    Cancel another unresolved appointment and verify its capacity is released.
11. Attempt a mode change over populated dates; verify rejection. Check audit
    actor, original/current reservation and independent Serving Order.
12. Review the full automated results before approving the final Git checkpoint.
