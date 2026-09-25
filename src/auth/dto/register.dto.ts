import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ type: String, example: 'dana@example.com' })
  @IsEmail()
  email: string | undefined;

  @ApiProperty({ type: String, minLength: 8, example: 'password123' })
  @IsString()
  @MinLength(8)
  password: string | undefined;
}
