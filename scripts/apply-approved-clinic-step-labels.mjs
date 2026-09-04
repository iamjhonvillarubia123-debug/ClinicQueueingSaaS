import { readFileSync, writeFileSync } from 'node:fs';

const path = 'frontend/src/doctor/ClinicTab.tsx';
let source = readFileSync(path, 'utf8');

function replaceOnce(before, after, label) {
  if (!source.includes(before)) {
    if (source.includes(after)) return;
    throw new Error(`Unable to apply approved clinic wording: ${label} anchor not found.`);
  }
  source = source.replace(before, after);
}

replaceOnce(
  `  const labels = [\n    'Basic Info',\n    'Clinic Hours',\n    'Services',\n    'Questions',\n    'Review',\n  ];`,
  `  const labels = [\n    'Basic Informations',\n    'Clinic Hours',\n    'Clinic Services',\n    'Clinic Questions',\n    'Review',\n  ];`,
  'stepper labels',
);

replaceOnce(
  `      : step === 3\n          ? 'Services'\n          : step === 4\n            ? 'Booking Questions'`,
  `      : step === 3\n          ? 'Clinic Services'\n          : step === 4\n            ? 'Clinic Questions'`,
  'step titles',
);

replaceOnce(
  `        <div className="clinic-work-heading">\n          <h2>{title}</h2>`,
  `        <div className="clinic-work-heading">\n          <h2>{step === 1 ? 'Basic Informations' : title}</h2>`,
  'work card heading',
);

writeFileSync(path, source);
console.log('Approved clinic wording applied successfully.');
