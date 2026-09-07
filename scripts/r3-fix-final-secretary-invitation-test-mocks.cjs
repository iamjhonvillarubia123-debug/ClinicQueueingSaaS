const fs = require('fs');

const path = 'src/practice-staff/secretary-invitation.service.spec.ts';
let s = fs.readFileSync(path, 'utf8');

function replaceRequired(from, to, label) {
  if (!s.includes(from)) throw new Error(`Patch target not found: ${label}`);
  s = s.replace(from, to);
}

replaceRequired(
  "import {\n  ConflictException,\n  ForbiddenException,\n  NotFoundException,\n  UnauthorizedException,\n} from '@nestjs/common';",
  "import {\n  BadRequestException,\n  ConflictException,\n  ForbiddenException,\n  NotFoundException,\n  UnauthorizedException,\n} from '@nestjs/common';",
  'BadRequestException import',
);

replaceRequired(
  "    notificationOutbox: {\n      create: jest.fn(),\n    },",
  "    notificationOutbox: {\n      create: jest.fn(),\n      updateMany: jest.fn(),\n    },",
  'transaction notification outbox updateMany mock',
);

replaceRequired(
  "    secretaryInvitation: { findUnique: jest.fn(), findFirst: jest.fn() },",
  "    secretaryInvitation: {\n      findUnique: jest.fn(),\n      findFirst: jest.fn(),\n      update: jest.fn(),\n    },",
  'root secretary invitation update mock',
);

replaceRequired(
  ").rejects.toBeInstanceOf(ConflictException);\n  });\n\n  it('does not disclose a clinic outside Doctor ownership'",
  ").rejects.toBeInstanceOf(BadRequestException);\n  });\n\n  it('does not disclose a clinic outside Doctor ownership'",
  'empty authority plan expected exception',
);

fs.writeFileSync(path, s, 'utf8');
console.log('Aligned remaining Secretary invitation test mocks with current service implementation.');
