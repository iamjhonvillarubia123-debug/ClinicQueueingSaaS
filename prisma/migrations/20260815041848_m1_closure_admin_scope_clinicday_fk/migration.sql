-- AddForeignKey
ALTER TABLE "AdministrativeAccountActionScope" ADD CONSTRAINT "AdministrativeAccountActionScope_clinicDayId_fkey" FOREIGN KEY ("clinicDayId") REFERENCES "ClinicDay"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
