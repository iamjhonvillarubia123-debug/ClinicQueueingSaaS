import { readFile, writeFile } from 'node:fs/promises';

const path = 'test/im-here.e2e-spec.ts';
const source = await readFile(path, 'utf8');

const pattern = /await expect\(\s*service\.reinsert\(\s*absent\.bookingReference,\s*await issueToken\(\s*absent\.id,\s*serviceDate,\s*BookingAccessTokenPurpose\.VIEW_AND_MANAGE_BOOKING,\s*new Date\(Date\.now\(\) - 1000\),?\s*\),\s*`imhere-expired-\$\{scope\}`,\s*\),\s*\)\.rejects\.toThrow\('Patient booking access is unavailable'\);/m;

if (!pattern.test(source)) {
  throw new Error('I\'M HERE expired-token fixture: expected source block was not found');
}

const replacement = `const expiredToken = await issueToken(absent.id, serviceDate);\n    const expiredTokenCreatedAt = new Date(Date.now() - 2_000);\n    const expiredTokenExpiresAt = new Date(Date.now() - 1_000);\n    await prisma.bookingAccessToken.update({\n      where: { tokenHash: tokenHash(expiredToken) },\n      data: {\n        createdAt: expiredTokenCreatedAt,\n        expiresAt: expiredTokenExpiresAt,\n      },\n    });\n    await expect(\n      service.reinsert(\n        absent.bookingReference,\n        expiredToken,\n        \`imhere-expired-\${scope}\`,\n      ),\n    ).rejects.toThrow('Patient booking access is unavailable');`;

const updated = source.replace(pattern, replacement);
await writeFile(path, updated, 'utf8');
console.log('M7S3C I\'M HERE expired-token fixture aligned.');
