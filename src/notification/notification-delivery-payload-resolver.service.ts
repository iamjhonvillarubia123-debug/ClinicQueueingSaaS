import { BadRequestException, Injectable } from '@nestjs/common';
import { NotificationChannel } from '../../generated/prisma/client';
import { ProtectedAccountPayloadService } from '../auth/security/protected-account-payload.service';
import { MobileNumberService } from '../security/mobile-number/mobile-number.service';
import { ClaimedOutboxRow } from './notification-outbox-claim.service';
import { NotificationPayloadService } from './notification-payload.service';

export type ResolvedNotificationDeliveryPayload = {
  recipient: string;
  messageBody: string;
};

@Injectable()
export class NotificationDeliveryPayloadResolverService {
  constructor(
    private readonly mobileNumberService: MobileNumberService,
    private readonly notificationPayload: NotificationPayloadService,
    private readonly protectedAccountPayload: ProtectedAccountPayloadService,
  ) {}

  resolve(claimed: ClaimedOutboxRow): ResolvedNotificationDeliveryPayload {
    switch (claimed.channel) {
      case NotificationChannel.SMS:
        return this.resolveSms(claimed);
      case NotificationChannel.EMAIL:
        return this.resolveEmail(claimed);
    }
  }

  private resolveSms(
    claimed: ClaimedOutboxRow,
  ): ResolvedNotificationDeliveryPayload {
    if (!claimed.recipientMobileEncrypted || !claimed.messageBodyEncrypted) {
      throw new BadRequestException(
        'Notification protected delivery payload is unavailable.',
      );
    }

    return {
      recipient: this.mobileNumberService.decrypt(
        claimed.recipientMobileEncrypted,
      ),
      messageBody: this.notificationPayload.decryptMessage(
        claimed.messageBodyEncrypted,
      ),
    };
  }

  private resolveEmail(
    claimed: ClaimedOutboxRow,
  ): ResolvedNotificationDeliveryPayload {
    if (!claimed.recipientEmailEncrypted || !claimed.messageBodyEncrypted) {
      throw new BadRequestException(
        'Notification protected delivery payload is unavailable.',
      );
    }

    const recipientPurpose = this.readProtectedPurpose(
      claimed.recipientEmailEncrypted,
      'recipient',
    );

    return {
      recipient: this.protectedAccountPayload.decrypt(
        claimed.recipientEmailEncrypted,
        recipientPurpose,
      ),
      messageBody: this.decryptEmailMessage(claimed.messageBodyEncrypted),
    };
  }

  private decryptEmailMessage(envelope: string): string {
    try {
      return this.notificationPayload.decryptMessage(envelope);
    } catch {
      const messagePurpose = this.readProtectedPurpose(envelope, 'message');
      return this.protectedAccountPayload.decrypt(envelope, messagePurpose);
    }
  }

  private readProtectedPurpose(
    envelope: string,
    expectedRole: 'recipient' | 'message',
  ): string {
    const parts = envelope.split('.');
    if (parts.length !== 6 || parts[0] !== 'v1') {
      throw new BadRequestException(
        'Notification protected delivery payload is invalid.',
      );
    }

    const purpose = parts[2];
    const roleMatches =
      expectedRole === 'recipient'
        ? purpose.endsWith(':recipient') || purpose.endsWith(':recipient-email')
        : purpose.endsWith(':message');

    if (!roleMatches) {
      throw new BadRequestException(
        'Notification protected delivery payload purpose is invalid.',
      );
    }

    return purpose;
  }
}
