# Account activity notification extension

Implementation authority: September 3 user approval to complete the Settings follow-up, including payment, developer-update, onboarding/acceptance and account-security notices. Profile editing remains excluded.

## Reviewed design

Extend the existing recipient-scoped ApplicationNotification model, rather than introducing another inbox. Add ACCOUNT_ACTIVITY and optional bounded plain-text title/message fields. Existing secretary lifecycle notices remain backward compatible. No patient data, credentials, invitation tokens, or arbitrary JSON payloads are copied.

Transactional database triggers emit account notices when a password changes, an account status changes, an invitation is created/accepted/revoked/expired, or a subscription payment/refund changes status. Recipients are derived from the source record's Doctor ownership, never from client input. Invitation notices never confer authority. No historical events are fabricated/backfilled. Unique event identities suppress redundant same-state callbacks.

Administrative announcements use a separate authenticated SYSTEM_ADMIN endpoint, active-account revalidation, current-password verification, origin checking, rate limits, explicit recipient selection (maximum 100), and idempotency. Announcement source actor is recorded in a nullable internal actor field. This is not an unrestricted Doctor-to-user messaging feature.

Existing affected-secretary relations provide safe display names only inside recipient-owned notices; no directory/search endpoint is added. Closed accounts display a neutral label, not deleted identity snapshots.

Migration review: additive enum/nullable columns only; no table drop, data deletion, or retention change. Triggers run in the source transaction so failures cannot commit misleading notices. Test against the isolated test database before local deployment. Existing notifications and read states are preserved. UI handles old notices with no title/message.

Limitations: no external email delivery is promised for these in-app notices, and no admin composing UI is introduced. Current erasure retention still applies. Audit history must state its actual source coverage.
