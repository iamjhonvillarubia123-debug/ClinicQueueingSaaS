const fs = require('fs');
const path = require('path');

// First apply the already-approved F6 neutral invitation / dual-identifier reconciliation.
require('./r3-complete-unregistered-secretary-invitation-and-validation.cjs');

function read(p) { return fs.readFileSync(p, 'utf8'); }
function write(p, s) { fs.writeFileSync(p, s); }
function ensureReplace(s, from, to, label) {
  if (s.includes(to)) return s;
  if (!s.includes(from)) throw new Error(`Patch target not found: ${label}`);
  return s.replace(from, to);
}

const dtoDir = 'src/practice-staff/dto';
const identifierDto = `${dtoDir}/validate-secretary-invitation-identifier.dto.ts`;
if (!fs.existsSync(identifierDto)) {
  write(identifierDto, `import { Transform } from 'class-transformer';\nimport { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';\n\nexport class ValidateSecretaryInvitationIdentifierDto {\n  @IsUUID()\n  @IsNotEmpty()\n  practiceLocationId!: string;\n\n  @Transform(({ value }: { value: unknown }) =>\n    typeof value === 'string' ? value.trim().toLowerCase() : value,\n  )\n  @IsString()\n  @IsNotEmpty()\n  @MaxLength(255)\n  identifier!: string;\n}\n`);
}

const authDto = `${dtoDir}/validate-secretary-invitation-authorization.dto.ts`;
if (!fs.existsSync(authDto)) {
  write(authDto, `import { IsNotEmpty, IsString, IsUUID } from 'class-validator';\n\nexport class ValidateSecretaryInvitationAuthorizationDto {\n  @IsUUID()\n  @IsNotEmpty()\n  practiceLocationId!: string;\n\n  @IsString()\n  @IsNotEmpty()\n  password!: string;\n}\n`);
}

const servicePath = 'src/practice-staff/secretary-invitation.service.ts';
let service = read(servicePath);
const serviceAnchor = '  async preview(token: string) {';
if (!service.includes('async validateIdentifier(')) {
  const methods = `  async validateIdentifier(\n    actorUserId: string,\n    dto: { practiceLocationId: string; identifier: string },\n  ) {\n    const actor = await this.prisma.user.findUnique({\n      where: { id: actorUserId },\n      select: {\n        role: true,\n        accountStatus: true,\n        administrativeRestrictionStatus: true,\n      },\n    });\n    if (\n      !actor ||\n      actor.role !== UserRole.DOCTOR ||\n      actor.accountStatus !== UserAccountStatus.ACTIVE ||\n      actor.administrativeRestrictionStatus !== AdministrativeRestrictionStatus.NONE\n    ) {\n      throw new ForbiddenException('Only an eligible current Doctor may validate a Secretary invitation.');\n    }\n\n    const location = await this.prisma.practiceLocation.findFirst({\n      where: {\n        id: dto.practiceLocationId,\n        doctorProfile: { userId: actorUserId },\n      },\n      select: { id: true },\n    });\n    if (!location) throw new NotFoundException('Practice location was not found.');\n\n    const identifier = parseAccountIdentifier(dto.identifier, this.mobileNumbers);\n    const target = await this.prisma.user.findFirst({\n      where: {\n        ...(identifier.type === 'EMAIL'\n          ? {\n              loginIdentifierType: AccountLoginIdentifierType.EMAIL,\n              email: identifier.normalized,\n            }\n          : {\n              loginIdentifierType: AccountLoginIdentifierType.MOBILE,\n              mobileNumberHash: identifier.mobileHash,\n            }),\n        accountStatus: { not: UserAccountStatus.PERMANENTLY_CLOSED },\n      },\n      select: {\n        id: true,\n        role: true,\n        accountStatus: true,\n        administrativeRestrictionStatus: true,\n        loginIdentifierType: true,\n        emailVerifiedAt: true,\n        mobileVerifiedAt: true,\n        firstName: true,\n        lastName: true,\n      },\n    });\n\n    if (target && target.role !== UserRole.SECRETARY) {\n      throw new ConflictException('This identifier cannot currently be used for a Secretary invitation.');\n    }\n    if (\n      target &&\n      (target.accountStatus !== UserAccountStatus.ACTIVE ||\n        target.administrativeRestrictionStatus !== AdministrativeRestrictionStatus.NONE ||\n        !accountIdentifierIsVerified(target))\n    ) {\n      throw new ConflictException('This identifier cannot currently be used for a Secretary invitation.');\n    }\n\n    return {\n      valid: true as const,\n      identifierType: identifier.type,\n      normalizedIdentifier: identifier.normalized,\n      existingSecretary: Boolean(target),\n      secretaryName: target\n        ? \`${'${target.firstName}'} ${'${target.lastName}'}\`.trim()\n        : null,\n    };\n  }\n\n  async validateSensitiveAuthorization(\n    actorUserId: string,\n    dto: { practiceLocationId: string; password: string },\n  ) {\n    const actor = await this.prisma.user.findUnique({\n      where: { id: actorUserId },\n      select: {\n        role: true,\n        accountStatus: true,\n        administrativeRestrictionStatus: true,\n        passwordHash: true,\n      },\n    });\n    if (\n      !actor ||\n      actor.role !== UserRole.DOCTOR ||\n      actor.accountStatus !== UserAccountStatus.ACTIVE ||\n      actor.administrativeRestrictionStatus !== AdministrativeRestrictionStatus.NONE\n    ) {\n      throw new ForbiddenException('Only an eligible current Doctor may authorize this invitation.');\n    }\n\n    const location = await this.prisma.practiceLocation.findFirst({\n      where: {\n        id: dto.practiceLocationId,\n        doctorProfile: { userId: actorUserId },\n      },\n      select: { id: true },\n    });\n    if (!location) throw new NotFoundException('Practice location was not found.');\n    if (!(await this.passwords.verify(dto.password, actor.passwordHash))) {\n      throw new UnauthorizedException('Current password is incorrect.');\n    }\n    return { valid: true as const };\n  }\n\n`;
  if (!service.includes(serviceAnchor)) throw new Error('Service preview anchor not found');
  service = service.replace(serviceAnchor, methods + serviceAnchor);
  write(servicePath, service);
}

