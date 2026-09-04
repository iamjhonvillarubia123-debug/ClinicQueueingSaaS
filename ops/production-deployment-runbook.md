# Clinic Queueing SaaS Version 1 Production Deployment Runbook

## Purpose

This runbook is the canonical Version 1 deployment sequence for the backend application, notification worker, and maintenance worker.

It implements the Milestone 13 production-hardening requirements for deployment preparation, production configuration, worker startup, health/readiness verification, backup/restore readiness, rollback controls, and operational verification.

It does not authorize undocumented business-rule changes or ad-hoc database surgery.

## Production process topology

Version 1 uses three independently supervised Node.js processes built from the same release artifact and production environment:

1. API process: `npm run start:prod`
2. Notification delivery/reconciliation worker: `npm run start:worker`
3. Retention/maintenance worker: `npm run start:maintenance`

The notification worker performs provider delivery and expired-processing-lease reconciliation using the durable NotificationOutbox architecture.

The maintenance worker executes bounded retention/cleanup jobs for BookingDraft, security/recovery data, notification retention, command idempotency, and expired rate-limit buckets.

Do not run provider delivery from the API process.

## Required production environment

The following values must be supplied by the deployment platform or secret manager. Secrets must not be committed to Git.

Required common configuration:

- `NODE_ENV=production`
- `DATABASE_URL`
- `JWT_SECRET`
- `MOBILE_ENCRYPTION_KEY_V1`
- `MOBILE_LOOKUP_HMAC_KEY_V1`
- `MOBILE_ENCRYPTION_ACTIVE_KEY_ID`
- `MOBILE_LOOKUP_ACTIVE_KEY_ID`
- `OTP_HMAC_KEY_V1`
- `OTP_HMAC_ACTIVE_KEY_ID`
- `PUBLIC_APP_BASE_URL`
- `WEB_APP_ORIGIN`
- `SMS_PROVIDER=PHILSMS`
- `PHILSMS_API_TOKEN`
- `PHILSMS_SENDER_ID`
- `NOTIFICATION_WORKER_LEASE_MS`

Optional operational configuration with validated defaults/ranges where applicable:

- `PORT`
- `PHILSMS_BASE_URL`
- `PHILSMS_TIMEOUT_MS`
- `NOTIFICATION_WORKER_POLL_MS`
- `NOTIFICATION_RECONCILIATION_POLL_MS`
- `MAINTENANCE_WORKER_INTERVAL_MS`
- `RATE_LIMIT_ENABLED` may be omitted or true; production explicitly rejects false.

Production configuration validation requires PostgreSQL, HTTPS public origins, the approved PhilSMS provider, valid provider/worker timing ranges, and a worker lease safely longer than the provider timeout.

## Pre-deployment release gate

Before changing production:

1. Confirm the release candidate commit SHA and previous known-good release SHA.
2. Confirm the working release artifact was built from the intended immutable commit.
3. Confirm the complete automated verification gate passed for that commit.
4. Confirm the database migration/backup/restore/privacy replay drill passed for the release candidate.
5. Confirm the rollback compatibility gate passed against the previous known-good release.
6. Confirm provider live/sandbox acceptance required for the release has been completed or is explicitly recorded as an approved release blocker/deferment.
7. Confirm a current production database backup can be taken and restored according to the verified backup/restore procedure.
8. Confirm no secrets are present in source control, build logs, or deployment manifests.

## Build and configuration preflight

From the release artifact:

```text
npm ci
npm run build
npm run verify:production-config
```

`verify:production-config` must return `Production configuration PASS.` before migration or process startup.

This command validates environment configuration only. It does not send SMS and does not start workers.

## Deployment order

### 1. Quiesce deployment changes

Prevent a second deployment from running concurrently. Keep the previous application artifact available for rollback.

### 2. Create and verify the pre-deployment backup

Create a PostgreSQL backup using the production backup procedure. Record:

- backup timestamp;
- database identifier;
- release SHA before deployment;
- backup storage location/reference;
- operator/deployment identifier.

Do not continue if the backup command fails or the resulting artifact is not available.

### 3. Run rollback compatibility gate

Run:

```text
npm run verify:rollback -- <previous-known-good-release-sha>
```

If the gate fails, application rollback must not be assumed safe. Stop deployment and review the migration plan.

### 4. Apply database migrations

Run the production migration command from exactly the release artifact being deployed:

```text
npx prisma migrate deploy
```

Never use `prisma migrate dev`, `prisma db push`, manual schema editing, or ad-hoc inverse SQL in production.

### 5. Verify migration state

Run:

```text
npx prisma migrate status
```

Required result: repository migrations and production migration history are current with no failed or pending migration.

If migration deployment fails, do not start the new application. Follow the rollback/recovery runbook.

### 6. Start the API process

Start one or more supervised API instances using:

```text
npm run start:prod
```

The process must remain running without startup configuration errors.

### 7. Verify API liveness and readiness

Check:

- `GET /app/health` returns HTTP 200 with `{ "status": "OK" }`.
- `GET /app/ready` returns HTTP 200 with `{ "status": "READY" }`.

