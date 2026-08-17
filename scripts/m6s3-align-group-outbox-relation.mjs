import { readFile, writeFile } from 'node:fs/promises';

const schemaPath = 'prisma/schema.prisma';
let source = await readFile(schemaPath, 'utf8');

function modelBlock(modelName) {
  const startMarker = `model ${modelName} {`;
  const start = source.indexOf(startMarker);
  if (start === -1) {
    throw new Error(`${modelName}: model was not found`);
  }

  const nextModel = source.indexOf('\nmodel ', start + startMarker.length);
  const end = nextModel === -1 ? source.length : nextModel;
  return { start, end, text: source.slice(start, end) };
}

function insertAfterInModel(modelName, label, anchor, insertion, alreadyPresent) {
  const block = modelBlock(modelName);
  if (block.text.includes(alreadyPresent)) {
    console.log(`${label}: already aligned`);
    return;
  }

  const relativeAnchorIndex = block.text.indexOf(anchor);
  if (relativeAnchorIndex === -1) {
    throw new Error(`${label}: anchor was not found in ${modelName}`);
  }

  const insertionPoint = block.start + relativeAnchorIndex + anchor.length;
  source = `${source.slice(0, insertionPoint)}${insertion}${source.slice(insertionPoint)}`;
  console.log(`${label}: aligned`);
}

insertAfterInModel(
  'BookingGroup',
  'BookingGroup NotificationOutbox reverse relation',
  '  appointments                 Appointment[]',
  '\n  notificationOutboxes          NotificationOutbox[]',
  '  notificationOutboxes          NotificationOutbox[]',
);

insertAfterInModel(
  'NotificationOutbox',
  'NotificationOutbox bookingGroupId field',
  '  appointmentId                  String?',
  '\n  bookingGroupId                 String?',
  '  bookingGroupId                 String?',
);

insertAfterInModel(
  'NotificationOutbox',
  'NotificationOutbox BookingGroup relation',
  '  appointment      Appointment?      @relation(fields: [appointmentId], references: [id], onDelete: SetNull)',
  '\n  bookingGroup     BookingGroup?     @relation(fields: [bookingGroupId], references: [id], onDelete: Restrict)',
  '  bookingGroup     BookingGroup?     @relation(fields: [bookingGroupId], references: [id], onDelete: Restrict)',
);

insertAfterInModel(
  'NotificationOutbox',
  'NotificationOutbox bookingGroup index',
  '  @@index([appointmentId], map: "NotificationOutbox_appointment_idx")',
  '\n  @@index([bookingGroupId], map: "NotificationOutbox_bookingGroup_idx")',
  '  @@index([bookingGroupId], map: "NotificationOutbox_bookingGroup_idx")',
);

await writeFile(schemaPath, source, 'utf8');
console.log('M6S3 BookingGroup NotificationOutbox schema alignment complete.');
