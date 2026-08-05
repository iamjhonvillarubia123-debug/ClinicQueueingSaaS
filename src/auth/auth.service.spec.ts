import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;

  const prismaServiceMock = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  const jwtServiceMock = {
    signAsync: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: prismaServiceMock,
        },
        {
          provide: JwtService,
          useValue: jwtServiceMock,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
  expect(service).toBeDefined();
});

it('should reject login when the email does not exist', async () => {
  prismaServiceMock.user.findUnique.mockResolvedValue(null);

  await expect(
    service.login({
      email: 'missing@example.com',
      password: 'WrongPassword123!',
    }),
  ).rejects.toThrow('Invalid email or password.');

  expect(prismaServiceMock.user.findUnique).toHaveBeenCalledWith({
    where: {
      email: 'missing@example.com',
    },
  });

  expect(prismaServiceMock.user.update).not.toHaveBeenCalled();
  expect(jwtServiceMock.signAsync).not.toHaveBeenCalled();
});
});