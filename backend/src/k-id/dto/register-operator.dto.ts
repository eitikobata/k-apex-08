import { IsEmail, IsEnum, IsString, MinLength } from 'class-validator';
import { OperatorRole } from '@prisma/client';

export class RegisterOperatorDto {
  @IsString()
  @MinLength(3)
  callsign: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(12)
  password: string;

  @IsEnum(OperatorRole)
  role: OperatorRole;
}
