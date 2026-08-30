import { readFileSync, writeFileSync } from 'node:fs';

const path = 'frontend/src/doctor/ClinicTab.tsx';
let source = readFileSync(path, 'utf8');

function replaceOnce(before, after, label) {
  if (!source.includes(before)) {
    if (source.includes(after)) return;
    throw new Error(`Unable to wire clinic delete: ${label} anchor not found.`);
  }
  source = source.replace(before, after);
}

replaceOnce(
  "import { DisableClinicDialog } from './DisableClinicDialog';",
  "import { DisableClinicDialog } from './DisableClinicDialog';\nimport { PermanentlyDeleteClinicDialog } from './PermanentlyDeleteClinicDialog';",
  'dialog import',
);

replaceOnce(
  `  onActivate,\n  onDisable,\n}: {\n  clinics: ClinicRecord[];\n  onAdd: () => void;\n  onEdit: (clinic: ClinicRecord) => void;\n  onActivate: (clinic: ClinicRecord) => void;\n  onDisable: (clinic: ClinicRecord) => void;\n}) {`,
  `  onActivate,\n  onDisable,\n  onDelete,\n}: {\n  clinics: ClinicRecord[];\n  onAdd: () => void;\n  onEdit: (clinic: ClinicRecord) => void;\n  onActivate: (clinic: ClinicRecord) => void;\n  onDisable: (clinic: ClinicRecord) => void;\n  onDelete: (clinic: ClinicRecord) => void;\n}) {`,
  'ClinicList delete callback',
);

replaceOnce(
  `    if (action === 'DISABLE' && clinic.status === 'ACTIVE') {\n      onDisable(clinic);\n    }`,
  `    if (action === 'DISABLE' && clinic.status === 'ACTIVE') {\n      onDisable(clinic);\n      return;\n    }\n    if (action === 'DELETE') {\n      onDelete(clinic);\n    }`,
  'delete action execution',
);

replaceOnce(
  `              (selectedAction === 'ACTIVATE' && clinic.status === 'DRAFT') ||\n              (selectedAction === 'DISABLE' && clinic.status === 'ACTIVE');`,
  `              (selectedAction === 'ACTIVATE' && clinic.status === 'DRAFT') ||\n              (selectedAction === 'DISABLE' && clinic.status === 'ACTIVE') ||\n              selectedAction === 'DELETE';`,
  'delete executable state',
);

replaceOnce(
  `                            (action === 'DISABLE' && clinic.status === 'ACTIVE')\n                              ? undefined`,
  `                            (action === 'DISABLE' && clinic.status === 'ACTIVE') ||\n                            action === 'DELETE'\n                              ? undefined`,
  'delete menu title',
);

replaceOnce(
  `  const [disablingClinicId, setDisablingClinicId] = useState<string | null>(\n    null,\n  );\n  const [loadError, setLoadError] = useState('');`,
  `  const [disablingClinicId, setDisablingClinicId] = useState<string | null>(\n    null,\n  );\n  const [deletingClinic, setDeletingClinic] = useState<ClinicRecord | null>(null);\n  const [loadError, setLoadError] = useState('');`,
  'delete dialog state',
);

replaceOnce(
  `        onDisable={(clinic) => {\n          setDisablingClinicId(clinic.id);\n        }}\n      />`,
  `        onDisable={(clinic) => {\n          setDisablingClinicId(clinic.id);\n        }}\n        onDelete={(clinic) => {\n          setDeletingClinic(clinic);\n        }}\n      />`,
  'ClinicList delete handler',
);

replaceOnce(
  `      {disablingClinicId ? (\n        <DisableClinicDialog`,
  `      {deletingClinic ? (\n        <PermanentlyDeleteClinicDialog\n          practiceLocationId={deletingClinic.id}\n          clinicName={deletingClinic.name}\n          onCancel={() => setDeletingClinic(null)}\n          onDeleted={async () => {\n            setDeletingClinic(null);\n            try {\n              await loadClinics();\n              setLoadError('');\n            } catch (error) {\n              setLoadError(\n                error instanceof Error\n                  ? error.message\n                  : 'Unable to reload clinics.',\n              );\n            }\n          }}\n        />\n      ) : null}\n      {disablingClinicId ? (\n        <DisableClinicDialog`,
  'delete dialog rendering',
);

writeFileSync(path, source);
console.log('Protected clinic permanent-delete UI wired successfully.');
