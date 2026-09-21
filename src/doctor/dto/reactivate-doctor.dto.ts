import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class ReactivateDoctorDto {
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  identifier!: string;

  @IsString()
  password!: string;

  get email(): string {
    return this.identifier;
  }
}
