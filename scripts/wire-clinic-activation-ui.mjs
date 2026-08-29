import { readFileSync, writeFileSync } from 'node:fs';

const path = 'frontend/src/doctor/ClinicTab.tsx';
let source = readFileSync(path, 'utf8');

function replaceOnce(before, after, label) {
  if (!source.includes(before)) {
    if (source.includes(after)) return;
    throw new Error(`Unable to wire clinic activation: ${label} anchor not found.`);
  }
  source = source.replace(before, after);
}

replaceOnce(
  "import { ApplyClinicChangesDialog } from './ApplyClinicChangesDialog';",
  "import { ActivateClinicDialog } from './ActivateClinicDialog';\nimport { ApplyClinicChangesDialog } from './ApplyClinicChangesDialog';",
  'dialog import',
);

replaceOnce(
  "  const [showApplyDialog, setShowApplyDialog] = useState(false);",
  "  const [showActivateDialog, setShowActivateDialog] = useState(false);\n  const [showApplyDialog, setShowApplyDialog] = useState(false);",
  'dialog state',
);

replaceOnce(
  `      setSaveError(\n        'Activate Clinic is not connected yet. Use Save as Draft until the protected activation workflow is implemented.',\n      );\n      return;`,
  `      if (!practiceLocationId) {\n        setSaveError('Save this clinic before activating it.');\n        return;\n      }\n      setShowActivateDialog(true);\n      return;`,
  'review activation action',
);

replaceOnce(
  `      {showApplyDialog && practiceLocationId ? (\n        <ApplyClinicChangesDialog`,
  `      {showActivateDialog && practiceLocationId ? (\n        <ActivateClinicDialog\n          practiceLocationId={practiceLocationId}\n          onCancel={() => setShowActivateDialog(false)}\n          onActivated={async () => {\n            setShowActivateDialog(false);\n            await onApplied();\n          }}\n        />\n      ) : null}\n      {showApplyDialog && practiceLocationId ? (\n        <ApplyClinicChangesDialog`,
  'dialog rendering',
);

writeFileSync(path, source);
console.log('Protected Draft -> Active clinic activation UI wired successfully.');
