-- M6S3: propagate the approved BookingGroup correlation onto NotificationOutbox.
ALTER TABLE "NotificationOutbox"
ADD COLUMN "bookingGroupId" TEXT;

CREATE INDEX "NotificationOutbox_bookingGroup_idx"
ON "NotificationOutbox"("bookingGroupId");

ALTER TABLE "NotificationOutbox"
ADD CONSTRAINT "NotificationOutbox_bookingGroupId_fkey"
FOREIGN KEY ("bookingGroupId") REFERENCES "BookingGroup"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
