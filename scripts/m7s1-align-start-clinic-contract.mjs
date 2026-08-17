import { readFile, writeFile } from 'node:fs/promises';

const schemaPath = new URL('../prisma/schema.prisma', import.meta.url);
let schema = await readFile(schemaPath, 'utf8');

function replaceRequired(label, search, replacement) {
  if (schema.includes(replacement)) {
    console.log(`${label}: already aligned`);
    return;
  }
  if (!schema.includes(search)) {
    throw new Error(`${label}: expected source pattern was not found`);
  }
  schema = schema.replace(search, replacement);
  console.log(`${label}: aligned`);
}

replaceRequired(
  'CommandType START_CLINIC',
  '  CREATE_STAFF_APPOINTMENT\n  NEXT_PATIENT',
  '  CREATE_STAFF_APPOINTMENT\n  START_CLINIC\n  NEXT_PATIENT',
);

replaceRequired(
  'QueueEventType START_CLINIC',
  'enum QueueEventType {\n  NEXT_PATIENT',
  'enum QueueEventType {\n  START_CLINIC\n  NEXT_PATIENT',
);

await writeFile(schemaPath, schema, 'utf8');
console.log('M7S1 START CLINIC schema contract alignment complete.');
