import { ApiProperty } from '@nestjs/swagger';

// Solo documentan en Swagger lo que regresa AuthService.

export class RegisterResponseDto {
  @ApiProperty({ example: '3f2b9c1e-8d4a-4e6f-9b7c-1a2d3e4f5a6b' })
  id: string;

  @ApiProperty({ example: 'dana@example.com' })
  email: string;
}

export class LoginResponseDto {
  @ApiProperty({ description: 'Dura 15 minutos' })
  accessToken: string;

  @ApiProperty({ description: 'Dura 7 días' })
  refreshToken: string;
}

export class RefreshResponseDto {
  @ApiProperty({ description: 'Access token nuevo, dura 15 minutos' })
  accessToken: string;
}
