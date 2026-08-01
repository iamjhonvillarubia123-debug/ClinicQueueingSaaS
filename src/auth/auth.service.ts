import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async findUserByEmail(email: string) {
  return this.prisma.user.findUnique({
    where: {
      email,
    },
  });
}
}