const controllerPath = 'src/practice-staff/secretary-invitation.controller.ts';
let controller = read(controllerPath);
controller = ensureReplace(
  controller,
  "import { UpdateSecretaryInvitationDto } from './dto/update-secretary-invitation.dto';",
  "import { UpdateSecretaryInvitationDto } from './dto/update-secretary-invitation.dto';\nimport { ValidateSecretaryInvitationIdentifierDto } from './dto/validate-secretary-invitation-identifier.dto';\nimport { ValidateSecretaryInvitationAuthorizationDto } from './dto/validate-secretary-invitation-authorization.dto';",
  'controller validation DTO imports',
);
if (!controller.includes("@Post('validate-identifier')")) {
  const anchor = '  @UseGuards(SessionAuthGuard, CsrfOriginGuard)\n  @Post()';
  const routes = `  @UseGuards(SessionAuthGuard, CsrfOriginGuard)\n  @Post('validate-identifier')\n  validateIdentifier(\n    @Body() dto: ValidateSecretaryInvitationIdentifierDto,\n    @Request() request: AuthenticatedRequest,\n  ) {\n    return this.invitations.validateIdentifier(request.user.userId, dto);\n  }\n\n  @UseGuards(SessionAuthGuard, CsrfOriginGuard)\n  @Post('validate-authorization')\n  validateAuthorization(\n    @Body() dto: ValidateSecretaryInvitationAuthorizationDto,\n    @Request() request: AuthenticatedRequest,\n  ) {\n    return this.invitations.validateSensitiveAuthorization(\n      request.user.userId,\n      dto,\n    );\n  }\n\n`;
  if (!controller.includes(anchor)) throw new Error('Controller create route anchor not found');
  controller = controller.replace(anchor, routes + anchor);
}
write(controllerPath, controller);

