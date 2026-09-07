const fs = require('fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function write(path, content) {
  fs.writeFileSync(path, content, 'utf8');
}

function replaceOnce(content, from, to, label) {
  const index = content.indexOf(from);
  if (index === -1) throw new Error(`Patch target not found: ${label}`);
  if (content.indexOf(from, index + from.length) !== -1) {
    throw new Error(`Patch target is not unique: ${label}`);
  }
  return content.slice(0, index) + to + content.slice(index + from.length);
}

// 1) Prisma model: professional/public profile fields are optional for clinic ownership.
{
  const path = 'prisma/schema.prisma';
  let s = read(path);
  s = replaceOnce(s, '  professionalTitle  String  @db.VarChar(50)', '  professionalTitle  String? @db.VarChar(50)', 'DoctorProfile.professionalTitle nullable');
  s = replaceOnce(s, '  specialization     String  @db.VarChar(150)', '  specialization     String? @db.VarChar(150)', 'DoctorProfile.specialization nullable');
  s = replaceOnce(s, '  licenseNumber      String  @unique @db.VarChar(100)', '  licenseNumber      String? @unique @db.VarChar(100)', 'DoctorProfile.licenseNumber nullable');
  write(path, s);
}

// 2) PracticeLocation eligibility: verified active Doctor is enough. Professional profile completion is not a gate.
{
  const path = 'src/practice-location/practice-location.service.ts';
  let s = read(path);

  s = replaceOnce(
    s,
    "import { PrismaService } from '../prisma/prisma.service';",
    "import { accountIdentifierIsVerified } from '../auth/security/account-identifier';\nimport { PrismaService } from '../prisma/prisma.service';",
    'practice service verification helper import',
  );

  s = replaceOnce(
    s,
    `        administrativeRestrictionStatus: true,\n        emailVerifiedAt: true,\n        doctorProfile: { select: { id: true } },`,
    `        administrativeRestrictionStatus: true,\n        loginIdentifierType: true,\n        emailVerifiedAt: true,\n        mobileVerifiedAt: true,\n        doctorProfile: { select: { id: true } },`,
    'practice create user verification select',
  );

  s = replaceOnce(
    s,
    `      user.administrativeRestrictionStatus !==\n        AdministrativeRestrictionStatus.NONE ||\n      !user.emailVerifiedAt ||\n      !user.doctorProfile\n    ) {\n      throw new ForbiddenException(\n        'A verified active Doctor with a completed professional profile is required to create a practice location.',\n      );\n    }\n\n    const doctorProfile = user.doctorProfile;`,
    `      user.administrativeRestrictionStatus !==\n        AdministrativeRestrictionStatus.NONE ||\n      !accountIdentifierIsVerified(user)\n    ) {\n      throw new ForbiddenException(\n        'A verified active Doctor is required to create a practice location.',\n      );\n    }`,
    'practice create eligibility gate',
  );

  s = replaceOnce(
    s,
    `    return this.prisma.$transaction(async (transaction) => {\n      if (name && addressLine1) {`,
    `    return this.prisma.$transaction(async (transaction) => {\n      const doctorProfile =\n        user.doctorProfile ??\n        (await transaction.doctorProfile.create({\n          data: {\n            userId,\n            professionalTitle: null,\n            specialization: null,\n            licenseNumber: null,\n            isProfilePublic: false,\n          },\n          select: { id: true },\n        }));\n\n      await transaction.doctorAccountSettings.upsert({\n        where: { doctorProfileId: doctorProfile.id },\n        create: { doctorProfileId: doctorProfile.id },\n        update: {},\n      });\n\n      if (name && addressLine1) {`,
    'practice create internal ownership profile',
  );

  s = replaceOnce(
    s,
    `  async findAllForDoctor(userId: string) {\n    const doctorProfile = await this.prisma.doctorProfile.findUnique({\n      where: { userId },\n      select: { id: true },\n    });\n\n    if (!doctorProfile) {\n      throw new ForbiddenException(\n        'Only a doctor may view practice locations.',\n      );\n    }\n\n    const locations = await this.prisma.practiceLocation.findMany({`,
    `  async findAllForDoctor(userId: string) {\n    const user = await this.prisma.user.findUnique({\n      where: { id: userId },\n      select: {\n        role: true,\n        accountStatus: true,\n        administrativeRestrictionStatus: true,\n        loginIdentifierType: true,\n        emailVerifiedAt: true,\n        mobileVerifiedAt: true,\n        doctorProfile: { select: { id: true } },\n      },\n    });\n\n    if (\n      !user ||\n      user.role !== UserRole.DOCTOR ||\n      user.accountStatus !== UserAccountStatus.ACTIVE ||\n      user.administrativeRestrictionStatus !==\n        AdministrativeRestrictionStatus.NONE ||\n      !accountIdentifierIsVerified(user)\n    ) {\n      throw new ForbiddenException(\n        'Only an active verified Doctor may view practice locations.',\n      );\n    }\n\n    if (!user.doctorProfile) return [];\n    const doctorProfile = user.doctorProfile;\n\n    const locations = await this.prisma.practiceLocation.findMany({`,
    'practice list valid doctor empty state',
  );

  write(path, s);
}

