import { randomUUID } from 'crypto';
import { BookingQuestionType, UserRole } from './../generated/prisma/client';
import { PrismaService } from './../src/prisma/prisma.service';

describe('BookingQuestion historical type protection (e2e)', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function createFixture() {
    const scope = randomUUID();
    const shortScope = scope.slice(0, 12);
    const user = await prisma.user.create({
      data: {
        email: `m3s12-${scope}@example.test`,
        firstName: 'History',
        lastName: 'Guard',
        mobileNumber: `0917${scope.replaceAll('-', '').slice(0, 7)}`,
        passwordHash: 'e2e-only-not-a-real-password-hash',
        role: UserRole.DOCTOR,
      },
    });
    const doctor = await prisma.doctorProfile.create({
      data: {
        userId: user.id,
        professionalTitle: 'Dr.',
        specialization: 'Testing',
        licenseNumber: `M3S12-${shortScope}`,
      },
    });
    const location = await prisma.practiceLocation.create({
      data: {
        doctorProfileId: doctor.id,
        name: `M3S12 Clinic ${shortScope}`,
        countryCode: 'PH',
        timeZone: 'Asia/Manila',
      },
    });
    const question = await prisma.bookingQuestion.create({
      data: {
        practiceLocationId: location.id,
        questionText: 'Historical question?',
        type: BookingQuestionType.TEXT,
        displayOrder: 0,
      },
    });

    return { user, doctor, location, question, scope };
  }

  async function cleanup(fixture: Awaited<ReturnType<typeof createFixture>>) {
    await prisma.appointmentAnswer.deleteMany({
      where: { bookingQuestionId: fixture.question.id },
    });
    await prisma.bookingDraftAnswer.deleteMany({
      where: { bookingQuestionId: fixture.question.id },
    });
    await prisma.appointment.deleteMany({
      where: { practiceLocationId: fixture.location.id },
    });
    await prisma.bookingDraft.deleteMany({
      where: { practiceLocationId: fixture.location.id },
    });
    await prisma.bookingQuestion.delete({ where: { id: fixture.question.id } });
    await prisma.practiceLocation.delete({
      where: { id: fixture.location.id },
    });
    await prisma.doctorProfile.delete({ where: { id: fixture.doctor.id } });
    await prisma.user.delete({ where: { id: fixture.user.id } });
  }

  it('permits changing type before any answer history exists', async () => {
    const fixture = await createFixture();
    try {
      const changed = await prisma.bookingQuestion.update({
        where: { id: fixture.question.id },
        data: { type: BookingQuestionType.BOOLEAN },
      });
      expect(changed.type).toBe(BookingQuestionType.BOOLEAN);
    } finally {
      await cleanup(fixture);
    }
  });

  it('blocks type changes after BookingDraftAnswer history exists', async () => {
    const fixture = await createFixture();
    try {
      const draft = await prisma.bookingDraft.create({
        data: {
          bookingReference: `BD-${fixture.scope.slice(0, 12)}`,
          practiceLocationId: fixture.location.id,
          serviceDate: new Date('2026-08-17T00:00:00.000Z'),
          expiresAt: new Date('2026-08-17T01:00:00.000Z'),
        },
      });
      await prisma.bookingDraftAnswer.create({
        data: {
          bookingDraftId: draft.id,
          bookingQuestionId: fixture.question.id,
          answerText: 'temporary answer',
        },
      });

      await expect(
        prisma.bookingQuestion.update({
          where: { id: fixture.question.id },
          data: { type: BookingQuestionType.BOOLEAN },
        }),
      ).rejects.toBeDefined();

      const preserved = await prisma.bookingQuestion.findUniqueOrThrow({
        where: { id: fixture.question.id },
        select: { type: true },
      });
      expect(preserved.type).toBe(BookingQuestionType.TEXT);
    } finally {
      await cleanup(fixture);
    }
  });

  it('blocks type changes after AppointmentAnswer history exists', async () => {
    const fixture = await createFixture();
    try {
      const appointment = await prisma.appointment.create({
        data: {
          bookingReference: `AP-${fixture.scope}`,
          practiceLocationId: fixture.location.id,
          serviceDate: new Date('2026-08-17T00:00:00.000Z'),
          estimatedServiceMinutes: 30,
          queueNumber: 1,
        },
      });
      await prisma.appointmentAnswer.create({
        data: {
          appointmentId: appointment.id,
          bookingQuestionId: fixture.question.id,
          answerText: 'durable answer',
        },
      });

      await expect(
        prisma.bookingQuestion.update({
          where: { id: fixture.question.id },
          data: { type: BookingQuestionType.BOOLEAN },
        }),
      ).rejects.toBeDefined();

      const preserved = await prisma.bookingQuestion.findUniqueOrThrow({
        where: { id: fixture.question.id },
        select: { type: true },
      });
      expect(preserved.type).toBe(BookingQuestionType.TEXT);
    } finally {
      await cleanup(fixture);
    }
  });
});
