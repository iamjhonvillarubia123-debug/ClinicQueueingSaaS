-- CreateEnum
CREATE TYPE "PracticeStaffRole" AS ENUM ('SECRETARY');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('WAITING', 'CALLED', 'TEMPORARILY_ABSENT', 'OUT_FOR_PROCEDURE', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED');

-- CreateEnum
CREATE TYPE "AppointmentCancelledByType" AS ENUM ('PATIENT', 'DOCTOR', 'SECRETARY', 'SYSTEM');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('BOOKING_VERIFICATION');

-- CreateEnum
CREATE TYPE "BookingAccessTokenPurpose" AS ENUM ('VIEW_AND_MANAGE_BOOKING', 'VIEW_ONLY');

-- CreateEnum
CREATE TYPE "FollowUpRecommendationStatus" AS ENUM ('SCHEDULED', 'SENT', 'CANCELLED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('OTP', 'BOOKING_CONFIRMED', 'APPOINTMENT_REMINDER', 'FOLLOW_UP_REMINDER', 'CANCELLATION_CONFIRMATION');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('SMS', 'EMAIL', 'PUSH');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('DOCTOR', 'SECRETARY', 'SYSTEM_ADMIN');

-- CreateEnum
CREATE TYPE "BookingDraftStatus" AS ENUM ('PENDING_OTP', 'CONSUMED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QueueEventType" AS ENUM ('NEXT_PATIENT', 'SELF_SERVICE_REINSERTION', 'STAFF_REINSERTION', 'OUT_FOR_PROCEDURE', 'UNDO_NEXT_PATIENT', 'APPOINTMENT_CANCELLED', 'QUEUE_CLOSED');

-- CreateEnum
CREATE TYPE "QueueEventActorType" AS ENUM ('USER', 'PATIENT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "BookingQuestionType" AS ENUM ('TEXT', 'NUMBER', 'BOOLEAN', 'SINGLE_SELECT');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "firstName" VARCHAR(100) NOT NULL,
    "lastName" VARCHAR(100) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "mobileNumber" VARCHAR(30) NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "role" "UserRole" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "emailVerifiedAt" TIMESTAMPTZ(3),
    "lastLoginAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DoctorProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "middleName" VARCHAR(100),
    "suffix" VARCHAR(30),
    "professionalTitle" VARCHAR(50) NOT NULL,
    "specialization" VARCHAR(150) NOT NULL,
    "licenseNumber" VARCHAR(100) NOT NULL,
    "profileDescription" TEXT,
    "profilePhotoUrl" VARCHAR(500),
    "publicSlug" VARCHAR(120),
    "isProfilePublic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DoctorProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DoctorAccountSettings" (
    "id" TEXT NOT NULL,
    "doctorProfileId" TEXT NOT NULL,
    "defaultTimeZone" VARCHAR(100) NOT NULL DEFAULT 'Asia/Manila',
    "defaultConsultationMinutes" INTEGER NOT NULL DEFAULT 30,
    "maximumAdvanceBookingDays" INTEGER NOT NULL DEFAULT 30,
    "allowOnlineBooking" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DoctorAccountSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PracticeLocation" (
    "id" TEXT NOT NULL,
    "doctorProfileId" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "addressLine1" VARCHAR(255) NOT NULL,
    "addressLine2" VARCHAR(255),
    "cityMunicipality" VARCHAR(120) NOT NULL,
    "province" VARCHAR(120) NOT NULL,
    "postalCode" VARCHAR(20),
    "contactNumber" VARCHAR(30) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isBookingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PracticeLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PracticeStaff" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "practiceLocationId" TEXT NOT NULL,
    "staffRole" "PracticeStaffRole" NOT NULL DEFAULT 'SECRETARY',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PracticeStaff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Patient" (
    "id" TEXT NOT NULL,
    "fullName" VARCHAR(150) NOT NULL,
    "mobileNumberEncrypted" TEXT NOT NULL,
    "mobileNumberHash" VARCHAR(128) NOT NULL,
    "mobileVerifiedAt" TIMESTAMPTZ(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "anonymizedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "bookingReference" VARCHAR(20) NOT NULL,
    "patientId" TEXT NOT NULL,
    "practiceLocationId" TEXT NOT NULL,
    "serviceDate" DATE NOT NULL,
    "estimatedServiceMinutes" INTEGER NOT NULL,
    "queueNumber" INTEGER NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'WAITING',
    "arrivedAt" TIMESTAMPTZ(3),
    "calledAt" TIMESTAMPTZ(3),
    "serviceStartedAt" TIMESTAMPTZ(3),
    "serviceCompletedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelledByType" "AppointmentCancelledByType",
    "cancellationReason" VARCHAR(255),
    "createdByUserId" TEXT,
    "anonymizedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtpVerification" (
    "id" TEXT NOT NULL,
    "bookingDraftId" TEXT NOT NULL,
    "mobileNumberHash" VARCHAR(128) NOT NULL,
    "otpHash" VARCHAR(255) NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "verifiedAt" TIMESTAMPTZ(3),
    "consumedAt" TIMESTAMPTZ(3),
    "invalidatedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingAccessToken" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "tokenHash" VARCHAR(255) NOT NULL,
    "purpose" "BookingAccessTokenPurpose" NOT NULL DEFAULT 'VIEW_AND_MANAGE_BOOKING',
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "lastUsedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingAccessToken_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "FollowUpRecommendation" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "recommendedByUserId" TEXT NOT NULL,
    "recommendedFollowUpDate" DATE NOT NULL,
    "reminderScheduledAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "FollowUpRecommendationStatus" NOT NULL DEFAULT 'SCHEDULED',
    "shortNote" VARCHAR(150),
    "sentAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FollowUpRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT,
    "followUpRecommendationId" TEXT,
    "type" "NotificationType" NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "recipientMobileEncrypted" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "providerMessageId" VARCHAR(150),
    "sentAt" TIMESTAMPTZ(3),
    "deliveredAt" TIMESTAMPTZ(3),
    "failedAt" TIMESTAMPTZ(3),
    "failureReason" VARCHAR(255),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingDraft" (
    "id" TEXT NOT NULL,
    "bookingReference" VARCHAR(20) NOT NULL,
    "status" "BookingDraftStatus" NOT NULL DEFAULT 'PENDING_OTP',
    "practiceLocationId" TEXT NOT NULL,
    "firstName" VARCHAR(100) NOT NULL,
    "middleName" VARCHAR(100),
    "lastName" VARCHAR(100) NOT NULL,
    "suffix" VARCHAR(20),
    "mobileNumberEncrypted" TEXT NOT NULL,
    "mobileNumberHash" VARCHAR(128) NOT NULL,
    "mobileNumberLastFour" CHAR(4) NOT NULL,
    "serviceDate" DATE NOT NULL,
    "estimatedServiceMinutes" INTEGER NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "consumedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BookingDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueueCounter" (
    "id" TEXT NOT NULL,
    "practiceLocationId" TEXT NOT NULL,
    "serviceDate" DATE NOT NULL,
    "lastAllocatedNumber" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "QueueCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueueEvent" (
    "id" TEXT NOT NULL,
    "practiceLocationId" TEXT NOT NULL,
    "serviceDate" DATE NOT NULL,
    "type" "QueueEventType" NOT NULL,
    "actorType" "QueueEventActorType" NOT NULL,
    "actorUserId" TEXT,
    "primaryAppointmentId" TEXT NOT NULL,
    "secondaryAppointmentId" TEXT,
    "previousPrimaryStatus" "AppointmentStatus",
    "newPrimaryStatus" "AppointmentStatus",
    "previousSecondaryStatus" "AppointmentStatus",
    "newSecondaryStatus" "AppointmentStatus",
    "reversedEventId" TEXT,
    "isUndoable" BOOLEAN NOT NULL DEFAULT false,
    "undoneAt" TIMESTAMPTZ(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QueueEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingQuestion" (
    "id" TEXT NOT NULL,
    "practiceLocationId" TEXT NOT NULL,
    "questionText" VARCHAR(500) NOT NULL,
    "helpText" VARCHAR(500),
    "type" "BookingQuestionType" NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "displayOrder" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "estimatedMinutesAdjustment" INTEGER NOT NULL DEFAULT 0,
    "textMaximumLength" INTEGER,
    "numberMinimum" DECIMAL(65,30),
    "numberMaximum" DECIMAL(65,30),
    "selectOptions" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BookingQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingDraftAnswer" (
    "id" TEXT NOT NULL,
    "bookingDraftId" TEXT NOT NULL,
    "bookingQuestionId" TEXT NOT NULL,
    "answerText" TEXT,
    "answerNumber" DECIMAL(65,30),
    "answerBoolean" BOOLEAN,
    "selectedOptionValue" VARCHAR(100),
    "estimatedMinutesAdjustment" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BookingDraftAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppointmentAnswer" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "bookingQuestionId" TEXT NOT NULL,
    "answerText" TEXT,
    "answerNumber" DECIMAL(65,30),
    "answerBoolean" BOOLEAN,
    "selectedOptionValue" VARCHAR(100),
    "estimatedMinutesAdjustment" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AppointmentAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "DoctorProfile_userId_key" ON "DoctorProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DoctorProfile_licenseNumber_key" ON "DoctorProfile"("licenseNumber");

-- CreateIndex
CREATE UNIQUE INDEX "DoctorProfile_publicSlug_key" ON "DoctorProfile"("publicSlug");

-- CreateIndex
CREATE UNIQUE INDEX "DoctorAccountSettings_doctorProfileId_key" ON "DoctorAccountSettings"("doctorProfileId");

-- CreateIndex
CREATE INDEX "PracticeLocation_doctorProfileId_idx" ON "PracticeLocation"("doctorProfileId");

-- CreateIndex
CREATE INDEX "PracticeStaff_userId_idx" ON "PracticeStaff"("userId");

-- CreateIndex
CREATE INDEX "PracticeStaff_practiceLocationId_idx" ON "PracticeStaff"("practiceLocationId");

-- CreateIndex
CREATE UNIQUE INDEX "PracticeStaff_userId_practiceLocationId_key" ON "PracticeStaff"("userId", "practiceLocationId");

-- CreateIndex
CREATE UNIQUE INDEX "Patient_mobileNumberHash_key" ON "Patient"("mobileNumberHash");

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_bookingReference_key" ON "Appointment"("bookingReference");

-- CreateIndex
CREATE INDEX "Appointment_practiceLocationId_serviceDate_idx" ON "Appointment"("practiceLocationId", "serviceDate");

-- CreateIndex
CREATE INDEX "Appointment_practiceLocationId_status_serviceDate_idx" ON "Appointment"("practiceLocationId", "status", "serviceDate");

-- CreateIndex
CREATE INDEX "Appointment_patientId_idx" ON "Appointment"("patientId");

-- CreateIndex
CREATE INDEX "Appointment_status_idx" ON "Appointment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_practiceLocationId_serviceDate_queueNumber_key" ON "Appointment"("practiceLocationId", "serviceDate", "queueNumber");

-- CreateIndex
CREATE INDEX "OtpVerification_bookingDraftId_idx" ON "OtpVerification"("bookingDraftId");

-- CreateIndex
CREATE INDEX "OtpVerification_mobileNumberHash_purpose_expiresAt_idx" ON "OtpVerification"("mobileNumberHash", "purpose", "expiresAt");

-- CreateIndex
CREATE INDEX "OtpVerification_expiresAt_idx" ON "OtpVerification"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "BookingAccessToken_tokenHash_key" ON "BookingAccessToken"("tokenHash");

-- CreateIndex
CREATE INDEX "BookingAccessToken_appointmentId_idx" ON "BookingAccessToken"("appointmentId");

-- CreateIndex
CREATE INDEX "BookingAccessToken_expiresAt_idx" ON "BookingAccessToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ContactPreference_appointmentId_key" ON "ContactPreference"("appointmentId");

-- CreateIndex
CREATE INDEX "FollowUpRecommendation_appointmentId_idx" ON "FollowUpRecommendation"("appointmentId");

-- CreateIndex
CREATE INDEX "FollowUpRecommendation_status_reminderScheduledAt_idx" ON "FollowUpRecommendation"("status", "reminderScheduledAt");

-- CreateIndex
CREATE INDEX "FollowUpRecommendation_recommendedByUserId_idx" ON "FollowUpRecommendation"("recommendedByUserId");

-- CreateIndex
CREATE INDEX "NotificationLog_appointmentId_idx" ON "NotificationLog"("appointmentId");

-- CreateIndex
CREATE INDEX "NotificationLog_status_createdAt_idx" ON "NotificationLog"("status", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationLog_providerMessageId_idx" ON "NotificationLog"("providerMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "BookingDraft_bookingReference_key" ON "BookingDraft"("bookingReference");

-- CreateIndex
CREATE INDEX "BookingDraft_practiceLocationId_serviceDate_idx" ON "BookingDraft"("practiceLocationId", "serviceDate");

-- CreateIndex
CREATE INDEX "BookingDraft_mobileNumberHash_expiresAt_idx" ON "BookingDraft"("mobileNumberHash", "expiresAt");

-- CreateIndex
CREATE INDEX "BookingDraft_expiresAt_idx" ON "BookingDraft"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "QueueCounter_practiceLocationId_serviceDate_key" ON "QueueCounter"("practiceLocationId", "serviceDate");

-- CreateIndex
CREATE UNIQUE INDEX "QueueEvent_reversedEventId_key" ON "QueueEvent"("reversedEventId");

-- CreateIndex
CREATE INDEX "QueueEvent_practiceLocationId_serviceDate_createdAt_idx" ON "QueueEvent"("practiceLocationId", "serviceDate", "createdAt");

-- CreateIndex
CREATE INDEX "QueueEvent_primaryAppointmentId_createdAt_idx" ON "QueueEvent"("primaryAppointmentId", "createdAt");

-- CreateIndex
CREATE INDEX "QueueEvent_secondaryAppointmentId_idx" ON "QueueEvent"("secondaryAppointmentId");

-- CreateIndex
CREATE INDEX "QueueEvent_actorUserId_createdAt_idx" ON "QueueEvent"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "QueueEvent_type_createdAt_idx" ON "QueueEvent"("type", "createdAt");

-- CreateIndex
CREATE INDEX "QueueEvent_isUndoable_practiceLocationId_serviceDate_idx" ON "QueueEvent"("isUndoable", "practiceLocationId", "serviceDate");

-- CreateIndex
CREATE INDEX "BookingQuestion_practiceLocationId_isActive_displayOrder_idx" ON "BookingQuestion"("practiceLocationId", "isActive", "displayOrder");

-- CreateIndex
CREATE UNIQUE INDEX "BookingQuestion_practiceLocationId_displayOrder_key" ON "BookingQuestion"("practiceLocationId", "displayOrder");

-- CreateIndex
CREATE INDEX "BookingDraftAnswer_bookingQuestionId_idx" ON "BookingDraftAnswer"("bookingQuestionId");

-- CreateIndex
CREATE UNIQUE INDEX "BookingDraftAnswer_bookingDraftId_bookingQuestionId_key" ON "BookingDraftAnswer"("bookingDraftId", "bookingQuestionId");

-- CreateIndex
CREATE INDEX "AppointmentAnswer_bookingQuestionId_idx" ON "AppointmentAnswer"("bookingQuestionId");

-- CreateIndex
CREATE UNIQUE INDEX "AppointmentAnswer_appointmentId_bookingQuestionId_key" ON "AppointmentAnswer"("appointmentId", "bookingQuestionId");

-- AddForeignKey
ALTER TABLE "DoctorProfile" ADD CONSTRAINT "DoctorProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorAccountSettings" ADD CONSTRAINT "DoctorAccountSettings_doctorProfileId_fkey" FOREIGN KEY ("doctorProfileId") REFERENCES "DoctorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeLocation" ADD CONSTRAINT "PracticeLocation_doctorProfileId_fkey" FOREIGN KEY ("doctorProfileId") REFERENCES "DoctorProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeStaff" ADD CONSTRAINT "PracticeStaff_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeStaff" ADD CONSTRAINT "PracticeStaff_practiceLocationId_fkey" FOREIGN KEY ("practiceLocationId") REFERENCES "PracticeLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_practiceLocationId_fkey" FOREIGN KEY ("practiceLocationId") REFERENCES "PracticeLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OtpVerification" ADD CONSTRAINT "OtpVerification_bookingDraftId_fkey" FOREIGN KEY ("bookingDraftId") REFERENCES "BookingDraft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingAccessToken" ADD CONSTRAINT "BookingAccessToken_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactPreference" ADD CONSTRAINT "ContactPreference_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpRecommendation" ADD CONSTRAINT "FollowUpRecommendation_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpRecommendation" ADD CONSTRAINT "FollowUpRecommendation_recommendedByUserId_fkey" FOREIGN KEY ("recommendedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_followUpRecommendationId_fkey" FOREIGN KEY ("followUpRecommendationId") REFERENCES "FollowUpRecommendation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingDraft" ADD CONSTRAINT "BookingDraft_practiceLocationId_fkey" FOREIGN KEY ("practiceLocationId") REFERENCES "PracticeLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueCounter" ADD CONSTRAINT "QueueCounter_practiceLocationId_fkey" FOREIGN KEY ("practiceLocationId") REFERENCES "PracticeLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueEvent" ADD CONSTRAINT "QueueEvent_practiceLocationId_fkey" FOREIGN KEY ("practiceLocationId") REFERENCES "PracticeLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueEvent" ADD CONSTRAINT "QueueEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueEvent" ADD CONSTRAINT "QueueEvent_primaryAppointmentId_fkey" FOREIGN KEY ("primaryAppointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueEvent" ADD CONSTRAINT "QueueEvent_secondaryAppointmentId_fkey" FOREIGN KEY ("secondaryAppointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueEvent" ADD CONSTRAINT "QueueEvent_reversedEventId_fkey" FOREIGN KEY ("reversedEventId") REFERENCES "QueueEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingQuestion" ADD CONSTRAINT "BookingQuestion_practiceLocationId_fkey" FOREIGN KEY ("practiceLocationId") REFERENCES "PracticeLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingDraftAnswer" ADD CONSTRAINT "BookingDraftAnswer_bookingDraftId_fkey" FOREIGN KEY ("bookingDraftId") REFERENCES "BookingDraft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingDraftAnswer" ADD CONSTRAINT "BookingDraftAnswer_bookingQuestionId_fkey" FOREIGN KEY ("bookingQuestionId") REFERENCES "BookingQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentAnswer" ADD CONSTRAINT "AppointmentAnswer_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentAnswer" ADD CONSTRAINT "AppointmentAnswer_bookingQuestionId_fkey" FOREIGN KEY ("bookingQuestionId") REFERENCES "BookingQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
