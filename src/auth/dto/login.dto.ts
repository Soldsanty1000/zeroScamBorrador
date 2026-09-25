import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString } from 'class-validator';

export class LoginDto {
  @ApiProperty({ type: String, example: 'dana@example.com' })
  @IsEmail()
  email: string | undefined;

  @ApiProperty({ type: String, example: 'password123' })
  @IsString()
  password: string | undefined;
}
