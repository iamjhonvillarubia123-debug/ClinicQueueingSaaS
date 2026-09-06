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

function transformEndpoint(content, endpoint, transform) {
  const marker = `.post('${endpoint}')`;
  let cursor = 0;
  let output = '';
  while (true) {
    const start = content.indexOf(marker, cursor);
    if (start < 0) {
      output += content.slice(cursor);
      return output;
    }
    output += content.slice(cursor, start);
    const nextPost = content.indexOf('.post(', start + marker.length);
    const end = nextPost < 0 ? content.length : nextPost;
    output += transform(content.slice(start, end));
    cursor = end;
  }
}

function identifierRequests(block) {
  return block
    .replace(/\.send\(\{ email, password \}\)/g, '.send({ identifier: email, password })')
    .replace(/\.send\(\{ email, password: ([^}\r\n]+) \}\)/g, '.send({ identifier: email, password: $1 })')
    .replace(/\.send\(\{ email: ([^,}\r\n]+), password \}\)/g, '.send({ identifier: $1, password })')
    .replace(/\.send\(\{ email: ([^,}\r\n]+), password: ([^}\r\n]+) \}\)/g, '.send({ identifier: $1, password: $2 })')
    .replace(/\.send\(\{ email \}\)/g, '.send({ identifier: email })')
    .replace(/\.send\(\{ email: (.+) \}\)/g, '.send({ identifier: $1 })')
    .replace(/(\.send\(\{\r?\n[\s\S]*?\r?\n)([ \t]+)email,(\r?\n)/g, '$1$2identifier: email,$3')
    .replace(/(\.send\(\{\r?\n[\s\S]*?\r?\n)([ \t]+)email: ([^,\r\n]+),(\r?\n)/g, '$1$2identifier: $3,$4');
}

let content = gitShow(`${knownGoodCommit}:test/app.e2e-spec.ts`);

const originalTestCount = (content.match(/\bit\('/g) || []).length;
if (originalTestCount !== 11) {
  throw new Error(`Known-good source should contain 11 tests, found ${originalTestCount}. No file was written.`);
}

for (const endpoint of [
  '/auth/login',
  '/auth/request-password-reset',
  '/doctor/account/reactivate',
  '/doctor/account/permanent-delete',
]) {
  content = transformEndpoint(content, endpoint, identifierRequests);
}

content = transformEndpoint(content, '/auth/register', (block) =>
  block
    .replace(/([ \t]*)email,\r?\n\1mobileNumber: '[^']+',\r?\n/g, '$1identifier: email,\n')
    .replace(/([ \t]*)email: ([^,\n]+),\r?\n\1mobileNumber: '[^']+',\r?\n/g, '$1identifier: $2,\n'),
);

content = content
  .replace(/emailVerificationRequired/g, 'verificationRequired')
  .replace(/emailVerificationExpiresAt/g, 'verificationExpiresAt');

const finalTestCount = (content.match(/\bit\('/g) || []).length;
if (finalTestCount !== 11) {
  throw new Error(`Recovered file should still contain 11 tests, found ${finalTestCount}. No file was written.`);
}

for (const endpoint of [
  '/auth/login',
  '/auth/request-password-reset',
  '/doctor/account/reactivate',
  '/doctor/account/permanent-delete',
]) {
  const marker = `.post('${endpoint}')`;
  let start = content.indexOf(marker);
  while (start >= 0) {
    const nextPost = content.indexOf('.post(', start + marker.length);
    const block = content.slice(start, nextPost < 0 ? content.length : nextPost);
    if (/\.send\(\{ email(?:[, }])/.test(block) || /\n\s+email,\n/.test(block)) {
      throw new Error(`Obsolete email request remains for ${endpoint}. No file was written.`);
    }
    start = content.indexOf(marker, start + marker.length);
  }
}

fs.writeFileSync(target, content, 'utf8');
console.log('Recovered test/app.e2e-spec.ts from known-good commit and applied current dual-identifier contracts.');
console.log('Recovered test count: 11');
