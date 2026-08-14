import { IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  callsign: string;

  @IsString()
  @MinLength(8)
  password: string;
}
