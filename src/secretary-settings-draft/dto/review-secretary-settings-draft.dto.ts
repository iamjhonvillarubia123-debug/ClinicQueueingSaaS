import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewSecretarySettingsDraftDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reviewComment?: string;
}