// 3) Doctor profile onboarding: an internal ownership profile is not the same as a completed professional profile.
{
  const path = 'src/doctor/doctor-profile-onboarding.service.ts';
  let s = read(path);

  s = replaceOnce(
    s,
    '      onboardingComplete: Boolean(user!.doctorProfile),',
    '      onboardingComplete: this.profileIsComplete(user!.doctorProfile),',
    'profile state completeness',
  );

  s = replaceOnce(
    s,
    `        doctorProfile: { select: { id: true } },`,
    `        doctorProfile: {\n          select: {\n            id: true,\n            professionalTitle: true,\n            specialization: true,\n            licenseNumber: true,\n          },\n        },`,
    'complete onboarding initial profile select',
  );

  s = replaceOnce(
    s,
    `    if (user!.doctorProfile) {\n      throw new ConflictException('Doctor onboarding is already complete.');\n    }`,
    `    if (this.profileIsComplete(user!.doctorProfile)) {\n      throw new ConflictException('Doctor onboarding is already complete.');\n    }`,
    'complete onboarding early completeness check',
  );

  s = replaceOnce(
    s,
    `        const existingProfile = await transaction.doctorProfile.findUnique({\n          where: { userId: authenticatedUserId },\n          select: { id: true },\n        });\n        if (existingProfile) {\n          throw new ConflictException('Doctor onboarding is already complete.');\n        }`,
    `        const existingProfile = await transaction.doctorProfile.findUnique({\n          where: { userId: authenticatedUserId },\n          select: {\n            id: true,\n            professionalTitle: true,\n            specialization: true,\n            licenseNumber: true,\n          },\n        });\n        if (this.profileIsComplete(existingProfile)) {\n          throw new ConflictException('Doctor onboarding is already complete.');\n        }`,
    'complete onboarding locked completeness check',
  );

  s = replaceOnce(
    s,
    `        const doctorProfile = await transaction.doctorProfile.create({\n          data: {\n            userId: authenticatedUserId,\n            middleName,\n            suffix,\n            professionalTitle,\n            specialization,\n            licenseNumber,\n            profileDescription,\n            isProfilePublic: false,\n          },\n          select: {\n            id: true,\n            middleName: true,\n            suffix: true,\n            professionalTitle: true,\n            specialization: true,\n            licenseNumber: true,\n            profileDescription: true,\n            profilePhotoUrl: true,\n            publicIdentifier: true,\n            publicSlug: true,\n            isProfilePublic: true,\n          },\n        });\n\n        await transaction.doctorAccountSettings.create({\n          data: { doctorProfileId: doctorProfile.id },\n        });`,
    `        const profileData = {\n          middleName,\n          suffix,\n          professionalTitle,\n          specialization,\n          licenseNumber,\n          profileDescription,\n          isProfilePublic: false,\n        };\n        const profileSelect = {\n          id: true,\n          middleName: true,\n          suffix: true,\n          professionalTitle: true,\n          specialization: true,\n          licenseNumber: true,\n          profileDescription: true,\n          profilePhotoUrl: true,\n          publicIdentifier: true,\n          publicSlug: true,\n          isProfilePublic: true,\n        } as const;\n        const doctorProfile = existingProfile\n          ? await transaction.doctorProfile.update({\n              where: { id: existingProfile.id },\n              data: profileData,\n              select: profileSelect,\n            })\n          : await transaction.doctorProfile.create({\n              data: { userId: authenticatedUserId, ...profileData },\n              select: profileSelect,\n            });\n\n        await transaction.doctorAccountSettings.upsert({\n          where: { doctorProfileId: doctorProfile.id },\n          create: { doctorProfileId: doctorProfile.id },\n          update: {},\n        });`,
    'complete onboarding update skeleton or create profile',
  );

  s = replaceOnce(
    s,
    `  private optionalTrim(value: string | undefined): string | null {`,
    `  private profileIsComplete(\n    profile: {\n      professionalTitle: string | null;\n      specialization: string | null;\n      licenseNumber: string | null;\n    } | null,\n  ): boolean {\n    return Boolean(\n      profile?.professionalTitle?.trim() &&\n        profile.specialization?.trim() &&\n        profile.licenseNumber?.trim(),\n    );\n  }\n\n  private optionalTrim(value: string | undefined): string | null {`,
    'profile completeness helper',
  );

  write(path, s);
}

