import { readFile, writeFile } from 'node:fs/promises';

async function replaceRequired(path, search, replacement, label) {
  const original = await readFile(path, 'utf8');
  if (original.includes(replacement)) {
    console.log(`${label}: already aligned`);
    return;
  }
  if (!original.includes(search)) {
    throw new Error(`${label}: expected source pattern was not found`);
  }
  const updated = original.replace(search, replacement);
  await writeFile(path, updated, 'utf8');
  console.log(`${label}: aligned`);
}

await replaceRequired(
  'prisma/schema.prisma',
  `  mobileNumberEncrypted String?\n  mobileNumberHash      String? @db.VarChar(128)\n  mobileNumberLastFour  String? @db.Char(4)\n\n  draftControlTokenHash String? @db.VarChar(64)`,
  `  mobileNumberEncrypted String?\n  mobileNumberHash      String? @db.VarChar(128)\n  mobileNumberLastFour  String? @db.Char(4)\n\n  activeDraftKey String? @unique @db.VarChar(64)\n\n  draftControlTokenHash String? @db.VarChar(64)`,
  'BookingDraft Prisma field',
);

await replaceRequired(
  'prisma/schema.prisma',
  `  mobileNumberEncrypted String?\n  mobileNumberHash      String?\n  mobileNumberLastFour  String? @db.VarChar(4)\n\n  calledAt`,
  `  mobileNumberEncrypted String?\n  mobileNumberHash      String?\n  mobileNumberLastFour  String? @db.VarChar(4)\n\n  activeAppointmentKey String? @unique @db.VarChar(64)\n\n  calledAt`,
  'Appointment Prisma field',
);

await replaceRequired(
  'src/booking/booking.service.ts',
  `import { BookingConfigurationService } from './booking-configuration.service';`,
  `import { ActiveBookingIdentityService } from './active-booking-identity.service';\nimport { BookingConfigurationService } from './booking-configuration.service';`,
  'BookingService active identity import',
);

await replaceRequired(
  'src/booking/booking.service.ts',
  `    private readonly bookingDraftControlService: BookingDraftControlService,\n  ) {}`,
  `    private readonly bookingDraftControlService: BookingDraftControlService,\n    private readonly activeBookingIdentityService: ActiveBookingIdentityService,\n  ) {}`,
  'BookingService active identity dependency',
);

await replaceRequired(
  'src/booking/booking.service.ts',
  `    const controlCredential = this.bookingDraftControlService.issueCredential();\n    const acknowledgement = this.prepareAcknowledgement(createBookingDraftDto);`,
  `    const controlCredential = this.bookingDraftControlService.issueCredential();\n    const acknowledgement = this.prepareAcknowledgement(createBookingDraftDto);\n    const activeDraftKey = this.activeBookingIdentityService.deriveDraftKey(\n      protectedMobileNumber.hash,\n      createBookingDraftDto.practiceLocationId,\n      serviceDate,\n    );`,
  'BookingService draft key derivation',
);

await replaceRequired(
  'src/booking/booking.service.ts',
  `            controlCredential.tokenHash,\n            acknowledgement,\n          )`,
  `            controlCredential.tokenHash,\n            acknowledgement,\n            activeDraftKey,\n          )`,
  'BookingService multi-person draft key argument',
);

await replaceRequired(
  'src/booking/booking.service.ts',
  `            controlCredential.tokenHash,\n            acknowledgement,\n          );`,
  `            controlCredential.tokenHash,\n            acknowledgement,\n            activeDraftKey,\n          );`,
  'BookingService individual draft key argument',
);

await replaceRequired(
  'src/booking/booking.service.ts',
  `    draftControlTokenHash: string,\n    acknowledgement: ReturnType<BookingService['prepareAcknowledgement']>,\n  ) {`,
  `    draftControlTokenHash: string,\n    acknowledgement: ReturnType<BookingService['prepareAcknowledgement']>,\n    activeDraftKey: string,\n  ) {`,
  'BookingService individual signature',
);

const servicePath = 'src/booking/booking.service.ts';
let service = await readFile(servicePath, 'utf8');
const signatureNeedle = `    draftControlTokenHash: string,\n    acknowledgement: ReturnType<BookingService['prepareAcknowledgement']>,\n  ) {`;
if (service.includes(signatureNeedle)) {
  service = service.replace(
    signatureNeedle,
    `    draftControlTokenHash: string,\n    acknowledgement: ReturnType<BookingService['prepareAcknowledgement']>,\n    activeDraftKey: string,\n  ) {`,
  );
  await writeFile(servicePath, service, 'utf8');
  console.log('BookingService multi-person signature: aligned');
} else {
  console.log('BookingService multi-person signature: already aligned');
}

