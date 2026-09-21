const fs = require('fs');
function read(p){return fs.readFileSync(p,'utf8')}
function write(p,s){fs.writeFileSync(p,s)}

const workspace='src/practice-staff/secretary-workspace.service.ts';
let w=read(workspace);
const old=`    const invitationIdentityWhere = user.email
      ? {
          OR: [
            { targetUserId: user.id },
            { targetUserId: null, normalizedEmail: user.email.trim().toLowerCase() },
          ],
        }
      : { targetUserId: user.id };`;
const neu=`    const normalizedIdentifier =
      user.loginIdentifierType === 'EMAIL'
        ? user.email?.trim().toLowerCase()
        : user.mobileNumber;
    const invitationIdentityWhere = normalizedIdentifier
      ? {
          OR: [
            { targetUserId: user.id },
            {
              targetUserId: null,
              identifierType: user.loginIdentifierType,
              normalizedIdentifier,
            },
          ],
        }
      : { targetUserId: user.id };`;
if(w.includes(old)) w=w.replace(old,neu);
write(workspace,w);

const invitationSpec='src/practice-staff/secretary-invitation.service.spec.ts';
let s=read(invitationSpec);
s=s.replace("  it('rejects an invitation when no Secretary account exists for the submitted identifier', async () => {","  it('creates a neutral pending invitation when no Secretary account exists for the submitted identifier', async () => {");
s=s.replace(/    await expect\(service\.create\('doctor-1', clinicPlan\)\)\.rejects\.toThrow\([\s\S]*?\);\n    expect\(transaction\.secretaryInvitation\.create\)\.not\.toHaveBeenCalled\(\);/,`    await expect(service.create('doctor-1', clinicPlan)).resolves.toEqual(\n      expect.objectContaining({ status: 'PENDING' }),\n    );\n    expect(transaction.secretaryInvitation.create).toHaveBeenCalled();`);
s=s.replace("  it('rejects a corrected email that has no eligible Secretary account without changing the invitation', async () => {","  it('allows retargeting a pending invitation to an unregistered valid identifier', async () => {");
s=s.replace(/    await expect\(\n      service\.updatePending\('doctor-1', 'invite-1', \{([\s\S]*?)\}\),\n    \)\.rejects\.toBeInstanceOf\([^;]+;\n    expect\(transaction\.secretaryInvitation\.update\)\.not\.toHaveBeenCalled\(\);/,`    await expect(\n      service.updatePending('doctor-1', 'invite-1', {$1}),\n    ).resolves.toBeDefined();\n    expect(transaction.secretaryInvitation.update).toHaveBeenCalled();`);
write(invitationSpec,s);

const workspaceSpec='src/practice-staff/secretary-workspace.service.spec.ts';
let ws=read(workspaceSpec);
ws=ws.replace("{ targetUserId: null, normalizedEmail: 'secretary@example.test' },","{ targetUserId: null, identifierType: 'EMAIL', normalizedIdentifier: 'secretary@example.test' },");
write(workspaceSpec,ws);

console.log('Aligned staged invitation workspace typing and F6 neutral invitation tests.');