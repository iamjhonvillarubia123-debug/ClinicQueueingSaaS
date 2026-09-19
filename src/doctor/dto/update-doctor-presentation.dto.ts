import {
  IsBoolean,
  IsNumber,
  Min,
  Max,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
export class UpdateDoctorPresentationDto {
  @IsOptional() @IsNumber() @Min(1) @Max(3) profilePhotoZoom?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) profilePhotoX?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) profilePhotoY?: number;
  @IsOptional()
  @IsString()
  @MaxLength(400000)
  @Matches(/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/)
  profilePhotoUrl?: string;
  @IsOptional() @IsBoolean() isProfilePublic?: boolean;
}
