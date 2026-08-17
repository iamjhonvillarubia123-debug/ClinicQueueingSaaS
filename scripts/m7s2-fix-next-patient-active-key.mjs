import { readFile, writeFile } from 'node:fs/promises';

const path = new URL('../test/next-patient.e2e-spec.ts', import.meta.url);
let source = await readFile(path, 'utf8');

if (!source.includes("import { createHash, randomUUID } from 'crypto';")) {
  source = source.replace(
    /import \{\s*randomUUID\s*\} from 'crypto';/,
    "import { createHash, randomUUID } from 'crypto';",
  );
}

const activeKeyPattern = /activeAppointmentKey:\s*`\$\{scope\.slice\(0,\s*8\)\}-\$\{serviceDate\s*\.toISOString\(\)\s*\.slice\(8,\s*10\)\}-\$\{queueNumber\}-\$\{discriminator\.slice\(0,\s*12\)\}`,/m;

const activeKeyReplacement = `activeAppointmentKey: createHash('sha256')\n          .update(\n            \`${'${scope}'}|${'${serviceDate.toISOString()}'}|${'${queueNumber}'}|${'${discriminator}'}\`,\n          )\n          .digest('hex'),`;

if (activeKeyPattern.test(source)) {
  source = source.replace(activeKeyPattern, activeKeyReplacement);
} else if (!source.includes("createHash('sha256')")) {
  throw new Error('NEXT PATIENT fixture activeAppointmentKey pattern was not found.');
}

await writeFile(path, source, 'utf8');
console.log('M7S2 NEXT PATIENT fixture activeAppointmentKey aligned to SHA-256.');
