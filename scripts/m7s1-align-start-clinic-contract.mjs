import { readFile, writeFile } from 'node:fs/promises';

const schemaPath = new URL('../prisma/schema.prisma', import.meta.url);
let schema = await readFile(schemaPath, 'utf8');

function alignRequired(label, alignedPattern, sourcePattern, replacement) {
  if (alignedPattern.test(schema)) {
    console.log(`${label}: already aligned`);
    return;
  }
  if (!sourcePattern.test(schema)) {
    throw new Error(`${label}: expected source pattern was not found`);
  }
  schema = schema.replace(sourcePattern, replacement);
  console.log(`${label}: aligned`);
}

const newline = schema.includes('\r\n') ? '\r\n' : '\n';

alignRequired(
  'CommandType START_CLINIC',
  /  CREATE_STAFF_APPOINTMENT\r?\n  START_CLINIC\r?\n  NEXT_PATIENT/,
  /  CREATE_STAFF_APPOINTMENT\r?\n  NEXT_PATIENT/,
  `  CREATE_STAFF_APPOINTMENT${newline}  START_CLINIC${newline}  NEXT_PATIENT`,
);

alignRequired(
  'QueueEventType START_CLINIC',
  /enum QueueEventType \{\r?\n  START_CLINIC\r?\n  NEXT_PATIENT/,
  /enum QueueEventType \{\r?\n  NEXT_PATIENT/,
  `enum QueueEventType {${newline}  START_CLINIC${newline}  NEXT_PATIENT`,
);

await writeFile(schemaPath, schema, 'utf8');
console.log('M7S1 START CLINIC schema contract alignment complete.');
