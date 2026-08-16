import { randomUUID } from 'crypto';
import {
  AppointmentStatus,
  BookingQuestionType,
  UserRole,
  WaitingPlacementType,
} from './../generated/prisma/client';
import { DoctorDefaultsApplyService } from './../src/doctor/doctor-defaults-apply.service';
import { PrismaService } from './../src/prisma/prisma.service';

describe('BookingQuestion historical meaning protection (e2e)', () => {
  let prisma: PrismaService;
  let defaultsApply: DoctorDefaultsApplyService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    defaultsApply = new DoctorDefaultsApplyService(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function createFixture() {
    const scope = randomUUID();
    const shortScope = scope.slice(0, 12);
    const user = await prisma.user.create({
      data: {
        email: `m4s2a-${scope}@example.test`,
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
        licenseNumber: `M4S2A-${shortScope}`,
      },
    });
    const location = await prisma.practiceLocation.create({
      data: {
        doctorProfileId: doctor.id,
        name: `M4S2A Clinic ${shortScope}`,
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

  async function createDraftAnswer(
    fixture: Awaited<ReturnType<typeof createFixture>>,
  ) {
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
    return draft;
  }

  async function cleanup(fixture: Awaited<ReturnType<typeof createFixture>>) {
    await prisma.$executeRawUnsafe(`
      DELETE FROM "DoctorDefaultsApplyAuditItem"
      WHERE "doctorDefaultsApplyAuditTargetId" IN (
        SELECT t."id"
        FROM "DoctorDefaultsApplyAuditTarget" t
        WHERE t."practiceLocationId" = '${fixture.location.id}'
      )
    `);
    await prisma.$executeRawUnsafe(`
      DELETE FROM "DoctorDefaultsApplyAuditTarget"
      WHERE "practiceLocationId" = '${fixture.location.id}'
    `);
    await prisma.$executeRawUnsafe(`
      DELETE FROM "DoctorDefaultsApplyAudit"
      WHERE "actorUserId" = '${fixture.user.id}'
    `);
    await prisma.commandIdempotency.deleteMany({
      where: { actorUserId: fixture.user.id },
    });
    await prisma.appointmentAnswer.deleteMany({
      where: { bookingQuestion: { practiceLocationId: fixture.location.id } },
    });
    await prisma.bookingDraftAnswer.deleteMany({
      where: { bookingQuestion: { practiceLocationId: fixture.location.id } },
    });
    await prisma.appointment.deleteMany({
      where: { practiceLocationId: fixture.location.id },
    });
    await prisma.bookingDraft.deleteMany({
      where: { practiceLocationId: fixture.location.id },
    });
    await prisma.bookingQuestion.deleteMany({
      where: { practiceLocationId: fixture.location.id },
    });
    await prisma.doctorBookingQuestionTemplate.deleteMany({
      where: { doctorProfileId: fixture.doctor.id },
    });
    await prisma.practiceLocation.delete({
      where: { id: fixture.location.id },
    });
    await prisma.doctorProfile.delete({ where: { id: fixture.doctor.id } });
    await prisma.user.delete({ where: { id: fixture.user.id } });
  }

  it('permits changing protected meaning before any answer history exists', async () => {
    const fixture = await createFixture();
    try {
      const changed = await prisma.bookingQuestion.update({
        where: { id: fixture.question.id },
        data: {
          questionText: 'Changed before history?',
          type: BookingQuestionType.BOOLEAN,
        },
      });
      expect(changed.questionText).toBe('Changed before history?');
      expect(changed.type).toBe(BookingQuestionType.BOOLEAN);
    } finally {
      await cleanup(fixture);
    }
  });

  it('blocks type changes after BookingDraftAnswer history exists', async () => {
    const fixture = await createFixture();
    try {
      await createDraftAnswer(fixture);

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

  it('blocks question text changes after BookingDraftAnswer history exists', async () => {
    const fixture = await createFixture();
    try {
      await createDraftAnswer(fixture);

      await expect(
        prisma.bookingQuestion.update({
          where: { id: fixture.question.id },
          data: { questionText: 'Rewritten historical question?' },
        }),
      ).rejects.toBeDefined();

      const preserved = await prisma.bookingQuestion.findUniqueOrThrow({
        where: { id: fixture.question.id },
        select: { questionText: true },
      });
      expect(preserved.questionText).toBe('Historical question?');
    } finally {
      await cleanup(fixture);
    }
  });

  it('blocks select option meaning changes after answer history exists', async () => {
    const fixture = await createFixture();
    try {
      await prisma.bookingQuestion.update({
        where: { id: fixture.question.id },
        data: {
          type: BookingQuestionType.SINGLE_SELECT,
          selectOptions: [
            { value: 'a', label: 'Option A' },
            { value: 'b', label: 'Option B' },
          ],
        },
      });
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
          selectedOptionValue: 'a',
        },
      });

      await expect(
        prisma.bookingQuestion.update({
          where: { id: fixture.question.id },
          data: {
            selectOptions: [
              { value: 'a', label: 'Option A' },
              { value: 'c', label: 'Option C' },
            ],
          },
        }),
      ).rejects.toBeDefined();
    } finally {
      await cleanup(fixture);
    }
  });

  it('allows non-meaning display changes after answer history exists', async () => {
    const fixture = await createFixture();
    try {
      await createDraftAnswer(fixture);
      const changed = await prisma.bookingQuestion.update({
        where: { id: fixture.question.id },
        data: { displayOrder: 7, helpText: 'Updated operational guidance' },
      });
      expect(changed.displayOrder).toBe(7);
      expect(changed.helpText).toBe('Updated operational guidance');
    } finally {
      await cleanup(fixture);
    }
  });

  it('blocks protected meaning changes after AppointmentAnswer history exists', async () => {
    const fixture = await createFixture();
    try {
      const appointment = await prisma.appointment.create({
        data: {
          bookingReference: `AP-${fixture.scope}`,
          practiceLocationId: fixture.location.id,
          serviceDate: new Date('2026-08-17T00:00:00.000Z'),
          estimatedServiceMinutes: 30,
          queueNumber: 1,
          status: AppointmentStatus.WAITING,
          servingOrderKey: '1',
          waitingPlacementType: WaitingPlacementType.ORDINARY,
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
          data: {
            questionText: 'Changed durable meaning?',
            type: BookingQuestionType.BOOLEAN,
          },
        }),
      ).rejects.toBeDefined();

      const preserved = await prisma.bookingQuestion.findUniqueOrThrow({
        where: { id: fixture.question.id },
        select: { questionText: true, type: true },
      });
      expect(preserved.questionText).toBe('Historical question?');
      expect(preserved.type).toBe(BookingQuestionType.TEXT);
    } finally {
      await cleanup(fixture);
    }
  });

  it('re-Apply preserves answered template-derived question history and creates the refreshed replacement', async () => {
    const fixture = await createFixture();
    try {
      const template = await prisma.doctorBookingQuestionTemplate.create({
        data: {
          doctorProfileId: fixture.doctor.id,
          questionText: 'Historical question?',
          type: BookingQuestionType.TEXT,
          displayOrder: 0,
          isActive: true,
        },
      });
      await prisma.$executeRaw`
        UPDATE "BookingQuestion"
        SET "sourceDoctorBookingQuestionTemplateId" = ${template.id}
        WHERE "id" = ${fixture.question.id}
      `;
      await createDraftAnswer(fixture);
      await prisma.doctorBookingQuestionTemplate.update({
        where: { id: template.id },
        data: { questionText: 'Refreshed template question?' },
      });

      await defaultsApply.apply(
        fixture.user.id,
        { practiceLocationIds: [fixture.location.id] },
        `m4s2a-${fixture.scope}`,
      );

      const questions = await prisma.bookingQuestion.findMany({
        where: { practiceLocationId: fixture.location.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(questions).toHaveLength(2);
      const historical = questions.find(
        (question) => question.id === fixture.question.id,
      );
      const replacement = questions.find(
        (question) => question.id !== fixture.question.id,
      );
      expect(historical).toMatchObject({
        questionText: 'Historical question?',
        isActive: false,
      });
      expect(replacement).toMatchObject({
        questionText: 'Refreshed template question?',
        isActive: true,
        displayOrder: 0,
      });
      const replacementSource = await prisma.$queryRaw<
        Array<{ sourceDoctorBookingQuestionTemplateId: string | null }>
      >`
        SELECT "sourceDoctorBookingQuestionTemplateId"
        FROM "BookingQuestion"
        WHERE "id" = ${replacement!.id}
      `;
      expect(replacementSource[0]?.sourceDoctorBookingQuestionTemplateId).toBe(
        template.id,
      );
    } finally {
      await cleanup(fixture);
    }
  });
});
