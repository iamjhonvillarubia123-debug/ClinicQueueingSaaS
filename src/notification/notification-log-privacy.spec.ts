import { readFileSync } from 'fs';
import { join } from 'path';

const schema = readFileSync(join(process.cwd(), 'prisma', 'schema.prisma'), 'utf8');

function notificationLogBlock(): string {
  const match = schema.match(/model NotificationLog \{([\s\S]*?)\n\}/u);
  if (!match) throw new Error('NotificationLog model was not found in Prisma schema.');
  return match[1];
}

function fieldNames(block: string): string[] {
  return block
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('@@'))
    .map((line) => line.split(/\s+/u)[0])
    .filter((name) => name !== undefined);
}

describe('NotificationLog privacy schema contract', () => {
  it('contains only approved provider-attempt audit fields and the outbox relation', () => {
    const actualFields = fieldNames(notificationLogBlock()).sort();
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
    const fields = new Set(fieldNames(notificationLogBlock()));

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
      expect(fields.has(forbiddenField)).toBe(false);
    }
  });
});
