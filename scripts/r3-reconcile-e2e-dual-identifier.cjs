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
];

function replaceAllChecked(content, search, replacement, label, minimum = 1) {
  const occurrences = content.split(search).length - 1;
  if (occurrences < minimum) {
    throw new Error(`${label}: expected at least ${minimum} occurrence(s), found ${occurrences}`);
  }
  return content.split(search).join(replacement);
}

for (const relativePath of targets) {
  const filePath = path.join(root, relativePath);
  let content = fs.readFileSync(filePath, 'utf8');
  const original = content;

  // Current F6 auth contracts use one primary identifier field for email or mobile.
  content = content.replace(/\.send\(\{ email, password \}\)/g, '.send({ identifier: email, password })');
  content = content.replace(/\.send\(\{ email, password: ([^}]+) \}\)/g, '.send({ identifier: email, password: $1 })');
  content = content.replace(/\.send\(\{ email: ([^,}]+), password \}\)/g, '.send({ identifier: $1, password })');
  content = content.replace(/\.send\(\{ email: ([^,}]+), password: ([^}]+) \}\)/g, '.send({ identifier: $1, password: $2 })');
  content = content.replace(/\.send\(\{ email \}\)/g, '.send({ identifier: email })');

  // Lifecycle pre-login endpoints now use the same primary-identifier contract.
  content = content.replace(/\.send\(\{ email, password: ([^}]+) \}\)/g, '.send({ identifier: email, password: $1 })');

  // Public account registration now accepts one identifier rather than separate email/mobile fields.
  content = content.replace(
    /([ \t]*)email,\r?\n\1mobileNumber: '[^']+',\r?\n/g,
    '$1identifier: email,\n',
  );
  content = content.replace(
    /([ \t]*)email: ([^,\n]+),\r?\n\1mobileNumber: '[^']+',\r?\n/g,
    '$1identifier: $2,\n',
  );

  // A few lifecycle DTOs used an explicit email property rather than the shorthand form.
  content = content.replace(/([ \t]*)email: email,\r?\n/g, '$1identifier: email,\n');

  if (content !== original) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`updated ${relativePath}`);
  } else {
    console.log(`no changes ${relativePath}`);
  }
}

// Guard against leaving the known obsolete HTTP request shapes in the affected files.
const forbidden = [
  /\.post\('\/auth\/login'\)[\s\S]{0,120}\.send\(\{ email[, }]/,
  /\.post\('\/auth\/request-password-reset'\)[\s\S]{0,120}\.send\(\{ email[, }]/,
  /\.post\('\/auth\/register'\)[\s\S]{0,220}\.send\(\{[\s\S]*?\n\s*email[, :]/,
];

for (const relativePath of targets) {
  const content = fs.readFileSync(path.join(root, relativePath), 'utf8');
  for (const pattern of forbidden) {
    if (pattern.test(content)) {
      throw new Error(`${relativePath}: obsolete dual-identifier HTTP request shape remains (${pattern})`);
    }
  }
}

console.log('R3 E2E dual-identifier reconciliation complete.');
