const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const target = path.join(root, 'test', 'app.e2e-spec.ts');
const knownGoodCommit = '1c640e78fee7340426459109736400ec637d6b5c';

const content = execFileSync(
  'git',
  ['show', `${knownGoodCommit}:test/app.e2e-spec.ts`],
  {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  },
);

const testCount = (content.match(/\bit\('/g) || []).length;
if (testCount !== 11) {
  throw new Error(
    `Known-good source should contain 11 tests, found ${testCount}. No file was written.`,
  );
}

let repaired = content;

const replacements = [
  [
    ".post('/auth/register')\n      .send({\n        firstName: 'Jane',\n        lastName: 'Doe',\n        email,\n        mobileNumber: '09171234567',",
    ".post('/auth/register')\n      .send({\n        firstName: 'Jane',\n        lastName: 'Doe',\n        identifier: email,",
  ],
  [
    '.post(\'/auth/login\')\n      .send({ email, password })',
    '.post(\'/auth/login\')\n      .send({ identifier: email, password })',
  ],
  [
    '.post(\'/auth/request-password-reset\')\n      .send({ email })',
    '.post(\'/auth/request-password-reset\')\n      .send({ identifier: email })',
  ],
  [
    ".post('/doctor/account/permanent-delete')\n      .set('Idempotency-Key', idempotencyKey)\n      .send({\n        email,",
    ".post('/doctor/account/permanent-delete')\n      .set('Idempotency-Key', idempotencyKey)\n      .send({\n        identifier: email,",
  ],
  [
    ".post('/doctor/account/permanent-delete')\n      .set('Idempotency-Key', `delete-started-${unique}`)\n      .send({\n        email,",
    ".post('/doctor/account/permanent-delete')\n      .set('Idempotency-Key', `delete-started-${unique}`)\n      .send({\n        identifier: email,",
  ],
];

for (const [from, to] of replacements) {
  if (!repaired.includes(from)) {
    throw new Error(
      `Expected known-good request shape not found: ${from.split('\n')[0]}. No file was written.`,
    );
  }
  repaired = repaired.replaceAll(from, to);
}

repaired = repaired
  .replaceAll('emailVerificationRequired', 'verificationRequired')
  .replaceAll('emailVerificationExpiresAt', 'verificationExpiresAt');

const repairedTestCount = (repaired.match(/\bit\('/g) || []).length;
if (repairedTestCount !== 11) {
  throw new Error(
    `Recovered file should still contain 11 tests, found ${repairedTestCount}. No file was written.`,
  );
}

fs.writeFileSync(target, repaired, 'utf8');
console.log(
  'Recovered test/app.e2e-spec.ts from known-good commit and applied targeted current contracts.',
);
console.log('Recovered test count: 11');
