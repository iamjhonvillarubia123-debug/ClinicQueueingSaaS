require('dotenv').config();
const { Client } = require('pg');
const { assertDevelopmentDatabase } = require('./show-dev-latest-email-verification-link.cjs');

async function main() {
  console.log('R3 Secretary candidate / replacement state diagnostic');
  console.log('Read-only: no rows are changed.');

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to inspect Secretary relationship state in production.');
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not defined.');
  assertDevelopmentDatabase(databaseUrl);

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const clinicResult = await client.query(`
      SELECT
        pl."id" AS "clinicId",
        pl."name" AS "clinicName",
        pl."currentRegularPracticeStaffId",
        dp."userId" AS "doctorUserId",
        MAX(si."createdAt") AS "latestInvitationAt"
      FROM "PracticeLocation" pl
      INNER JOIN "DoctorProfile" dp ON dp."id" = pl."doctorProfileId"
      LEFT JOIN "SecretaryInvitation" si ON si."practiceLocationId" = pl."id"
      GROUP BY pl."id", pl."name", pl."currentRegularPracticeStaffId", dp."userId"
      ORDER BY MAX(si."createdAt") DESC NULLS LAST, pl."updatedAt" DESC
      LIMIT 1
    `);

    if (clinicResult.rowCount === 0) throw new Error('No clinic exists in the development database.');
    const clinic = clinicResult.rows[0];

    const staffResult = await client.query(`
      SELECT
        ps."id" AS "practiceStaffId",
        ps."practiceLocationId",
        ps."userId",
        ps."isActive",
        ps."disconnectedAt",
        u."firstName",
        u."lastName",
        u."role"::text AS "userRole",
        u."accountStatus"::text AS "accountStatus",
        u."administrativeRestrictionStatus"::text AS "restrictionStatus",
        u."loginIdentifierType"::text AS "loginIdentifierType",
        u."emailVerifiedAt",
        u."mobileVerifiedAt"
      FROM "PracticeStaff" ps
      INNER JOIN "User" u ON u."id" = ps."userId"
      INNER JOIN "PracticeLocation" pl ON pl."id" = ps."practiceLocationId"
      INNER JOIN "DoctorProfile" dp ON dp."id" = pl."doctorProfileId"
      WHERE dp."userId" = $1
      ORDER BY ps."updatedAt" DESC
    `, [clinic.doctorUserId]);

    const pendingResult = await client.query(`
      SELECT
        si."id",
        si."status"::text AS "status",
        si."targetUserId",
        si."normalizedIdentifier",
        si."requestedAssignmentType"::text AS "assignmentType",
        si."expectedCurrentPracticeStaffId",
        si."createdAt"
      FROM "SecretaryInvitation" si
      WHERE si."practiceLocationId" = $1
      ORDER BY si."createdAt" DESC
      LIMIT 10
    `, [clinic.clinicId]);

    console.log('');
    console.log(`Clinic: ${clinic.clinicName ?? '(unnamed)'} (${clinic.clinicId})`);
    console.log(`Doctor user: ${clinic.doctorUserId}`);
    console.log(`Current regular PracticeStaff pointer: ${clinic.currentRegularPracticeStaffId ?? 'NULL'}`);
    console.log('');
    console.log('Doctor-linked PracticeStaff relationships:');

    if (staffResult.rowCount === 0) {
      console.log('  none');
    } else {
      for (const row of staffResult.rows) {
        const verified =
          row.loginIdentifierType === 'EMAIL'
            ? Boolean(row.emailVerifiedAt)
            : Boolean(row.mobileVerifiedAt);
        const candidateEligible =
          row.userRole === 'SECRETARY' &&
          row.accountStatus === 'ACTIVE' &&
          row.restrictionStatus === 'NONE' &&
          verified &&
          row.disconnectedAt === null;
        console.log(
          `  ${row.firstName} ${row.lastName} | staff=${row.practiceStaffId} | clinic=${row.practiceLocationId} | assignmentActive=${row.isActive} | disconnected=${row.disconnectedAt ? 'YES' : 'NO'} | account=${row.accountStatus} | restriction=${row.restrictionStatus} | primary=${row.loginIdentifierType} | verified=${verified ? 'YES' : 'NO'} | existingCandidate=${candidateEligible ? 'YES' : 'NO'}${row.practiceStaffId === clinic.currentRegularPracticeStaffId ? ' | CURRENT_REGULAR=YES' : ''}`,
        );
      }
    }

    console.log('');
    console.log('Recent invitations for this clinic:');
    if (pendingResult.rowCount === 0) {
      console.log('  none');
    } else {
      for (const row of pendingResult.rows) {
        console.log(
          `  ${row.status} | ${row.normalizedIdentifier} | type=${row.assignmentType} | targetUser=${row.targetUserId ?? 'NULL'} | expectedCurrent=${row.expectedCurrentPracticeStaffId ?? 'NULL'} | created=${new Date(row.createdAt).toISOString()}`,
        );
      }
    }

    console.log('');
    if (!clinic.currentRegularPracticeStaffId) {
      console.log('DIAGNOSTIC FLAG: this clinic has no current regular Secretary pointer. A Clinic Secretary replacement warning cannot be derived reliably until that state is reconciled.');
    } else {
      console.log('Current regular Secretary pointer exists. If the browser omits the replacement warning, the remaining defect is in the frontend state/flow.');
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`Diagnostic failed: ${error.message}`);
  process.exitCode = 1;
});
