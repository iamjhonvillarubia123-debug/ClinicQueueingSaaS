import { readFileSync, writeFileSync } from 'node:fs';

function patchFile(path, patches) {
  let source = readFileSync(path, 'utf8');
  for (const { before, after, label } of patches) {
    if (!source.includes(before)) {
      if (source.includes(after)) continue;
      throw new Error(`Unable to wire clinic activation: ${label} anchor not found in ${path}.`);
    }
    source = source.replace(before, after);
  }
  writeFileSync(path, source);
}

patchFile('frontend/src/doctor/ClinicTab.tsx', [
  {
    before: "import { ApplyClinicChangesDialog } from './ApplyClinicChangesDialog';",
    after:
      "import { ActivateClinicDialog } from './ActivateClinicDialog';\nimport { ApplyClinicChangesDialog } from './ApplyClinicChangesDialog';",
    label: 'dialog import',
  },
  {
    before: '  const [showApplyDialog, setShowApplyDialog] = useState(false);',
    after:
      '  const [showActivateDialog, setShowActivateDialog] = useState(false);\n  const [showApplyDialog, setShowApplyDialog] = useState(false);',
    label: 'dialog state',
  },
  {
    before: `      setSaveError(\n        'Activate Clinic is not connected yet. Use Save as Draft until the protected activation workflow is implemented.',\n      );\n      return;`,
    after: `      if (!practiceLocationId) {\n        setSaveError('Save this clinic before activating it.');\n        return;\n      }\n      setShowActivateDialog(true);\n      return;`,
    label: 'review activation action',
  },
  {
    before: `      {showApplyDialog && practiceLocationId ? (\n        <ApplyClinicChangesDialog`,
    after: `      {showActivateDialog && practiceLocationId ? (\n        <ActivateClinicDialog\n          practiceLocationId={practiceLocationId}\n          onCancel={() => setShowActivateDialog(false)}\n          onActivated={async () => {\n            setShowActivateDialog(false);\n            await onApplied();\n          }}\n        />\n      ) : null}\n      {showApplyDialog && practiceLocationId ? (\n        <ApplyClinicChangesDialog`,
    label: 'dialog rendering',
  },
]);

patchFile('src/practice-location/practice-location.controller.spec.ts', [
  {
    before:
      "import { PracticeLocationPermanentDeleteService } from './practice-location-permanent-delete.service';",
    after:
      "import { PracticeLocationPermanentDeleteService } from './practice-location-permanent-delete.service';\nimport { PracticeLocationProtectedActivationService } from './practice-location-protected-activation.service';",
    label: 'protected activation test import',
  },
  {
    before: `  const practiceLocationConfigurationApplyServiceMock = {\n    apply: jest.fn(),\n  };`,
    after: `  const practiceLocationProtectedActivationServiceMock = {\n    activate: jest.fn(),\n  };\n  const practiceLocationConfigurationApplyServiceMock = {\n    apply: jest.fn(),\n  };`,
    label: 'protected activation mock',
  },
  {
    before: `        {\n          provide: PracticeLocationConfigurationApplyService,\n          useValue: practiceLocationConfigurationApplyServiceMock,\n        },`,
    after: `        {\n          provide: PracticeLocationProtectedActivationService,\n          useValue: practiceLocationProtectedActivationServiceMock,\n        },\n        {\n          provide: PracticeLocationConfigurationApplyService,\n          useValue: practiceLocationConfigurationApplyServiceMock,\n        },`,
    label: 'protected activation provider',
  },
  {
    before: `    const dto = { practiceLocationId: 'location-1' };\n\n    await controller.activate(dto, 'activation-key', request as never);`,
    after: `    const dto = {\n      practiceLocationId: 'location-1',\n      password: 'secret',\n      confirmActivation: true,\n    };\n\n    await controller.activate(dto, 'activation-key', request as never);`,
    label: 'activation DTO fixture',
  },
  {
    before: `    expect(practiceLocationActivationServiceMock.activate).toHaveBeenCalledWith(\n      'doctor-1',\n      dto,\n      'activation-key',\n    );`,
    after: `    expect(\n      practiceLocationProtectedActivationServiceMock.activate,\n    ).toHaveBeenCalledWith('doctor-1', dto, 'activation-key');`,
    label: 'activation delegation assertion',
  },
]);

console.log('Protected Draft -> Active clinic activation wiring completed.');
