import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthenticationService } from '../authentication.service';
import { readCookie, SESSION_COOKIE_NAME } from '../security/session-security';
import type { AuthenticatedRequest } from '../types/authenticated-request';

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private readonly authenticationService: AuthenticationService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const rawToken = readCookie(request.headers.cookie, SESSION_COOKIE_NAME);

    if (!rawToken) {
      throw new UnauthorizedException('Authentication required.');
    }

    const authenticatedUser =
      await this.authenticationService.authenticateOrdinarySession(rawToken);
    (request as AuthenticatedRequest).user = authenticatedUser;
    return true;
  }
}
