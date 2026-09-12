const fs = require('fs');

const path = 'src/practice-staff/secretary-invitation.service.spec.ts';
let s = fs.readFileSync(path, 'utf8');

function replaceIfPresent(from, to) {
  if (s.includes(from)) s = s.replace(from, to);
}

replaceIfPresent(
  "    notificationOutbox: {\n      create: jest.fn(),\n    },",
  "    notificationOutbox: {\n      create: jest.fn(),\n      updateMany: jest.fn(),\n    },",
);

replaceIfPresent(
  "    secretaryInvitation: { findUnique: jest.fn(), findFirst: jest.fn() },",
  "    secretaryInvitation: {\n      findUnique: jest.fn(),\n      findFirst: jest.fn(),\n      update: jest.fn(),\n    },",
);

const requiredMarkers = [
  'notificationOutbox: {',
  'updateMany: jest.fn()',
  'secretaryInvitation: {',
  'update: jest.fn()',
];
for (const marker of requiredMarkers) {
  if (!s.includes(marker)) {
    throw new Error(`Required test mock marker missing after patch: ${marker}`);
  }
}

fs.writeFileSync(path, s, 'utf8');
console.log('Aligned remaining Secretary invitation test mocks with current service implementation.');
