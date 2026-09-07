const fs = require('fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}
function write(path, content) {
  fs.writeFileSync(path, content, 'utf8');
}
function replaceRequired(content, pattern, replacement, label) {
  const next = content.replace(pattern, replacement);
  if (next === content) throw new Error(`Patch target not found: ${label}`);
  return next;
}

// 1) Surface a precise wrong-password message for sensitive staff authority grants.
{
  const path = 'frontend/src/doctor/AuthoritativeClinicStaffTab.tsx';
  let s = read(path);
  if (!s.includes("import { ApiError, apiRequest } from '../api/client';")) {
    s = replaceRequired(
      s,
      "import { apiRequest } from '../api/client';",
      "import { ApiError, apiRequest } from '../api/client';",
      'ApiError import',
    );
  }
  if (!s.includes('passwordProtectedClinicSecretary')) {
    s = replaceRequired(
      s,
      /    } catch \(cause\) \{\r?\n      setMessage\(\r?\n        cause instanceof Error\r?\n          \? cause\.message\r?\n          : 'Unable to assign this Secretary\.',\r?\n      \);\r?\n    } finally \{/,
      `    } catch (cause) {\n      const passwordProtectedClinicSecretary =\n        command.role === 'CLINIC_SECRETARY' ||\n        (command.role === 'INVITE_NEW' &&\n          command.assignmentType === 'CLINIC_SECRETARY')\n          ? Boolean(command.password)\n          : false;\n      const genericApiMessage =\n        cause instanceof ApiError &&\n        cause.message === 'Something went wrong. Please try again.';\n      setMessage(\n        cause instanceof ApiError &&\n          cause.status === 401 &&\n          passwordProtectedClinicSecretary &&\n          genericApiMessage\n          ? 'Current password is incorrect.'\n          : cause instanceof Error\n            ? cause.message\n            : 'Unable to assign this Secretary.',\n      );\n    } finally {`,
      'staff assignment 401 feedback',
    );
  }
  write(path, s);
}

// 2) Align the invitation drawer with F6 email-or-mobile identity.
{
  const path = 'frontend/src/doctor/StaffAssignmentDrawer.tsx';
  let s = read(path);
  s = s.replace(
    "      const identifier = inviteIdentifier.trim().toLowerCase();",
    "      const identifier = inviteIdentifier.trim();",
  );
  s = s.replace(
    `Enter the Secretary&apos;s registered email address. The Secretary must\n            already have an active, verified Secretary account.`,
    `Enter the Secretary&apos;s registered email address or Philippine mobile number. The Secretary must\n            already have an active, verified Secretary account.`,
  );
  s = s.replace(
    `Secretary Email Address\n              <input\n                type="email"\n                autoComplete="email"\n                placeholder="Enter Secretary email address"`,
    `Secretary Email or Mobile Number\n              <input\n                type="text"\n                autoComplete="username"\n                inputMode="text"\n                placeholder="Email or 09xx xxx xxxx"`,
  );
  write(path, s);
}

// 3) Keep backend invitation errors identifier-neutral for email and mobile flows.
{
  const path = 'src/practice-staff/secretary-invitation.service.ts';
  let s = read(path);
  s = s.replaceAll(
    'No Secretary account was found for this email. Please review the email address for possible errors. If the details are correct, ask the Secretary to create and verify an account first.',
    'No Secretary account was found for this email address or mobile number. Please review the identifier for possible errors. If the details are correct, ask the Secretary to create and verify an account first.',
  );
  s = s.replaceAll(
    'This email address belongs to an account with an incompatible role.',
    'This email address or mobile number belongs to an account with an incompatible role.',
  );
  s = s.replaceAll(
    'The Secretary account must be active and its registered email address must be verified before it can be invited.',
    'The Secretary account must be active and its registered login identifier must be verified before it can be invited.',
  );
  write(path, s);
}

// 4) Update focused UI tests to exercise mobile invitation identity.
{
  const path = 'frontend/src/doctor/AuthoritativeClinicStaffTab.test.tsx';
  let s = read(path);
  s = s.replaceAll(
    "screen.getByLabelText('Secretary Email Address')",
    "screen.getByLabelText('Secretary Email or Mobile Number')",
  );
  s = s.replace(
    `await user.type(\n      screen.getByLabelText('Secretary Email or Mobile Number'),\n      'anna@example.test',\n    );\n    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();`,
    `await user.type(\n      screen.getByLabelText('Secretary Email or Mobile Number'),\n      '09171234567',\n    );\n    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();`,
  );
  s = s.replace(
    `identifier: 'anna@example.test',\n        authorityBundles:`,
    `identifier: '09171234567',\n        authorityBundles:`,
  );
  write(path, s);
}

console.log('Aligned Secretary invitation error feedback and email/mobile invitation identity.');
