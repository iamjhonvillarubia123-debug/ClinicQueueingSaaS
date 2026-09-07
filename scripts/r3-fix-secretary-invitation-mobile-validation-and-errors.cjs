const fs = require('fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}
function write(path, content) {
  fs.writeFileSync(path, content, 'utf8');
}
function replaceOnce(content, from, to, label) {
  if (content.includes(to)) return content;
  if (!content.includes(from)) throw new Error(`Patch target not found: ${label}`);
  return content.replace(from, to);
}

for (const path of [
  'src/practice-staff/dto/create-secretary-invitation.dto.ts',
  'src/practice-staff/dto/update-secretary-invitation.dto.ts',
]) {
  let s = read(path);
  s = s.replace(/\n  IsEmail,/, '');
  s = replaceOnce(
    s,
    '  @IsEmail()\n  @IsNotEmpty()\n  @MaxLength(255)\n  identifier!: string;',
    '  @IsString()\n  @IsNotEmpty()\n  @MaxLength(255)\n  identifier!: string;',
    `${path} create identifier validation`,
  );
  s = replaceOnce(
    s,
    '  @IsEmail()\n  @MaxLength(255)\n  identifier?: string;',
    '  @IsString()\n  @MaxLength(255)\n  identifier?: string;',
    `${path} update identifier validation`,
  );
  write(path, s);
}

{
  const path = 'frontend/src/api/client.ts';
  let s = read(path);
  const old = `    const message = typeof payload?.message === 'string'\n      ? payload.message\n      : 'Something went wrong. Please try again.';`;
  const next = `    const message =\n      typeof payload?.message === 'string'\n        ? payload.message\n        : Array.isArray(payload?.message) &&\n            payload.message.every((item: unknown) => typeof item === 'string')\n          ? payload.message.join(' ')\n          : 'Something went wrong. Please try again.';`;
  s = replaceOnce(s, old, next, 'frontend API validation error arrays');
  write(path, s);
}

{
  const path = 'frontend/src/api/client.test.ts';
  let s = read(path);
  if (!s.includes('surfaces validation message arrays')) {
    const marker = `  it('does not invent a bearer authorization header', async () => {`;
    const test = `  it('surfaces validation message arrays from the backend', async () => {\n    vi.spyOn(globalThis, 'fetch').mockResolvedValue(\n      new Response(JSON.stringify({ message: ['identifier must be a string'] }), {\n        status: 400,\n        headers: { 'Content-Type': 'application/json' },\n      }),\n    );\n    await expect(apiRequest('/practice-staff/invitations')).rejects.toThrow(\n      'identifier must be a string',\n    );\n  });\n\n`;
    if (!s.includes(marker)) throw new Error('Patch target not found: api client test marker');
    s = s.replace(marker, test + marker);
  }
  write(path, s);
}

console.log('Aligned Secretary invitation mobile validation and frontend error feedback.');
