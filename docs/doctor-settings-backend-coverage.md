# Doctor Settings: frontend and backend coverage

Follow-up: Active Sessions is now implemented with authenticated session listing, owner-only individual revocation, and password-verified revocation of other sessions. Browser/location metadata remains unavailable. The table below records the original frontend-only checkpoint; see [settings-backend-follow-up.md](settings-backend-follow-up.md) for the current implementation status and the user's subsequent decisions, including account-only exports with no patient data.

Reviewed September 3, 2026. Scope: the five approved Doctor Settings designs. No backend, database, migration, or API contract changes were made for this implementation.

The new page is `/app/settings`, with bookmarkable `?tab=account`, `defaults`, `notifications`, `privacy`, and `audit` sections. Existing Doctor navigation is preserved. Unsupported panels are available for review, but their final submission buttons are disabled and explicitly say **Not connected yet**. No sample identities, notifications, audit events, security statuses, or success results are presented as real data.

## Connected features

| UI | Existing backend used | Notes |
| --- | --- | --- |
| Account ID and role | `GET /auth/profile` | Only these two fields are exposed. |
| Permanent account deletion | `POST /doctor/account/permanent-delete` | Warning, final confirmation, email, password, explicit acknowledgment, and idempotency key. Email is additionally requested because the current API requires it and the profile endpoint does not expose it. Server errors leave the dialog open. |
| List/manage default services | `GET /doctor/defaults`; `POST /doctor/defaults/services`; `PATCH /doctor/defaults/services/:templateId` | Name, duration, ACTIVE/INACTIVE status. These edit templates, not clinic entries. |
| List/manage default questions | `GET /doctor/defaults`; `POST /doctor/defaults/booking-questions`; `PATCH /doctor/defaults/booking-questions/:templateId` | Text, help, answer type, required/active flags, display order, type-specific limits/options. Server validates question count/order constraints. |
| Clinic selection preview | `GET /practice-location` | Only the Doctor's clinics. Permanently deleted clinics excluded. Selection is local; Apply is disabled. |
| Notifications | `GET /application-notifications`; `PATCH /application-notifications/:notificationId/read` | Supports current secretary disabled/deleted event types. All/Unread and Load More work locally over the returned list. Mark All uses existing per-item calls; partial failures are reported and do not falsely mark remaining notices as read. |
| Notification clinic names/navigation | `GET /practice-location` and existing clinic route | Unavailable clinic names are not invented. |
| Retention policy and acknowledgment status | `GET /doctor/account/data-privacy` | Uses actual policy version, retention values, acknowledgment status/date. |
| Acknowledge current retention policy | `POST /doctor/account/data-retention-acknowledgement` | Only sent after the user explicitly checks the acknowledgment. |
| Help/policy drawers and tab navigation | Frontend only | These do not require a new backend. |

## Unconnected features and reasons

| UI feature | Current gap | Decision needed |
| --- | --- | --- |
| Name, email, email verification status, account status, full Doctor profile | `AuthController.getProfile` returns only `userId` and `role`. `DoctorService.getAccountSettings` returns only `maximumEstimatedServiceMinutesPerPatient`. No private profile-detail endpoint was found. | Expose an authenticated, appropriately scoped profile contract. |
| Change Password; last changed date | Recovery/reset endpoints exist, but there is no current-password-verified signed-in change endpoint or last-changed field in the exposed profile. | Define a signed-in change-password endpoint and session revocation policy. The design's strength checklist is shown as proposed, not as currently enforced backend validation. |
| Session list, device metadata, per-device sign-out, sign out all other sessions | Internal session handling and current-session logout exist, but there are no user-facing list/revoke-other-session endpoints. | Define session visibility, safe metadata, and password reauthentication for bulk revocation. |
| Password-confirmed Disable Account | `DoctorController.disableAccount` accepts no password DTO and calls lifecycle disable with only user ID and idempotency key. A password typed into the frontend would not be verified. | Add backend password verification before enabling this approved action. No automatic disablement fallback is used. |
| Default timezone, advance booking, online booking read/edit | Database fields exist, but the current account-settings GET/PATCH contract only exposes the patient-duration cap. Registration fields are not a settings-edit API. | Expose these fields and define whether changes affect new clinics only or existing clinic behavior. |
| Apply only services / only questions, additive only | The existing `/doctor/defaults/apply` takes only clinic IDs. It applies both kinds together and updates existing template-linked service/question entries. This conflicts with the approved separate, non-overwriting behavior. | Change the backend contract/behavior or explicitly approve a different UI. Do not connect the current endpoint under the additive-only promise. |
| Service/question drag-and-drop and permanent template deletion | Question display order can be edited through the existing PATCH endpoint; there is no atomic reorder endpoint or permanent template deletion route. | Decide whether ordered editing and inactive templates are sufficient, or add dedicated operations. No nonfunctional drag handles or delete controls are displayed. |
| Billing, payment, maintenance, compliance inbox notifications | The application notification enum currently supports only secretary-account disabled/deleted. Other email/outbox mechanisms do not expose these sample events as an inbox feed. | Add supported event types, delivery rules, and safe detail payloads if desired. |
| Secretary name/profile in notification detail | Notification responses expose the affected secretary ID, not a safe display snapshot. A deleted/disconnected secretary may no longer appear in the Doctor's directory. | Provide privacy-safe event display data; do not broaden unrelated-secretary search to fill this gap. |
| Notification channel preferences / notification bell across the shell | The approved notification guide is implemented as informational content. There is no notification-preference API. A global shell bell was not added; this change is scoped to Settings. | Decide whether to extend the shared application shell separately. |
| Export My Data, Request Account Data, Backup Settings | No account-data request/export/backup endpoints were found. | Define scope, privacy filtering, authorization, delivery, retention, and request tracking before implementing. |
| Personalized Account & Practice Information | Retention-policy data is available; a personalized inventory of stored account/practice data is not. | Define the data inventory contract. |
| Automatic erasure **Active** status | Policy fields describe retention, but do not expose worker health or execution status. | Add operational status if this badge is required. The frontend does not claim that the worker is running. |
| Audit timeline, date-filtered results, activity totals, printing records | Internal audit storage exists, but no Doctor-scoped combined audit-query endpoint was found. Counts cannot be inferred safely from unrelated APIs. | Define the audit read model, authorization, retention-safe payload, filters, pagination, and totals. Print stays disabled while there are no connected records. |

## Why these gaps exist

The code establishes narrower backend capabilities than the new approved screens assume. Some fields exist only in storage or registration, some commands exist with different semantics, and others have no exposed route. **This is evidence about the current implementation, not proof of why earlier development omitted them.** The historical/product reason cannot be established from the route and service inspection alone.

## Verification scope

Component tests cover tab rendering, unconnected controls, template create/update payloads, notification read-all and partial failure behavior, explicit retention acknowledgment, permanent-delete error handling, and data-load retry. These tests mock API responses: they do not delete a real account, change a real password, or accept policy on behalf of a real Doctor.

Additional regressions cover missing clinic references on retained notifications and decimal question limits serialized as strings by the backend. There are 13 Settings-specific tests. Type checking, linting, and the production build pass. Vite reports a non-blocking large-chunk warning. Full-suite runs with the default five-second test limit intermittently time out in existing UI tests; use `npm run test -- --maxWorkers=2 --testTimeout=15000` on this machine. No global test settings or existing tests were changed to suppress failures.

Live signed-in visual verification requires a Doctor session. The available preview browser initially opened the sign-in screen; no authentication was bypassed.
