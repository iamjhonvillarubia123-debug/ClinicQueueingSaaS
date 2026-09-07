const fs = require('fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function write(path, content) {
  fs.writeFileSync(path, content, 'utf8');
}

function replaceRequired(content, pattern, replacement, label) {
  const next = content.replace(pattern, replacement);
  if (next === content) throw new Error(`Patch target not found: ${label}`);
  return next;
}

function ensureContains(content, needle, label) {
  if (!content.includes(needle)) throw new Error(`Post-patch check failed: ${label}`);
}

// The schema migration has already made professional profile fields nullable.
// This script only aligns application behavior and focused tests.

// 1) Verified Doctor accounts may list/create clinics without completing the professional profile.
{
  const path = 'src/practice-location/practice-location.service.ts';
  let s = read(path);

  if (!s.includes('accountIdentifierIsVerified')) {
    s = replaceRequired(
      s,
      /import \{ PrismaService \} from '\.\.\/prisma\/prisma\.service';/,
      "import { accountIdentifierIsVerified } from '../auth/security/account-identifier';\nimport { PrismaService } from '../prisma/prisma.service';",
      'practice service verification helper import',
    );
  }

  if (!s.includes('loginIdentifierType: true')) {
    s = replaceRequired(
      s,
      /administrativeRestrictionStatus: true,\s*emailVerifiedAt: true,\s*doctorProfile: \{ select: \{ id: true \} \},/,
      `administrativeRestrictionStatus: true,\n        loginIdentifierType: true,\n        emailVerifiedAt: true,\n        mobileVerifiedAt: true,\n        doctorProfile: { select: { id: true } },`,
      'practice create user verification select',
    );
  }

  if (s.includes('completed professional profile is required to create a practice location')) {
    s = replaceRequired(
      s,
      /user\.administrativeRestrictionStatus !==\s*AdministrativeRestrictionStatus\.NONE \|\|\s*!user\.emailVerifiedAt \|\|\s*!user\.doctorProfile\s*\) \{\s*throw new ForbiddenException\(\s*'A verified active Doctor with a completed professional profile is required to create a practice location\.',\s*\);\s*\}\s*\n\s*const doctorProfile = user\.doctorProfile;/,
      `user.administrativeRestrictionStatus !==\n        AdministrativeRestrictionStatus.NONE ||\n      !accountIdentifierIsVerified(user)\n    ) {\n      throw new ForbiddenException(\n        'A verified active Doctor is required to create a practice location.',\n      );\n    }`,
      'practice create eligibility gate',
    );
  }

  if (!s.includes('professionalTitle: null')) {
    s = replaceRequired(
      s,
      /return this\.prisma\.\$transaction\(async \(transaction\) => \{\s*if \(name && addressLine1\) \{/,
      `return this.prisma.$transaction(async (transaction) => {\n      const doctorProfile =\n        user.doctorProfile ??\n        (await transaction.doctorProfile.create({\n          data: {\n            userId,\n            professionalTitle: null,\n            specialization: null,\n            licenseNumber: null,\n            isProfilePublic: false,\n          },\n          select: { id: true },\n        }));\n\n      await transaction.doctorAccountSettings.upsert({\n        where: { doctorProfileId: doctorProfile.id },\n        create: { doctorProfileId: doctorProfile.id },\n        update: {},\n      });\n\n      if (name && addressLine1) {`,
      'practice create internal ownership profile',
    );
  }

  if (!s.includes('if (!user.doctorProfile) return [];')) {
    s = replaceRequired(
      s,
      /async findAllForDoctor\(userId: string\) \{\s*const doctorProfile = await this\.prisma\.doctorProfile\.findUnique\(\{\s*where: \{ userId \},\s*select: \{ id: true \},\s*\}\);\s*if \(!doctorProfile\) \{\s*throw new ForbiddenException\(\s*'Only a doctor may view practice locations\.',\s*\);\s*\}\s*const locations = await this\.prisma\.practiceLocation\.findMany\(\{/,
      `async findAllForDoctor(userId: string) {\n    const user = await this.prisma.user.findUnique({\n      where: { id: userId },\n      select: {\n        role: true,\n        accountStatus: true,\n        administrativeRestrictionStatus: true,\n        loginIdentifierType: true,\n        emailVerifiedAt: true,\n        mobileVerifiedAt: true,\n        doctorProfile: { select: { id: true } },\n      },\n    });\n\n    if (\n      !user ||\n      user.role !== UserRole.DOCTOR ||\n      user.accountStatus !== UserAccountStatus.ACTIVE ||\n      user.administrativeRestrictionStatus !==\n        AdministrativeRestrictionStatus.NONE ||\n      !accountIdentifierIsVerified(user)\n    ) {\n      throw new ForbiddenException(\n        'Only an active verified Doctor may view practice locations.',\n      );\n    }\n\n    if (!user.doctorProfile) return [];\n    const doctorProfile = user.doctorProfile;\n\n    const locations = await this.prisma.practiceLocation.findMany({`,
      'practice list verified Doctor empty state',
    );
  }

  ensureContains(s, 'if (!user.doctorProfile) return [];', 'Doctor without profile gets empty clinics');
  ensureContains(s, 'professionalTitle: null', 'skeletal Doctor ownership profile');
  write(path, s);
}

// 2) A skeletal ownership profile is not a completed professional/public profile.
{
  const path = 'src/doctor/doctor-profile-onboarding.service.ts';
  let s = read(path);

  if (s.includes('onboardingComplete: Boolean(user!.doctorProfile),')) {
    s = replaceRequired(
      s,
      'onboardingComplete: Boolean(user!.doctorProfile),',
      'onboardingComplete: this.profileIsComplete(user!.doctorProfile),',
      'profile state completeness',
    );
  }

  if (s.includes('doctorProfile: { select: { id: true } },')) {
    s = replaceRequired(
      s,
      /doctorProfile: \{ select: \{ id: true \} \},/,
      `doctorProfile: {\n          select: {\n            id: true,\n            professionalTitle: true,\n            specialization: true,\n            licenseNumber: true,\n          },\n        },`,
      'complete onboarding initial profile select',
    );
  }

  if (s.includes('if (user!.doctorProfile)')) {
    s = replaceRequired(
      s,
      /if \(user!\.doctorProfile\) \{\s*throw new ConflictException\('Doctor onboarding is already complete\.'\);\s*\}/,
      `if (this.profileIsComplete(user!.doctorProfile)) {\n      throw new ConflictException('Doctor onboarding is already complete.');\n    }`,
      'complete onboarding early completeness check',
    );
  }

  if (s.includes('select: { id: true },\n        });\n        if (existingProfile)')) {
    s = replaceRequired(
      s,
      /const existingProfile = await transaction\.doctorProfile\.findUnique\(\{\s*where: \{ userId: authenticatedUserId \},\s*select: \{ id: true \},\s*\}\);\s*if \(existingProfile\) \{\s*throw new ConflictException\('Doctor onboarding is already complete\.'\);\s*\}/,
      `const existingProfile = await transaction.doctorProfile.findUnique({\n          where: { userId: authenticatedUserId },\n          select: {\n            id: true,\n            professionalTitle: true,\n            specialization: true,\n            licenseNumber: true,\n          },\n        });\n        if (this.profileIsComplete(existingProfile)) {\n          throw new ConflictException('Doctor onboarding is already complete.');\n        }`,
      'locked profile completeness check',
    );
  }

  if (s.includes('await transaction.doctorAccountSettings.create')) {
    s = replaceRequired(
      s,
      /const doctorProfile = await transaction\.doctorProfile\.create\(\{\s*data: \{\s*userId: authenticatedUserId,\s*middleName,\s*suffix,\s*professionalTitle,\s*specialization,\s*licenseNumber,\s*profileDescription,\s*isProfilePublic: false,\s*\},\s*select: \{\s*id: true,\s*middleName: true,\s*suffix: true,\s*professionalTitle: true,\s*specialization: true,\s*licenseNumber: true,\s*profileDescription: true,\s*profilePhotoUrl: true,\s*publicIdentifier: true,\s*publicSlug: true,\s*isProfilePublic: true,\s*\},\s*\}\);\s*await transaction\.doctorAccountSettings\.create\(\{\s*data: \{ doctorProfileId: doctorProfile\.id \},\s*\}\);/,
      `const profileData = {\n          middleName,\n          suffix,\n          professionalTitle,\n          specialization,\n          licenseNumber,\n          profileDescription,\n          isProfilePublic: false,\n        };\n        const profileSelect = {\n          id: true,\n          middleName: true,\n          suffix: true,\n          professionalTitle: true,\n          specialization: true,\n          licenseNumber: true,\n          profileDescription: true,\n          profilePhotoUrl: true,\n          publicIdentifier: true,\n          publicSlug: true,\n          isProfilePublic: true,\n        } as const;\n        const doctorProfile = existingProfile\n          ? await transaction.doctorProfile.update({\n              where: { id: existingProfile.id },\n              data: profileData,\n              select: profileSelect,\n            })\n          : await transaction.doctorProfile.create({\n              data: { userId: authenticatedUserId, ...profileData },\n              select: profileSelect,\n            });\n\n        await transaction.doctorAccountSettings.upsert({\n          where: { doctorProfileId: doctorProfile.id },\n          create: { doctorProfileId: doctorProfile.id },\n          update: {},\n        });`,
      'complete skeletal or new professional profile',
    );
  }

  if (!s.includes('private profileIsComplete(')) {
    s = replaceRequired(
      s,
      /  private optionalTrim\(value: string \| undefined\): string \| null \{/,
      `  private profileIsComplete(\n    profile: {\n      professionalTitle: string | null;\n      specialization: string | null;\n      licenseNumber: string | null;\n    } | null,\n  ): boolean {\n    return Boolean(\n      profile?.professionalTitle?.trim() &&\n        profile.specialization?.trim() &&\n        profile.licenseNumber?.trim(),\n    );\n  }\n\n  private optionalTrim(value: string | undefined): string | null {`,
      'profile completeness helper',
    );
  }

  write(path, s);
}

// 3) Focused PracticeLocationService tests.
{
  const path = 'src/practice-location/practice-location.service.spec.ts';
  let s = read(path);

  if (!s.includes('AccountLoginIdentifierType')) {
    s = replaceRequired(
      s,
      /import \{\s*AdministrativeRestrictionStatus,/,
      `import {\n  AccountLoginIdentifierType,\n  AdministrativeRestrictionStatus,`,
      'practice spec account identifier enum',
    );
  }

  if (!s.includes('doctorProfile: {\n      create: jest.fn(),')) {
    s = replaceRequired(
      s,
      /doctorBookingQuestionTemplate: \{\s*findMany: jest\.fn\(\),\s*\},\s*\$executeRaw: jest\.fn\(\),/,
      `doctorBookingQuestionTemplate: {\n      findMany: jest.fn(),\n    },\n    doctorProfile: {\n      create: jest.fn(),\n    },\n    doctorAccountSettings: {\n      upsert: jest.fn(),\n    },\n    $executeRaw: jest.fn(),`,
      'practice spec ownership mocks',
    );
  }

  if (!s.includes('loginIdentifierType: AccountLoginIdentifierType.EMAIL')) {
    s = replaceRequired(
      s,
      /administrativeRestrictionStatus: AdministrativeRestrictionStatus\.NONE,\s*emailVerifiedAt: new Date\('2026-09-01T00:00:00\.000Z'\),\s*doctorProfile: \{ id: 'doctor-profile-1' \},/,
      `administrativeRestrictionStatus: AdministrativeRestrictionStatus.NONE,\n    loginIdentifierType: AccountLoginIdentifierType.EMAIL,\n    emailVerifiedAt: new Date('2026-09-01T00:00:00.000Z'),\n    mobileVerifiedAt: null,\n    doctorProfile: { id: 'doctor-profile-1' },`,
      'practice spec dual identifier fixture',
    );
  }

  if (s.includes('rejects first clinic creation until Doctor email verification and professional onboarding are complete')) {
    s = replaceRequired(
      s,
      /it\('rejects first clinic creation until Doctor email verification and professional onboarding are complete',[\s\S]*?expect\(prismaServiceMock\.\$transaction\)\.not\.toHaveBeenCalled\(\);\s*\}\);/,
      `it('allows a verified Doctor without a professional profile to create a clinic ownership record', async () => {\n    prismaServiceMock.user.findUnique.mockResolvedValue({\n      ...eligibleDoctor,\n      doctorProfile: null,\n    });\n    transactionMock.doctorProfile.create.mockResolvedValue({ id: 'doctor-profile-1' });\n    transactionMock.doctorAccountSettings.upsert.mockResolvedValue({ id: 'settings-1' });\n    transactionMock.practiceLocation.create.mockResolvedValue({\n      id: 'location-1',\n      lifecycleStatus: PracticeLocationLifecycleStatus.DRAFT,\n    });\n\n    await expect(service.create('doctor-user-1', {})).resolves.toBeDefined();\n    expect(transactionMock.doctorProfile.create).toHaveBeenCalledWith({\n      data: {\n        userId: 'doctor-user-1',\n        professionalTitle: null,\n        specialization: null,\n        licenseNumber: null,\n        isProfilePublic: false,\n      },\n      select: { id: true },\n    });\n  });\n\n  it('rejects clinic creation until the Doctor primary identifier is verified', async () => {\n    prismaServiceMock.user.findUnique.mockResolvedValue({\n      ...eligibleDoctor,\n      emailVerifiedAt: null,\n      mobileVerifiedAt: null,\n      doctorProfile: null,\n    });\n\n    await expect(service.create('doctor-user-1', {})).rejects.toBeInstanceOf(\n      ForbiddenException,\n    );\n    expect(prismaServiceMock.$transaction).not.toHaveBeenCalled();\n  });\n\n  it('accepts a mobile-primary verified Doctor for clinic creation', async () => {\n    prismaServiceMock.user.findUnique.mockResolvedValue({\n      ...eligibleDoctor,\n      loginIdentifierType: AccountLoginIdentifierType.MOBILE,\n      emailVerifiedAt: null,\n      mobileVerifiedAt: new Date('2026-09-07T00:00:00.000Z'),\n    });\n    transactionMock.practiceLocation.create.mockResolvedValue({\n      id: 'location-1',\n      lifecycleStatus: PracticeLocationLifecycleStatus.DRAFT,\n    });\n\n    await expect(service.create('doctor-user-1', {})).resolves.toBeDefined();\n  });`,
      'practice spec optional professional profile expectations',
    );
  }

  write(path, s);
}

// 4) Focused Doctor onboarding tests support completing a skeletal profile.
{
  const path = 'src/doctor/doctor-profile-onboarding.service.spec.ts';
  let s = read(path);

  if (!s.includes('update: jest.fn(),')) {
    s = replaceRequired(
      s,
      /doctorProfile: \{\s*findUnique: jest\.fn\(\),\s*create: createProfileMock,\s*\},\s*doctorAccountSettings: \{ create: jest\.fn\(\) \},/,
      `doctorProfile: {\n      findUnique: jest.fn(),\n      create: createProfileMock,\n      update: jest.fn(),\n    },\n    doctorAccountSettings: { upsert: jest.fn() },`,
      'onboarding spec skeletal profile mocks',
    );
  }

  if (s.includes('transaction.doctorAccountSettings.create.mockResolvedValue')) {
    s = replaceRequired(
      s,
      /transaction\.doctorAccountSettings\.create\.mockResolvedValue\(\{\s*id: 'settings-1',\s*\}\);/,
      `transaction.doctorAccountSettings.upsert.mockResolvedValue({\n      id: 'settings-1',\n    });`,
      'onboarding spec settings upsert mock',
    );
  }

  if (s.includes('expect(transaction.doctorAccountSettings.create)')) {
    s = replaceRequired(
      s,
      /expect\(transaction\.doctorAccountSettings\.create\)\.toHaveBeenCalledWith\(\{\s*data: \{ doctorProfileId: 'profile-1' \},\s*\}\);/,
      `expect(transaction.doctorAccountSettings.upsert).toHaveBeenCalledWith({\n      where: { doctorProfileId: 'profile-1' },\n      create: { doctorProfileId: 'profile-1' },\n      update: {},\n    });`,
      'onboarding spec settings upsert expectation',
    );
  }

  const oldExistingProfileTest = /\n\s*it\('does not allow the onboarding command to overwrite an existing DoctorProfile',[\s\S]*?expect\(prismaServiceMock\.\$transaction\)\.not\.toHaveBeenCalled\(\);\s*\}\);/;
  if (oldExistingProfileTest.test(s)) {
    s = replaceRequired(
      s,
      oldExistingProfileTest,
      `\n\n  it('rejects onboarding only when the existing DoctorProfile is already complete', async () => {\n    prismaServiceMock.user.findUnique.mockResolvedValueOnce({\n      ...eligibleUser,\n      doctorProfile: {\n        id: 'existing-profile',\n        professionalTitle: 'Doctor',\n        specialization: 'Family Medicine',\n        licenseNumber: 'LIC-123',\n      },\n    });\n\n    await expect(\n      service.completeOnboarding('doctor-user', {\n        firstName: 'Jane',\n        lastName: 'Doe',\n        professionalTitle: 'Doctor',\n        specialization: 'Family Medicine',\n        licenseNumber: 'LIC-123',\n      }),\n    ).rejects.toThrow('Doctor onboarding is already complete.');\n\n    expect(prismaServiceMock.$transaction).not.toHaveBeenCalled();\n  });`,
      'replace stale complete-profile test',
    );
  }

  const skeletalTest = `\n\n  it('completes a skeletal clinic-ownership profile instead of rejecting it as already complete', async () => {\n    const skeletalProfile = {\n      id: 'profile-1',\n      professionalTitle: null,\n      specialization: null,\n      licenseNumber: null,\n    };\n    prismaServiceMock.user.findUnique.mockResolvedValueOnce({\n      ...eligibleUser,\n      doctorProfile: skeletalProfile,\n    });\n    transaction.doctorProfile.findUnique.mockResolvedValueOnce(skeletalProfile);\n    transaction.doctorProfile.update.mockResolvedValueOnce(profile);\n\n    const result = await service.completeOnboarding('doctor-user', {\n      firstName: 'Jane',\n      lastName: 'Doe',\n      professionalTitle: 'Doctor',\n      specialization: 'Family Medicine',\n      licenseNumber: 'LIC-123',\n    });\n\n    expect(transaction.doctorProfile.update).toHaveBeenCalledWith(\n      expect.objectContaining({ where: { id: 'profile-1' } }),\n    );\n    expect(result.onboardingComplete).toBe(true);\n  });`;

  if (!s.includes('completes a skeletal clinic-ownership profile')) {
    s = replaceRequired(s, /\n\}\);\s*$/, `${skeletalTest}\n});\n`, 'append skeletal onboarding test');
  }

  write(path, s);
}

console.log('Aligned verified Doctor clinic ownership with optional professional profile completion.');
