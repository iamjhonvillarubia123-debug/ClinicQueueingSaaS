import { readFileSync, writeFileSync } from 'node:fs';

const path = 'frontend/src/doctor/ClinicTab.tsx';
let source = readFileSync(path, 'utf8');

function replaceOnce(before, after, label) {
  if (!source.includes(before)) {
    if (source.includes(after)) return;
    throw new Error(`Unable to persist clinic edit navigation: ${label} anchor not found.`);
  }
  source = source.replace(before, after);
}

replaceOnce(
  `const initialServices: ServiceRow[] = [];\nconst initialQuestions: QuestionRow[] = [];`,
  `const initialServices: ServiceRow[] = [];\nconst initialQuestions: QuestionRow[] = [];\n\nfunction readClinicEditNavigation(): { clinicId: string | null; step: Step } {\n  const params = new URLSearchParams(window.location.search);\n  const clinicId = params.get('clinic');\n  const candidateStep = Number(params.get('step'));\n  const step =\n    Number.isInteger(candidateStep) && candidateStep >= 1 && candidateStep <= 5\n      ? (candidateStep as Step)\n      : 1;\n  return { clinicId, step };\n}\n\nfunction writeClinicEditNavigation(clinicId: string | null, step: Step = 1) {\n  const url = new URL(window.location.href);\n  if (clinicId) {\n    url.searchParams.set('clinic', clinicId);\n    url.searchParams.set('step', String(step));\n  } else {\n    url.searchParams.delete('clinic');\n    url.searchParams.delete('step');\n  }\n  window.history.replaceState(\n    window.history.state,\n    '',\n    \`${'${url.pathname}${url.search}${url.hash}'}\`,\n  );\n}`,
  'URL navigation helpers',
);

replaceOnce(
  `  initialStatus = 'DRAFT',\n  editing,\n  editingClinicId,`,
  `  initialStatus = 'DRAFT',\n  initialStep = 1,\n  onStepChange,\n  editing,\n  editingClinicId,`,
  'wizard argument defaults',
);

replaceOnce(
  `  initialStatus?: ClinicStatus;\n  editing?: boolean;\n  editingClinicId?: string;\n}) {\n  const [step, setStep] = useState<Step>(1);`,
  `  initialStatus?: ClinicStatus;\n  initialStep?: Step;\n  onStepChange?: (step: Step) => void;\n  editing?: boolean;\n  editingClinicId?: string;\n}) {\n  const [step, setStepState] = useState<Step>(initialStep);\n  function setStep(nextStep: Step) {\n    setStepState(nextStep);\n    onStepChange?.(nextStep);\n  }`,
  'wizard step persistence',
);

replaceOnce(
  `export function ClinicTabPage() {\n  const [mode, setMode] = useState<'list' | 'create' | 'edit'>('list');\n  const [clinics, setClinics] = useState<ClinicRecord[]>([]);`,
  `export function ClinicTabPage() {\n  const initialNavigation = readClinicEditNavigation();\n  const [mode, setMode] = useState<'list' | 'create' | 'edit'>(() =>\n    initialNavigation.clinicId ? 'edit' : 'list',\n  );\n  const [requestedClinicId, setRequestedClinicId] = useState<string | null>(\n    initialNavigation.clinicId,\n  );\n  const [requestedStep, setRequestedStep] = useState<Step>(\n    initialNavigation.step,\n  );\n  const [clinicsLoaded, setClinicsLoaded] = useState(false);\n  const [clinics, setClinics] = useState<ClinicRecord[]>([]);`,
  'page navigation state',
);

replaceOnce(
  `    setClinics(mapped);\n    return mapped;`,
  `    setClinics(mapped);\n    setClinicsLoaded(true);\n    return mapped;`,
  'reload completion state',
);

replaceOnce(
  `        setLoadError('');\n      })\n      .catch((error) => {`,
  `        setLoadError('');\n        setClinicsLoaded(true);\n      })\n      .catch((error) => {`,
  'initial load success state',
);

replaceOnce(
  `        setLoadError(\n          error instanceof Error ? error.message : 'Unable to load clinics.',\n        );\n      });`,
  `        setLoadError(\n          error instanceof Error ? error.message : 'Unable to load clinics.',\n        );\n        setClinicsLoaded(true);\n      });`,
  'initial load failure state',
);

replaceOnce(
  `  async function applied() {`,
  `  useEffect(() => {\n    if (!clinicsLoaded || !requestedClinicId) return;\n    const clinic = clinics.find((candidate) => candidate.id === requestedClinicId);\n    if (clinic) {\n      setEditingClinic(clinic);\n      setMode('edit');\n      return;\n    }\n\n    setRequestedClinicId(null);\n    setRequestedStep(1);\n    setEditingClinic(null);\n    setMode('list');\n    writeClinicEditNavigation(null);\n    setLoadError('The clinic you were editing is no longer available.');\n  }, [clinics, clinicsLoaded, requestedClinicId]);\n\n  function returnToClinicList() {\n    setRequestedClinicId(null);\n    setRequestedStep(1);\n    setEditingClinic(null);\n    setMode('list');\n    writeClinicEditNavigation(null);\n  }\n\n  async function applied() {`,
  'restore edit after refresh',
);

replaceOnce(
  `    setEditingClinic(null);\n    setMode('list');\n  }\n\n  async function saved(`,
  `    returnToClinicList();\n  }\n\n  async function saved(`,
  'applied returns to clean list URL',
);

replaceOnce(
  `        initialStatus={editingClinic.status}\n        initialValue={editingClinic.editor.draft}`,
  `        initialStatus={editingClinic.status}\n        initialStep={requestedStep}\n        onStepChange={(nextStep) => {\n          setRequestedStep(nextStep);\n          writeClinicEditNavigation(editingClinic.id, nextStep);\n        }}\n        initialValue={editingClinic.editor.draft}`,
  'wizard restores routed step',
);

replaceOnce(
  `        onExit={() => {\n          setEditingClinic(null);\n          setMode('list');\n        }}\n        onSaved={saved}\n        onApplied={applied}\n      />\n    );\n  return (`,
  `        onExit={returnToClinicList}\n        onSaved={saved}\n        onApplied={applied}\n      />\n    );\n  if (mode === 'edit' && requestedClinicId && !editingClinic) {\n    return (\n      <section className="clinic-page" aria-live="polite">\n        <p>{clinicsLoaded ? 'Returning to clinics…' : 'Loading clinic…'}</p>\n      </section>\n    );\n  }\n  return (`,
  'edit restore loading state',
);

replaceOnce(
  `        onAdd={() => {\n          setEditingClinic(null);\n          setMode('create');\n        }}\n        onEdit={(clinic) => {\n          setEditingClinic(clinic);\n          setMode('edit');\n        }}`,
  `        onAdd={() => {\n          setRequestedClinicId(null);\n          setRequestedStep(1);\n          writeClinicEditNavigation(null);\n          setEditingClinic(null);\n          setMode('create');\n        }}\n        onEdit={(clinic) => {\n          setRequestedClinicId(clinic.id);\n          setRequestedStep(1);\n          writeClinicEditNavigation(clinic.id, 1);\n          setEditingClinic(clinic);\n          setMode('edit');\n        }}`,
  'list edit action writes URL state',
);

writeFileSync(path, source);
console.log('Clinic edit navigation now survives browser refresh.');