service = await readFile(servicePath, 'utf8');
const transactionNeedle = `        const bookingDraft = await this.prisma.$transaction(\n          async (transaction) => {\n            const created = await transaction.bookingDraft.create({`;
const transactionReplacement = `        const bookingDraft = await this.prisma.$transaction(\n          async (transaction) => {\n            await this.activeBookingIdentityService.acquireDraftScopeLock(\n              transaction,\n              activeDraftKey,\n            );\n            await this.activeBookingIdentityService.assertNoActiveDraft(\n              transaction,\n              activeDraftKey,\n            );\n\n            const created = await transaction.bookingDraft.create({`;
if (service.includes(transactionNeedle)) {
  service = service.replace(transactionNeedle, transactionReplacement);
} else if (!service.includes(transactionReplacement)) {
  throw new Error('BookingService individual transaction pattern was not found');
}

const attachNeedle = `            await this.bookingDraftControlService.attachCredential(\n              transaction,\n              created.id,\n              draftControlTokenHash,\n            );\n\n            return created;`;
const attachReplacement = `            await this.bookingDraftControlService.attachCredential(\n              transaction,\n              created.id,\n              draftControlTokenHash,\n            );\n            await this.activeBookingIdentityService.attachDraftKey(\n              transaction,\n              created.id,\n              activeDraftKey,\n            );\n\n            return created;`;
if (service.includes(attachNeedle)) {
  service = service.replace(attachNeedle, attachReplacement);
} else if (!service.includes(attachReplacement)) {
  throw new Error('BookingService individual key attachment pattern was not found');
}

const parentTransactionNeedle = `        const bookingDraft = await this.prisma.$transaction(\n          async (transaction) => {\n            const parent = await transaction.bookingDraft.create({`;
const parentTransactionReplacement = `        const bookingDraft = await this.prisma.$transaction(\n          async (transaction) => {\n            await this.activeBookingIdentityService.acquireDraftScopeLock(\n              transaction,\n              activeDraftKey,\n            );\n            await this.activeBookingIdentityService.assertNoActiveDraft(\n              transaction,\n              activeDraftKey,\n            );\n\n            const parent = await transaction.bookingDraft.create({`;
if (service.includes(parentTransactionNeedle)) {
  service = service.replace(parentTransactionNeedle, parentTransactionReplacement);
} else if (!service.includes(parentTransactionReplacement)) {
  throw new Error('BookingService multi-person transaction pattern was not found');
}

const parentAttachNeedle = `            await this.bookingDraftControlService.attachCredential(\n              transaction,\n              parent.id,\n              draftControlTokenHash,\n            );\n\n            for (const preparedMember of preparedMembers) {`;
const parentAttachReplacement = `            await this.bookingDraftControlService.attachCredential(\n              transaction,\n              parent.id,\n              draftControlTokenHash,\n            );\n            await this.activeBookingIdentityService.attachDraftKey(\n              transaction,\n              parent.id,\n              activeDraftKey,\n            );\n\n            for (const preparedMember of preparedMembers) {`;
if (service.includes(parentAttachNeedle)) {
  service = service.replace(parentAttachNeedle, parentAttachReplacement);
} else if (!service.includes(parentAttachReplacement)) {
  throw new Error('BookingService multi-person key attachment pattern was not found');
}
await writeFile(servicePath, service, 'utf8');
console.log('BookingService draft concurrency transaction wiring: aligned');

await replaceRequired(
  'src/booking/booking-draft-cleanup.service.ts',
  `          "expiredAt" = \${now},\n          "draftControlTokenHash" = NULL`,
  `          "expiredAt" = \${now},\n          "activeDraftKey" = NULL,\n          "draftControlTokenHash" = NULL`,
  'BookingDraft expiry active key clearing',
);

await replaceRequired(
  'src/booking/booking-draft-cleanup.service.ts',
  `          "mobileNumberLastFour" = NULL,\n          "draftControlTokenHash" = NULL,`,
  `          "mobileNumberLastFour" = NULL,\n          "activeDraftKey" = NULL,\n          "draftControlTokenHash" = NULL,`,
  'BookingDraft protected cleanup active key clearing',
);

console.log('M6S1 active-key alignment complete.');
