import { IsDateString, IsUUID } from 'class-validator';

export class UndoQueueDto {
  @IsUUID()
  practiceLocationId!: string;

  @IsDateString()
  serviceDate!: string;
}
