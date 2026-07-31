-- CreateTable
CREATE TABLE "ContactPreference" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "allowOperationalMessages" BOOLEAN NOT NULL DEFAULT true,
    "allowFollowUpReminder" BOOLEAN NOT NULL DEFAULT false,
    "allowMarketingMessages" BOOLEAN NOT NULL DEFAULT false,
    "acknowledgedAt" TIMESTAMPTZ(3) NOT NULL,
    "withdrawnAt" TIMESTAMPTZ(3),
    "privacyNoticeVersion" VARCHAR(30) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContactPreference_appointmentId_key" ON "ContactPreference"("appointmentId");

-- AddForeignKey
ALTER TABLE "ContactPreference" ADD CONSTRAINT "ContactPreference_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
