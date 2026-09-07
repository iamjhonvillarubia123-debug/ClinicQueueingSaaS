const fs = require('fs');

const path = 'src/practice-staff/secretary-invitation.service.spec.ts';
let source = fs.readFileSync(path, 'utf8');

function replaceOnce(from, to, label) {
  const index = source.indexOf(from);
  if (index === -1) throw new Error(`Patch target not found: ${label}`);
  if (source.indexOf(from, index + from.length) !== -1) {
    throw new Error(`Patch target not unique: ${label}`);
  }
  source = source.slice(0, index) + to + source.slice(index + from.length);
}

if (!source.includes("import { ConfigService } from '@nestjs/config';")) {
  replaceOnce(
    "import { Test } from '@nestjs/testing';",
    "import { ConfigService } from '@nestjs/config';\nimport { Test } from '@nestjs/testing';",
    'ConfigService import',
  );
}

replaceOnce(
  "        { provide: 'ConfigService', useValue: config },",
  '        { provide: ConfigService, useValue: config },',
  'ConfigService provider token',
);

const overrideBlock = `\n    })\n      .overrideProvider(require('@nestjs/config').ConfigService)\n      .useValue(config)\n      .compile();`;
const directCompile = `\n    }).compile();`;
if (source.includes(overrideBlock)) {
  source = source.replace(overrideBlock, directCompile);
}

if (!source.includes('{ provide: ConfigService, useValue: config }')) {
  throw new Error('Post-patch check failed: ConfigService provider');
}
if (source.includes("{ provide: 'ConfigService'")) {
  throw new Error('Post-patch check failed: stale string ConfigService token');
}

fs.writeFileSync(path, source, 'utf8');
console.log('Aligned SecretaryInvitationService test harness with ConfigService dependency.');
