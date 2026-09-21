import { Matches } from 'class-validator';
export class InvitationCoverageRangeDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  fromServiceDate!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  toServiceDate!: string;
}