`/app/health` proves the HTTP process is alive.

`/app/ready` performs a PostgreSQL query and is the traffic-admission readiness probe.

Do not route production traffic to an API instance until readiness succeeds.

### 8. Start the notification worker

Start a separately supervised worker process:

```text
npm run start:worker
```

Required conditions:

- startup configuration passes;
- process remains alive;
- worker lease is greater than the provider timeout by more than five seconds;
- provider credentials are supplied only through secure runtime configuration;
- process supervisor restarts the worker after unexpected exit.

Do not infer exactly-once external SMS delivery. Recovery follows persisted processing leases and reconciliation rules.

### 9. Start the maintenance worker

Start a separately supervised maintenance process:

```text
npm run start:maintenance
```

Required conditions:

- process remains alive;
- only one instance is required for Version 1, although cleanup operations are bounded and database-safe;
- process supervisor restarts it after unexpected exit.

### 10. Production smoke verification

After all processes are healthy, verify at minimum:

- public doctor route responds;
- public PracticeLocation route responds;
- booking configuration/availability can be read;
- staff login reaches normal authentication behavior;
- rate limiting remains enabled;
- database readiness remains healthy;
- no unexpected 5xx response surge appears in logs;
- request correlation IDs are present on responses/errors;
- no secrets, mobile numbers, OTP values, message bodies, or patient free text appear in operational logs.

Provider acceptance must use a controlled test recipient and only when explicitly authorized. Do not perform an unplanned live SMS test merely as a deployment health check.

## Verified local performance/load evidence

Milestone 13 includes an opt-in HTTP/PostgreSQL load smoke test:

```text
npm run test:load
```

The harness starts the real Nest application on an ephemeral localhost TCP port, uses the isolated PostgreSQL test database, and exercises concurrent HTTP requests without provider side effects. Rate limiting is disabled only inside this isolated capacity harness so the workload measures application/database processing rather than the intentional abuse-control ceiling.

Verified local result on 2026-08-22:

- liveness `/app/health`: 300 requests, concurrency 30, approximately 1657.6 requests/second, p50 11.2 ms, p95 51.9 ms, max 59.6 ms;
- DB-backed readiness `/app/ready`: 200 requests, concurrency 20, approximately 1132.9 requests/second, p50 10.9 ms, p95 23.2 ms, max 176.1 ms;
- public PracticeLocation route: 300 requests, concurrency 30, approximately 641.0 requests/second, p50 41.5 ms, p95 85.4 ms, max 94.0 ms;
- zero incorrect HTTP results in the workload;
- load test suite passed.

These figures are evidence that the application and isolated PostgreSQL database sustain the tested concurrent read workload on the development machine. They are not a production SLA, capacity guarantee, hosting-size commitment, or substitute for production monitoring. Real production latency and throughput depend on infrastructure, geographic network distance, database sizing, provider dependencies, and concurrent write workload.

## Rollback triggers

Initiate rollback/recovery review when any of the following occurs and cannot be corrected immediately without changing production data manually:

- API cannot become ready after deployment;
- migration fails or migration history is inconsistent;
- authentication or authorization regression is detected;
- booking/queue transactional integrity is compromised;
- notification worker repeatedly crashes or creates unresolved processing growth;
- privacy/retention behavior is incorrect;
- material error-rate increase occurs after release;
- security configuration is missing or rate limiting is disabled;
- a critical Product Owner acceptance workflow fails.

## Application rollback

Application rollback is permitted only when `verify:rollback` confirms database compatibility with the previous release.

When permitted:

1. stop routing traffic to the failed release;
2. stop the failed release API/worker/maintenance processes;
3. deploy the previous known-good application artifact without modifying the current database schema;
4. start the previous API process;
5. verify `/app/health` and `/app/ready`;
6. start the previous release's required workers;
7. perform targeted smoke verification;
8. preserve logs and incident evidence.

Do not delete a newly added compatible table merely to make the database resemble the older release.

## Database recovery

Database downgrade is not implied by application rollback.

If a migration is destructive, incompatible, partially applied, or otherwise unsafe for application-only rollback, use the separately verified backup/restore procedure in `ops/production-rollback-runbook.md` and the database drill evidence.

Do not improvise reverse SQL.

After restore, run the required privacy-erasure replay procedure before returning restored data to ordinary application use when the backup can contain previously erased identifiers.

## Post-deployment evidence

Record the following for each production deployment:

- deployed Git commit SHA;
- previous known-good SHA;
- production configuration preflight result;
- rollback compatibility result;
- backup reference and timestamp;
- Prisma migration status result;
- API health/readiness result;
- notification worker startup result;
- maintenance worker startup result;
- smoke-test result;
- provider acceptance result when applicable;
- rollback/recovery action if any;
- Product Owner acceptance status when required for release closure.

## Version 1 release restriction

Milestone 13 is not complete merely because this runbook exists. Production release still requires the remaining Milestone 13 logging/privacy inspection, provider acceptance, integrated Product Owner acceptance, and final release-candidate checkpoint to be completed and recorded.
