const fs = require('fs');

const drawerPath = 'frontend/src/doctor/StaffAssignmentDrawer.tsx';
const parentPath = 'frontend/src/doctor/AuthoritativeClinicStaffTab.tsx';
const specPath = 'frontend/src/doctor/AuthoritativeClinicStaffTab.test.tsx';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}
function write(path, content) {
  fs.writeFileSync(path, content);
}
function replaceOnce(source, from, to, label) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`Patch target not found: ${label}`);
  return source.replace(from, to);
}

let drawer = read(drawerPath);
drawer = drawer.replace(
  /  const candidates = useMemo\([\s\S]*?\n  \);\n  const \[step,/,
  '  const candidates = data.candidates;\n  const [step,',
);

drawer = drawer.replace(
  /(  const \[stepValidationPending, setStepValidationPending\] = useState\(false\);\n  const \[stepValidationError, setStepValidationError\] = useState\(''\);\n  const \[validatedInvitee, setValidatedInvitee\] = useState<\{ existingSecretary: boolean; secretaryName: string \| null \} \| null>\(null\);\n)(?:\1)+/g,
  '$1',
);

drawer = drawer.replace(
  /(  const \[stepValidationPending, setStepValidationPending\] = useState\(false\);\n  const \[stepValidationError, setStepValidationError\] = useState\(''\);\n  const \[validatedInvitee, setValidatedInvitee\] = useState<\{\n    existingSecretary: boolean;\n    secretaryName: string \| null;\n  \} \| null>\(null\);\n)(?:\1)+/g,
  '$1',
);

if (!drawer.includes('onValidateInviteIdentifier')) {
  drawer = replaceOnce(
    drawer,
    '  onSubmit,\n}: {\n  data: AuthoritativeClinicStaff;\n  pending: boolean;\n  message: string;\n  onClose: () => void;\n  onSubmit: (command: StaffAssignmentCommand) => void | Promise<void>;\n}) {',
    '  onSubmit,\n  onValidateInviteIdentifier,\n  onValidateInviteAuthorization,\n}: {\n  data: AuthoritativeClinicStaff;\n  pending: boolean;\n  message: string;\n  onClose: () => void;\n  onSubmit: (command: StaffAssignmentCommand) => void | Promise<void>;\n  onValidateInviteIdentifier?: (identifier: string) => Promise<{ existingSecretary: boolean; secretaryName: string | null }>;\n  onValidateInviteAuthorization?: (password: string) => Promise<void>;\n}) {',
    'validation props',
  );
}

if (!drawer.includes('stepValidationPending')) {
  drawer = replaceOnce(
    drawer,
    "  const [inviteIdentifier, setInviteIdentifier] = useState('');",
    "  const [inviteIdentifier, setInviteIdentifier] = useState('');\n  const [stepValidationPending, setStepValidationPending] = useState(false);\n  const [stepValidationError, setStepValidationError] = useState('');\n  const [validatedInvitee, setValidatedInvitee] = useState<{ existingSecretary: boolean; secretaryName: string | null } | null>(null);",
    'validation state',
  );
}

if (!drawer.includes('async function advance()')) {
  drawer = replaceOnce(
    drawer,
    '  function submit() {',
    `  async function advance() {\n    setStepValidationError('');\n    if (mode === 'INVITE' && step === 2 && onValidateInviteIdentifier) {\n      setStepValidationPending(true);\n      try {\n        const result = await onValidateInviteIdentifier(inviteIdentifier.trim().toLowerCase());\n        setValidatedInvitee(result);\n        setStep(3);\n      } catch (cause) {\n        setValidatedInvitee(null);\n        setStepValidationError(\n          cause instanceof Error ? cause.message : 'Unable to validate this Secretary identifier.',\n        );\n      } finally {\n        setStepValidationPending(false);\n      }\n      return;\n    }\n\n    if (\n      mode === 'INVITE' &&\n      step === 4 &&\n      role === 'CLINIC_SECRETARY' &&\n      (current || cancelClinicDay) &&\n      onValidateInviteAuthorization\n    ) {\n      setStepValidationPending(true);\n      try {\n        await onValidateInviteAuthorization(password);\n        setStep(5);\n      } catch (cause) {\n        setStepValidationError(\n          cause instanceof Error ? cause.message : 'Unable to validate the Doctor password.',\n        );\n      } finally {\n        setStepValidationPending(false);\n      }\n      return;\n    }\n\n    setStep((value) => value + 1);\n  }\n\n  function submit() {`,
    'advance function',
  );
}

drawer = drawer.replace(
  /onClick=\{\(\) => setStep\(\(value\) => value \+ 1\)\}/g,
  'onClick={() => void advance()}',
);
drawer = drawer.replace('disabled={pending}', 'disabled={pending || stepValidationPending}');
if (!drawer.includes('{stepValidationError ? (')) {
  drawer = replaceOnce(
    drawer,
    '      {message ? (',
    '      {stepValidationError ? (\n        <div className="staff-drawer-message is-error" role="alert">\n          {stepValidationError}\n        </div>\n      ) : null}\n\n      {message ? (',
    'validation error rendering',
  );
}
drawer = drawer.replace(
  'Enter the Secretary&apos;s registered email address. The Secretary must\n            already have an active, verified Secretary account.',
  'Enter the Secretary&apos;s registered email address or Philippine mobile number. Existing eligible Secretary accounts can be invited immediately; otherwise the recipient must create and verify their own Secretary account before accepting.',
);
drawer = drawer.replace('Secretary Email Address', 'Email or Mobile Number');
drawer = drawer.replace(
  'type="email"\n                autoComplete="email"\n                placeholder="Enter Secretary email address"',
  'type="text"\n                autoComplete="username"\n                placeholder="Enter email or mobile number"',
);
write(drawerPath, drawer);

let parent = read(parentPath);
if (!parent.includes('async function validateInviteIdentifier(')) {
  parent = replaceOnce(
    parent,
    '  async function assign(command: StaffAssignmentCommand) {',
    `  async function validateInviteIdentifier(identifier: string) {\n    return apiRequest<{\n      valid: true;\n      existingSecretary: boolean;\n      secretaryName: string | null;\n    }>('/practice-staff/invitations/validate-identifier', {\n      method: 'POST',\n      body: { practiceLocationId: clinicId, identifier },\n    });\n  }\n\n  async function validateInviteAuthorization(password: string) {\n    await apiRequest('/practice-staff/invitations/validate-authorization', {\n      method: 'POST',\n      body: { practiceLocationId: clinicId, password },\n    });\n  }\n\n  async function assign(command: StaffAssignmentCommand) {`,
    'parent validation helpers',
  );
}
if (!parent.includes('onValidateInviteIdentifier={validateInviteIdentifier}')) {
  parent = replaceOnce(
    parent,
    '          onClose={() => setDrawerOpen(false)}\n          onSubmit={assign}',
    '          onClose={() => setDrawerOpen(false)}\n          onSubmit={assign}\n          onValidateInviteIdentifier={validateInviteIdentifier}\n          onValidateInviteAuthorization={validateInviteAuthorization}',
    'drawer validation callbacks',
  );
}
write(parentPath, parent);

let spec = read(specPath);
if (!spec.includes('keeps the current Clinic Secretary visible in Assign Existing Secretary')) {
  const end = spec.lastIndexOf('\n});');
  if (end < 0) throw new Error('Test suite end not found');
  const tests = `\n  it('keeps the current Clinic Secretary visible in Assign Existing Secretary', async () => {\n    const user = userEvent.setup();\n    const withCurrentCandidate = {\n      ...staff,\n      candidates: [\n        ...staff.candidates,\n        {\n          userId: 'user-regular',\n          name: 'Maria Santos',\n          email: 'maria@example.test',\n          mobileNumber: '09172223333',\n        },\n      ],\n    };\n    render(\n      <StaffAssignmentDrawer\n        data={withCurrentCandidate}\n        pending={false}\n        message=\"\"\n        onClose={() => undefined}\n        onSubmit={() => undefined}\n      />,\n    );\n    await user.click(screen.getByRole('button', { name: /Assign Existing Secretary/i }));\n    expect(screen.getByText('Maria Santos')).toBeInTheDocument();\n  });\n\n  it('warns and validates Doctor authentication before review when inviting a replacement Clinic Secretary', async () => {\n    const user = userEvent.setup();\n    const validateIdentifier = vi.fn().mockResolvedValue({\n      existingSecretary: true,\n      secretaryName: 'Anna Cruz',\n    });\n    const validateAuthorization = vi.fn().mockResolvedValue(undefined);\n    render(\n      <StaffAssignmentDrawer\n        data={staff}\n        pending={false}\n        message=\"\"\n        onClose={() => undefined}\n        onSubmit={() => undefined}\n        onValidateInviteIdentifier={validateIdentifier}\n        onValidateInviteAuthorization={validateAuthorization}\n      />,\n    );\n    await user.click(screen.getByRole('button', { name: /Invite New Secretary to Clinic/i }));\n    await user.type(screen.getByLabelText('Email or Mobile Number'), 'anna@example.test');\n    await user.click(screen.getByRole('button', { name: 'Next' }));\n    await user.click(screen.getByRole('button', { name: 'Next' }));\n    expect(screen.getByText('Replace current Clinic Secretary?')).toBeInTheDocument();\n    const password = screen.getByLabelText(/current password to authorize this replacement/i);\n    await user.type(password, 'doctor-password');\n    await user.click(screen.getByRole('button', { name: 'Next' }));\n    expect(validateAuthorization).toHaveBeenCalledWith('doctor-password');\n    expect(screen.getByRole('heading', { name: 'Review Invitation' })).toBeInTheDocument();\n  });\n`;
  spec = spec.slice(0, end) + tests + spec.slice(end);
} else {
  spec = spec.replace(
    "screen.getByRole('button', { name: /Invite Secretary to Clinic/i })",
    "screen.getByRole('button', { name: /Invite New Secretary to Clinic/i })",
  );
}
write(specPath, spec);

console.log('Reconciled current-Secretary visibility and replacement warning/authentication flow without duplicate validation state.');
