import { IsNotEmpty, IsString } from 'class-validator';

export class RemovePracticeStaffRelationshipDto {
  @IsString()
  @IsNotEmpty()
  password!: string;
}
