import { IsUUID } from 'class-validator';

export class ReactivatePracticeLocationDto {
  @IsUUID()
  practiceLocationId!: string;
}
