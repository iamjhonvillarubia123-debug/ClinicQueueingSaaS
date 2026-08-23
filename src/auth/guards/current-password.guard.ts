import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { PasswordSecurityService } from '../security/password-security.service';
import type { AuthenticatedRequest } from '../types/authenticated-request';

type CurrentPasswordBody = {
  currentPassword?: unknown;
};

@Injectable()
export class CurrentPasswordGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordSecurityService: PasswordSecurityService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const body = request.body as CurrentPasswordBody | undefined;
    const currentPassword = body?.currentPassword;
    const authenticatedRequest = request as AuthenticatedRequest;

    if (typeof currentPassword !== 'string' || !currentPassword.trim()) {
      throw new BadRequestException('Current password is required.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: authenticatedRequest.user.userId },
      select: { passwordHash: true },
    });
    if (!user) {
      throw new UnauthorizedException('Authentication required.');
    }

    const passwordMatches = await this.passwordSecurityService.verify(
      currentPassword,
      user.passwordHash,
    );
    if (!passwordMatches) {
      throw new UnauthorizedException('Current password is incorrect.');
    }

    return true;
  }
}
