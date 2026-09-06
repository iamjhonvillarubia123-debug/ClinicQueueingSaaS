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

function transformRequestBodies(content, endpoint, transform) {
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
    const sendStart = content.indexOf('.send({', start + marker.length);
    const nextPost = content.indexOf('.post(', start + marker.length);

    if (sendStart < 0 || (nextPost >= 0 && sendStart > nextPost)) {
      output += content.slice(start, nextPost < 0 ? content.length : nextPost);
      cursor = nextPost < 0 ? content.length : nextPost;
      if (cursor >= content.length) return output;
      continue;
    }

    const sendEnd = content.indexOf('})', sendStart);
    if (sendEnd < 0 || (nextPost >= 0 && sendEnd > nextPost)) {
      throw new Error(`Could not isolate request body for ${endpoint}. No file was written.`);
    }

    output += content.slice(start, sendStart);
    output += transform(content.slice(sendStart, sendEnd + 2));
    cursor = sendEnd + 2;
  }
}

function replaceEmailKey(body) {
  return body
    .replace(/\.send\(\{ email, password \}\)/g, '.send({ identifier: email, password })')
    .replace(/\.send\(\{ email, password: ([^}\r\n]+) \}\)/g, '.send({ identifier: email, password: $1 })')
    .replace(/\.send\(\{ email: ([^,}\r\n]+), password \}\)/g, '.send({ identifier: $1, password })')
    .replace(/\.send\(\{ email: ([^,}\r\n]+), password: ([^}\r\n]+) \}\)/g, '.send({ identifier: $1, password: $2 })')
    .replace(/\.send\(\{ email \}\)/g, '.send({ identifier: email })')
    .replace(/\.send\(\{ email: (.+) \}\)/g, '.send({ identifier: $1 })')
    .replace(/\n([ \t]+)email,(\r?\n)/g, '\n$1identifier: email,$2')
    .replace(/\n([ \t]+)email: ([^,\r\n]+),(\r?\n)/g, '\n$1identifier: $2,$3');
}

function replaceRegistrationIdentity(body) {
  return body
    .replace(/\n([ \t]+)email,(\r?\n)([ \t]+)mobileNumber: '[^']+',/g, '\n$1identifier: email,$2')
    .replace(/\n([ \t]+)email: ([^,\r\n]+),(\r?\n)([ \t]+)mobileNumber: '[^']+',/g, '\n$1identifier: $2,$3');
}

function assertNoEmailBody(content, endpoint) {
  const marker = `.post('${endpoint}')`;
  let cursor = 0;

  while (true) {
    const start = content.indexOf(marker, cursor);
    if (start < 0) return;

    const sendStart = content.indexOf('.send({', start + marker.length);
    const nextPost = content.indexOf('.post(', start + marker.length);
    if (sendStart < 0 || (nextPost >= 0 && sendStart > nextPost)) {
      cursor = nextPost < 0 ? content.length : nextPost;
      if (cursor >= content.length) return;
      continue;
    }

    const sendEnd = content.indexOf('})', sendStart);
    if (sendEnd < 0) throw new Error(`Could not inspect request body for ${endpoint}.`);
    const body = content.slice(sendStart, sendEnd + 2);

    if (/\bemail\s*[:,}]/.test(body)) {
      throw new Error(`Obsolete email request remains for ${endpoint}. No file was written.`);
    }

    cursor = sendEnd + 2;
  }
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
  content = transformRequestBodies(content, endpoint, replaceEmailKey);
}

content = transformRequestBodies(content, '/auth/register', replaceRegistrationIdentity);

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
  assertNoEmailBody(content, endpoint);
}

fs.writeFileSync(target, content, 'utf8');
console.log('Recovered test/app.e2e-spec.ts from known-good commit and applied current dual-identifier contracts.');
console.log('Recovered test count: 11');
