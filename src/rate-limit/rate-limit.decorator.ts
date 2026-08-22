import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_POLICY = 'rate-limit-policy';

export type RateLimitSubject =
  | { kind: 'NONE' }
  | { kind: 'BODY_EMAIL'; field: string }
  | { kind: 'PARAM'; field: string };

export type RateLimitPolicy = {
  id: string;
  limit: number;
  windowMs: number;
  subject: RateLimitSubject;
};

export const RateLimit = (policy: RateLimitPolicy) =>
  SetMetadata(RATE_LIMIT_POLICY, policy);
