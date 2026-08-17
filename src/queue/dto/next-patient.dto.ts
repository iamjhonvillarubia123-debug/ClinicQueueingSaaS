import { IsDateString, IsEnum, IsUUID } from 'class-validator';

export enum NextPatientOutcome {
  NOW_SERVING = 'NOW_SERVING',
  COMPLETED = 'COMPLETED',
  OUT_FOR_PROCEDURE = 'OUT_FOR_PROCEDURE',
}

export class NextPatientDto {
  @IsUUID()
  practiceLocationId!: string;

  @IsDateString({ strict: true })
  serviceDate!: string;

  @IsEnum(NextPatientOutcome)
  patientOutcome!: NextPatientOutcome;
}
