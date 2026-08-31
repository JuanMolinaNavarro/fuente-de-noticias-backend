import { IsDateString, IsOptional } from 'class-validator';

export class PublishDto {
  /** ISO 8601. Si es futuro, la nota queda SCHEDULED hasta esa hora. */
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;
}
