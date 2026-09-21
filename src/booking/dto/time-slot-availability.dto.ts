import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class TimeSlotMemberServicesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  selectedServiceIds!: string[];
}
export class TimeSlotAvailabilityDto {
  @IsDateString({ strict: true })
  serviceDate!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => TimeSlotMemberServicesDto)
  members!: TimeSlotMemberServicesDto[];
}
