const fs = require('fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }
function write(path, content) { fs.writeFileSync(path, content); }

function removeDuplicateConfigImport(content) {
  const line = "import { ConfigService } from '@nestjs/config';";
  const first = content.indexOf(line);
  if (first < 0) return content;
  const second = content.indexOf(line, first + line.length);
  if (second < 0) return content;
  return content.slice(0, second) + content.slice(second + line.length + (content[second + line.length] === '\r' ? 2 : 1));
}

for (const path of [
  'src/practice-staff/dto/create-secretary-invitation.dto.ts',
  'src/practice-staff/dto/update-secretary-invitation.dto.ts',
]) {
  let s = read(path);
  s = s.replace(/\n\s*IsEmail,/, '');
  s = s.replace(/\n\s*@IsEmail\(\)/g, '');
  write(path, s);
}

const specPath = 'src/practice-staff/secretary-invitation.service.spec.ts';
let spec = removeDuplicateConfigImport(read(specPath));

// Keep the fixture typed to the DTO enum instead of freezing enum values into string literals.
spec = spec.replace(/assignmentType:\s*'CLINIC_SECRETARY'/g, 'assignmentType: SecretaryInvitationAssignmentType.CLINIC_SECRETARY');
spec = spec.replace(/assignmentType:\s*SecretaryInvitationAssignmentType\.CLINIC_SECRETARY\s+as const/g, 'assignmentType: SecretaryInvitationAssignmentType.CLINIC_SECRETARY');
spec = spec.replace(/authorityBundles:\s*\['QUEUE_AND_CLINIC_DAY_OPERATIONS'\]\s+as const/g, "authorityBundles: [ClinicSecretaryAuthorityBundle.QUEUE_AND_CLINIC_DAY_OPERATIONS]");
spec = spec.replace(/authorityBundles:\s*\['QUEUE_AND_CLINIC_DAY_OPERATIONS'\]/g, "authorityBundles: [ClinicSecretaryAuthorityBundle.QUEUE_AND_CLINIC_DAY_OPERATIONS]");

if (spec.includes('ClinicSecretaryAuthorityBundle.') && !spec.includes("import { ClinicSecretaryAuthorityBundle }")) {
  const anchor = "import { SecretaryInvitationAssignmentType } from './dto/create-secretary-invitation.dto';";
  if (spec.includes(anchor)) {
    spec = spec.replace(anchor, `${anchor}\nimport { ClinicSecretaryAuthorityBundle } from './secretary-authority.types';`);
  }
}
write(specPath, spec);

// Make the frontend error parser accept Nest validation arrays if the previous patch did not land.
const clientPath = 'frontend/src/api/client.ts';
let client = read(clientPath);
client = client.replace(
  /typeof body\.message === 'string'\s*\? body\.message\s*:\s*'Something went wrong\. Please try again\.'/g,
  "typeof body.message === 'string'\n          ? body.message\n          : Array.isArray(body.message) && body.message.every((item) => typeof item === 'string')\n            ? body.message.join(' ')\n            : 'Something went wrong. Please try again.'",
);
write(clientPath, client);

console.log('Repaired invitation mobile validation patch and Secretary invitation test type drift.');
