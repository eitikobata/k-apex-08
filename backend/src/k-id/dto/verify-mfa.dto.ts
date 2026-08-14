import { IsString, Length } from 'class-validator';

export class VerifyMfaDto {
  @IsString()
  mfaPendingToken: string;

  @IsString()
  @Length(6, 6)
  totpCode: string;
}
