# Production Deployment Rollback Runbook

## Purpose

Provide the Version 1 rollback/recovery procedure required by Milestone 13. This runbook separates application rollback from database recovery. A previous application release must never be pointed at an incompatible database merely because the application artifact itself can be redeployed quickly.

## Control principles

1. Every production deployment has a verified previous-release Git commit/artifact and a pre-deployment PostgreSQL backup.
2. Prisma migration history is append-only. Do not edit or delete migrations that have reached production.
3. Application rollback and database rollback are separate decisions.
4. Prefer application-only rollback when the current database remains backward-compatible with the previous application.
5. Do not attempt ad-hoc inverse SQL for destructive or uncertain migrations.
6. If database compatibility is uncertain, stop writes and use the verified backup/restore recovery path.
7. After restoration, run applicable privacy-erasure replay before reopening normal traffic.
8. Never restore an older backup over the live database in place without an isolated restore/verification step first.

## Pre-deployment evidence required

Before production deployment record:

- current release commit;
- previous verified release commit;
- successful `npm run verify:static` result;
- successful `npm run test:db-drill` result for releases with database changes;
- output of `npm run verify:rollback -- <previous-release-commit>`;
- pre-deployment PostgreSQL backup identifier/location;
- migration list introduced by the release;
- migration compatibility classification;
- deployment start time and responsible operator.

A release with an unclassified migration must not be considered application-rollback-ready.

## Rollback decision tree

### Case A: application defect, database is backward-compatible

Examples: HTTP/API regression, worker regression, provider integration defect, or application configuration issue where the migration compatibility gate passes.

Procedure:

1. Stop or drain the defective application release from receiving new traffic.
2. Pause workers that can create additional durable side effects if the defect affects worker behavior.
3. Preserve the current database. Do not run inverse migrations.
4. Redeploy the exact previous verified application artifact/commit.
5. Restore the previous release's environment configuration/secrets references without copying secrets into source control.
6. Start the application and required workers.
7. Verify health endpoint, authentication, a read-only public route, database connectivity, and Prisma compatibility.
8. Verify high-risk workflow boundaries affected by the incident.
9. Keep the additive newer schema in place until a reviewed forward migration removes it in a later release, if removal is actually necessary.
10. Record incident cause, rollback commit, verification result, and follow-up action.

### Case B: migration is destructive, incompatible, partially applied, or compatibility is uncertain

Procedure:

1. Stop application traffic that performs writes.
2. Stop workers that perform database writes or external-provider submissions.
3. Do not deploy the previous application against the uncertain database.
4. Preserve the affected database for incident analysis.
5. Restore the pre-deployment backup into a separate replacement database.
6. Verify table counts/integrity, Prisma migration history, required constraints/indexes, and application compatibility using the verified database drill procedure.
7. Run privacy-erasure replay for still-valid erasure ledgers before the restored database becomes authoritative.
8. Point the previous verified application artifact at the verified replacement database.
9. Run health and critical workflow checks.
10. Reopen traffic only after verification is complete.
11. Preserve incident evidence and document any data reconstruction required for writes accepted between backup creation and traffic shutdown.

Data written after the backup was taken may require explicit reconstruction. Do not silently discard or invent those business events.

### Case C: migration deployment itself fails before application cutover

Procedure:

1. Keep the previous application release active if it remains compatible with the partially changed schema.
2. Stop further migration attempts.
3. Inspect Prisma migration status and PostgreSQL state.
4. If the failed migration was transactional and rolled back completely, correct the migration in a new reviewed migration only if it has not been accepted as production history.
5. If database state is partial or uncertain, follow Case B.
6. Never mark a failed migration as resolved merely to silence Prisma unless the actual database state has been independently verified against the intended schema.

## Current Milestone 13 compatibility decision

Rollback target baseline: final verified Milestone 12 commit `d89ca881a62972f3f47b5ea32c92d7fc18919be5`.

Milestone 13 migration `20260822120000_m13s5_rate_limit_buckets` is classified `APPLICATION_ROLLBACK_COMPATIBLE` because it only creates the `RateLimitBucket` table, its primary/check constraints, and an index. It does not alter or remove schema required by the Milestone 12 application.

Therefore an application-only rollback from the Milestone 13 release candidate to the verified Milestone 12 application is approved from the database-compatibility perspective, provided no later migration changes this conclusion and the rollback compatibility gate still passes immediately before deployment.

Database downgrade is not required for that application rollback. The unused additive table may remain until a future reviewed forward migration decides otherwise.

## Post-rollback verification

At minimum verify:

- application health endpoint;
- PostgreSQL connectivity;
- Prisma migration state is understood and documented;
- Doctor login;
- public Doctor/PracticeLocation route;
- booking availability read;
- worker status where workers were restarted;
- no unexpected provider submissions;
- privacy-erasure replay status if a backup was restored;
- no credentials/secrets were copied into logs or source control.

If the incident involved booking, queue, financial, notification, or privacy behavior, execute the relevant targeted E2E/acceptance workflow before declaring recovery complete.

## Prohibited shortcuts

- Editing/deleting a production migration and pretending it never happened.
- Running unreviewed `DROP`, inverse migration, or schema surgery against production.
- Restoring a backup directly over the live database without isolated verification.
- Rolling application code back when migration compatibility is unknown.
- Reopening traffic before health/database/privacy verification.
- Treating successful compilation as rollback verification.
