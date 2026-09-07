const fs=require('fs');
function read(p){return fs.readFileSync(p,'utf8')}
function write(p,s){fs.writeFileSync(p,s)}

// Fix Secretary workspace query typing by building a non-null Prisma where object explicitly.
const workspace='src/practice-staff/secretary-workspace.service.ts';
let w=read(workspace);
if(!w.includes("Prisma,")){
  w=w.replace("  AdministrativeRestrictionStatus,\n", "  AdministrativeRestrictionStatus,\n  Prisma,\n");
}
const start=w.indexOf('    const normalizedIdentifier =');
const end=w.indexOf('\n\n    const [assignments, invitations]',start);
if(start<0||end<0) throw new Error('workspace identity block not found');
const block=`    const normalizedIdentifier =\n      user.loginIdentifierType === 'EMAIL'\n        ? user.email?.trim().toLowerCase() ?? null\n        : user.mobileNumber ?? null;\n    const invitationIdentityWhere: Prisma.SecretaryInvitationWhereInput =\n      normalizedIdentifier !== null\n        ? {\n            OR: [\n              { targetUserId: user.id },\n              {\n                targetUserId: null,\n                identifierType: user.loginIdentifierType,\n                normalizedIdentifier,\n              },\n            ],\n          }\n        : { targetUserId: user.id };`;
w=w.slice(0,start)+block+w.slice(end);
write(workspace,w);

// Align invitation service specs with the approved neutral invitation behavior.
const invSpec='src/practice-staff/secretary-invitation.service.spec.ts';
let s=read(invSpec);
s=s.replace("expect(transaction.notificationOutbox.create).not.toHaveBeenCalled();","expect(transaction.notificationOutbox.create).toHaveBeenCalled();");
const title="it('allows retargeting a pending invitation to an unregistered valid identifier'";
const t=s.indexOf(title);
if(t>=0){
  const next=s.indexOf("\n  it('",t+title.length);
  const e=next>=0?next:s.lastIndexOf('\n});');
  let chunk=s.slice(t,e);
  chunk=chunk.replace(/await expect\(([\s\S]*?)\)\.rejects\.toBeInstanceOf\([^\n]+\);/,"await expect($1).resolves.toBeDefined();");
  chunk=chunk.replace("expect(transaction.secretaryInvitation.update).not.toHaveBeenCalled();","expect(transaction.secretaryInvitation.update).toHaveBeenCalled();");
  s=s.slice(0,t)+chunk+s.slice(e);
}
write(invSpec,s);

// Align workspace spec with dual-identifier invitation binding.
const wsSpec='src/practice-staff/secretary-workspace.service.spec.ts';
let ws=read(wsSpec);
ws=ws.replace(/\{\s*targetUserId: null,\s*normalizedEmail: 'secretary@example\.test',\s*\}/g,"{ targetUserId: null, identifierType: 'EMAIL', normalizedIdentifier: 'secretary@example.test' }");
write(wsSpec,ws);
console.log('Finalized staged invitation backend typing and F6-neutral invitation assertions.');