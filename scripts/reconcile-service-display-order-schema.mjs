import { readFile, writeFile } from 'node:fs/promises';

const schemaPath = new URL('../prisma/schema.prisma', import.meta.url);
let schema = await readFile(schemaPath, 'utf8');

const fail = (message) => {
  throw new Error(`Service display-order schema reconciliation failed: ${message}`);
};

function modelBlock(name) {
  const match = schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`, 'm'));
  if (!match) fail(`${name} model not found`);
  return match[0];
}

function modelHasField(modelName, fieldName) {
  return new RegExp(`^\\s*${fieldName}\\s+`, 'm').test(modelBlock(modelName));
}

if (!modelHasField('PracticeLocationService', 'displayOrder')) {
  const model = modelBlock('PracticeLocationService');
  const updated = model.replace(
    /(\s+durationMinutes\s+Int[^\n]*\r?\n)/,
    `$1  // Presentation-only ordering. This does not affect queue, booking priority, or Service selection semantics.\n  displayOrder    Int @default(0)\n`,
  );
  if (updated === model) fail('PracticeLocationService durationMinutes anchor not found');
  schema = schema.replace(model, updated);
}

if (!modelHasField('SecretarySettingsDraftService', 'proposedDisplayOrder')) {
  const model = modelBlock('SecretarySettingsDraftService');
  const updated = model.replace(
    /(\s+proposedDurationMinutes\s+Int[^\n]*\r?\n)/,
    `$1  proposedDisplayOrder    Int @default(0)\n`,
  );
  if (updated === model) fail('SecretarySettingsDraftService proposedDurationMinutes anchor not found');
  schema = schema.replace(model, updated);
}

{
  const model = modelBlock('PracticeLocationService');
  if (!model.includes('@@index([practiceLocationId, displayOrder])')) {
    const updated = model.replace(
      /(\s+@@index\(\[practiceLocationId, status\]\)[^\n]*\r?\n)/,
      `  @@index([practiceLocationId, displayOrder])\n$1`,
    );
    if (updated === model) fail('PracticeLocationService index anchor not found');
    schema = schema.replace(model, updated);
  }
}

if (!modelHasField('PracticeLocationService', 'displayOrder')) fail('PracticeLocationService.displayOrder missing after patch');
if (!modelHasField('SecretarySettingsDraftService', 'proposedDisplayOrder')) fail('SecretarySettingsDraftService.proposedDisplayOrder missing after patch');

await writeFile(schemaPath, schema, 'utf8');
console.log('Service display-order schema reconciliation applied successfully.');
