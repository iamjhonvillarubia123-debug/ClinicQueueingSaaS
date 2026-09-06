const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const target = path.join(root, 'test', 'app.e2e-spec.ts');
const knownGoodCommit = '1c640e78fee7340426459109736400ec637d6b5c';

function gitShow(spec) {
  return execFileSync('git', ['show', spec], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
}

let content = gitShow(`${knownGoodCommit}:test/app.e2e-spec.ts`);

const originalTestCount = (content.match(/\bit\('/g) || []).length;
if (originalTestCount !== 11) {
  throw new Error(
    `Known-good source should contain 11 tests, found ${originalTestCount}. No file was written.`,
  );
}

const replacements = [
  [".post('/auth/register')\n      .send({\n        firstName: 'Jane',\n        lastName: 'Doe',\n        email,\n        mobileNumber: '09171234567',", ".post('/auth/register')\n      .send({\n        firstName: 'Jane',\n        lastName: 'Doe',\n        identifier: email,"],
  [".post('/auth/login')\n      .send({ email, password })", ".post('/auth/login')\n      .send({ identifier: email, password })"],
  [".post('/auth/request-password-reset')\n      .send({ email })", ".post('/auth/request-password-reset')\n      .send({ identifier: email })"],
  [".post('/doctor/account/reactivate')\n      .send({\n        email,", ".post('/doctor/account/reactivate')\n      .send({\n        identifier: email,"],
  [".post('/doctor/account/permanent-delete')\n      .set('Idempotency-Key', idempotencyKey)\n      .send({\n        email,", ".post('/doctor/account/permanent-delete')\n      .set('Idempotency-Key', idempotencyKey)\n      .send({\n        identifier: email,"],
  [".post('/doctor/account/permanent-delete')\n      .set('Idempotency-Key', `delete-replay-${unique}`)\n      .send({\n        email,", ".post('/doctor/account/permanent-delete')\n      .set('Idempotency-Key', `delete-replay-${unique}`)\n      .send({\n        identifier: email,"],
  [".post('/doctor/account/permanent-delete')\n      .set('Idempotency-Key', `delete-started-${unique}`)\n      .send({\n        email,", ".post('/doctor/account/permanent-delete')\n      .set('Idempotency-Key', `delete-started-${unique}`)\n      .send({\n        identifier: email,"],
];

for (const [from, to] of replacements) {
  if (!content.includes(from)) {
    throw new Error(`Expected known-good request shape not found: ${from.split('\n')[0]}. No file was written.`);
  }
  content = content.replace(from, to);
}

content = content
  .replace(/emailVerificationRequired/g, 'verificationRequired')
  .replace(/emailVerificationExpiresAt/g, 'verificationExpiresAt');

const finalTestCount = (content.match(/\bit\('/g) || []).length;
if (finalTestCount !== 11) {
  throw new Error(
    `Recovered file should still contain 11 tests, found ${finalTestCount}. No file was written.`,
  );
}

for (const forbidden of [
  ".post('/auth/login')\n      .send({ email, password })",
  ".post('/auth/request-password-reset')\n      .send({ email })",
  ".post('/doctor/account/reactivate')\n      .send({\n        email,",
  ".post('/doctor/account/permanent-delete')\n      .set('Idempotency-Key', idempotencyKey)\n      .send({\n        email,",
  ".post('/doctor/account/permanent-delete')\n      .set('Idempotency-Key', `delete-replay-${unique}`)\n      .send({\n        email,",
  ".post('/doctor/account/permanent-delete')\n      .set('Idempotency-Key', `delete-started-${unique}`)\n      .send({\n        email,",
]) {
  if (content.includes(forbidden)) {
    throw new Error('A stale request body remains. No file was written.');
  }
}

fs.writeFileSync(target, content, 'utf8');
console.log(
  'Recovered test/app.e2e-spec.ts from known-good commit and applied exact current request contracts.',
);
console.log('Recovered test count: 11');
