const fs = require('fs');

const files = {
  permanentDto: 'src/secretary/dto/permanently-delete-secretary.dto.ts',
  reactivateDto: 'src/secretary/dto/reactivate-secretary.dto.ts',
  controller: 'src/secretary/secretary.controller.ts',
  service: 'src/secretary/secretary-lifecycle.service.ts',
  module: 'src/secretary/secretary.module.ts',
  frontend: 'frontend/src/auth/AccountLifecyclePages.tsx',
};

function read(path) { return fs.readFileSync(path, 'utf8'); }
function write(path, value) { fs.writeFileSync(path, value); }
function replaceOnce(source, from, to, label) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`Patch target not found: ${label}`);
  return source.replace(from, to);
}

function reconcileIdentifierDto(source, { permanent }) {
  source = source.replace(
    /import\s*\{([^}]*)\}\s*from\s*['"]class-validator['"];?/,
    (_match, names) => {
      const validators = names
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean)
        .filter((name) => name !== 'IsEmail');
      if (!validators.includes('IsString')) validators.push('IsString');
      return `import { ${validators.join(', ')} } from 'class-validator';`;
    },
  );

  source = source.replace(
    /\s*@IsEmail\(\)\s*(?:\r?\n\s*)?email!:\s*string;/,
    '\n  @IsString()\n  identifier!: string;',
  );

  // Recover partially reconciled files where the import changed but the old
  // decorator/property pair survived because of newline or formatting drift.
  source = source.replace(
    /\s*@IsEmail\(\)\s*(?:\r?\n\s*)?identifier!:\s*string;/,
    '\n  @IsString()\n  identifier!: string;',
  );
  source = source.replace(
    /\s*@IsString\(\)\s*(?:\r?\n\s*)?email!:\s*string;/,
    '\n  @IsString()\n  identifier!: string;',
  );

  if (source.includes('@IsEmail()')) {
    throw new Error(`Stale @IsEmail() remains in ${permanent ? 'permanent-delete' : 'reactivate'} Secretary DTO.`);
  }
  if (!source.includes('identifier!: string;')) {
    throw new Error(`Secretary ${permanent ? 'permanent-delete' : 'reactivate'} DTO was not reconciled to identifier.`);
  }
  return source;
}

let permanentDto = reconcileIdentifierDto(read(files.permanentDto), { permanent: true });
write(files.permanentDto, permanentDto);

let reactivateDto = reconcileIdentifierDto(read(files.reactivateDto), { permanent: false });
write(files.reactivateDto, reactivateDto);

let controller = read(files.controller);
controller = controller.replace("subject: { kind: 'BODY', field: 'email' }", "subject: { kind: 'BODY', field: 'identifier' }");
controller = controller.replace("subject: { kind: 'BODY', field: 'email' }", "subject: { kind: 'BODY', field: 'identifier' }");
controller = controller.replace('      dto.email,\n      dto.password,', '      dto.identifier,\n      dto.password,');
controller = controller.replace('      dto.email,\n      dto.password,', '      dto.identifier,\n      dto.password,');
controller = controller.replace(/dto\.email,/g, 'dto.identifier,');
write(files.controller, controller);

let moduleFile = read(files.module);
if (!moduleFile.includes('MobileNumberModule')) {
  moduleFile = replaceOnce(
    moduleFile,
    "import { PrismaModule } from '../prisma/prisma.module';",
    "import { PrismaModule } from '../prisma/prisma.module';\nimport { MobileNumberModule } from '../security/mobile-number/mobile-number.module';",
    'MobileNumberModule import',
  );
  moduleFile = moduleFile.replace('imports: [PrismaModule, AuthModule]', 'imports: [PrismaModule, AuthModule, MobileNumberModule]');
}
write(files.module, moduleFile);

