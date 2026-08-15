import type { Request } from 'express';
import type { UserRole } from '../../../generated/prisma/client';

export interface AuthenticatedUserContext {
  userId: string;
  role: UserRole;
  sessionId: string;
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUserContext;
}
