import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Contact } from '../entities/contact.entity';

export class ContactResponseDto {
  @ApiProperty({ example: '3f2b9c1e-8d4a-4e6f-9b7c-1a2d3e4f5a6b' })
  id: string;

  @ApiProperty({ example: 'Danna Azul' })
  name: string;

  @ApiProperty({ example: 'dana@example.com' })
  email: string;

  @ApiProperty({ example: '811-123-4567' })
  phone: string;

  @ApiPropertyOptional({ example: 'compañera de clase' })
  notes?: string;

  @ApiPropertyOptional({
    example: '/uploads/ana.png',
    description: 'Ruta de la foto, relativa al servidor; no viene si no tiene',
  })
  photoUrl?: string;

  @ApiProperty({
    format: 'date-time',
    description: 'ISO 8601',
    example: '2026-09-10T18:30:00.000Z',
  })
  createdAt: string;

  static fromEntity(contact: Contact): ContactResponseDto {
    const dto = new ContactResponseDto();
    dto.id = contact.id!;
    dto.name = contact.name!;
    dto.email = contact.email!;
    dto.phone = contact.phone!;
    dto.notes = contact.notes;
    dto.photoUrl = contact.photo ? '/uploads/' + contact.photo : undefined;
    dto.createdAt = contact.createdAt!.toISOString();
    return dto;
  }
}