const drawerPath = 'frontend/src/doctor/StaffAssignmentDrawer.tsx';
let drawer = read(drawerPath);
drawer = ensureReplace(
  drawer,
  "  onSubmit,\n}: {\n  data: AuthoritativeClinicStaff;\n  pending: boolean;\n  message: string;\n  onClose: () => void;\n  onSubmit: (command: StaffAssignmentCommand) => void | Promise<void>;\n}) {",
  "  onSubmit,\n  onValidateInviteIdentifier,\n  onValidateInviteAuthorization,\n}: {\n  data: AuthoritativeClinicStaff;\n  pending: boolean;\n  message: string;\n  onClose: () => void;\n  onSubmit: (command: StaffAssignmentCommand) => void | Promise<void>;\n  onValidateInviteIdentifier?: (identifier: string) => Promise<{ existingSecretary: boolean; secretaryName: string | null }>;\n  onValidateInviteAuthorization?: (password: string) => Promise<void>;\n}) {",
  'drawer validation callback props',
);
drawer = ensureReplace(
  drawer,
  "  const [inviteIdentifier, setInviteIdentifier] = useState('');",
  "  const [inviteIdentifier, setInviteIdentifier] = useState('');\n  const [stepValidationPending, setStepValidationPending] = useState(false);\n  const [stepValidationError, setStepValidationError] = useState('');\n  const [validatedInvitee, setValidatedInvitee] = useState<{ existingSecretary: boolean; secretaryName: string | null } | null>(null);",
  'drawer staged validation state',
);
if (!drawer.includes('async function advance()')) {
  drawer = ensureReplace(
    drawer,
    '  function submit() {',
    `  async function advance() {\n    setStepValidationError('');\n    if (mode === 'INVITE' && step === 2 && onValidateInviteIdentifier) {\n      setStepValidationPending(true);\n      try {\n        const result = await onValidateInviteIdentifier(inviteIdentifier.trim().toLowerCase());\n        setValidatedInvitee(result);\n        setStep(3);\n      } catch (cause) {\n        setValidatedInvitee(null);\n        setStepValidationError(\n          cause instanceof Error ? cause.message : 'Unable to validate this Secretary identifier.',\n        );\n      } finally {\n        setStepValidationPending(false);\n      }\n      return;\n    }\n\n    if (\n      mode === 'INVITE' &&\n      step === 4 &&\n      role === 'CLINIC_SECRETARY' &&\n      (current || cancelClinicDay) &&\n      onValidateInviteAuthorization\n    ) {\n      setStepValidationPending(true);\n      try {\n        await onValidateInviteAuthorization(password);\n        setStep(5);\n      } catch (cause) {\n        setStepValidationError(\n          cause instanceof Error ? cause.message : 'Unable to validate the Doctor password.',\n        );\n      } finally {\n        setStepValidationPending(false);\n      }\n      return;\n    }\n\n    setStep((value) => value + 1);\n  }\n\n  function submit() {`,
    'drawer advance function',
  );
}
drawer = drawer.replace(
  /onClick=\{\(\) => setStep\(\(value\) => value \+ 1\)\}/g,
  'onClick={() => void advance()}',
);
drawer = ensureReplace(
  drawer,
  "      {message ? (",
  "      {stepValidationError ? (\n        <div className=\"staff-drawer-message is-error\" role=\"alert\">\n          {stepValidationError}\n        </div>\n      ) : null}\n\n      {message ? (",
  'drawer staged validation error rendering',
);
drawer = drawer.replace(
  "disabled={pending}",
  "disabled={pending || stepValidationPending}",
);
drawer = drawer.replace(
  "{pending\n              ? mode === 'INVITE'",
  "{pending || stepValidationPending\n              ? mode === 'INVITE'",
);
// Review note: validated identity is now informational only; final send still revalidates transactionally.
drawer = drawer.replace(
  "? 'The system will match this email to an existing active, verified Secretary account. No clinic authority is granted until that Secretary accepts.'",
  "? validatedInvitee?.existingSecretary\n                ? `Validated existing Secretary${validatedInvitee.secretaryName ? `: ${validatedInvitee.secretaryName}` : ''}. No clinic authority is granted until acceptance.`\n                : 'Validated invitation identifier. No existing Secretary account was found, so the recipient must create and verify their own Secretary account before accepting. No clinic authority is granted until acceptance.'",
);
write(drawerPath, drawer);

