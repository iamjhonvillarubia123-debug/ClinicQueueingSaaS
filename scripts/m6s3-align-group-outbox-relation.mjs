import { readFile, writeFile } from 'node:fs/promises';

const schemaPath = 'prisma/schema.prisma';
let source = await readFile(schemaPath, 'utf8');

function insertAfter(label, anchor, insertion, alreadyPresent) {
  if (source.includes(alreadyPresent)) {
    console.log(`${label}: already aligned`);
    return;
  }
  const index = source.indexOf(anchor);
  if (index === -1) {
    throw new Error(`${label}: anchor was not found`);
  }
  const insertionPoint = index + anchor.length;
  source = `${source.slice(0, insertionPoint)}${insertion}${source.slice(insertionPoint)}`;
  console.log(`${label}: aligned`);
}

insertAfter(
  'BookingGroup NotificationOutbox reverse relation',
  '  appointments                 Appointment[]',
  '\n  notificationOutboxes          NotificationOutbox[]',
  '  notificationOutboxes          NotificationOutbox[]',
);

insertAfter(
  'NotificationOutbox bookingGroupId field',
  '  appointmentId                  String?',
  '\n  bookingGroupId                 String?',
  '  bookingGroupId                 String?',
);

insertAfter(
  'NotificationOutbox BookingGroup relation',
  '  appointment      Appointment?      @relation(fields: [appointmentId], references: [id], onDelete: SetNull)',
  '\n  bookingGroup     BookingGroup?     @relation(fields: [bookingGroupId], references: [id], onDelete: Restrict)',
  '  bookingGroup     BookingGroup?     @relation(fields: [bookingGroupId], references: [id], onDelete: Restrict)',
);

insertAfter(
  'NotificationOutbox bookingGroup index',
  '  @@index([appointmentId], map: "NotificationOutbox_appointment_idx")',
  '\n  @@index([bookingGroupId], map: "NotificationOutbox_bookingGroup_idx")',
  '  @@index([bookingGroupId], map: "NotificationOutbox_bookingGroup_idx")',
);

await writeFile(schemaPath, source, 'utf8');
console.log('M6S3 BookingGroup NotificationOutbox schema alignment complete.');
