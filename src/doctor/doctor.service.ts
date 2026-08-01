import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, UserRole } from '../../generated/prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDoctorDto } from './dto/register-doctor.dto';


@Injectable()
export class DoctorService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async hashPassword(password: string): Promise<string> {
    const saltRounds = 12;

    return bcrypt.hash(password, saltRounds);
  }

  async registerDoctor(registerDoctorDto: RegisterDoctorDto) {
  const normalizedEmail = registerDoctorDto.email.trim().toLowerCase();

  const firstName = registerDoctorDto.firstName.trim();
  const lastName = registerDoctorDto.lastName.trim();
  const mobileNumber = registerDoctorDto.mobileNumber.trim();
  const professionalTitle = registerDoctorDto.professionalTitle.trim();
  const specialization = registerDoctorDto.specialization.trim();
  const licenseNumber = registerDoctorDto.licenseNumber.trim();

  const passwordHash = await this.hashPassword(
    registerDoctorDto.password,
  );

  try {
    return await this.prisma.$transaction(async (transaction) => {
      const user = await transaction.user.create({
        data: {
          firstName,
          lastName,
          email: normalizedEmail,
          mobileNumber,
          passwordHash,
          role: UserRole.DOCTOR,
          isActive: true,
        },
      });

      const doctorProfile = await transaction.doctorProfile.create({
        data: {
          userId: user.id,
          professionalTitle,
          specialization,
          licenseNumber,
        },
      });

      await transaction.doctorAccountSettings.create({
        data: {
          doctorProfileId: doctorProfile.id,
        },
      });

      return {
        userId: user.id,
        doctorProfileId: doctorProfile.id,
      };
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException(
        'A user with this email or license number already exists.',
      );
    }

    throw error;
  }
}
}