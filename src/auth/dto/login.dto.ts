import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Matches, MaxLength } from 'class-validator';
import { EMAIL_MESSAGE, EMAIL_PATTERN } from '../../common/validation';

export class LoginDto {
  @ApiProperty({ type: String, example: 'dana@example.com' })
  @IsEmail()
  @MaxLength(150)
  @Matches(EMAIL_PATTERN, { message: EMAIL_MESSAGE })
  email: string | undefined;

  @ApiProperty({ type: String, example: 'password123!' })
  @IsString()
  @MaxLength(256)
  password: string | undefined;
}