// 4) PracticeLocationService unit fixtures/mocks for the new ownership behavior.
{
  const path = 'src/practice-location/practice-location.service.spec.ts';
  let s = read(path);

  s = replaceOnce(
    s,
    `  AdministrativeRestrictionStatus,\n  BookingQuestionType,`,
    `  AccountLoginIdentifierType,\n  AdministrativeRestrictionStatus,\n  BookingQuestionType,`,
    'practice spec account identifier enum',
  );

  s = replaceOnce(
    s,
    `    doctorBookingQuestionTemplate: {\n      findMany: jest.fn(),\n    },\n    $executeRaw: jest.fn(),`,
    `    doctorBookingQuestionTemplate: {\n      findMany: jest.fn(),\n    },\n    doctorProfile: {\n      create: jest.fn(),\n    },\n    doctorAccountSettings: {\n      upsert: jest.fn(),\n    },\n    $executeRaw: jest.fn(),`,
    'practice spec transaction ownership mocks',
  );

  s = replaceOnce(
    s,
    `    administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,\n    emailVerifiedAt: new Date('2026-09-01T00:00:00.000Z'),\n    doctorProfile: { id: 'doctor-profile-1' },`,
    `    administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,\n    loginIdentifierType: AccountLoginIdentifierType.EMAIL,\n    emailVerifiedAt: new Date('2026-09-01T00:00:00.000Z'),\n    mobileVerifiedAt: null,\n    doctorProfile: { id: 'doctor-profile-1' },`,
    'practice spec eligible doctor dual identifier fixture',
  );

  s = replaceOnce(
    s,
    `  it('rejects first clinic creation until Doctor email verification and professional onboarding are complete', async () => {\n    prismaServiceMock.user.findUnique.mockResolvedValue({\n      ...eligibleDoctor,\n      emailVerifiedAt: null,\n      doctorProfile: null,\n    });\n\n    await expect(service.create('doctor-user-1', {})).rejects.toBeInstanceOf(\n      ForbiddenException,\n    );\n    expect(prismaServiceMock.$transaction).not.toHaveBeenCalled();\n  });`,
    `  it('allows a verified Doctor without a professional profile to create the internal ownership profile', async () => {\n    prismaServiceMock.user.findUnique.mockResolvedValue({\n      ...eligibleDoctor,\n      doctorProfile: null,\n    });\n    transactionMock.doctorProfile.create.mockResolvedValue({\n      id: 'doctor-profile-1',\n    });\n    transactionMock.doctorAccountSettings.upsert.mockResolvedValue({\n      id: 'settings-1',\n    });\n    transactionMock.practiceLocation.create.mockResolvedValue({\n      id: 'location-1',\n      lifecycleStatus: PracticeLocationLifecycleStatus.DRAFT,\n    });\n\n    await service.create('doctor-user-1', {});\n\n    expect(transactionMock.doctorProfile.create).toHaveBeenCalledWith({\n      data: {\n        userId: 'doctor-user-1',\n        professionalTitle: null,\n        specialization: null,\n        licenseNumber: null,\n        isProfilePublic: false,\n      },\n      select: { id: true },\n    });\n  });\n\n  it('rejects clinic creation until the Doctor primary login identifier is verified', async () => {\n    prismaServiceMock.user.findUnique.mockResolvedValue({\n      ...eligibleDoctor,\n      emailVerifiedAt: null,\n      mobileVerifiedAt: null,\n      doctorProfile: null,\n    });\n\n    await expect(service.create('doctor-user-1', {})).rejects.toBeInstanceOf(\n      ForbiddenException,\n    );\n    expect(prismaServiceMock.$transaction).not.toHaveBeenCalled();\n  });\n\n  it('accepts a mobile-primary verified Doctor for clinic creation', async () => {\n    prismaServiceMock.user.findUnique.mockResolvedValue({\n      ...eligibleDoctor,\n      loginIdentifierType: AccountLoginIdentifierType.MOBILE,\n      emailVerifiedAt: null,\n      mobileVerifiedAt: new Date('2026-09-07T00:00:00.000Z'),\n    });\n    transactionMock.practiceLocation.create.mockResolvedValue({\n      id: 'location-1',\n      lifecycleStatus: PracticeLocationLifecycleStatus.DRAFT,\n    });\n\n    await expect(service.create('doctor-user-1', {})).resolves.toBeDefined();\n  });`,
    'practice spec optional professional profile tests',
  );

  write(path, s);
}

