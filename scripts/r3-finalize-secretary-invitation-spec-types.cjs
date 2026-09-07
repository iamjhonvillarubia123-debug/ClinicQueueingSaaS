const fs = require('fs');

const path = 'src/practice-staff/secretary-invitation.service.spec.ts';
let s = fs.readFileSync(path, 'utf8');

// Remove duplicate ConfigService imports if earlier local repair scripts produced them.
const configImport = "import { ConfigService } from '@nestjs/config';";
const configMatches = [...s.matchAll(new RegExp(configImport.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))];
if (configMatches.length > 1) {
  let seen = false;
  s = s
    .split(/\r?\n/)
    .filter((line) => {
      if (line !== configImport) return true;
      if (!seen) {
        seen = true;
        return true;
      }
      return false;
    })
    .join('\n');
}

// The DTO owns the assignment enum contract. Do not use the similarly named Prisma enum in DTO fixtures.
s = s.replace(/\n\s*SecretaryInvitationAssignmentType,\n/, '\n');

const dtoImport = "import {\n  CreateSecretaryInvitationDto,\n  SecretaryInvitationAssignmentType,\n} from './dto/create-secretary-invitation.dto';";
if (!s.includes("from './dto/create-secretary-invitation.dto'")) {
  const anchor = "import { MobileNumberService } from '../security/mobile-number/mobile-number.service';";
  if (!s.includes(anchor)) throw new Error('Could not locate DTO import anchor');
  s = s.replace(anchor, `${anchor}\n${dtoImport}`);
} else {
  // Normalize any existing local import of the DTO enum.
  s = s.replace(/import \{[^}]*SecretaryInvitationAssignmentType[^}]*\} from '\.\/dto\/create-secretary-invitation\.dto';/s, dtoImport);
}

const authorityImport = "import { ClinicSecretaryAuthorityBundle } from './secretary-authority.types';";
if (!s.includes(authorityImport)) {
  const anchor = "import { SecretaryInvitationService } from './secretary-invitation.service';";
  if (!s.includes(anchor)) throw new Error('Could not locate authority import anchor');
  s = s.replace(anchor, `${authorityImport}\n${anchor}`);
}

// Use the application authority enum wherever DTO fixtures are constructed.
s = s.replace(/\['QUEUE_AND_CLINIC_DAY_OPERATIONS'\]/g, '[ClinicSecretaryAuthorityBundle.QUEUE_AND_CLINIC_DAY_OPERATIONS]');

// Give the shared plan the DTO type so fixtures cannot silently drift again.
s = s.replace(/const clinicPlan\s*=\s*\{/m, 'const clinicPlan: CreateSecretaryInvitationDto = {');
s = s.replace(/\n\s*\}\s+as const;(?=\n\n\s*beforeEach)/m, '\n  };');

fs.writeFileSync(path, s, 'utf8');
console.log('Aligned Secretary invitation spec with application DTO enums and authority bundle types.');
