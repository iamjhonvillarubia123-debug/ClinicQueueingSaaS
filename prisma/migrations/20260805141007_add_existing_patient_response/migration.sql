/*
  Warnings:

  - Added the required column `existingPatientResponse` to the `BookingDraft` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ExistingPatientResponse" AS ENUM ('YES', 'NO', 'UNSURE');

-- AlterTable
ALTER TABLE "BookingDraft" ADD COLUMN     "existingPatientResponse" "ExistingPatientResponse" NOT NULL;