const parentPath = 'frontend/src/doctor/AuthoritativeClinicStaffTab.tsx';
let parent = read(parentPath);
if (!parent.includes('async function validateInviteIdentifier(')) {
  const anchor = '  async function assign(command: StaffAssignmentCommand) {';
  const helpers = `  async function validateInviteIdentifier(identifier: string) {\n    return apiRequest<{\n      valid: true;\n      existingSecretary: boolean;\n      secretaryName: string | null;\n    }>('/practice-staff/invitations/validate-identifier', {\n      method: 'POST',\n      body: { practiceLocationId: clinicId, identifier },\n    });\n  }\n\n  async function validateInviteAuthorization(password: string) {\n    await apiRequest('/practice-staff/invitations/validate-authorization', {\n      method: 'POST',\n      body: { practiceLocationId: clinicId, password },\n    });\n  }\n\n`;
  if (!parent.includes(anchor)) throw new Error('Parent assign anchor not found');
  parent = parent.replace(anchor, helpers + anchor);
}
parent = ensureReplace(
  parent,
  "          onClose={() => setDrawerOpen(false)}\n          onSubmit={assign}",
  "          onClose={() => setDrawerOpen(false)}\n          onSubmit={assign}\n          onValidateInviteIdentifier={validateInviteIdentifier}\n          onValidateInviteAuthorization={validateInviteAuthorization}",
  'parent drawer staged validation props',
);
write(parentPath, parent);

const specPath = 'src/practice-staff/secretary-invitation.service.spec.ts';
let spec = read(specPath);
if (!spec.includes('validates an invitation identifier before review')) {
  const end = spec.lastIndexOf('\n});');
  if (end < 0) throw new Error('Backend spec end not found');
  const tests = `\n  it('validates an invitation identifier before review without creating authority', async () => {\n    prisma.user.findFirst.mockResolvedValue(null);\n    const result = await service.validateIdentifier('doctor-1', {\n      practiceLocationId: 'clinic-1',\n      identifier: 'newsec@example.test',\n    });\n    expect(result).toEqual(\n      expect.objectContaining({ valid: true, existingSecretary: false }),\n    );\n    expect(transaction.secretaryInvitation.create).not.toHaveBeenCalled();\n    expect(transaction.practiceStaff.create).not.toHaveBeenCalled();\n  });\n\n  it('rejects a wrong Doctor password during staged sensitive authorization', async () => {\n    passwords.verify.mockResolvedValue(false);\n    await expect(\n      service.validateSensitiveAuthorization('doctor-1', {\n        practiceLocationId: 'clinic-1',\n        password: 'wrong-password',\n      }),\n    ).rejects.toThrow('Current password is incorrect.');\n  });\n`;
  spec = spec.slice(0, end) + tests + spec.slice(end);
  write(specPath, spec);
}

const frontendSpecPath = 'frontend/src/doctor/AuthoritativeClinicStaffTab.test.tsx';
let frontendSpec = read(frontendSpecPath);
if (!frontendSpec.includes('validates the invite identifier before leaving Invitation Details')) {
  const end = frontendSpec.lastIndexOf('\n});');
  if (end < 0) throw new Error('Frontend spec end not found');
  const test = `\n  it('validates the invite identifier before leaving Invitation Details', async () => {\n    const user = userEvent.setup();\n    const validateIdentifier = vi.fn().mockRejectedValue(\n      new Error('Enter a valid email address or Philippine mobile number.'),\n    );\n    render(\n      <StaffAssignmentDrawer\n        data={staff}\n        pending={false}\n        message=\"\"\n        onClose={() => undefined}\n        onSubmit={() => undefined}\n        onValidateInviteIdentifier={validateIdentifier}\n      />,\n    );\n    await user.click(screen.getByRole('button', { name: /Invite New Secretary/i }));\n    await user.type(screen.getByLabelText(/Secretary.*Address|Secretary.*Number|Email or Mobile/i), 'not-valid');\n    await user.click(screen.getByRole('button', { name: 'Next' }));\n    expect(validateIdentifier).toHaveBeenCalled();\n    expect(await screen.findByRole('alert')).toHaveTextContent(\n      'Enter a valid email address or Philippine mobile number.',\n    );\n    expect(screen.getByRole('heading', { name: 'Invitation Details' })).toBeInTheDocument();\n  });\n`;
  frontendSpec = frontendSpec.slice(0, end) + test + frontendSpec.slice(end);
  write(frontendSpecPath, frontendSpec);
}

console.log('Staged Secretary invitation validation before review is aligned.');
