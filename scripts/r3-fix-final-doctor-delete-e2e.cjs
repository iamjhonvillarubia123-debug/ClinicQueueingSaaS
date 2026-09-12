const fs = require('fs');
const path = require('path');

const filePath = path.resolve(__dirname, '..', 'test', 'app.e2e-spec.ts');
let content = fs.readFileSync(filePath, 'utf8');

const oldBody = [
  "      .send({",
  "        email,",
  "        password,",
  "        confirmPermanentDelete: true,",
  "      })",
].join('\n');

const newBody = [
  "      .send({",
  "        identifier: email,",
  "        password,",
  "        confirmPermanentDelete: true,",
  "      })",
].join('\n');

const occurrences = content.split(oldBody).length - 1;
if (occurrences !== 3) {
  throw new Error(
    `Expected exactly 3 stale Doctor permanent-delete request bodies, found ${occurrences}. No file changes were written.`,
  );
}

content = content.split(oldBody).join(newBody);

const remaining = content.split(oldBody).length - 1;
if (remaining !== 0) {
  throw new Error('Doctor permanent-delete request reconciliation was incomplete.');
}

fs.writeFileSync(filePath, content, 'utf8');
console.log('Updated exactly 3 Doctor permanent-delete E2E request bodies.');
