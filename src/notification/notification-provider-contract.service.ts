import { BadRequestException, Injectable } from '@nestjs/common';
import {
  NotificationAttemptOutcome,
  NotificationChannel,
} from '../../generated/prisma/client';
import {
  NotificationProviderAdapter,
  NotificationProviderSubmissionResult,
} from './notification-provider-adapter';

const MAX_PROVIDER_NAME_LENGTH = 64;
const MAX_PROVIDER_REFERENCE_LENGTH = 200;
const MAX_PROVIDER_STATUS_LENGTH = 100;
const MAX_PROVIDER_ERROR_CODE_LENGTH = 100;
const MAX_FAILURE_DETAIL_LENGTH = 500;

@Injectable()
export class NotificationProviderContractService {
  assertAdapter(
    adapter: NotificationProviderAdapter,
    expectedChannel: NotificationChannel,
  ): void {
    if (adapter.channel !== expectedChannel) {
      throw new BadRequestException(
        'Notification provider adapter channel does not match the claimed outbox.',
      );
    }

    this.assertBoundedSafeText(
      adapter.providerName,
      'Notification provider name',
      MAX_PROVIDER_NAME_LENGTH,
      false,
    );

    if (adapter.providerName !== adapter.providerName.trim()) {
      throw new BadRequestException(
        'Notification provider name must already be normalized.',
      );
    }

    if (
      typeof adapter.supportsIdempotency !== 'boolean' ||
      typeof adapter.supportsStatusLookup !== 'boolean'
    ) {
      throw new BadRequestException(
        'Notification provider capabilities are invalid.',
      );
    }
  }

  assertSubmissionResult(
    adapter: NotificationProviderAdapter,
    result: NotificationProviderSubmissionResult,
    protectedValues: readonly string[] = [],
  ): void {
    if (result.providerName !== adapter.providerName) {
      throw new BadRequestException(
        'Notification provider result does not match the configured adapter.',
      );
    }

    this.assertBoundedSafeText(
      result.providerName,
      'Notification provider result name',
      MAX_PROVIDER_NAME_LENGTH,
      false,
    );
    this.assertBoundedSafeText(
      result.providerReference,
      'Notification provider reference',
      MAX_PROVIDER_REFERENCE_LENGTH,
      true,
    );
    this.assertBoundedSafeText(
      result.providerStatus,
      'Notification provider status',
      MAX_PROVIDER_STATUS_LENGTH,
      true,
    );
    this.assertBoundedSafeText(
      result.providerErrorCode,
      'Notification provider error code',
      MAX_PROVIDER_ERROR_CODE_LENGTH,
      true,
    );
    this.assertBoundedSafeText(
      result.failureDetailSanitized,
      'Notification provider failure detail',
      MAX_FAILURE_DETAIL_LENGTH,
      true,
    );

    const sensitiveFragments = this.deriveSensitiveFragments(protectedValues);
    this.assertNoSensitiveContent(
      result.providerReference,
      'Notification provider reference',
      sensitiveFragments,
    );
    this.assertNoSensitiveContent(
      result.providerStatus,
      'Notification provider status',
      sensitiveFragments,
    );
    this.assertNoSensitiveContent(
      result.providerErrorCode,
      'Notification provider error code',
      sensitiveFragments,
    );
    this.assertNoSensitiveContent(
      result.failureDetailSanitized,
      'Notification provider failure detail',
      sensitiveFragments,
    );

    this.assertValidDate(result.submittedAt, 'Notification submittedAt');
    if (result.resolvedAt !== undefined && result.resolvedAt !== null) {
      this.assertValidDate(result.resolvedAt, 'Notification resolvedAt');
    }
    if (result.nextAttemptAt !== undefined && result.nextAttemptAt !== null) {
      this.assertValidDate(result.nextAttemptAt, 'Notification nextAttemptAt');
    }

    if (
      result.outcome === NotificationAttemptOutcome.UNCERTAIN &&
      result.resolvedAt != null
    ) {
      throw new BadRequestException(
        'Uncertain notification result must remain unresolved.',
      );
    }

    if (
      result.outcome !== NotificationAttemptOutcome.RETRYABLE_FAILURE &&
      result.nextAttemptAt != null
    ) {
      throw new BadRequestException(
        'Only retryable notification failure may schedule another attempt.',
      );
    }
  }

  private deriveSensitiveFragments(values: readonly string[]): string[] {
    const fragments = new Set<string>();

    for (const rawValue of values) {
      const value = rawValue.trim();
      if (value.length >= 4) fragments.add(value);

      for (const match of value.matchAll(/https?:\/\/\S+/giu)) {
        fragments.add(match[0]);
      }
      for (const match of value.matchAll(/\b\d{6,}\b/gu)) {
        fragments.add(match[0]);
      }
      for (const match of value.matchAll(/\b[A-Za-z0-9_-]{16,}\b/gu)) {
        fragments.add(match[0]);
      }
    }

    return [...fragments];
  }

  private assertNoSensitiveContent(
    value: string | null | undefined,
    fieldName: string,
    sensitiveFragments: readonly string[],
  ): void {
    if (!value) return;

    if (sensitiveFragments.some((fragment) => value.includes(fragment))) {
      throw new BadRequestException(
        `${fieldName} contains protected delivery content.`,
      );
    }
  }

  private assertBoundedSafeText(
    value: string | null | undefined,
    fieldName: string,
    maxLength: number,
    allowNull: boolean,
  ): void {
    if (value === null || value === undefined) {
      if (allowNull) return;
      throw new BadRequestException(`${fieldName} is required.`);
    }

    const hasUnsafeControlCharacter = [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code === 0 || code === 10 || code === 13;
    });

    if (
      !value.trim() ||
      value.length > maxLength ||
      hasUnsafeControlCharacter
    ) {
      throw new BadRequestException(`${fieldName} is invalid.`);
    }
  }

  private assertValidDate(value: Date, fieldName: string): void {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      throw new BadRequestException(`${fieldName} is invalid.`);
    }
  }
}
