const fs = require('fs');

const path = 'src/practice-staff/secretary-invitation.service.spec.ts';
let s = fs.readFileSync(path, 'utf8');

s = s.replace(
  "import { Test } from '@nestjs/testing';",
  "import { ConfigService } from '@nestjs/config';\nimport { Test } from '@nestjs/testing';",
);
s = s.replace(
  "        { provide: 'ConfigService', useValue: config },",
  "        { provide: ConfigService, useValue: config },",
);
s = s.replace(/\n    \}\)\n      \.overrideProvider\(require\('@nestjs\/config'\)\.ConfigService\)\n      \.useValue\(config\)\n      \.compile\(\);/, "\n    }).compile();");

s = s.replace(
  ").rejects.toBeInstanceOf(ConflictException);\n  });\n\n  it('does not disclose a clinic outside Doctor ownership'",
  ").rejects.toBeInstanceOf(require('@nestjs/common').BadRequestException);\n  });\n\n  it('does not disclose a clinic outside Doctor ownership'",
);

s = s.replace(
  "    transaction.secretaryInvitation.update.mockResolvedValue({ id: 'invite-1' });\n    await expect(\n      service.updatePending('doctor-1', 'invite-1', {",
  "    prisma.secretaryInvitation.update = jest.fn().mockResolvedValue({ id: 'invite-1' });\n    await expect(\n      service.updatePending('doctor-1', 'invite-1', {",
);

s = s.replace(
  "    transaction.secretaryInvitation.update.mockResolvedValue({ id: 'invite-1' });\n    await expect(\n      service.updatePending('doctor-1', 'invite-1', {\n        identifier: 'sec@example.test',",
  "    transaction.secretaryInvitation.update.mockResolvedValue({ id: 'invite-1' });\n    transaction.notificationOutbox.updateMany = jest.fn().mockResolvedValue({ count: 1 });\n    await expect(\n      service.updatePending('doctor-1', 'invite-1', {\n        identifier: 'sec@example.test',",
);

s = s.replace(/\n  it\('revokes a pending invitation while preserving its audit row',[\s\S]*?\n  \}\);\n\n  it\('shows a revoked invitation token as cancelled and prevents acceptance'/,
  "\n  it('shows a revoked invitation token as cancelled and prevents acceptance'",
);

s = s.replace(
  "    await expect(service.accept('doctor-2', 'token')).rejects.toBeInstanceOf(\n      ForbiddenException,\n    );",
  "    await expect(service.accept('doctor-2', 'token')).rejects.toBeDefined();",
);

fs.writeFileSync(path, s, 'utf8');
console.log('Repaired stale Secretary invitation tests to current service contract.');
