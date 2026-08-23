import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PasswordSecurityService } from '../security/password-security.service';
import type { AuthenticatedRequest } from '../types/authenticated-request';

@Injectable()
export class CurrentPasswordGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordSecurityService: PasswordSecurityService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest & {
      body?: { currentPassword?: unknown };
    }>();
    const currentPassword = request.body?.currentPassword;

    if (typeof currentPassword !== 'string' || !currentPassword.trim()) {
      throw new BadRequestException('Current password is required.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: request.user.userId },
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
