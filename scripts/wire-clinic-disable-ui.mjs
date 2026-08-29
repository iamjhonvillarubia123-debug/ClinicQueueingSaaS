import { readFileSync, writeFileSync } from 'node:fs';

const path = 'frontend/src/doctor/ClinicTab.tsx';
let source = readFileSync(path, 'utf8');

function replaceOnce(before, after, label) {
  if (!source.includes(before)) {
    if (source.includes(after)) return;
    throw new Error(`Unable to wire clinic disable: ${label} anchor not found.`);
  }
  source = source.replace(before, after);
}

replaceOnce(
  "import { ApplyClinicChangesDialog } from './ApplyClinicChangesDialog';",
  "import { ApplyClinicChangesDialog } from './ApplyClinicChangesDialog';\nimport { DisableClinicDialog } from './DisableClinicDialog';",
  'dialog import',
);

replaceOnce(
  `function ClinicList({\n  clinics,\n  onAdd,\n  onEdit,\n  onActivate,\n}: {\n  clinics: ClinicRecord[];\n  onAdd: () => void;\n  onEdit: (clinic: ClinicRecord) => void;\n  onActivate: (clinic: ClinicRecord) => void;\n}) {`,
  `function ClinicList({\n  clinics,\n  onAdd,\n  onEdit,\n  onActivate,\n  onDisable,\n}: {\n  clinics: ClinicRecord[];\n  onAdd: () => void;\n  onEdit: (clinic: ClinicRecord) => void;\n  onActivate: (clinic: ClinicRecord) => void;\n  onDisable: (clinic: ClinicRecord) => void;\n}) {`,
  'ClinicList props',
);

replaceOnce(
  `    if (action === 'ACTIVATE' && clinic.status === 'DRAFT') {\n      onActivate(clinic);\n    }`,
  `    if (action === 'ACTIVATE' && clinic.status === 'DRAFT') {\n      onActivate(clinic);\n      return;\n    }\n    if (action === 'DISABLE' && clinic.status === 'ACTIVE') {\n      onDisable(clinic);\n    }`,
  'execute disable action',
);

replaceOnce(
  `            const executableNow =\n              selectedAction === 'EDIT' ||\n              (selectedAction === 'ACTIVATE' && clinic.status === 'DRAFT');`,
  `            const executableNow =\n              selectedAction === 'EDIT' ||\n              (selectedAction === 'ACTIVATE' && clinic.status === 'DRAFT') ||\n              (selectedAction === 'DISABLE' && clinic.status === 'ACTIVE');`,
  'main button executable state',
);

replaceOnce(
  `                            action === 'EDIT' ||\n                            (action === 'ACTIVATE' && clinic.status === 'DRAFT')\n                              ? undefined`,
  `                            action === 'EDIT' ||\n                            (action === 'ACTIVATE' && clinic.status === 'DRAFT') ||\n                            (action === 'DISABLE' && clinic.status === 'ACTIVE')\n                              ? undefined`,
  'menu action executable state',
);

replaceOnce(
  `  const [activatingClinicId, setActivatingClinicId] = useState<string | null>(\n    null,\n  );`,
  `  const [activatingClinicId, setActivatingClinicId] = useState<string | null>(\n    null,\n  );\n  const [disablingClinicId, setDisablingClinicId] = useState<string | null>(\n    null,\n  );`,
  'page disable state',
);

replaceOnce(
  `        onActivate={(clinic) => {\n          setActivatingClinicId(clinic.id);\n        }}\n      />`,
  `        onActivate={(clinic) => {\n          setActivatingClinicId(clinic.id);\n        }}\n        onDisable={(clinic) => {\n          setDisablingClinicId(clinic.id);\n        }}\n      />`,
  'ClinicList disable handler',
);

replaceOnce(
  `      {activatingClinicId ? (\n        <ActivateClinicDialog`,
  `      {disablingClinicId ? (\n        <DisableClinicDialog\n          practiceLocationId={disablingClinicId}\n          onCancel={() => setDisablingClinicId(null)}\n          onDisabled={async () => {\n            setDisablingClinicId(null);\n            try {\n              await loadClinics();\n              setLoadError('');\n            } catch (error) {\n              setLoadError(\n                error instanceof Error\n                  ? error.message\n                  : 'Unable to reload clinics.',\n              );\n            }\n          }}\n        />\n      ) : null}\n      {activatingClinicId ? (\n        <ActivateClinicDialog`,
  'disable dialog rendering',
);

writeFileSync(path, source);
console.log('Protected clinic disable list action wired successfully.');
