const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const targets = [
  'test/app.e2e-spec.ts',
  'test/r1-secretary-password-reset-parity.e2e-spec.ts',
  'test/r1-secretary-disable-reactivate.e2e-spec.ts',
  'test/r1-secretary-permanent-closure.e2e-spec.ts',
  'test/account-security-closure.e2e-spec.ts',
  'test/r1-auth-role-boundary.e2e-spec.ts',
  'test/r1-secretary-zero-assignment-account.e2e-spec.ts',
  'test/rate-limit.e2e-spec.ts',
];

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

for (const relativePath of targets) {
  const filePath = path.join(root, relativePath);
  let content = fs.readFileSync(filePath, 'utf8');
  const original = content;

  // Only endpoints whose approved/current DTO actually uses the dual identifier are changed.
  content = transformEndpoint(content, '/auth/login', identifierRequests);
  content = transformEndpoint(content, '/auth/request-password-reset', identifierRequests);
  content = transformEndpoint(content, '/doctor/account/reactivate', identifierRequests);
  content = transformEndpoint(content, '/doctor/account/permanent-delete', identifierRequests);

  // Common F6 registration accepts one primary identifier and no second contact field.
  content = transformEndpoint(content, '/auth/register', (block) =>
    block
      .replace(/([ \t]*)email,\r?\n\1mobileNumber: '[^']+',\r?\n/g, '$1identifier: email,\n')
      .replace(/([ \t]*)email: ([^,\n]+),\r?\n\1mobileNumber: '[^']+',\r?\n/g, '$1identifier: $2,\n'),
  );

  // Registration response names were generalized from email-only verification.
  content = content
    .replace(/emailVerificationRequired/g, 'verificationRequired')
    .replace(/emailVerificationExpiresAt/g, 'verificationExpiresAt');

  // Secretary lifecycle endpoints still have their existing email DTO during this reconciliation slice.
  content = transformEndpoint(content, '/secretary/account/reactivate', (block) =>
    block.replace(/identifier: email/g, 'email'),
  );
  content = transformEndpoint(content, '/secretary/account/permanent-delete', (block) =>
    block.replace(/identifier: email/g, 'email'),
  );

  // Legacy /doctor/register is an onboarding compatibility endpoint with its own DTO. Leave it unchanged.

  // Secretary workspace deliberately returns account identity plus authority collections.
  if (relativePath === 'test/r1-secretary-password-reset-parity.e2e-spec.ts') {
    content = content.replace(
      "expect(workspace.body).toEqual({ clinics: [], invitations: [] });",
      "expect(workspace.body).toEqual({\n      account: {\n        firstName: 'Reset',\n        lastName: 'Secretary',\n        email,\n        mobileNumber: '+639171234567',\n      },\n      clinics: [],\n      invitations: [],\n    });",
    );
  }

  if (relativePath === 'test/r1-secretary-disable-reactivate.e2e-spec.ts') {
    content = content.replace(
      "expect(workspace.body).toEqual({ clinics: [], invitations: [] });",
      "expect(workspace.body).toEqual({\n      account: {\n        firstName: 'Maria',\n        lastName: 'Secretary',\n        email,\n        mobileNumber: '+639171234567',\n      },\n      clinics: [],\n      invitations: [],\n    });",
    );
  }

  if (relativePath === 'test/r1-secretary-zero-assignment-account.e2e-spec.ts') {
    content = content.replace("mobileNumber: '09171234567',", 'mobileNumber: null,');
  }

  fs.writeFileSync(filePath, content, 'utf8');
  console.log(content === original ? `no changes ${relativePath}` : `updated ${relativePath}`);
}

// Endpoint-aware guards. They intentionally do not flag legacy /doctor/register or Secretary lifecycle DTOs.
for (const relativePath of targets) {
  const content = fs.readFileSync(path.join(root, relativePath), 'utf8');
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
        throw new Error(`${relativePath}: obsolete email request remains for ${endpoint}`);
      }
      start = content.indexOf(marker, start + marker.length);
    }
  }
}

console.log('R3 E2E endpoint-aware reconciliation complete.');
