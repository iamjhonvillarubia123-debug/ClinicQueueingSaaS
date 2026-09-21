require('dotenv').config({ quiet: true });
const { Client } = require('pg');
const { randomUUID } = require('crypto');
const email = 'aaadoctor@gmail.com';
const prefix = 'DEMO30-';
const weekdays = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'];
async function main() {
  const url = new URL(process.env.DATABASE_URL);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || process.env.NODE_ENV === 'production') throw Error('This fixture is restricted to the local development database.');
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    await c.query('BEGIN');
    const { rows: clinics } = await c.query(`SELECT l.*, u.id AS "userId" FROM "PracticeLocation" l JOIN "DoctorProfile" d ON d.id=l."doctorProfileId" JOIN "User" u ON u.id=d."userId" WHERE lower(u.email)=lower($1) AND l."lifecycleStatus"='ACTIVE'`, [email]);
    if (!clinics.length) throw Error('No active clinic found for the requested account.');
    const summaries = [];
    for (const clinic of clinics) {
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: clinic.timeZone || 'Asia/Manila' }).format(new Date());
      const { rows: schedules } = await c.query('SELECT *, "opensAtLocal"::text AS opens, "closesAtLocal"::text AS closes FROM "PracticeSchedule" WHERE "practiceLocationId"=$1', [clinic.id]);
      const { rows: services } = await c.query(`SELECT * FROM "PracticeLocationService" WHERE "practiceLocationId"=$1 AND status='ACTIVE' ORDER BY name`, [clinic.id]);
      let inserted = 0, populatedDays = 0;
      for (let day = 0; day < 30; day++) {
        const date = new Date(today + 'T00:00:00Z'); date.setUTCDate(date.getUTCDate() + day);
        const dateString = date.toISOString().slice(0,10);
        const { rows: exceptions } = await c.query('SELECT *, "opensAtLocal"::text AS opens, "closesAtLocal"::text AS closes FROM "ScheduleException" WHERE "practiceLocationId"=$1 AND "serviceDate"=$2', [clinic.id, dateString]);
        const schedule = exceptions[0] || schedules.find(s => s.weekday === weekdays[date.getUTCDay()]);
        if (!schedule?.isOpen) continue;
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`QUEUE_COUNTER:${clinic.id}:${dateString}`]);
        const { rows: existing } = await c.query('SELECT count(*)::int AS count, coalesce(max("queueNumber"),0)::int AS max, coalesce(sum("estimatedServiceMinutes"),0)::int AS minutes FROM "Appointment" WHERE "practiceLocationId"=$1 AND "serviceDate"=$2', [clinic.id, dateString]);
        const { rows: counters } = await c.query('SELECT "lastAllocatedNumber" FROM "QueueCounter" WHERE "practiceLocationId"=$1 AND "serviceDate"=$2', [clinic.id, dateString]);
        let queue = Math.max(existing[0].max, counters[0]?.lastAllocatedNumber || 0);
        const minutes = time => Number(time.slice(0,2))*60 + Number(time.slice(3,5));
        let capacity = Math.max(0, minutes(schedule.closes) - minutes(schedule.opens) - existing[0].minutes);
        const target = 8 + (day * 7) % 9;
        let daily = 0;
        for (let i = 0; i < target; i++) {
          const reference = `${prefix}${clinic.id.slice(0,8)}-${dateString}-${i+1}`;
          if ((await c.query('SELECT id FROM "Appointment" WHERE "bookingReference"=$1', [reference])).rowCount) continue;
          const service = services.length ? services[(day+i)%services.length] : null;
          const duration = service?.durationMinutes || 30;
          if (capacity < duration) break;
          const id = randomUUID(); queue++;
          const first = ['Maria','Jose','Ana','Luis','Angelica','Carlo','Sofia','Miguel'][i%8];
          const last = ['Santos','Reyes','Cruz','Garcia','Ramos','Mendoza'][(day+i)%6];
          await c.query(`INSERT INTO "Appointment" (id,"bookingReference","practiceLocationId","serviceDate","estimatedServiceMinutes","queueNumber",status,"servingOrderKey","waitingPlacementType","firstName","lastName","createdByUserId","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,'WAITING',$6::integer::numeric,'ORDINARY',$7,$8,$9,now(),now())`, [id,reference,clinic.id,dateString,duration,queue,first+' (Demo)',last,clinic.userId]);
          if (service) await c.query(`INSERT INTO "AppointmentBookedService" (id,"appointmentId","practiceLocationServiceId","serviceNameSnapshot","durationMinutesSnapshot","createdAt") VALUES ($1,$2,$3,$4,$5,now())`, [randomUUID(),id,service.id,service.name,duration]);
          capacity-=duration; daily++; inserted++;
        }
        await c.query(`INSERT INTO "QueueCounter" (id,"practiceLocationId","serviceDate","lastAllocatedNumber","createdAt","updatedAt") VALUES ($1,$2,$3,$4,now(),now()) ON CONFLICT ("practiceLocationId","serviceDate") DO UPDATE SET "lastAllocatedNumber"=EXCLUDED."lastAllocatedNumber","updatedAt"=now()`, [randomUUID(),clinic.id,dateString,queue]);
        if(daily) populatedDays++;
      }
      summaries.push({clinic:clinic.name,from:today,inserted,populatedDays});
    }
    await c.query('COMMIT'); console.log(JSON.stringify(summaries));
  } catch(error) { await c.query('ROLLBACK'); throw error; } finally { await c.end(); }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});


