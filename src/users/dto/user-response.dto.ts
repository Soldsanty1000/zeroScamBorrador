import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { User } from '../../auth/entities/user.entity';

export class UserResponseDto {
  @ApiProperty({ example: '1', description: 'id_usuario' })
  id: string;

  @ApiProperty({ example: 'Danna' })
  name: string;

  @ApiProperty({ example: 'Azul' })
  lastName: string;

  @ApiProperty({ example: 'México' })
  country: string;

  @ApiProperty({ example: 'dana@example.com' })
  email: string;

  @ApiProperty({
    example: 'Usuario',
    description: 'Usuario, Administrador, Policia u Owner',
  })
  role: string;

  @ApiProperty({ example: 'ACTIVO', description: 'ACTIVO o SUSPENDIDO' })
  accountStatus: string;

  @ApiProperty({
    format: 'date-time',
    description: 'ISO 8601',
    example: '2026-09-10T18:30:00.000Z',
  })
  createdAt: string;

  @ApiPropertyOptional({
    format: 'date-time',
    description:
      'Cuándo aceptó el aviso de privacidad (RNF07); no viene en las ' +
      'cuentas que no se crearon con el registro',
    example: '2026-09-10T18:30:00.000Z',
  })
  privacyAcceptedAt?: string;

  static fromEntity(user: User): UserResponseDto {
    const dto = new UserResponseDto();
    dto.id = user.id!;
    dto.name = user.name!;
    dto.lastName = user.lastName!;
    dto.country = user.country!;
    dto.email = user.email!;
    dto.role = user.role!;
    dto.accountStatus = user.accountStatus!;
    dto.createdAt = user.createdAt!.toISOString();
    dto.privacyAcceptedAt = user.privacyAcceptedAt?.toISOString();
    return dto;
  }
}
