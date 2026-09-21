import { IsObject } from 'class-validator';

export class SaveAppointmentModeProposalDto {
  @IsObject()
  proposal!: Record<string, unknown>;
}
