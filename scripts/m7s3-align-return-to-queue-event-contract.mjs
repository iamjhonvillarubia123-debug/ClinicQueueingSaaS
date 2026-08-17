import { readFile, writeFile } from 'node:fs/promises';

const schemaPath = new URL('../prisma/schema.prisma', import.meta.url);
const schema = await readFile(schemaPath, 'utf8');

const enumPattern = /enum QueueEventType \{([\s\S]*?)\n\}/;
const match = schema.match(enumPattern);

if (!match) {
  throw new Error('QueueEventType enum was not found in prisma/schema.prisma');
}

if (/^\s*RETURN_TO_QUEUE\s*$/m.test(match[1])) {
  console.log('QueueEventType RETURN_TO_QUEUE: already aligned');
  process.exit(0);
}

if (!/^\s*STAFF_REINSERTION\s*$/m.test(match[1])) {
  throw new Error(
    'QueueEventType RETURN_TO_QUEUE: STAFF_REINSERTION anchor was not found',
  );
}

const updatedEnumBody = match[1].replace(
  /^(\s*STAFF_REINSERTION\s*)$/m,
  '$1\n  RETURN_TO_QUEUE',
);
const updatedSchema = schema.replace(
  enumPattern,
  `enum QueueEventType {${updatedEnumBody}\n}`,
);

await writeFile(schemaPath, updatedSchema, 'utf8');
console.log('QueueEventType RETURN_TO_QUEUE: aligned');
