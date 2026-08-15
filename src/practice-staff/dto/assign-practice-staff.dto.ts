import { IsNotEmpty, IsUUID } from 'class-validator';

export class AssignPracticeStaffDto {
  @IsUUID()
  @IsNotEmpty()
  practiceLocationId!: string;

  @IsUUID()
  @IsNotEmpty()
  userId!: string;
}
