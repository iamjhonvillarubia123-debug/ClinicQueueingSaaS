import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class ActivatePracticeLocationDto {
  @IsUUID()
  practiceLocationId!: string;

  @IsString()
  @IsNotEmpty()
  currentPassword!: string;
}
