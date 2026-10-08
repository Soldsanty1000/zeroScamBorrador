import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches } from 'class-validator';

export class VerifyCodeDto {
  @ApiProperty({
    type: String,
    description: '`challengeId` que regresó `POST /auth/login`',
  })
  @IsString()
  @Length(64, 64)
  challengeId: string | undefined;

  @ApiProperty({ type: String, example: '042817', description: '6 dígitos' })
  @IsString()
  @Matches(/^[0-9]{6}$/, { message: 'code debe tener 6 dígitos' })
  code: string | undefined;
}
