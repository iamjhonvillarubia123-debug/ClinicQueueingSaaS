import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SessionManagementService } from '../auth/session-management.service';
import type { AuthenticatedUserContext } from '../auth/types/authenticated-request';

@Injectable()
export class DoctorAuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionManagementService,
  ) {}
  async list(
    actor: AuthenticatedUserContext,
    from: string,
    to: string,
    page: number,
  ) {
    const start = new Date(from + 'T00:00:00.000Z');
    const end = new Date(to + 'T00:00:00.000Z');
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(to) ||
      !Number.isFinite(start.getTime()) ||
      !Number.isFinite(end.getTime()) ||
      start.toISOString().slice(0, 10) !== from ||
      end.toISOString().slice(0, 10) !== to ||
      start > end ||
      end.getTime() - start.getTime() > 366 * 86400000 ||
      !Number.isInteger(page) ||
      page < 1 ||
      page > 10000
    ) {
      throw new BadRequestException(
        'Choose valid dates within a 366-day range and a valid page.',
      );
    }
    end.setUTCDate(end.getUTCDate() + 1);
    return this.prisma.$transaction(
      async (tx) => {
        await this.sessions.validateActor(tx, actor);
        // Only descriptive event fields are projected. No patient link, answer,
        // queue position, request fingerprint, token, or arbitrary JSON is read.
        const events = Prisma.sql`
        WITH events AS (
          SELECT 'configuration:' || a."id"::text AS id, a."practiceLocationId" AS clinic_id,
            a."actorUserId" AS actor_id, a."occurredAt" AS occurred_at,
            'Clinic configuration updated'::text AS title, 'Configuration'::text AS category
          FROM "PracticeLocationConfigurationAudit" a
          UNION ALL
          SELECT 'defaults:' || a."id"::text || ':' || t."id", t."practiceLocationId", a."actorUserId", a."occurredAt", 'Doctor defaults copied', 'Configuration'
          FROM "DoctorDefaultsApplyAudit" a JOIN "DoctorDefaultsApplyAuditTarget" t ON t."doctorDefaultsApplyAuditId" = a."id"
          UNION ALL
          SELECT 'staff:' || a."id", a."practiceLocationId", a."actorUserId", a."createdAt", 'Operating secretary changed', 'Staff'
          FROM "ClinicDayOperatingStaffAudit" a
          UNION ALL
          SELECT 'bundle-grant:' || b."id", s."practiceLocationId", b."grantedByUserId", b."grantedAt", 'Secretary authority granted: ' || replace(b."bundleType"::text, '_', ' '), 'Staff'
          FROM "PracticeStaffAuthorityBundle" b JOIN "PracticeStaff" s ON s."id" = b."practiceStaffId"
          UNION ALL
          SELECT 'bundle-revoke:' || b."id", s."practiceLocationId", b."revokedByUserId", b."revokedAt", 'Secretary authority revoked: ' || replace(b."bundleType"::text, '_', ' '), 'Staff'
          FROM "PracticeStaffAuthorityBundle" b JOIN "PracticeStaff" s ON s."id" = b."practiceStaffId" WHERE b."revokedAt" IS NOT NULL
          UNION ALL
          SELECT 'capability-grant:' || b."id", s."practiceLocationId", b."grantedByUserId", b."grantedAt", 'Secretary capability granted: ' || replace(b."capabilityType"::text, '_', ' '), 'Staff'
          FROM "PracticeStaffCapability" b JOIN "PracticeStaff" s ON s."id" = b."practiceStaffId"
          UNION ALL
          SELECT 'capability-revoke:' || b."id", s."practiceLocationId", b."revokedByUserId", b."revokedAt", 'Secretary capability revoked: ' || replace(b."capabilityType"::text, '_', ' '), 'Staff'
          FROM "PracticeStaffCapability" b JOIN "PracticeStaff" s ON s."id" = b."practiceStaffId" WHERE b."revokedAt" IS NOT NULL
          UNION ALL
          SELECT 'queue:' || q."id", q."practiceLocationId", q."actorUserId", q."createdAt", replace(q."type"::text, '_', ' '), 'Queue'
          FROM "QueueEvent" q
        ), scoped AS (
          SELECT e.id, e.occurred_at, e.title, e.category, e.actor_id,
            p."name" AS clinic, p."id" AS clinic_id,
            CASE WHEN u."accountStatus" = 'PERMANENTLY_CLOSED' THEN 'Closed account'
              ELSE NULLIF(concat_ws(' ', u."firstName", u."lastName"), '') END AS actor
          FROM events e JOIN "PracticeLocation" p ON p."id" = e.clinic_id
          JOIN "DoctorProfile" d ON d."id" = p."doctorProfileId"
          LEFT JOIN "User" u ON u."id" = e.actor_id
          WHERE d."userId" = ${actor.userId} AND e.occurred_at >= ${start} AND e.occurred_at < ${end}
          UNION ALL
          SELECT 'account:' || n."id", n."createdAt", n."title", 'Account', n."sourceActorUserId", COALESCE(p."name", 'Account'), n."practiceLocationId", NULL::text
          FROM "ApplicationNotification" n LEFT JOIN "PracticeLocation" p ON p."id" = n."practiceLocationId"
          WHERE n."recipientUserId" = ${actor.userId} AND n."notificationType" = 'ACCOUNT_ACTIVITY'
            AND n."createdAt" >= ${start} AND n."createdAt" < ${end}
        )`;
        const totals = await tx.$queryRaw<
          { total: bigint; clinics: bigint; actors: bigint }[]
        >(Prisma.sql`${events}
        SELECT count(*)::bigint AS total, count(DISTINCT clinic_id)::bigint AS clinics, count(DISTINCT actor_id)::bigint AS actors FROM scoped`);
        const items = await tx.$queryRaw<
          {
            id: string;
            occurredAt: Date;
            title: string;
            category: string;
            clinic: string;
            actor: string | null;
          }[]
        >(Prisma.sql`${events}
        SELECT id, occurred_at AS "occurredAt", title, category, clinic, actor FROM scoped ORDER BY occurred_at DESC, id DESC LIMIT 50 OFFSET ${(page - 1) * 50}`);
        return {
          items,
          page,
          pageSize: 50,
          total: Number(totals[0]?.total ?? 0),
          clinics: Number(totals[0]?.clinics ?? 0),
          actors: Number(totals[0]?.actors ?? 0),
          timeZone: 'UTC',
          coverage:
            'Recorded clinic configuration, defaults copying, secretary authority changes, queue events, and retained account notices. Older events not recorded by the system cannot be reconstructed. Patient details are excluded.',
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
