import { readFileSync, writeFileSync } from 'node:fs';

for (const file of [
  'prisma/migrations/20260906190500_r3_financial_primary_recovery_identity/migration.sql',
  'src/financial/doctor-closure-financial-settlement.service.ts',
  'src/financial/financial-access-challenge.service.ts',
]) {
  const source = readFileSync(file, 'utf8');
  writeFileSync(
    file,
    source.replaceAll('"LoginIdentifierType"', '"AccountLoginIdentifierType"'),
  );
}

const schemaPath = 'prisma/schema.prisma';
let schema = readFileSync(schemaPath, 'utf8');

schema = schema.replace(
`model DoctorFinancialAccount {
  id String @id @default(uuid())
  doctorUserId String @unique
  recoveryEmailEncrypted String?
  recoveryEmailHash      String? @db.VarChar(64)
`,
`model DoctorFinancialAccount {
  id String @id @default(uuid())
  doctorUserId String @unique
  recoveryEmailEncrypted      String?
  recoveryEmailHash           String?                     @db.VarChar(64)
  recoveryIdentifierType      AccountLoginIdentifierType?
  recoveryIdentifierEncrypted String?
  recoveryIdentifierHash      String?                     @db.VarChar(128)
`,
);

schema = schema.replace(
`  @@index([recoveryEmailHash], map: "DoctorFinancialAccount_recoveryEmailHash_idx")
}
`,
`  @@index([recoveryEmailHash], map: "DoctorFinancialAccount_recoveryEmailHash_idx")
  @@index([recoveryIdentifierType, recoveryIdentifierHash], map: "DoctorFinancialAccount_recoveryIdentifier_idx")
}
`,
);

schema = schema.replace(
`model FinancialAccessChallenge {
  id String @id @default(uuid())
  recoveryEmailHash       String @db.VarChar(64)
  recipientEmailEncrypted String
  codeHash                String @db.VarChar(64)
`,
`model FinancialAccessChallenge {
  id String @id @default(uuid())
  recoveryEmailHash            String?                     @db.VarChar(64)
  recipientEmailEncrypted      String?
  recoveryIdentifierType       AccountLoginIdentifierType?
  recoveryIdentifierHash       String?                     @db.VarChar(128)
  recipientIdentifierEncrypted String?
  codeHash                     String                      @db.VarChar(64)
`,
);

schema = schema.replace(
`  @@index([recoveryEmailHash, createdAt], map: "FinancialAccessChallenge_email_created_idx")
  @@index([expiresAt], map: "FinancialAccessChallenge_expires_idx")
}
`,
`  @@index([recoveryEmailHash, createdAt], map: "FinancialAccessChallenge_email_created_idx")
  @@index([recoveryIdentifierType, recoveryIdentifierHash, createdAt], map: "FinancialAccessChallenge_identifier_created_idx")
  @@index([expiresAt], map: "FinancialAccessChallenge_expires_idx")
}
`,
);

if (!schema.includes('recoveryIdentifierType      AccountLoginIdentifierType?')) {
  throw new Error('DoctorFinancialAccount schema repair did not apply');
}
if (!schema.includes('recoveryIdentifierType       AccountLoginIdentifierType?')) {
  throw new Error('FinancialAccessChallenge schema repair did not apply');
}

writeFileSync(schemaPath, schema);
