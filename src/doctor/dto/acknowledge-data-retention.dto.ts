import { Equals, IsBoolean } from 'class-validator';

export class AcknowledgeDataRetentionDto {
  @IsBoolean()
  @Equals(true)
  acknowledged!: boolean;
}