// 5) Doctor onboarding tests: support completing a skeletal ownership profile.
{
  const path = 'src/doctor/doctor-profile-onboarding.service.spec.ts';
  let s = read(path);

  s = replaceOnce(
    s,
    `    doctorProfile: {\n      findUnique: jest.fn(),\n      create: createProfileMock,\n    },\n    doctorAccountSettings: { create: jest.fn() },`,
    `    doctorProfile: {\n      findUnique: jest.fn(),\n      create: createProfileMock,\n      update: jest.fn(),\n    },\n    doctorAccountSettings: { upsert: jest.fn() },`,
    'onboarding spec skeleton mocks',
  );

  s = replaceOnce(
    s,
    `    transaction.doctorAccountSettings.create.mockResolvedValue({\n      id: 'settings-1',\n    });`,
    `    transaction.doctorProfile.update.mockResolvedValue(profile);\n    transaction.doctorAccountSettings.upsert.mockResolvedValue({\n      id: 'settings-1',\n    });`,
    'onboarding spec setup upsert',
  );

  s = replaceOnce(
    s,
    `    expect(transaction.doctorAccountSettings.create).toHaveBeenCalledWith({\n      data: { doctorProfileId: 'profile-1' },\n    });`,
    `    expect(transaction.doctorAccountSettings.upsert).toHaveBeenCalledWith({\n      where: { doctorProfileId: 'profile-1' },\n      create: { doctorProfileId: 'profile-1' },\n      update: {},\n    });`,
    'onboarding spec settings expectation',
  );

  s = replaceOnce(
    s,
    `  it('does not allow the onboarding command to overwrite an existing DoctorProfile', async () => {\n    prismaServiceMock.user.findUnique.mockResolvedValueOnce({\n      ...eligibleUser,\n      doctorProfile: { id: 'existing-profile' },\n    });`,
    `  it('does not allow the onboarding command to overwrite a completed DoctorProfile', async () => {\n    prismaServiceMock.user.findUnique.mockResolvedValueOnce({\n      ...eligibleUser,\n      doctorProfile: {\n        id: 'existing-profile',\n        professionalTitle: 'Doctor',\n        specialization: 'Family Medicine',\n        licenseNumber: 'LIC-123',\n      },\n    });`,
    'onboarding spec completed profile guard',
  );

  const insertionPoint = `  it('rejects Secretary accounts and unverified Doctor accounts', async () => {`;
  const newTest = `  it('reports a skeletal clinic-ownership DoctorProfile as onboarding-incomplete and can complete it', async () => {\n    const skeletalProfile = {\n      ...profile,\n      professionalTitle: null,\n      specialization: null,\n      licenseNumber: null,\n    };\n    prismaServiceMock.user.findUnique.mockResolvedValueOnce({\n      ...eligibleUser,\n      doctorProfile: skeletalProfile,\n    });\n\n    const state = await service.getProfileState('doctor-user');\n    expect(state.onboardingComplete).toBe(false);\n\n    prismaServiceMock.user.findUnique.mockResolvedValueOnce({\n      ...eligibleUser,\n      doctorProfile: {\n        id: 'profile-1',\n        professionalTitle: null,\n        specialization: null,\n        licenseNumber: null,\n      },\n    });\n    transaction.doctorProfile.findUnique.mockResolvedValueOnce({\n      id: 'profile-1',\n      professionalTitle: null,\n      specialization: null,\n      licenseNumber: null,\n    });\n\n    await service.completeOnboarding('doctor-user', {\n      firstName: 'Jane',\n      lastName: 'Doe',\n      professionalTitle: 'Doctor',\n      specialization: 'Family Medicine',\n      licenseNumber: 'LIC-123',\n    });\n\n    expect(transaction.doctorProfile.update).toHaveBeenCalledWith(\n      expect.objectContaining({\n        where: { id: 'profile-1' },\n        data: expect.objectContaining({\n          professionalTitle: 'Doctor',\n          specialization: 'Family Medicine',\n          licenseNumber: 'LIC-123',\n        }),\n      }),\n    );\n  });\n\n`;
  if (!s.includes(insertionPoint)) throw new Error('Patch target not found: onboarding skeletal test insertion');
  s = s.replace(insertionPoint, newTest + insertionPoint);

  write(path, s);
}

console.log('R3 Doctor clinic/profile optional alignment applied.');
console.log('Next: npx prisma migrate deploy && npx prisma generate, then targeted tests/typecheck.');
