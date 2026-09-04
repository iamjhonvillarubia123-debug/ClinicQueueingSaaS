import { readFileSync, writeFileSync } from 'node:fs';

const path = 'frontend/src/doctor/ClinicTab.tsx';
let source = readFileSync(path, 'utf8');

function replaceOnce(before, after, label) {
  if (!source.includes(before)) {
    if (source.includes(after)) return;
    throw new Error(`Unable to wire clinic list activation: ${label} anchor not found.`);
  }
  source = source.replace(before, after);
}

replaceOnce(
  `function ClinicList({\n  clinics,\n  onAdd,\n  onEdit,\n}: {\n  clinics: ClinicRecord[];\n  onAdd: () => void;\n  onEdit: (clinic: ClinicRecord) => void;\n}) {`,
  `function ClinicList({\n  clinics,\n  onAdd,\n  onEdit,\n  onActivate,\n}: {\n  clinics: ClinicRecord[];\n  onAdd: () => void;\n  onEdit: (clinic: ClinicRecord) => void;\n  onActivate: (clinic: ClinicRecord) => void;\n}) {`,
  'ClinicList props',
);

replaceOnce(
  `  function executeSelectedAction(clinic: ClinicRecord) {\n    const action = selectedActionFor(clinic);\n    if (action === 'EDIT') onEdit(clinic);\n  }`,
  `  function executeSelectedAction(clinic: ClinicRecord) {\n    const action = selectedActionFor(clinic);\n    if (action === 'EDIT') {\n      onEdit(clinic);\n      return;\n    }\n    if (action === 'ACTIVATE' && clinic.status === 'DRAFT') {\n      onActivate(clinic);\n    }\n  }`,
  'list action execution',
);

replaceOnce(
  `            const executableNow = selectedAction === 'EDIT';`,
  `            const executableNow =\n              selectedAction === 'EDIT' ||\n              (selectedAction === 'ACTIVATE' && clinic.status === 'DRAFT');`,
  'list executable action',
);

replaceOnce(
  `                            action === 'EDIT'\n                              ? undefined\n                              : 'Available in a later implementation phase.'`,
  `                            action === 'EDIT' ||\n                            (action === 'ACTIVATE' && clinic.status === 'DRAFT')\n                              ? undefined\n                              : 'Available in a later implementation phase.'`,
  'action menu availability title',
);

replaceOnce(
  `  const [editingClinic, setEditingClinic] = useState<ClinicRecord | null>(null);\n  const [loadError, setLoadError] = useState('');`,
  `  const [editingClinic, setEditingClinic] = useState<ClinicRecord | null>(null);\n  const [activatingClinicId, setActivatingClinicId] = useState<string | null>(null);\n  const [loadError, setLoadError] = useState('');`,
  'page activation state',
);

replaceOnce(
  `        onEdit={(clinic) => {\n          setEditingClinic(clinic);\n          setMode('edit');\n        }}\n      />`,
  `        onEdit={(clinic) => {\n          setEditingClinic(clinic);\n          setMode('edit');\n        }}\n        onActivate={(clinic) => {\n          setActivatingClinicId(clinic.id);\n        }}\n      />\n      {activatingClinicId ? (\n        <ActivateClinicDialog\n          practiceLocationId={activatingClinicId}\n          onCancel={() => setActivatingClinicId(null)}\n          onActivated={async () => {\n            setActivatingClinicId(null);\n            try {\n              await loadClinics();\n              setLoadError('');\n            } catch (error) {\n              setLoadError(\n                error instanceof Error\n                  ? error.message\n                  : 'Unable to reload clinics.',\n              );\n            }\n          }}\n        />\n      ) : null}`,
  'list activation dialog',
);

writeFileSync(path, source);
console.log('Protected clinic-list activation UI wired successfully.');
