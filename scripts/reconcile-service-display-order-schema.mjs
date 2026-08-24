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

function replaceModel(name, transform) {
  const current = modelBlock(name);
  const next = transform(current);
  if (next === current) return;
  schema = schema.replace(current, next);
}

function modelHasField(modelName, fieldName) {
  return new RegExp(`^\\s*${fieldName}\\s+`, 'm').test(modelBlock(modelName));
}

// Repair the malformed line produced by the earlier reconciliation script.
// This is deliberately idempotent so a developer can simply re-run generation.
schema = schema.replace(
  /^(\s*appointmentBookedServices\s+AppointmentBookedService\[\])\s+@@index\(\[practiceLocationId, displayOrder\]\)\s*$/m,
  '$1',
);

if (!modelHasField('PracticeLocationService', 'displayOrder')) {
  replaceModel('PracticeLocationService', (model) => {
    const updated = model.replace(
      /^(\s*durationMinutes\s+Int[^\n]*\r?\n)/m,
      `$1  // Presentation-only ordering. This does not affect queue, booking priority, or Service selection semantics.\n  displayOrder    Int @default(0)\n`,
    );
    if (updated === model) fail('PracticeLocationService durationMinutes anchor not found');
    return updated;
  });
}

if (!modelHasField('SecretarySettingsDraftService', 'proposedDisplayOrder')) {
  replaceModel('SecretarySettingsDraftService', (model) => {
    const updated = model.replace(
      /^(\s*proposedDurationMinutes\s+Int[^\n]*\r?\n)/m,
      `$1  proposedDisplayOrder    Int @default(0)\n`,
    );
    if (updated === model) fail('SecretarySettingsDraftService proposedDurationMinutes anchor not found');
    return updated;
  });
}

replaceModel('PracticeLocationService', (model) => {
  if (model.includes('@@index([practiceLocationId, displayOrder])')) return model;

  const closingBraceIndex = model.lastIndexOf('\n}');
  if (closingBraceIndex < 0) fail('PracticeLocationService closing brace not found');

  return `${model.slice(0, closingBraceIndex)}\n  @@index([practiceLocationId, displayOrder])${model.slice(closingBraceIndex)}`;
});

if (!modelHasField('PracticeLocationService', 'displayOrder')) {
  fail('PracticeLocationService.displayOrder missing after patch');
}
if (!modelHasField('SecretarySettingsDraftService', 'proposedDisplayOrder')) {
  fail('SecretarySettingsDraftService.proposedDisplayOrder missing after patch');
}

const practiceLocationServiceModel = modelBlock('PracticeLocationService');
if (!practiceLocationServiceModel.includes('@@index([practiceLocationId, displayOrder])')) {
  fail('PracticeLocationService display-order index missing after patch');
}

await writeFile(schemaPath, schema, 'utf8');
console.log('Service display-order schema reconciliation applied successfully.');
