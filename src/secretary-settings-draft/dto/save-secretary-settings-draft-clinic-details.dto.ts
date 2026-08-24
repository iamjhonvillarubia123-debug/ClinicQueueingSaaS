import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class SaveSecretarySettingsDraftClinicDetailsDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  addressLine1!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  addressLine2?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  cityMunicipality!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  province!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  contactNumber!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2)
  countryCode!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  timeZone!: string;
}
