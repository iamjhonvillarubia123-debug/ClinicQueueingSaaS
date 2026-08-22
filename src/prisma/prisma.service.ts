import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is not defined.');
    }

    // Prisma ORM 7 uses the pg driver adapter. Pin every application database
    // session to UTC so JavaScript Date values round-trip as absolute instants
    // regardless of the PostgreSQL server/session default time zone.
    const adapter = new PrismaPg({
      connectionString,
      options: '-c timezone=UTC',
    });

    super({ adapter });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();

    const rows = await this.$queryRaw<Array<{ timeZone: string }>>`
      SELECT current_setting('TimeZone') AS "timeZone"
    `;
    if (rows[0]?.timeZone !== 'UTC') {
      throw new Error(
        `Prisma PostgreSQL session must use UTC; received ${rows[0]?.timeZone ?? 'unknown'}.`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
