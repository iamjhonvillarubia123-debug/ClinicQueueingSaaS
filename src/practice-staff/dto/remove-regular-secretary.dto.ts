import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class RemoveRegularSecretaryDto {
  @IsUUID()
  @IsNotEmpty()
  practiceLocationId!: string;

  // Retained for compatibility with the legacy service boundary. The
  // authoritative controller path no longer requires it for reversible disablement.
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  password?: string;
}
