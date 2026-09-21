const fs = require('fs');

const path = 'src/practice-staff/secretary-invitation.service.spec.ts';
let s = fs.readFileSync(path, 'utf8');

const target = "    prisma.secretaryInvitation.findUnique.mockResolvedValue(null);\n    transaction.secretaryInvitation.create.mockResolvedValue({\n      id: 'invite-1',\n      status: SecretaryInvitationStatus.PENDING,\n      expiresAt: new Date(Date.now() + 1000),\n    });";
const replacement = "    prisma.secretaryInvitation.findUnique.mockResolvedValue(null);\n    prisma.secretaryInvitation.update.mockResolvedValue({\n      id: 'invite-1',\n      status: SecretaryInvitationStatus.PENDING,\n      updatedAt: new Date(),\n    });\n    transaction.secretaryInvitation.create.mockResolvedValue({\n      id: 'invite-1',\n      status: SecretaryInvitationStatus.PENDING,\n      expiresAt: new Date(Date.now() + 1000),\n    });";

if (!s.includes(target)) {
  throw new Error('Patch target not found: root invitation update result mock');
}

s = s.replace(target, replacement);
fs.writeFileSync(path, s, 'utf8');
console.log('Aligned Secretary invitation update result mock with current service return contract.');
