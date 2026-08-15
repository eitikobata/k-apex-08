import { IsString, Length } from 'class-validator';

export class VerifyTotpSetupDto {
  @IsString()
  totpSetupToken: string;

  @IsString()
  @Length(6, 6)
  totpCode: string;
}
