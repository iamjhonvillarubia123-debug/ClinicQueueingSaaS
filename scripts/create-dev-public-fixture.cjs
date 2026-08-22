require('dotenv').config();
const { randomUUID } = require('crypto');
const { Client } = require('pg');

const ACCEPTANCE_EMAIL = 'frontend.acceptance.doctor@local.test';
const LOCATION_NAME = 'North Clinic';
const DAY_MS = 24 * 60 * 60 * 1000;

async function main() {
  if (process.env.NODE_ENV && process.env.NODE_ENV !== 'development') {
    throw new Error('Refusing to create the public acceptance fixture because NODE_ENV is not development.');
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL environment variable is not defined.');

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    const user = await client.query('SELECT "id" FROM "User" WHERE "email" = $1 LIMIT 1 FOR UPDATE', [ACCEPTANCE_EMAIL]);
    if (user.rowCount === 0) throw new Error('Run npm run dev:acceptance-user first.');
    const userId = user.rows[0].id;

    let profile = await client.query('SELECT "id", "publicIdentifier" FROM "DoctorProfile" WHERE "userId" = $1 LIMIT 1 FOR UPDATE', [userId]);
    let doctorProfileId;
    let doctorPublicIdentifier;
    if (profile.rowCount === 0) {
      doctorProfileId = randomUUID();
      doctorPublicIdentifier = randomUUID();
      await client.query(`INSERT INTO "DoctorProfile" ("id","userId","professionalTitle","specialization","licenseNumber","profileDescription","publicIdentifier","isProfilePublic","createdAt","updatedAt") VALUES ($1,$2,'Dr.','General Practice',$3,'A development-only public profile used for frontend acceptance testing.',$4,TRUE,now(),now())`, [doctorProfileId, userId, `DEV-${doctorProfileId}`, doctorPublicIdentifier]);
    } else {
      doctorProfileId = profile.rows[0].id;
      doctorPublicIdentifier = profile.rows[0].publicIdentifier;
      await client.query(`UPDATE "DoctorProfile" SET "professionalTitle"='Dr.', "specialization"='General Practice', "profileDescription"='A development-only public profile used for frontend acceptance testing.', "isProfilePublic"=TRUE, "updatedAt"=now() WHERE "id"=$1`, [doctorProfileId]);
    }

    let location = await client.query('SELECT "id", "publicIdentifier" FROM "PracticeLocation" WHERE "doctorProfileId"=$1 AND "name"=$2 LIMIT 1 FOR UPDATE', [doctorProfileId, LOCATION_NAME]);
    let locationId;
    let locationPublicIdentifier;
    if (location.rowCount === 0) {
      locationId = randomUUID();
      locationPublicIdentifier = randomUUID();
      await client.query(`INSERT INTO "PracticeLocation" ("id","doctorProfileId","publicIdentifier","lifecycleStatus","isBookingEnabled","name","addressLine1","cityMunicipality","province","postalCode","countryCode","timeZone","createdAt","updatedAt") VALUES ($1,$2,$3,'ACTIVE'::"PracticeLocationLifecycleStatus",TRUE,$4,'10 Main Street','Quezon City','Metro Manila','1100','PH','Asia/Manila',now(),now())`, [locationId, doctorProfileId, locationPublicIdentifier, LOCATION_NAME]);
    } else {
      locationId = location.rows[0].id;
      locationPublicIdentifier = location.rows[0].publicIdentifier;
      await client.query(`UPDATE "PracticeLocation" SET "lifecycleStatus"='ACTIVE'::"PracticeLocationLifecycleStatus", "isBookingEnabled"=TRUE, "addressLine1"='10 Main Street', "cityMunicipality"='Quezon City', "province"='Metro Manila', "postalCode"='1100', "countryCode"='PH', "timeZone"='Asia/Manila', "updatedAt"=now() WHERE "id"=$1`, [locationId]);
    }

    const service = await client.query('SELECT "id" FROM "PracticeLocationService" WHERE "practiceLocationId"=$1 AND "name"=$2 LIMIT 1 FOR UPDATE', [locationId, 'General Consultation']);
    if (service.rowCount === 0) {
      await client.query(`INSERT INTO "PracticeLocationService" ("id","practiceLocationId","name","durationMinutes","status","createdAt","updatedAt") VALUES ($1,$2,'General Consultation',30,'ACTIVE'::"ServiceAvailabilityStatus",now(),now())`, [randomUUID(), locationId]);
    }

    let financialAccount = await client.query('SELECT "id" FROM "DoctorFinancialAccount" WHERE "doctorUserId"=$1 LIMIT 1 FOR UPDATE', [userId]);
    let financialAccountId;
    if (financialAccount.rowCount === 0) {
      financialAccountId = randomUUID();
      await client.query('INSERT INTO "DoctorFinancialAccount" ("id","doctorUserId","createdAt","updatedAt") VALUES ($1,$2,now(),now())', [financialAccountId, userId]);
    } else {
      financialAccountId = financialAccount.rows[0].id;
    }

    const paidThrough = new Date(Date.now() + 30 * DAY_MS);
    const graceEndsAt = new Date(paidThrough.getTime() + 7 * DAY_MS);
    const entitlement = await client.query('SELECT "id" FROM "DoctorSubscriptionEntitlement" WHERE "doctorFinancialAccountId"=$1 LIMIT 1 FOR UPDATE', [financialAccountId]);
    if (entitlement.rowCount === 0) {
      await client.query('INSERT INTO "DoctorSubscriptionEntitlement" ("id","doctorFinancialAccountId","paidThrough","graceEndsAt","createdAt","updatedAt") VALUES ($1,$2,$3,$4,now(),now())', [randomUUID(), financialAccountId, paidThrough, graceEndsAt]);
    } else {
      await client.query('UPDATE "DoctorSubscriptionEntitlement" SET "paidThrough"=$2, "graceEndsAt"=$3, "updatedAt"=now() WHERE "doctorFinancialAccountId"=$1', [financialAccountId, paidThrough, graceEndsAt]);
    }

    await client.query('COMMIT');
    console.log('Development public acceptance fixture ready.');
    console.log(`Doctor page: http://localhost:5173/public/doctors/${doctorPublicIdentifier}`);
    console.log(`Practice location page: http://localhost:5173/public/practice-locations/${locationPublicIdentifier}`);
    console.log('Fixture state: ACTIVE Doctor, ACTIVE clinic, active Service, paid development entitlement.');
    console.log('This fixture contains development-only public data and no patient information.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
