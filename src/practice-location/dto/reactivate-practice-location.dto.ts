import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class ReactivatePracticeLocationDto {
  @IsUUID()
  practiceLocationId!: string;

  @IsString()
  @IsNotEmpty()
  currentPassword!: string;
}
