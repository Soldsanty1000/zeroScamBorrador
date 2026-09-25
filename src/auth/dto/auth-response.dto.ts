import { ApiProperty } from '@nestjs/swagger';

// Solo documentan en Swagger lo que regresa AuthService.

export class RegisterResponseDto {
  @ApiProperty({ example: '1', description: 'id_usuario' })
  id: string;

  @ApiProperty({ example: 'dana@example.com' })
  email: string;

  @ApiProperty({ example: 'Usuario creado con éxito' })
  message: string;
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
