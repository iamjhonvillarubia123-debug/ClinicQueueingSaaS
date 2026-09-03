import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsUUID,
  ValidateIf,
} from 'class-validator';

export class ApplyDoctorDefaultsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  practiceLocationIds!: string[];

  // Omitted means all templates of this kind; [] explicitly selects none.
  @ValidateIf((_object, value) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  serviceTemplateIds?: string[];

  @ValidateIf((_object, value) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  bookingQuestionTemplateIds?: string[];
}