let service = read(files.service);
if (!service.includes('parseAccountIdentifier')) {
  service = replaceOnce(
    service,
    "import { PasswordSecurityService } from '../auth/security/password-security.service';\nimport { normalizeEmail } from '../auth/security/session-security';",
    "import { parseAccountIdentifier } from '../auth/security/account-identifier';\nimport { PasswordSecurityService } from '../auth/security/password-security.service';",
    'identifier parser import',
  );
  service = replaceOnce(
    service,
    "import { PrismaService } from '../prisma/prisma.service';",
    "import { PrismaService } from '../prisma/prisma.service';\nimport { MobileNumberService } from '../security/mobile-number/mobile-number.service';",
    'mobile service import',
  );
}
if (!service.includes('private readonly mobileNumbers: MobileNumberService')) {
  service = replaceOnce(
    service,
    '    private readonly passwordSecurityService: PasswordSecurityService,\n  ) {}',
    '    private readonly passwordSecurityService: PasswordSecurityService,\n    private readonly mobileNumbers: MobileNumberService,\n  ) {}',
    'mobile service dependency',
  );
}
service = service.replace(
  /  async reactivate\(email: string, password: string, idempotencyKey: string\) \{\n    const key = this\.normalizeIdempotencyKey\(idempotencyKey\);\n    const normalizedEmail = normalizeEmail\(email\);\n\n    const currentUser = await this\.prisma\.user\.findFirst\(\{\n      where: \{\n        email: normalizedEmail,\n        role: UserRole\.SECRETARY,\n        accountStatus: \{ not: UserAccountStatus\.PERMANENTLY_CLOSED \},\n      \},\n      select: \{ id: true \},\n    \}\);/,
  `  async reactivate(identifierInput: string, password: string, idempotencyKey: string) {\n    const key = this.normalizeIdempotencyKey(idempotencyKey);\n    const identifier = parseAccountIdentifier(identifierInput, this.mobileNumbers);\n\n    const currentUser = await this.prisma.user.findFirst({\n      where: {\n        ...(identifier.type === 'EMAIL'\n          ? { loginIdentifierType: 'EMAIL', email: identifier.normalized }\n          : { loginIdentifierType: 'MOBILE', mobileNumberHash: identifier.mobileHash }),\n        role: UserRole.SECRETARY,\n        accountStatus: { not: UserAccountStatus.PERMANENTLY_CLOSED },\n      },\n      select: { id: true },\n    });`,
);
service = service.replace(
  /  async permanentlyDelete\(\n    email: string,\n    password: string,\n    confirmPermanentDelete: boolean,\n    idempotencyKey: string,\n  \) \{([\s\S]*?)    const key = this\.normalizeIdempotencyKey\(idempotencyKey\);\n    const normalizedEmail = normalizeEmail\(email\);\n\n    const target = await this\.prisma\.user\.findFirst\(\{\n      where: \{\n        email: normalizedEmail,\n        role: UserRole\.SECRETARY,\n      \},/,
  `  async permanentlyDelete(\n    identifierInput: string,\n    password: string,\n    confirmPermanentDelete: boolean,\n    idempotencyKey: string,\n  ) {$1    const key = this.normalizeIdempotencyKey(idempotencyKey);\n    const identifier = parseAccountIdentifier(identifierInput, this.mobileNumbers);\n\n    const target = await this.prisma.user.findFirst({\n      where: {\n        ...(identifier.type === 'EMAIL'\n          ? { loginIdentifierType: 'EMAIL', email: identifier.normalized }\n          : { loginIdentifierType: 'MOBILE', mobileNumberHash: identifier.mobileHash }),\n        role: UserRole.SECRETARY,\n      },`,
);
write(files.service, service);

let frontend = read(files.frontend);
frontend = frontend.replace("return 'Email or current password is incorrect.';", "return 'Sign-in identifier or current password is incorrect.';");
frontend = frontend.replace("return 'The account type, email, or current password is incorrect.';", "return 'The account type, sign-in identifier, or current password is incorrect.';");
frontend = frontend.replace('You can reactivate later with your email and password', 'You can reactivate later with your sign-in identifier and password');
frontend = frontend.replace('Password replacement is completed through your verified email', 'Password replacement is completed through your verified primary sign-in identifier');
frontend = frontend.replace("  const [email, setEmail] = useState('');\n  const [password, setPassword] = useState('');", "  const [identifier, setIdentifier] = useState('');\n  const [password, setPassword] = useState('');");
frontend = frontend.replace('if (!role || !email.trim() || !password || submitting) return;', 'if (!role || !identifier.trim() || !password || submitting) return;');
frontend = frontend.replace('body: { email, password },', 'body: { identifier, password },');
frontend = frontend.replace('<label htmlFor="reactivation-email">Email address</label><div className="sign-in-input"><ReactivationIcon name="mail" /><input id="reactivation-email" type="email" autoComplete="email" required placeholder="Enter your email address" value={email} onChange={(event) => setEmail(event.target.value)} /></div>', '<label htmlFor="reactivation-identifier">Email or mobile number</label><div className="sign-in-input"><ReactivationIcon name="mail" /><input id="reactivation-identifier" type="text" autoComplete="username" required placeholder="Enter your sign-in email or mobile number" value={identifier} onChange={(event) => setIdentifier(event.target.value)} /></div>');
frontend = frontend.replace('disabled={submitting || !role || !email.trim() || !password}', 'disabled={submitting || !role || !identifier.trim() || !password}');
frontend = frontend.replace("  const [email, setEmail] = useState('');\n  const [password, setPassword] = useState('');", "  const [identifier, setIdentifier] = useState('');\n  const [password, setPassword] = useState('');");
frontend = frontend.replace('body: { email, password, confirmPermanentDelete: true },', 'body: { identifier, password, confirmPermanentDelete: true },');
frontend = frontend.replace('<label>Email<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>', '<label>Sign-in identifier<input type="text" autoComplete="username" required placeholder="Email or Philippine mobile number" value={identifier} onChange={(event) => setIdentifier(event.target.value)} /></label>');
frontend = frontend.replace('disabled={submitting || !email || !password || !confirmed}', 'disabled={submitting || !identifier || !password || !confirmed}');
write(files.frontend, frontend);

console.log('Reconciled Secretary reactivation and permanent closure to the verified primary sign-in identifier.');
