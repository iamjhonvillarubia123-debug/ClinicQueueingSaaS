const fs = require('fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }
function write(path, value) { fs.writeFileSync(path, value); }
function replaceSection(source, startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error(`Patch target not found: ${label}`);
  return source.slice(0, start) + replacement + source.slice(end);
}

for (const path of [
  'src/practice-staff/dto/create-secretary-invitation.dto.ts',
  'src/practice-staff/dto/update-secretary-invitation.dto.ts',
]) {
  let s = read(path);
  s = s.replace(/\n\s*IsEmail,?/g, '');
  s = s.replace(/\n\s*@IsEmail\(\)/g, '\n  @IsString()');
  if (!s.includes('@IsString()\n  @IsNotEmpty()') && s.includes('@IsNotEmpty()\n  @MaxLength(255)\n  identifier')) {
    s = s.replace('@IsNotEmpty()\n  @MaxLength(255)\n  identifier', '@IsString()\n  @IsNotEmpty()\n  @MaxLength(255)\n  identifier');
  }
  write(path, s);
}

const servicePath = 'src/practice-staff/secretary-invitation.service.ts';
let service = read(servicePath);

const createMethod = `  async create(actorUserId: string, dto: CreateSecretaryInvitationDto) {
    const plan = this.validatePlan(dto);

    const actor = await this.prisma.user.findUnique({
      where: { id: actorUserId },
      select: {
        role: true,
        accountStatus: true,
        administrativeRestrictionStatus: true,
        passwordHash: true,
      },
    });
    if (
      !actor ||
      actor.role !== UserRole.DOCTOR ||
      actor.accountStatus !== UserAccountStatus.ACTIVE ||
      actor.administrativeRestrictionStatus !== AdministrativeRestrictionStatus.NONE
    ) {
      throw new ForbiddenException('Only an eligible current Doctor may invite a Secretary.');
    }

    const location = await this.prisma.practiceLocation.findFirst({
      where: {
        id: dto.practiceLocationId,
        doctorProfile: { userId: actorUserId },
      },
      select: { id: true, name: true, currentRegularPracticeStaffId: true },
    });
    if (!location) throw new NotFoundException('Practice location was not found.');

    const expectedCurrentPracticeStaffId =
      plan.assignmentType === SecretaryInvitationAssignmentType.CLINIC_SECRETARY
        ? location.currentRegularPracticeStaffId
        : null;

    // Sensitive Doctor authorization is evaluated independently of the invitee identity.
    // This prevents a malformed/unregistered Secretary identifier from hiding a bad Doctor password.
    if (expectedCurrentPracticeStaffId || plan.requestedCancelClinicDay) {
      if (!dto.password) {
        throw new UnauthorizedException(
          expectedCurrentPracticeStaffId
            ? 'Current password is required to authorize replacement.'
            : 'Current password is required to grant Cancel Clinic Day authority.',
        );
      }
      if (!(await this.passwords.verify(dto.password, actor.passwordHash))) {
        throw new UnauthorizedException('Current password is incorrect.');
      }
    }

    const identifier = parseAccountIdentifier(dto.identifier, this.mobileNumbers);
    const target = await this.prisma.user.findFirst({
      where: {
        ...(identifier.type === 'EMAIL'
          ? {
              loginIdentifierType: AccountLoginIdentifierType.EMAIL,
              email: identifier.normalized,
            }
          : {
              loginIdentifierType: AccountLoginIdentifierType.MOBILE,
              mobileNumberHash: identifier.mobileHash,
            }),
        accountStatus: { not: UserAccountStatus.PERMANENTLY_CLOSED },
      },
      select: {
        id: true,
        role: true,
        accountStatus: true,
        administrativeRestrictionStatus: true,
        loginIdentifierType: true,
        email: true,
        emailVerifiedAt: true,
        mobileNumber: true,
        mobileNumberHash: true,
        mobileVerifiedAt: true,
        firstName: true,
        lastName: true,
      },
    });

    if (target?.role !== undefined && target.role !== UserRole.SECRETARY) {
      throw new ConflictException('This identifier belongs to an account with an incompatible role.');
    }
    if (
      target &&
      (target.accountStatus !== UserAccountStatus.ACTIVE ||
        target.administrativeRestrictionStatus !== AdministrativeRestrictionStatus.NONE ||
        !accountIdentifierIsVerified(target))
    ) {
      throw new ConflictException(
        'The Secretary account must be active and its registered login identifier must be verified before it can accept a clinic invitation.',
      );
    }

    const identifierType =
      identifier.type === 'EMAIL'
        ? AccountLoginIdentifierType.EMAIL
        : AccountLoginIdentifierType.MOBILE;
    const normalizedIdentifier = target
      ? target.loginIdentifierType === AccountLoginIdentifierType.EMAIL
        ? target.email
        : target.mobileNumber
      : identifier.normalized;
    if (!normalizedIdentifier) {
      throw new ConflictException('The Secretary account does not have a usable verified login identifier.');
    }

    const activeInvitationKey = this.sha256(
      target
        ? \`${'${location.id}'}:user:${'${target.id}'}\`
        : \`${'${location.id}'}:identifier:${'${identifierType}'}:${'${normalizedIdentifier}'}\`,
    );
    if (
      await this.prisma.secretaryInvitation.findUnique({
        where: { activeInvitationKey },
        select: { id: true },
      })
    ) {
      throw new ConflictException('A pending invitation already exists for this Secretary at this clinic.');
    }

    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + INVITATION_LIFETIME_MS);
    const invitation = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.secretaryInvitation.create({
        data: {
          practiceLocationId: location.id,
          invitedByUserId: actorUserId,
          targetUserId: target?.id ?? null,
          identifierType,
          normalizedIdentifier,
          normalizedEmail:
            identifierType === AccountLoginIdentifierType.EMAIL ? normalizedIdentifier : null,
          firstName: target?.firstName ?? '',
          lastName: target?.lastName ?? '',
          mobileNumber:
            identifierType === AccountLoginIdentifierType.MOBILE ? normalizedIdentifier : null,
          tokenHash: this.sha256(token),
          activeInvitationKey,
          status: SecretaryInvitationStatus.PENDING,
          expiresAt,
          requestedAssignmentType: plan.assignmentType,
          requestedAuthorityBundles: plan.authorityBundles,
          requestedCancelClinicDay: plan.requestedCancelClinicDay,
          requestedCoverageMode: plan.coverageMode,
          requestedFromServiceDate: plan.fromServiceDate,
          requestedToServiceDate: plan.toServiceDate,
          expectedCurrentPracticeStaffId,
          createdAt: now,
        },
      });

      const url = \`${'${this.publicAppBaseUrl()}'}\/secretary-invitations\/accept?token=${'${encodeURIComponent(token)}'}\`;
      const roleLabel =
        plan.assignmentType === SecretaryInvitationAssignmentType.CLINIC_SECRETARY
          ? 'Clinic Secretary'
          : 'Substitute Secretary';
      const message = target
        ? \`You have been invited to join ${'${location.name ?? \'a clinic\'}'} as a ${'${roleLabel}'}. Sign in to your active, verified Secretary account, then accept the clinic relationship: ${'${url}'}\`
        : \`You have been invited to join ${'${location.name ?? \'a clinic\'}'} as a ${'${roleLabel}'}. Create and verify your own Secretary account using this same ${'${identifierType === AccountLoginIdentifierType.EMAIL ? \'email address\' : \'mobile number\'}'}, then sign in and accept the clinic relationship: ${'${url}'}\`;

      await transaction.notificationOutbox.create({
        data: {
          deliveryIdentityKey: this.sha256(\`${'${NotificationType.SECRETARY_INVITATION}'}:${'${created.id}'}\`),
          notificationType: NotificationType.SECRETARY_INVITATION,
          channel:
            identifierType === AccountLoginIdentifierType.EMAIL
              ? NotificationChannel.EMAIL
              : NotificationChannel.SMS,
          status: NotificationOutboxStatus.PENDING,
          practiceLocationId: location.id,
          secretaryInvitationId: created.id,
          recipientEmailEncrypted:
            identifierType === AccountLoginIdentifierType.EMAIL
              ? this.protectedAccountPayload.encrypt(
                  normalizedIdentifier,
                  \`${'${PAYLOAD_PURPOSE}'}:recipient\`,
                )
              : null,
          recipientMobileEncrypted:
            identifierType === AccountLoginIdentifierType.MOBILE
              ? this.mobileNumbers.encryptCanonical(normalizedIdentifier)
              : null,
          messageBodyEncrypted: this.notificationPayload.encryptMessage(message),
          providerIdempotencyKey: \`secretary-invitation:${'${created.id}'}\`,
          nextAttemptAt: now,
          expiresAt,
        },
      });
      return created;
    });

    return { invitationId: invitation.id, status: invitation.status, expiresAt: invitation.expiresAt };
  }

`;
service = replaceSection(service, '  async create(actorUserId: string, dto: CreateSecretaryInvitationDto) {', '  async preview(token: string) {', createMethod, 'SecretaryInvitationService.create');

const updateMethod = `  async updatePending(
    actorUserId: string,
    invitationId: string,
    dto: UpdateSecretaryInvitationDto,
  ) {
    const plan = this.validatePlan(dto);
    const invitation = await this.prisma.secretaryInvitation.findFirst({
      where: {
        id: invitationId,
        status: SecretaryInvitationStatus.PENDING,
        practiceLocation: { doctorProfile: { userId: actorUserId } },
      },
      select: {
        id: true,
        expiresAt: true,
        practiceLocationId: true,
        normalizedIdentifier: true,
        identifierType: true,
        requestedAssignmentType: true,
        requestedCancelClinicDay: true,
        practiceLocation: { select: { name: true } },
      },
    });
    if (!invitation) throw new NotFoundException('Pending invitation was not found.');
    if (invitation.expiresAt.getTime() <= Date.now()) throw new ConflictException('This invitation has expired.');
    if (invitation.requestedAssignmentType !== plan.assignmentType) {
      throw new ConflictException(
        'A pending invitation cannot change between Clinic Secretary and Substitute Secretary. Cancel it and create a new invitation instead.',
      );
    }

    const grantingCancelClinicDay =
      !invitation.requestedCancelClinicDay && plan.requestedCancelClinicDay;
    if (grantingCancelClinicDay) {
      const actor = await this.prisma.user.findUnique({
        where: { id: actorUserId },
        select: {
          role: true,
          accountStatus: true,
          administrativeRestrictionStatus: true,
          passwordHash: true,
        },
      });
      if (
        !actor ||
        actor.role !== UserRole.DOCTOR ||
        actor.accountStatus !== UserAccountStatus.ACTIVE ||
        actor.administrativeRestrictionStatus !== AdministrativeRestrictionStatus.NONE
      ) {
        throw new ForbiddenException('Only an eligible current Doctor may update this invitation.');
      }
      if (!dto.password) {
        throw new UnauthorizedException('Current password is required to grant Cancel Clinic Day authority.');
      }
      if (!(await this.passwords.verify(dto.password, actor.passwordHash))) {
        throw new UnauthorizedException('Current password is incorrect.');
      }
    }

    if (dto.identifier) {
      const corrected = parseAccountIdentifier(dto.identifier, this.mobileNumbers);
      const correctedType =
        corrected.type === 'EMAIL'
          ? AccountLoginIdentifierType.EMAIL
          : AccountLoginIdentifierType.MOBILE;
      if (
        corrected.normalized !== invitation.normalizedIdentifier ||
        correctedType !== invitation.identifierType
      ) {
        const target = await this.prisma.user.findFirst({
          where: {
            ...(corrected.type === 'EMAIL'
              ? {
                  loginIdentifierType: AccountLoginIdentifierType.EMAIL,
                  email: corrected.normalized,
                }
              : {
                  loginIdentifierType: AccountLoginIdentifierType.MOBILE,
                  mobileNumberHash: corrected.mobileHash,
                }),
            accountStatus: { not: UserAccountStatus.PERMANENTLY_CLOSED },
          },
          select: {
            id: true,
            role: true,
            accountStatus: true,
            administrativeRestrictionStatus: true,
            loginIdentifierType: true,
            email: true,
            emailVerifiedAt: true,
            mobileNumber: true,
            mobileNumberHash: true,
            mobileVerifiedAt: true,
            firstName: true,
            lastName: true,
          },
        });
        if (target?.role !== undefined && target.role !== UserRole.SECRETARY) {
          throw new ConflictException('This identifier belongs to an account with an incompatible role.');
        }
        if (
          target &&
          (target.accountStatus !== UserAccountStatus.ACTIVE ||
            target.administrativeRestrictionStatus !== AdministrativeRestrictionStatus.NONE ||
            !accountIdentifierIsVerified(target))
        ) {
          throw new ConflictException(
            'The Secretary account must be active and its registered login identifier must be verified before it can accept a clinic invitation.',
          );
        }

        const normalizedIdentifier = target
          ? target.loginIdentifierType === AccountLoginIdentifierType.EMAIL
            ? target.email
            : target.mobileNumber
          : corrected.normalized;
        if (!normalizedIdentifier) {
          throw new ConflictException('The Secretary account does not have a usable verified login identifier.');
        }
        const identifierType = correctedType;
        const activeInvitationKey = this.sha256(
          target
            ? \`${'${invitation.practiceLocationId}'}:user:${'${target.id}'}\`
            : \`${'${invitation.practiceLocationId}'}:identifier:${'${identifierType}'}:${'${normalizedIdentifier}'}\`,
        );
        const duplicate = await this.prisma.secretaryInvitation.findUnique({
          where: { activeInvitationKey },
          select: { id: true },
        });
        if (duplicate && duplicate.id !== invitation.id) {
          throw new ConflictException('A pending invitation already exists for this Secretary at this clinic.');
        }

        const token = randomBytes(32).toString('base64url');
        const now = new Date();
        const url = \`${'${this.publicAppBaseUrl()}'}\/secretary-invitations\/accept?token=${'${encodeURIComponent(token)}'}\`;
        const roleLabel =
          plan.assignmentType === SecretaryInvitationAssignmentType.CLINIC_SECRETARY
            ? 'Clinic Secretary'
            : 'Substitute Secretary';
        const message = target
          ? \`You have been invited to join ${'${invitation.practiceLocation.name ?? \'a clinic\'}'} as a ${'${roleLabel}'}. Sign in to your active, verified Secretary account, then accept the clinic relationship: ${'${url}'}\`
          : \`You have been invited to join ${'${invitation.practiceLocation.name ?? \'a clinic\'}'} as a ${'${roleLabel}'}. Create and verify your own Secretary account using this same ${'${identifierType === AccountLoginIdentifierType.EMAIL ? \'email address\' : \'mobile number\'}'}, then sign in and accept the clinic relationship: ${'${url}'}\`;

        const updated = await this.prisma.$transaction(async (transaction) => {
          const retargeted = await transaction.secretaryInvitation.update({
            where: { id: invitation.id },
            data: {
              targetUserId: target?.id ?? null,
              identifierType,
              normalizedIdentifier,
              normalizedEmail:
                identifierType === AccountLoginIdentifierType.EMAIL ? normalizedIdentifier : null,
              firstName: target?.firstName ?? '',
              lastName: target?.lastName ?? '',
              mobileNumber:
                identifierType === AccountLoginIdentifierType.MOBILE ? normalizedIdentifier : null,
              tokenHash: this.sha256(token),
              activeInvitationKey,
              requestedAssignmentType: plan.assignmentType,
              requestedAuthorityBundles: plan.authorityBundles,
              requestedCancelClinicDay: plan.requestedCancelClinicDay,
              requestedCoverageMode: plan.coverageMode,
              requestedFromServiceDate: plan.fromServiceDate,
              requestedToServiceDate: plan.toServiceDate,
            },
            select: { id: true, status: true, updatedAt: true },
          });
          await transaction.notificationOutbox.updateMany({
            where: { secretaryInvitationId: invitation.id },
            data: {
              channel:
                identifierType === AccountLoginIdentifierType.EMAIL
                  ? NotificationChannel.EMAIL
                  : NotificationChannel.SMS,
              status: NotificationOutboxStatus.PENDING,
              recipientEmailEncrypted:
                identifierType === AccountLoginIdentifierType.EMAIL
                  ? this.protectedAccountPayload.encrypt(
                      normalizedIdentifier,
                      \`${'${PAYLOAD_PURPOSE}'}:recipient\`,
                    )
                  : null,
              recipientMobileEncrypted:
                identifierType === AccountLoginIdentifierType.MOBILE
                  ? this.mobileNumbers.encryptCanonical(normalizedIdentifier)
                  : null,
              messageBodyEncrypted: this.notificationPayload.encryptMessage(message),
              providerIdempotencyKey: \`secretary-invitation:${'${invitation.id}'}:retarget:${'${this.sha256(`${target?.id ?? normalizedIdentifier}:${token}`).slice(0, 16)}'}\`,
              attemptCount: 0,
              processingStartedAt: null,
              leaseExpiresAt: null,
              processingWorkerId: null,
              nextAttemptAt: now,
              sentAt: null,
              failedAt: null,
              cancelledAt: null,
              protectedPayloadPurgedAt: null,
            },
          });
          return retargeted;
        });
        return { invitationId: updated.id, status: updated.status, updatedAt: updated.updatedAt };
      }
    }

    const updated = await this.prisma.secretaryInvitation.update({
      where: { id: invitation.id },
      data: {
        requestedAssignmentType: plan.assignmentType,
        requestedAuthorityBundles: plan.authorityBundles,
        requestedCancelClinicDay: plan.requestedCancelClinicDay,
        requestedCoverageMode: plan.coverageMode,
        requestedFromServiceDate: plan.fromServiceDate,
        requestedToServiceDate: plan.toServiceDate,
      },
      select: { id: true, status: true, updatedAt: true },
    });
    return { invitationId: updated.id, status: updated.status, updatedAt: updated.updatedAt };
  }

`;
service = replaceSection(service, '  async updatePending(', '  async revokePending(', updateMethod, 'SecretaryInvitationService.updatePending');
write(servicePath, service);

const workspacePath = 'src/practice-staff/secretary-workspace.service.ts';
let workspace = read(workspacePath);
workspace = workspace.replace(
  /const invitationIdentityWhere = user\.email[\s\S]*?const \[assignments, invitations\] = await Promise\.all\(\[/,
  `const invitationIdentityWhere = {\n      OR: [\n        { targetUserId: user.id },\n        {\n          targetUserId: null,\n          identifierType: user.loginIdentifierType,\n          normalizedIdentifier:\n            user.loginIdentifierType === 'EMAIL'\n              ? user.email?.trim().toLowerCase()\n              : user.mobileNumber,\n        },\n      ],\n    };\n\n    const [assignments, invitations] = await Promise.all([`,
);
write(workspacePath, workspace);

const drawerPath = 'frontend/src/doctor/StaffAssignmentDrawer.tsx';
let drawer = read(drawerPath);
if (!drawer.includes('function invitationIdentifierLooksValid')) {
  drawer = drawer.replace(
    'export type StaffAssignmentCommand =',
    `function invitationIdentifierLooksValid(value: string) {\n  const trimmed = value.trim();\n  if (!trimmed) return false;\n  if (trimmed.includes('@')) return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(trimmed);\n  const compact = trimmed.replace(/[\\s()-]/g, '');\n  return /^(?:\\+63|63|0)?9\\d{9}$/.test(compact);\n}\n\nexport type StaffAssignmentCommand =`,
  );
}
drawer = drawer.replace(
  /const detailsValid = Boolean\(inviteIdentifier\.trim\(\)\);/,
  `const detailsValid = Boolean(inviteIdentifier.trim());\n  const inviteIdentifierValid = invitationIdentifierLooksValid(inviteIdentifier);\n  const sensitiveDoctorAuthorization = role === 'CLINIC_SECRETARY' && Boolean(current || cancelClinicDay);`,
);
drawer = drawer.replace(
  /const identifierCorrectionVisible = Boolean\([\s\S]*?\n  \);\n\n  const toggleBundle/,
  `const identifierCorrectionVisible = Boolean(\n    mode === 'INVITE' &&\n      step === 5 &&\n      messageIsError &&\n      (!inviteIdentifierValid ||\n        message.toLowerCase().includes('identifier') ||\n        message.toLowerCase().includes('email') ||\n        message.toLowerCase().includes('mobile')),\n  );\n  const passwordCorrectionVisible = Boolean(\n    mode === 'INVITE' &&\n      step === 5 &&\n      sensitiveDoctorAuthorization &&\n      messageIsError &&\n      message.toLowerCase().includes('password'),\n  );\n\n  const toggleBundle`,
);
drawer = drawer.replace(
  /Send a clinic invitation to an existing Secretary account\./g,
  'Send a clinic invitation. If no account exists yet, the recipient creates and verifies their own Secretary account first.',
);
drawer = drawer.replace(
  /Enter the Secretary&apos;s registered email address\.[\s\S]*?verified Secretary account\./g,
  'Enter the Secretary&apos;s email address or Philippine mobile number. If no Secretary account exists yet, the invitation will direct the recipient to create and verify their own account first.',
);
drawer = drawer.replace(/Secretary Email Address/g, 'Secretary Email or Mobile Number');
drawer = drawer.replace(/type="email"\n\s*autoComplete="email"/g, 'type="text"\n                autoComplete="username"\n                inputMode="text"');
drawer = drawer.replace(/placeholder="Enter Secretary email address"/g, 'placeholder="Email address or Philippine mobile number"');
drawer = drawer.replace(
  /The system will match this email to an existing active, verified Secretary account\. No clinic authority is granted until that Secretary accepts\./g,
  'If this identifier belongs to an active, verified Secretary, the relationship can be accepted immediately. Otherwise the recipient must create and verify their own Secretary account first. The invitation itself grants no clinic authority.',
);

const oldCorrection = `{identifierCorrectionVisible ? (\n        <div className="staff-invite-fields">`;
if (drawer.includes(oldCorrection)) {
  drawer = drawer.replace(
    oldCorrection,
    `{identifierCorrectionVisible ? (\n        <div className="staff-invite-fields">`,
  );
}
// Add explicit local identifier feedback under the correction input.
drawer = drawer.replace(
  /(<input[\s\S]*?value=\{inviteIdentifier\}[\s\S]*?onChange=\{\(event\) => setInviteIdentifier\(event\.target\.value\)\}\n\s*\/>\n\s*<\/label>\n\s*<button\n\s*type="button"\n\s*className="clinic-staff-primary-button is-full")/,
  `$1`,
);
// Insert password correction panel before footer when backend rejects Doctor re-authentication.
if (!drawer.includes('Retry Doctor authorization')) {
  drawer = drawer.replace(
    `      <footer>`,
    `      {passwordCorrectionVisible ? (\n        <div className="staff-replacement-warning">\n          <strong>Doctor authorization failed</strong>\n          <label>\n            Enter your current password again\n            <input\n              type="password"\n              value={password}\n              onChange={(event) => setPassword(event.target.value)}\n            />\n          </label>\n          <button\n            type="button"\n            className="clinic-staff-primary-button is-full"\n            disabled={pending || !password}\n            onClick={submit}\n          >\n            {pending ? 'Retrying…' : 'Retry Doctor authorization'}\n          </button>\n        </div>\n      ) : null}\n\n      {mode === 'INVITE' && step === 5 && !inviteIdentifierValid ? (\n        <div className="staff-drawer-message is-error" role="alert">\n          Enter a valid email address or Philippine mobile number.\n        </div>\n      ) : null}\n\n      <footer>`,
  );
}
write(drawerPath, drawer);

// Keep the existing UI tests aligned with the neutral dual-identifier label.
const frontendTestPath = 'frontend/src/doctor/AuthoritativeClinicStaffTab.test.tsx';
let frontTest = read(frontendTestPath);
frontTest = frontTest.replace(/getByLabelText\('Secretary Email Address'\)/g, "getByLabelText('Secretary Email or Mobile Number')");
write(frontendTestPath, frontTest);

// Add focused backend regressions to the existing invitation spec without disturbing its established harness.
const specPath = 'src/practice-staff/secretary-invitation.service.spec.ts';
let spec = read(specPath);
if (!spec.includes('creates a neutral relationship invitation when the identifier has no account yet')) {
  const insertAt = spec.lastIndexOf('\n});');
  if (insertAt < 0) throw new Error('Patch target not found: Secretary invitation spec closing block');
  const tests = `\n\n  it('creates a neutral relationship invitation when the identifier has no account yet', async () => {\n    prisma.user.findFirst.mockResolvedValueOnce(null);\n    await expect(service.create('doctor-1', clinicPlan)).resolves.toBeDefined();\n    expect(transaction.secretaryInvitation.create).toHaveBeenCalledWith(\n      expect.objectContaining({\n        data: expect.objectContaining({\n          targetUserId: null,\n          normalizedIdentifier: 'sec@example.test',\n          normalizedEmail: 'sec@example.test',\n        }),\n      }),\n    );\n    expect(transaction.practiceStaff.create).not.toHaveBeenCalled();\n  });\n\n  it('checks sensitive Doctor re-authentication before rejecting a malformed invitee identifier', async () => {\n    passwords.verify.mockResolvedValueOnce(false);\n    await expect(\n      service.create('doctor-1', {\n        ...clinicPlan,\n        identifier: 'not-a-valid-identifier',\n        requestedCancelClinicDay: true,\n        password: 'wrong-password',\n      }),\n    ).rejects.toThrow('Current password is incorrect.');\n  });\n`;
  spec = spec.slice(0, insertAt) + tests + spec.slice(insertAt);
}
write(specPath, spec);

console.log('Completed F6 neutral Secretary invitation flow, dual-identifier retargeting, and independent Doctor re-authentication feedback.');
