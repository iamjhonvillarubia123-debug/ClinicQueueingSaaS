const fs = require('fs');

const drawerPath = 'frontend/src/doctor/StaffAssignmentDrawer.tsx';
const source = fs.readFileSync(drawerPath, 'utf8');

const patterns = [
  /  const candidates = useMemo\(\n    \(\) =>\n      data\.candidates\.filter\(\n        \(candidate\) => candidate\.userId !== current\?\.userId,\n      \),\n    \[current\?\.userId, data\.candidates\],\n  \);/,
  /  const candidates = useMemo\(\s*\(\) =>\s*data\.candidates\.filter\(\s*\(candidate\) => candidate\.userId !== current\?\.userId,?\s*\),\s*\[current\?\.userId, data\.candidates\],?\s*\);/s,
];

if (source.includes('const candidates = data.candidates;')) {
  console.log('Existing Secretary drawer is already reconciled.');
  process.exit(0);
}

let updated = source;
let matched = false;
for (const pattern of patterns) {
  if (pattern.test(updated)) {
    updated = updated.replace(pattern, '  const candidates = data.candidates;');
    matched = true;
    break;
  }
}

if (!matched) {
  throw new Error(
    'Could not find the obsolete current-Secretary candidate filter. No frontend file was changed.',
  );
}

fs.writeFileSync(drawerPath, updated);
console.log(
  'Reconciled Assign Existing Secretary so an established current Secretary remains visible in the account-level existing list.',
);
