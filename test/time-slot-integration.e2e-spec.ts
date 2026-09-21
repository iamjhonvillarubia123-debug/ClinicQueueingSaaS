import { BookingGroupMemberCancellationService } from '../src/booking/booking-group-member-cancellation.service';
import { StaffAppointmentService } from '../src/booking/staff-appointment.service';
import { StaffReinsertService } from '../src/queue/staff-reinsert.service';
import { AppointmentErasureService } from '../src/privacy-retention/appointment-erasure.service';
import { DoctorService } from '../src/doctor/doctor.service';
import { DoctorDefaultsApplyService } from '../src/doctor/doctor-defaults-apply.service';
import { SecretarySettingsDraftScheduleService } from '../src/secretary-settings-draft/secretary-settings-draft-schedule.service';
import { SecretarySettingsDraftApprovalService } from '../src/secretary-settings-draft/secretary-settings-draft-approval.service';
import { PublicBookingEntryService } from '../src/booking/public-booking-entry.service';
import { StartClinicService } from '../src/queue/start-clinic.service';
import { NextPatientService } from '../src/queue/next-patient.service';
import { NextPatientOutcome } from '../src/queue/dto/next-patient.dto';
import { ImHereService } from '../src/queue/im-here.service';
import { Test } from '@nestjs/testing';
import { randomInt, randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { BookingService } from '../src/booking/booking.service';
import { OtpGenerator } from '../src/otp/otp.generator';
import { IndividualBookingConfirmationService } from '../src/booking/individual-booking-confirmation.service';
import { MultiPersonBookingConfirmationService } from '../src/booking/multi-person-booking-confirmation.service';
import { ReservationManagementService } from '../src/booking/reservation-management.service';
import { BookingDraftEditService } from '../src/booking/booking-draft-edit.service';
import { applyAppointmentModeProposal } from '../src/schedule/appointment-mode.configuration';

describe('Time-Slot shared backend integration (real PostgreSQL)', () => {
  let module: Awaited<
    ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>
  >;
  let db: PrismaService;
  const environment = { ...process.env };
  beforeAll(async () => {
    Object.assign(process.env, {
      JWT_SECRET: 'time-slot-test-only-secret',
      PUBLIC_APP_BASE_URL: 'https://example.test',
      MOBILE_ENCRYPTION_KEY_V1: Buffer.alloc(32, 41).toString('base64'),
      MOBILE_LOOKUP_HMAC_KEY_V1: Buffer.alloc(32, 42).toString('base64'),
      MOBILE_ENCRYPTION_ACTIVE_KEY_ID: 'ts-mobile',
      MOBILE_LOOKUP_ACTIVE_KEY_ID: 'ts-lookup',
      OTP_HMAC_KEY_V1: Buffer.alloc(32, 43).toString('base64'),
      OTP_HMAC_ACTIVE_KEY_ID: 'ts-otp',
    });
    module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OtpGenerator)
      .useValue({ generate: () => '123456' })
      .compile();
    db = module.get(PrismaService);
    await db.$connect();
  });
  afterAll(async () => {
    await module?.close();
    for (const key of Object.keys(process.env))
      if (!(key in environment)) delete process.env[key];
    Object.assign(process.env, environment);
  });

  async function fixture(maximum: number | null = null) {
    const suffix = randomUUID().slice(0, 8);
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + 4);
    date.setUTCHours(0, 0, 0, 0);
    const dateText = date.toISOString().slice(0, 10);
    const user = await db.user.create({
      data: {
        email: `slot-${randomUUID()}@example.test`,
        firstName: 'Slot',
        lastName: 'Test',
        passwordHash: 'test-only',
        role: 'DOCTOR',
        accountStatus: 'ACTIVE',
        administrativeRestrictionStatus: 'NONE',
      },
    });
    const doctor = await db.doctorProfile.create({
      data: {
        userId: user.id,
        isProfilePublic: true,
        professionalTitle: 'Dr.',
        specialization: 'Test',
        licenseNumber: suffix,
      },
    });
    await db.doctorAccountSettings.create({
      data: {
        doctorProfileId: doctor.id,
        allowOnlineBooking: true,
        maximumAdvanceBookingDays: 30,
        maximumEstimatedServiceMinutesPerPatient: 60,
      },
    });
    const finance = await db.doctorFinancialAccount.create({
      data: { doctorUserId: user.id },
    });
    await db.doctorSubscriptionEntitlement.create({
      data: {
        doctorFinancialAccountId: finance.id,
        paidThrough: new Date(date.getTime() + 40 * 86400000),
        graceEndsAt: new Date(date.getTime() + 47 * 86400000),
      },
    });
    const clinic = await db.practiceLocation.create({
      data: {
        doctorProfileId: doctor.id,
        name: 'Time Slot Test',
        timeZone: 'Asia/Manila',
        countryCode: 'PH',
        lifecycleStatus: 'ACTIVE',
      },
    });
    await db.scheduleException.create({
      data: {
        practiceLocationId: clinic.id,
        serviceDate: date,
        isOpen: true,
        opensAtLocal: new Date('1970-01-01T08:00:00Z'),
        closesAtLocal: new Date('1970-01-01T17:00:00Z'),
        maximumOperatingUntilLocal: new Date('1970-01-01T18:00:00Z'),
      },
    });
    await db.$transaction((tx) =>
      applyAppointmentModeProposal(
        tx,
        clinic.id,
        {
          appointmentMode: 'TIME_SLOT_MODE',
          effectiveServiceDate: dateText,
          maximumBookableMinutes: maximum,
          protectedPeriods: [],
        },
        user.id,
        null,
      ),
    );
    const services = await Promise.all(
      [30, 90, 10].map((durationMinutes) =>
        db.practiceLocationService.create({
          data: {
            practiceLocationId: clinic.id,
            name: `Service ${durationMinutes}`,
            durationMinutes,
            status: 'ACTIVE',
          },
        }),
      ),
    );
    return {
      user,
      doctor,
      clinic,
      date,
      dateText,
      services,
      at: (hour: number, minute = 0) =>
        new Date(
          `${dateText}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+08:00`,
        ),
    };
  }
  async function draft(
    f: Awaited<ReturnType<typeof fixture>>,
    hour = 9,
    groupDurations?: number[],
    fragmented?: string[],
  ) {
    const mobileNumber = `0917${String(randomInt(0, 10000000)).padStart(7, '0')}`;
    const payload = {
      practiceLocationId: f.clinic.id,
      mode: groupDurations
        ? ('MULTI_PERSON' as const)
        : ('INDIVIDUAL' as const),
      firstName: 'Test',
      lastName: 'Patient',
      existingPatientResponse: 'NO' as const,
      mobileNumber,
      serviceDate: f.dateText,
      privacyNoticeVersion: 'ts-v1',
      privacyNoticeAcknowledged: true,
      selectedServiceIds: [f.services[0].id],
      reservationAt: f.at(hour).toISOString(),
      fragmentedReservations: !!fragmented,
      members: groupDurations?.map((duration, i) => ({
        firstName: `Member${i}`,
        lastName: 'Test',
        existingPatientResponse: 'NO' as const,
        selectedServiceIds: [
          f.services.find((s) => s.durationMinutes === duration)!.id,
        ],
        reservationAt: fragmented?.[i],
      })),
    };
    const result = await module.get(BookingService).createDraft(payload);
    await db.otpVerification.updateMany({
      where: { bookingDraftId: result.bookingDraft.id, purpose: 'BOOKING' },
      data: { verifiedAt: new Date() },
    });
    return { result, payload };
  }
  const confirm = (id: string, key = randomUUID()) =>
    module
      .get(IndividualBookingConfirmationService)
      .confirm({ bookingDraftId: id, idempotencyKey: key });

  it('only one simultaneous public claimant gets a colliding slot; losing OTP remains verified', async () => {
    const f = await fixture();
    const a = await draft(f);
    const b = await draft(f);
    const results = await Promise.allSettled([
      confirm(a.result.bookingDraft.id),
      confirm(b.result.bookingDraft.id),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      await db.appointment.count({
        where: { practiceLocationId: f.clinic.id },
      }),
    ).toBe(1);
    const loser = results[0].status === 'rejected' ? a : b;
    const otp = await db.otpVerification.findFirstOrThrow({
      where: {
        bookingDraftId: loser.result.bookingDraft.id,
        purpose: 'BOOKING',
      },
    });
    expect(otp.verifiedAt).not.toBeNull();
    expect(otp.consumedAt).toBeNull();
    expect(otp.invalidatedAt).toBeNull();
  });
  it('replays a protected confirmation without another appointment', async () => {
    const f = await fixture();
    const d = await draft(f);
    const key = randomUUID();
    const results = await Promise.all([
      confirm(d.result.bookingDraft.id, key),
      confirm(d.result.bookingDraft.id, key),
    ]);
    expect(results.map((r) => r.replayed).sort()).toEqual([false, true]);
    expect(
      await db.appointment.count({
        where: { practiceLocationId: f.clinic.id },
      }),
    ).toBe(1);
  });
  it.each([
    [[90, 90, 90], 180],
    [[90, 10, 30], 100],
  ])(
    'keeps actual group durations %j while scheduling %i minutes',
    async (durations, total) => {
      const f = await fixture(60);
      const d = await draft(f, 9, durations);
      await module.get(MultiPersonBookingConfirmationService).confirm({
        bookingDraftId: d.result.bookingDraft.id,
        idempotencyKey: randomUUID(),
      });
      const rows = await db.appointment.findMany({
        where: { practiceLocationId: f.clinic.id },
        orderBy: { queueNumber: 'asc' },
      });
      expect(rows.map((a) => a.estimatedServiceMinutes)).toEqual(durations);
      expect(rows.reduce((n, a) => n + a.schedulingAllotmentMinutes!, 0)).toBe(
        total,
      );
      expect(new Set(rows.map((a) => a.reservationAt!.getTime())).size).toBe(3);
      expect(new Set(rows.map((a) => a.bookingGroupId)).size).toBe(1);
      expect(
        await db.appointmentReservationEvent.count({
          where: { appointmentId: { in: rows.map((a) => a.id) } },
        }),
      ).toBe(3);
    },
  );
  it('rolls back a colliding fragmented group without consuming any member or OTP', async () => {
    const f = await fixture();
    const d = await draft(
      f,
      9,
      [30, 30],
      [f.at(9).toISOString(), f.at(9).toISOString()],
    );
    await expect(
      module.get(MultiPersonBookingConfirmationService).confirm({
        bookingDraftId: d.result.bookingDraft.id,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toThrow();
    expect(
      await db.appointment.count({
        where: { practiceLocationId: f.clinic.id },
      }),
    ).toBe(0);
    expect(
      await db.bookingGroup.count({
        where: { practiceLocationId: f.clinic.id },
      }),
    ).toBe(0);
    expect(
      (
        await db.bookingDraft.findUniqueOrThrow({
          where: { id: d.result.bookingDraft.id },
        })
      ).status,
    ).toBe('PENDING_OTP');
  });
  it('commits a fragmented group at separate times under one BookingGroup', async () => {
    const f = await fixture();
    const d = await draft(
      f,
      9,
      [30, 30],
      [f.at(9).toISOString(), f.at(14).toISOString()],
    );
    await module.get(MultiPersonBookingConfirmationService).confirm({
      bookingDraftId: d.result.bookingDraft.id,
      idempotencyKey: randomUUID(),
    });
    const rows = await db.appointment.findMany({
      where: { practiceLocationId: f.clinic.id },
      orderBy: { queueNumber: 'asc' },
    });
    expect(rows.map((a) => a.reservationAt)).toEqual([f.at(9), f.at(14)]);
    expect(new Set(rows.map((a) => a.bookingGroupId)).size).toBe(1);
  });
  it('preserves an existing reservation on failed reschedule, then records a successful change without changing its queue number', async () => {
    const f = await fixture();
    const a = await draft(f, 9);
    const b = await draft(f, 10);
    await confirm(a.result.bookingDraft.id);
    await confirm(b.result.bookingDraft.id);
    const original = await db.appointment.findFirstOrThrow({
      where: { practiceLocationId: f.clinic.id, reservationAt: f.at(9) },
    });
    const management = module.get(ReservationManagementService);
    await expect(
      management.execute(
        { userId: f.user.id },
        original.id,
        'RESCHEDULE',
        randomUUID(),
        f.at(10).toISOString(),
      ),
    ).rejects.toThrow();
    expect(
      (await db.appointment.findUniqueOrThrow({ where: { id: original.id } }))
        .reservationAt,
    ).toEqual(f.at(9));
    await management.execute(
      { userId: f.user.id },
      original.id,
      'RESCHEDULE',
      randomUUID(),
      f.at(11).toISOString(),
    );
    const moved = await db.appointment.findUniqueOrThrow({
      where: { id: original.id },
    });
    expect(moved.queueNumber).toBe(original.queueNumber);
    expect(moved.originalReservationAt).toEqual(f.at(9));
    expect(moved.reservationAt).toEqual(f.at(11));
    const event = await db.appointmentReservationEvent.findFirstOrThrow({
      where: { appointmentId: original.id, action: 'RESCHEDULE' },
    });
    expect(event.actorUserId).toBe(f.user.id);
  });
  it('allows an explicitly confirmed staff overlap, audits it, and blocks mode conversion of a populated date', async () => {
    const f = await fixture();
    const a = await draft(f, 9);
    const b = await draft(f, 10);
    await confirm(a.result.bookingDraft.id);
    await confirm(b.result.bookingDraft.id);
    const original = await db.appointment.findFirstOrThrow({
      where: { practiceLocationId: f.clinic.id, reservationAt: f.at(9) },
    });
    await module
      .get(ReservationManagementService)
      .execute(
        { userId: f.user.id },
        original.id,
        'RESCHEDULE',
        randomUUID(),
        f.at(10).toISOString(),
        true,
      );
    expect(
      await db.appointment.count({
        where: { practiceLocationId: f.clinic.id, reservationAt: f.at(10) },
      }),
    ).toBe(2);
    expect(
      (
        await db.appointmentReservationEvent.findFirstOrThrow({
          where: { appointmentId: original.id, action: 'RESCHEDULE' },
        })
      ).availabilityOverride,
    ).toBe(true);
    await expect(
      db.$transaction((tx) =>
        applyAppointmentModeProposal(
          tx,
          f.clinic.id,
          {
            appointmentMode: 'QUEUE_MODE',
            effectiveServiceDate: f.dateText,
            maximumBookableMinutes: null,
            protectedPeriods: [],
          },
          f.user.id,
          null,
        ),
      ),
    ).rejects.toThrow();
    await expect(
      db.appointment.update({
        where: { id: original.id },
        data: { appointmentMode: 'QUEUE_MODE' },
      }),
    ).rejects.toThrow();
  });
  it('reselects a lost slot with the same verified OTP and original expiry', async () => {
    const f = await fixture();
    const winner = await draft(f, 9);
    const loser = await draft(f, 9);
    await confirm(winner.result.bookingDraft.id);
    await expect(confirm(loser.result.bookingDraft.id)).rejects.toThrow();
    const before = await db.otpVerification.findFirstOrThrow({
      where: {
        bookingDraftId: loser.result.bookingDraft.id,
        purpose: 'BOOKING',
      },
    });
    await module
      .get(BookingDraftEditService)
      .replaceDraft(loser.result.bookingDraft.id, {
        ...loser.payload,
        draftControlToken: loser.result.draftControlToken,
        continueVerifiedTimeSlot: true,
        reservationAt: f.at(11).toISOString(),
      });
    const after = await db.otpVerification.findUniqueOrThrow({
      where: { id: before.id },
    });
    expect(after.verifiedAt).toEqual(before.verifiedAt);
    expect(after.expiresAt).toEqual(before.expiresAt);
    expect(after.invalidatedAt).toBeNull();
    await confirm(loser.result.bookingDraft.id);
    expect(
      await db.appointment.count({
        where: { practiceLocationId: f.clinic.id },
      }),
    ).toBe(2);
  });

  it('does not preserve verified OTP when patient identity changes', async () => {
    const f = await fixture();
    const d = await draft(f);
    await expect(
      module
        .get(BookingDraftEditService)
        .replaceDraft(d.result.bookingDraft.id, {
          ...d.payload,
          firstName: 'Different',
          draftControlToken: d.result.draftControlToken,
          continueVerifiedTimeSlot: true,
          reservationAt: f.at(11).toISOString(),
        }),
    ).rejects.toThrow();
    expect(
      (
        await db.bookingDraft.findUniqueOrThrow({
          where: { id: d.result.bookingDraft.id },
        })
      ).firstName,
    ).toBe('Test');
  });

  it('rejects an individual actual duration above the clinic maximum without consuming the draft', async () => {
    const f = await fixture(60);
    const d = await draft(f);
    await module
      .get(BookingDraftEditService)
      .replaceDraft(d.result.bookingDraft.id, {
        ...d.payload,
        selectedServiceIds: [f.services[1].id],
        draftControlToken: d.result.draftControlToken,
        continueVerifiedTimeSlot: true,
      });
    await expect(confirm(d.result.bookingDraft.id)).rejects.toThrow();
    expect(
      await db.appointment.count({
        where: { practiceLocationId: f.clinic.id },
      }),
    ).toBe(0);
    expect(
      (
        await db.otpVerification.findFirstOrThrow({
          where: {
            bookingDraftId: d.result.bookingDraft.id,
            purpose: 'BOOKING',
          },
        })
      ).consumedAt,
    ).toBeNull();
  });

  it('serializes two reschedules competing for the same new reservation', async () => {
    const f = await fixture();
    const a = await draft(f, 9);
    const b = await draft(f, 10);
    await confirm(a.result.bookingDraft.id);
    await confirm(b.result.bookingDraft.id);
    const rows = await db.appointment.findMany({
      where: { practiceLocationId: f.clinic.id },
    });
    const results = await Promise.allSettled(
      rows.map((row) =>
        module
          .get(ReservationManagementService)
          .execute(
            { userId: f.user.id },
            row.id,
            'RESCHEDULE',
            randomUUID(),
            f.at(12).toISOString(),
          ),
      ),
    );
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const current = await db.appointment.findMany({
      where: { practiceLocationId: f.clinic.id },
    });
    expect(
      current.filter(
        (row) => row.reservationAt?.getTime() === f.at(12).getTime(),
      ),
    ).toHaveLength(1);
    const loserIndex = results.findIndex(
      (result) => result.status === 'rejected',
    );
    expect(
      current.find((row) => row.id === rows[loserIndex].id)?.reservationAt,
    ).toEqual(rows[loserIndex].reservationAt);
  });
  it('releases cancelled capacity and replays cancellation without duplicate notifications', async () => {
    const f = await fixture();
    const d = await draft(f);
    const confirmed = await confirm(d.result.bookingDraft.id);
    const principal = {
      token: confirmed.bookingAccessToken!.token,
      bookingReference: confirmed.appointment.bookingReference,
    };
    const key = randomUUID();
    const service = module.get(ReservationManagementService);
    await service.execute(principal, principal.bookingReference, 'CANCEL', key);
    expect(
      (
        await service.execute(
          principal,
          principal.bookingReference,
          'CANCEL',
          key,
        )
      ).replayed,
    ).toBe(true);
    const replacement = await draft(f);
    await confirm(replacement.result.bookingDraft.id);
    expect(
      await db.notificationOutbox.count({
        where: {
          appointmentId: confirmed.appointment.id,
          notificationType: 'APPOINTMENT_CANCELLATION',
        },
      }),
    ).toBe(1);
  });

  it('public management cannot override an occupied reservation', async () => {
    const f = await fixture();
    const a = await draft(f, 9);
    const b = await draft(f, 10);
    const confirmed = await confirm(a.result.bookingDraft.id);
    await confirm(b.result.bookingDraft.id);
    await expect(
      module.get(ReservationManagementService).execute(
        {
          token: confirmed.bookingAccessToken!.token,
          bookingReference: confirmed.appointment.bookingReference,
        },
        confirmed.appointment.bookingReference,
        'RESCHEDULE',
        randomUUID(),
        f.at(10).toISOString(),
        true,
      ),
    ).rejects.toThrow();
    expect(
      (
        await db.appointment.findUniqueOrThrow({
          where: { id: confirmed.appointment.id },
        })
      ).reservationAt,
    ).toEqual(f.at(9));
  });

  it('uses reservation priority at START and NEXT, preserves missed bookings, and forbids Time-Slot IM HERE', async () => {
    const f = await fixture();
    const later = await draft(f, 12);
    const earlier = await draft(f, 9);
    const a = await confirm(later.result.bookingDraft.id);
    const b = await confirm(earlier.result.bookingDraft.id);
    expect(a.appointment.queueNumber).toBeLessThan(b.appointment.queueNumber);
    await module
      .get(StartClinicService)
      .start(
        f.user.id,
        { practiceLocationId: f.clinic.id, serviceDate: f.dateText },
        randomUUID(),
      );
    expect(
      (
        await db.appointment.findUniqueOrThrow({
          where: { id: b.appointment.id },
        })
      ).status,
    ).toBe('CALLED');
    await module.get(NextPatientService).advance(
      f.user.id,
      {
        practiceLocationId: f.clinic.id,
        serviceDate: f.dateText,
        patientOutcome: NextPatientOutcome.NOW_SERVING,
      },
      randomUUID(),
    );
    const missed = await db.appointment.findUniqueOrThrow({
      where: { id: b.appointment.id },
    });
    expect(missed.status).toBe('TEMPORARILY_ABSENT');
    expect(missed.reservationAt).toEqual(f.at(9));
    expect(missed.queueNumber).toBe(b.appointment.queueNumber);
    await expect(
      module
        .get(ImHereService)
        .reinsert(
          b.appointment.bookingReference,
          b.bookingAccessToken!.token,
          randomUUID(),
        ),
    ).rejects.toThrow('Time-Slot');
    expect(
      (
        await db.appointment.findUniqueOrThrow({
          where: { id: a.appointment.id },
        })
      ).status,
    ).toBe('CALLED');
    await module
      .get(ReservationManagementService)
      .execute(
        { userId: f.user.id },
        a.appointment.id,
        'START_SERVICE',
        randomUUID(),
      );
    await expect(
      module.get(ReservationManagementService).execute(
        {
          token: a.bookingAccessToken!.token,
          bookingReference: a.appointment.bookingReference,
        },
        a.appointment.bookingReference,
        'CANCEL',
        randomUUID(),
      ),
    ).rejects.toThrow('active service');
  });
  it('calculates alternate dates with room for the whole group when the selected date cannot fit', async () => {
    const f = await fixture();
    await db.scheduleException.update({
      where: {
        practiceLocationId_serviceDate: {
          practiceLocationId: f.clinic.id,
          serviceDate: f.date,
        },
      },
      data: {
        closesAtLocal: new Date('1970-01-01T08:30:00Z'),
        maximumOperatingUntilLocal: new Date('1970-01-01T08:30:00Z'),
      },
    });
    const nextDate = new Date(f.date.getTime() + 86400000);
    await db.scheduleException.create({
      data: {
        practiceLocationId: f.clinic.id,
        serviceDate: nextDate,
        isOpen: true,
        opensAtLocal: new Date('1970-01-01T08:00:00Z'),
        closesAtLocal: new Date('1970-01-01T17:00:00Z'),
        maximumOperatingUntilLocal: new Date('1970-01-01T18:00:00Z'),
      },
    });
    const result = await module
      .get(PublicBookingEntryService)
      .getTimeSlots(f.clinic.publicIdentifier, {
        serviceDate: f.dateText,
        members: [
          { selectedServiceIds: [f.services[0].id] },
          { selectedServiceIds: [f.services[0].id] },
        ],
      });
    expect(result.available).toBe(false);
    expect(result.alternateDates?.[0].serviceDate).toBe(
      nextDate.toISOString().slice(0, 10),
    );
    expect(result.alternateDates?.[0].reservationTimes.length).toBeGreaterThan(
      0,
    );
  });
  it('saves the Doctor default and applies it only to selected clinics', async () => {
    const f = await fixture();
    const clinics = await Promise.all(
      ['Selected', 'Untouched'].map((name) =>
        db.practiceLocation.create({
          data: {
            doctorProfileId: f.doctor.id,
            name,
            lifecycleStatus: 'DRAFT',
            timeZone: 'Asia/Manila',
            countryCode: 'PH',
          },
        }),
      ),
    );
    await module.get(DoctorService).updateAccountSettings(f.user.id, {
      defaultAppointmentMode: 'TIME_SLOT_MODE',
    });
    expect(
      (
        await db.doctorAccountSettings.findUniqueOrThrow({
          where: { doctorProfileId: f.doctor.id },
        })
      ).defaultAppointmentMode,
    ).toBe('TIME_SLOT_MODE');
    await module.get(DoctorDefaultsApplyService).apply(
      f.user.id,
      {
        practiceLocationIds: [clinics[0].id],
        serviceTemplateIds: [],
        bookingQuestionTemplateIds: [],
        appointmentModeEffectiveServiceDate: f.dateText,
      },
      randomUUID(),
    );
    expect(
      await db.appointmentModeConfiguration.count({
        where: {
          practiceLocationId: clinics[0].id,
          appointmentMode: 'TIME_SLOT_MODE',
        },
      }),
    ).toBe(1);
    expect(
      await db.appointmentModeConfiguration.count({
        where: { practiceLocationId: clinics[1].id },
      }),
    ).toBe(0);
  });

  it('requires current Secretary drafting authority and Doctor approval before a mode proposal is effective', async () => {
    const f = await fixture();
    const secretary = await db.user.create({
      data: {
        email: `secretary-${randomUUID()}@example.test`,
        firstName: 'Secretary',
        lastName: 'Test',
        passwordHash: 'test',
        role: 'SECRETARY',
        accountStatus: 'ACTIVE',
        emailVerifiedAt: new Date(),
      },
    });
    const assignment = await db.practiceStaff.create({
      data: { userId: secretary.id, practiceLocationId: f.clinic.id },
    });
    await db.practiceLocation.update({
      where: { id: f.clinic.id },
      data: { currentRegularPracticeStaffId: assignment.id },
    });
    const draft = await db.secretarySettingsDraft.create({
      data: {
        practiceLocationId: f.clinic.id,
        authorPracticeStaffId: assignment.id,
      },
    });
    const proposal = {
      appointmentMode: 'QUEUE_MODE',
      effectiveServiceDate: f.dateText,
      maximumBookableMinutes: null,
      protectedPeriods: [],
    };
    const service = module.get(SecretarySettingsDraftScheduleService);
    await expect(
      service.saveAppointmentModeProposal(secretary.id, draft.id, proposal),
    ).rejects.toThrow('authority');
    await db.practiceStaffAuthorityBundle.create({
      data: {
        practiceStaffId: assignment.id,
        bundleType: 'CLINIC_CONFIGURATION_DRAFTING',
        grantedByUserId: f.user.id,
        grantedAt: new Date(),
      },
    });
    await expect(
      service.saveAppointmentModeProposal(f.user.id, draft.id, proposal),
    ).rejects.toThrow('current regular secretary');
    await service.saveAppointmentModeProposal(secretary.id, draft.id, proposal);
    expect(
      await db.appointmentModeConfiguration.count({
        where: {
          practiceLocationId: f.clinic.id,
          appointmentMode: 'QUEUE_MODE',
        },
      }),
    ).toBe(0);
    await db.secretarySettingsDraft.update({
      where: { id: draft.id },
      data: { status: 'SUBMITTED', submittedAt: new Date() },
    });
    await expect(
      module
        .get(SecretarySettingsDraftApprovalService)
        .approve(secretary.id, draft.id, randomUUID()),
    ).rejects.toThrow();
    await module
      .get(SecretarySettingsDraftApprovalService)
      .approve(f.user.id, draft.id, randomUUID());
    const applied = await db.appointmentModeConfiguration.findFirstOrThrow({
      where: { sourceDraftId: draft.id },
    });
    expect(applied.appointmentMode).toBe('QUEUE_MODE');
    expect(applied.actorUserId).toBe(f.user.id);
  });
  it('warns before a staff walk-in overlap and records an explicitly confirmed duplicate time', async () => {
    const f = await fixture();
    const d = await draft(f);
    await confirm(d.result.bookingDraft.id);
    await module
      .get(StartClinicService)
      .start(
        f.user.id,
        { practiceLocationId: f.clinic.id, serviceDate: f.dateText },
        randomUUID(),
      );
    const dto = {
      practiceLocationId: f.clinic.id,
      serviceDate: f.dateText,
      firstName: 'Walk',
      lastName: 'In',
      mobileNumber: `0917${String(randomInt(0, 10000000)).padStart(7, '0')}`,
      existingPatientResponse: 'NO' as const,
      selectedServiceIds: [f.services[0].id],
    };
    const service = module.get(StaffAppointmentService);
    await expect(service.create(f.user.id, dto, randomUUID())).rejects.toThrow(
      'Select a Reservation Time',
    );
    await expect(
      service.create(
        f.user.id,
        { ...dto, reservationAt: f.at(9).toISOString() },
        randomUUID(),
      ),
    ).rejects.toThrow();
    const result = await service.create(
      f.user.id,
      {
        ...dto,
        reservationAt: f.at(9).toISOString(),
        confirmAvailabilityOverride: true,
      },
      randomUUID(),
    );
    expect(
      await db.appointment.count({
        where: { practiceLocationId: f.clinic.id, reservationAt: f.at(9) },
      }),
    ).toBe(2);
    expect(
      (
        await db.appointmentReservationEvent.findFirstOrThrow({
          where: { appointmentId: result.appointment.id },
        })
      ).availabilityOverride,
    ).toBe(true);
    const other = await fixture();
    await expect(
      service.create(
        other.user.id,
        { ...dto, reservationAt: f.at(10).toISOString() },
        randomUUID(),
      ),
    ).rejects.toThrow();
  });

  it('keeps reservation time when staff reorders, and prevents a Secretary using an expired time', async () => {
    const f = await fixture();
    const d = await draft(f, 9);
    const later = await draft(f, 12);
    const a = await confirm(d.result.bookingDraft.id);
    await confirm(later.result.bookingDraft.id);
    await module
      .get(StartClinicService)
      .start(
        f.user.id,
        { practiceLocationId: f.clinic.id, serviceDate: f.dateText },
        randomUUID(),
      );
    await module.get(NextPatientService).advance(
      f.user.id,
      {
        practiceLocationId: f.clinic.id,
        serviceDate: f.dateText,
        patientOutcome: NextPatientOutcome.NOW_SERVING,
      },
      randomUUID(),
    );
    const dto = {
      practiceLocationId: f.clinic.id,
      serviceDate: f.dateText,
      appointmentId: a.appointment.id,
      confirmReservationPriorityOverride: true,
    };
    await module
      .get(StaffReinsertService)
      .reinsert(f.user.id, dto, randomUUID());
    expect(
      (
        await db.appointment.findUniqueOrThrow({
          where: { id: a.appointment.id },
        })
      ).reservationAt,
    ).toEqual(f.at(9));
    const secretary = await db.user.create({
      data: {
        email: `expired-secretary-${randomUUID()}@example.test`,
        firstName: 'Secretary',
        lastName: 'Test',
        passwordHash: 'test',
        role: 'SECRETARY',
        accountStatus: 'ACTIVE',
        emailVerifiedAt: new Date(),
      },
    });
    const assignment = await db.practiceStaff.create({
      data: { userId: secretary.id, practiceLocationId: f.clinic.id },
    });
    await db.practiceLocation.update({
      where: { id: f.clinic.id },
      data: { currentRegularPracticeStaffId: assignment.id },
    });
    await db.clinicDay.update({
      where: {
        practiceLocationId_serviceDate: {
          practiceLocationId: f.clinic.id,
          serviceDate: f.date,
        },
      },
      data: { operatingPracticeStaffId: assignment.id },
    });
    await db.practiceStaffAuthorityBundle.create({
      data: {
        practiceStaffId: assignment.id,
        bundleType: 'QUEUE_AND_CLINIC_DAY_OPERATIONS',
        grantedByUserId: f.user.id,
        grantedAt: new Date(),
      },
    });
    const clock = jest.spyOn(Date, 'now').mockReturnValue(f.at(10).getTime());
    try {
      await expect(
        module
          .get(StaffReinsertService)
          .reinsert(secretary.id, dto, randomUUID()),
      ).rejects.toThrow('expired Reservation Time');
    } finally {
      clock.mockRestore();
    }
  });

  it('erases reservation history through the existing 24-hour erasure gate without waiting for command expiry', async () => {
    const f = await fixture();
    const d = await draft(f);
    const a = await confirm(d.result.bookingDraft.id);
    await module.get(ReservationManagementService).execute(
      {
        token: a.bookingAccessToken!.token,
        bookingReference: a.appointment.bookingReference,
      },
      a.appointment.bookingReference,
      'CANCEL',
      randomUUID(),
    );
    const erased = await module
      .get(AppointmentErasureService)
      .eraseEligibleAppointment(
        a.appointment.id,
        new Date(Date.now() + 2 * 86400000),
      );
    expect(erased.outcome).toBe('ERASED');
    expect(
      await db.appointmentReservationEvent.count({
        where: { appointmentId: a.appointment.id },
      }),
    ).toBe(0);
    expect(
      await db.appointment.findUnique({ where: { id: a.appointment.id } }),
    ).toBeNull();
  });
  it('rejects mixed-mode inserts and stale reservation selections after a mode change', async () => {
    const f = await fixture();
    const d = await draft(f);
    await db.$transaction((tx) =>
      applyAppointmentModeProposal(
        tx,
        f.clinic.id,
        {
          appointmentMode: 'QUEUE_MODE',
          effectiveServiceDate: f.dateText,
          maximumBookableMinutes: null,
          protectedPeriods: [],
        },
        f.user.id,
        null,
      ),
    );
    await expect(confirm(d.result.bookingDraft.id)).rejects.toThrow(
      'Mode changed',
    );
    expect(
      await db.appointment.count({
        where: { practiceLocationId: f.clinic.id },
      }),
    ).toBe(0);
    const other = await fixture();
    await expect(
      db.appointment.create({
        data: {
          practiceLocationId: other.clinic.id,
          serviceDate: other.date,
          bookingReference: randomUUID(),
          queueNumber: 999,
          estimatedServiceMinutes: 30,
        },
      }),
    ).rejects.toThrow('Appointment mode');
  });

  it('erases all members and their group through the shared privacy path', async () => {
    const f = await fixture();
    const d = await draft(f, 9, [30, 30]);
    const result = await module
      .get(MultiPersonBookingConfirmationService)
      .confirm({
        bookingDraftId: d.result.bookingDraft.id,
        idempotencyKey: randomUUID(),
      });
    const rows = await db.appointment.findMany({
      where: { practiceLocationId: f.clinic.id },
    });
    for (const row of rows) {
      await module
        .get(BookingGroupMemberCancellationService)
        .cancel(
          row.bookingGroupId!,
          row.id,
          result.bookingGroupAccessToken!.token,
          { reason: 'PATIENT_REQUESTED' },
          randomUUID(),
        );
      await module
        .get(AppointmentErasureService)
        .eraseEligibleAppointment(row.id, new Date(Date.now() + 2 * 86400000));
    }
    expect(
      await db.bookingGroup.findUnique({
        where: { id: rows[0].bookingGroupId! },
      }),
    ).toBeNull();
    expect(
      await db.appointmentReservationEvent.count({
        where: { appointmentId: { in: rows.map((row) => row.id) } },
      }),
    ).toBe(0);
  });
});
