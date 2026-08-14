-- M1S4C PostgreSQL identifier-length synchronization.
-- Prisma's implicit QueueEvent sequence index names are 64 characters,
-- while PostgreSQL identifiers are limited to 63 bytes. PostgreSQL therefore
-- truncated both names when the preceding migration created them.
-- Rename both indexes to explicit short canonical names synchronized with Prisma.

ALTER INDEX "QueueEvent_practiceLocationId_serviceDate_queueEventSequence_ke"
  RENAME TO "QueueEvent_scope_sequence_key";

ALTER INDEX "QueueEvent_practiceLocationId_serviceDate_queueEventSequence_id"
  RENAME TO "QueueEvent_scope_sequence_idx";