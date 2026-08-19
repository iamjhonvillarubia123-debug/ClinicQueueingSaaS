import { Prisma } from '../../generated/prisma/client';

describe('NotificationLog privacy schema contract', () => {
  it('contains only approved provider-attempt audit fields and the outbox relation', () => {
    const model = Prisma.dmmf.datamodel.models.find(
      (candidate) => candidate.name === 'NotificationLog',
    );
    expect(model).toBeDefined();

    const actualFields = model?.fields.map((field) => field.name).sort();
    const approvedFields = [
      'attemptNumber',
      'channel',
      'createdAt',
      'expiresAt',
      'failureDetailSanitized',
      'id',
      'notificationOutbox',
      'notificationOutboxId',
      'notificationType',
      'outcome',
      'providerErrorCode',
      'providerIdempotencyKeyUsed',
      'providerName',
      'providerReference',
      'providerStatus',
      'resolvedAt',
      'retryRecommended',
      'submittedAt',
    ].sort();

    expect(actualFields).toEqual(approvedFields);
  });

  it('does not expose direct patient, recipient, message, credential, or business-scope fields', () => {
    const model = Prisma.dmmf.datamodel.models.find(
      (candidate) => candidate.name === 'NotificationLog',
    );
    const fieldNames = new Set(model?.fields.map((field) => field.name) ?? []);

    for (const forbiddenField of [
      'patientId',
      'userId',
      'practiceLocationId',
      'appointmentId',
      'bookingDraftId',
      'scheduledReminderId',
      'otpVerificationId',
      'passwordResetId',
      'emailVerificationId',
      'recipientMobile',
      'recipientMobileEncrypted',
      'recipientEmail',
      'recipientEmailEncrypted',
      'messageBody',
      'messageBodyEncrypted',
      'otp',
      'bookingAccessToken',
      'tokenHash',
      'activeResetKey',
    ]) {
      expect(fieldNames.has(forbiddenField)).toBe(false);
    }
  });
});
