import { ArrayMaxSize, ArrayUnique, IsArray, IsUUID } from 'class-validator';
export class ReorderDoctorQuestionsDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  templateIds!: string[];
}
