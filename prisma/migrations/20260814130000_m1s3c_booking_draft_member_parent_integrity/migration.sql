-- M1S3C BOOKING DRAFT MEMBER / PARENT INTEGRITY
--
-- Phase 2 requires a member-owned BookingDraftAnswer to reference a member
-- belonging to the same BookingDraft. The same parent-integrity rule applies
-- to member-specific temporary Service selections.
--
-- Prisma retains the ordinary single-column relations for client ergonomics.
-- These PostgreSQL backstops prevent cross-parent combinations that a normal
-- single-column foreign key cannot reject.

-- Required target key for composite foreign keys. `id` is already globally
-- unique; this additional key exists solely to let PostgreSQL validate the
-- parent pairing without introducing duplicate ownership columns.
CREATE UNIQUE INDEX "BookingDraftMember_id_bookingDraftId_key"
ON "BookingDraftMember"("id", "bookingDraftId");

-- A member-owned answer must use the same parent BookingDraft as its member.
-- For INDIVIDUAL answers bookingDraftMemberId is NULL; PostgreSQL MATCH SIMPLE
-- correctly leaves those rows to the approved individual ownership rules and
-- partial uniqueness index established in M1S3B.
ALTER TABLE "BookingDraftAnswer"
ADD CONSTRAINT "BookingDraftAnswer_member_parent_fkey"
FOREIGN KEY ("bookingDraftMemberId", "bookingDraftId")
REFERENCES "BookingDraftMember"("id", "bookingDraftId")
ON DELETE RESTRICT
ON UPDATE CASCADE;

-- Member-specific Service selections follow the same parent draft as the
-- BookingDraftMember. Individual selections keep bookingDraftMemberId NULL.
ALTER TABLE "BookingDraftServiceSelection"
ADD CONSTRAINT "BookingDraftServiceSelection_member_parent_fkey"
FOREIGN KEY ("bookingDraftMemberId", "bookingDraftId")
REFERENCES "BookingDraftMember"("id", "bookingDraftId")
ON DELETE RESTRICT
ON UPDATE CASCADE;
