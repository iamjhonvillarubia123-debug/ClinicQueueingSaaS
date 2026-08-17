import fs from 'node:fs';

const path = 'test/close-clinic.e2e-spec.ts';
let source = fs.readFileSync(path, 'utf8');

const replacements = new Map([
  ['2026-11-16', '2026-06-29'],
  ['2026-11-23', '2026-07-06'],
  ['2026-11-30', '2026-07-13'],
  ['2026-12-07', '2026-07-20'],
  ['2026-12-14', '2026-07-27'],
  ['2026-12-21', '2026-08-03'],
  ['2026-12-28', '2026-08-10'],
]);

for (const [before, after] of replacements) {
  if (!source.includes(before)) {
    throw new Error(`M7S5A CLOSE CLINIC fixture date not found: ${before}`);
  }
  source = source.replaceAll(before, after);
}

fs.writeFileSync(path, source);
console.log('M7S5A CLOSE CLINIC fixture dates aligned to past Mondays.');
