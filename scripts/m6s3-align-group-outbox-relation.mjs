import { readFile, writeFile } from 'node:fs/promises';

const schemaPath = 'prisma/schema.prisma';

async function replaceRequired(label, before, after) {
  const source = await readFile(schemaPath, 'utf8');
  if (source.includes(after)) {
    console.log(`${label}: already aligned`);
    return;
  }
  if (!source.includes(before)) {
    throw new Error(`${label}: expected source pattern was not found`);
  }
  await writeFile(schemaPath, source.replace(before, after), 'utf8');
  console.log(`${label}: aligned`);
}

await replaceRequired(
  'BookingGroup NotificationOutbox reverse relation',
  `  appointments                 Appointment[]\n  accessTokens                 BookingGroupAccessToken[]\n  recoveryAttempts             BookingGroupRecoveryAttempt[]`,
  `  appointments                 Appointment[]\n  notificationOutboxes          NotificationOutbox[]\n  accessTokens                 BookingGroupAccessToken[]\n  recoveryAttempts             BookingGroupRecoveryAttempt[]`,
);

await replaceRequired(
  'NotificationOutbox bookingGroupId field',
  `  practiceLocationId             String?\n  appointmentId                  String?\n  scheduledReminderId            String? @unique`,
  `  practiceLocationId             String?\n  appointmentId                  String?\n  bookingGroupId                 String?\n  scheduledReminderId            String? @unique`,
);

await replaceRequired(
  'NotificationOutbox BookingGroup relation',
  `  practiceLocation PracticeLocation? @relation(fields: [practiceLocationId], references: [id], onDelete: Restrict)\n  appointment      Appointment?      @relation(fields: [appointmentId], references: [id], onDelete: SetNull)`,
  `  practiceLocation PracticeLocation? @relation(fields: [practiceLocationId], references: [id], onDelete: Restrict)\n  appointment      Appointment?      @relation(fields: [appointmentId], references: [id], onDelete: SetNull)\n  bookingGroup     BookingGroup?     @relation(fields: [bookingGroupId], references: [id], onDelete: Restrict)`,
);

await replaceRequired(
  'NotificationOutbox bookingGroup index',
  `  @@index([practiceLocationId, createdAt], map: "NotificationOutbox_location_created_idx")\n  @@index([appointmentId], map: "NotificationOutbox_appointment_idx")\n  @@index([commandIdempotencyId], map: "NotificationOutbox_command_idx")`,
  `  @@index([practiceLocationId, createdAt], map: "NotificationOutbox_location_created_idx")\n  @@index([appointmentId], map: "NotificationOutbox_appointment_idx")\n  @@index([bookingGroupId], map: "NotificationOutbox_bookingGroup_idx")\n  @@index([commandIdempotencyId], map: "NotificationOutbox_command_idx")`,
);

console.log('M6S3 BookingGroup NotificationOutbox schema alignment complete.');
