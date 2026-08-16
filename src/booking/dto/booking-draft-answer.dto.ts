import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class BookingDraftAnswerDto {
  @IsString()
  @MaxLength(100)
  bookingQuestionId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  answerText?: string;

  @IsOptional()
  @IsNumber({ allowInfinity: false, allowNaN: false })
  answerNumber?: number;

  @IsOptional()
  @IsBoolean()
  answerBoolean?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  selectedOptionValue?: string;
}
