import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';


@Injectable()
export class AuthService {
  constructor(
  private readonly prisma: PrismaService,
  private readonly jwtService: JwtService,
) {}

  async login(loginDto: LoginDto) {
  const normalizedEmail = loginDto.email.trim().toLowerCase();

  const user = await this.prisma.user.findUnique({
    where: {
      email: normalizedEmail,
    },
  });

  if (!user) {
    throw new UnauthorizedException('Invalid email or password.');
  }

  const passwordMatches = await bcrypt.compare(
    loginDto.password,
    user.passwordHash,
  );

  if (!passwordMatches) {
    throw new UnauthorizedException('Invalid email or password.');
  }

  if (!user.isActive) {
    throw new UnauthorizedException('Invalid email or password.');
  }

  const updatedUser = await this.prisma.user.update({
  where: {
    id: user.id,
  },
  data: {
    lastLoginAt: new Date(),
  },
});

const accessToken = await this.jwtService.signAsync({
  sub: updatedUser.id,
  role: updatedUser.role,
});

return {
  accessToken,
  user: {
    id: updatedUser.id,
    role: updatedUser.role,
  },
  lastLoginAt: updatedUser.lastLoginAt,
};
}
}