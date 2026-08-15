import { IsUUID } from 'class-validator';

export class ActivatePracticeLocationDto {
  @IsUUID()
  practiceLocationId!: string;
}
