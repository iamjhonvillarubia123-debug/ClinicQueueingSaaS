-- Generated schema delta, reviewed in prisma/reviews/settings-account-notifications.md.
ALTER TYPE "ApplicationNotificationType" ADD VALUE 'ACCOUNT_ACTIVITY';
ALTER TABLE "ApplicationNotification" ADD COLUMN "message" VARCHAR(2000),
ADD COLUMN "sourceActorUserId" TEXT, ADD COLUMN "title" VARCHAR(200);

-- Notices participate in the originating transaction. No patient data or secrets.
CREATE FUNCTION emit_account_notice(recipient TEXT, identity_key TEXT, notice_title TEXT,
  notice_message TEXT, clinic TEXT DEFAULT NULL, secretary TEXT DEFAULT NULL, actor TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF recipient IS NULL THEN RETURN; END IF;
  INSERT INTO "ApplicationNotification" ("id", "recipientUserId", "notificationType", "title", "message",
    "practiceLocationId", "affectedSecretaryUserId", "sourceActorUserId", "notificationIdentityKey", "createdAt")
  VALUES (gen_random_uuid()::text, recipient, 'ACCOUNT_ACTIVITY', notice_title, notice_message,
    clinic, secretary, actor, md5(identity_key) || md5(identity_key), CURRENT_TIMESTAMP)
  ON CONFLICT ("notificationIdentityKey") DO NOTHING;
END;
$$;

CREATE FUNCTION settings_account_security_notice() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."role" NOT IN ('DOCTOR', 'SECRETARY') OR NEW."accountStatus" = 'PERMANENTLY_CLOSED' THEN RETURN NEW; END IF;
  IF NEW."passwordHash" IS DISTINCT FROM OLD."passwordHash" THEN
    PERFORM emit_account_notice(NEW."id", 'password:' || gen_random_uuid()::text,
      'Password changed', 'Your account password was changed. If this was not you, recover your account immediately.');
  END IF;
  IF NEW."accountStatus" IS DISTINCT FROM OLD."accountStatus" THEN
    PERFORM emit_account_notice(NEW."id", 'account-status:' || gen_random_uuid()::text,
      'Account status changed', 'Your account status is now ' || replace(NEW."accountStatus"::text, '_', ' ') || '.');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER settings_account_security_notice AFTER UPDATE OF "passwordHash", "accountStatus" ON "User"
FOR EACH ROW EXECUTE FUNCTION settings_account_security_notice();

CREATE FUNCTION settings_invitation_notice() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE owner_id TEXT; event_name TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."status" IS NOT DISTINCT FROM OLD."status" THEN RETURN NEW; END IF;
  END IF;
  SELECT d."userId" INTO owner_id FROM "PracticeLocation" p JOIN "DoctorProfile" d ON d."id" = p."doctorProfileId" WHERE p."id" = NEW."practiceLocationId";
  event_name := CASE NEW."status" WHEN 'PENDING' THEN 'Secretary invitation sent' WHEN 'ACCEPTED' THEN 'Secretary invitation accepted'
    WHEN 'REVOKED' THEN 'Secretary invitation cancelled' ELSE 'Secretary invitation expired' END;
  PERFORM emit_account_notice(owner_id, 'invitation:' || NEW."id" || ':' || NEW."status"::text,
    event_name, event_name || '. Review the clinic Staff tab for current assignment details.', NEW."practiceLocationId", NEW."acceptedUserId", NEW."invitedByUserId");
  RETURN NEW;
END;
$$;
CREATE TRIGGER settings_invitation_notice AFTER INSERT OR UPDATE OF "status" ON "SecretaryInvitation"
FOR EACH ROW EXECUTE FUNCTION settings_invitation_notice();

CREATE FUNCTION settings_payment_notice() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE owner_id TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."status" IS NOT DISTINCT FROM OLD."status" THEN RETURN NEW; END IF;
  END IF;
  SELECT f."doctorUserId" INTO owner_id FROM "SubscriptionPurchase" p JOIN "DoctorFinancialAccount" f ON f."id" = p."doctorFinancialAccountId" WHERE p."id" = NEW."subscriptionPurchaseId";
  PERFORM emit_account_notice(owner_id, 'payment:' || NEW."id" || ':' || NEW."status"::text,
    'Subscription payment ' || lower(NEW."status"::text), 'Your subscription payment status changed to ' || NEW."status"::text || '. Review Billing for details.');
  RETURN NEW;
END;
$$;
CREATE TRIGGER settings_payment_notice AFTER INSERT OR UPDATE OF "status" ON "SubscriptionPayment"
FOR EACH ROW EXECUTE FUNCTION settings_payment_notice();

CREATE FUNCTION settings_refund_notice() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE owner_id TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."status" IS NOT DISTINCT FROM OLD."status" THEN RETURN NEW; END IF;
  END IF;
  SELECT "doctorUserId" INTO owner_id FROM "DoctorFinancialAccount" WHERE "id" = NEW."doctorFinancialAccountId";
  PERFORM emit_account_notice(owner_id, 'refund:' || NEW."id" || ':' || NEW."status"::text,
    'Refund ' || lower(NEW."status"::text), 'Your refund status changed to ' || NEW."status"::text || '. Review Billing for details.');
  RETURN NEW;
END;
$$;
CREATE TRIGGER settings_refund_notice AFTER INSERT OR UPDATE OF "status" ON "RefundRequest"
FOR EACH ROW EXECUTE FUNCTION settings_refund_notice();
