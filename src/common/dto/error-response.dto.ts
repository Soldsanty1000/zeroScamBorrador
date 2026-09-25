import { ApiProperty } from '@nestjs/swagger';

// Forma del JSON que Nest regresa cuando se lanza una HttpException.
// Solo sirven para documentar las respuestas de error en Swagger.

export class ErrorResponseDto {
  @ApiProperty({ example: 404 })
  statusCode: number;

  @ApiProperty({ example: 'Contacto 3f2b9c1e-... no encontrado' })
  message: string;

  @ApiProperty({ example: 'Not Found' })
  error: string;
}

export class ValidationErrorResponseDto {
  @ApiProperty({ example: 400 })
  statusCode: number;

  @ApiProperty({
    type: [String],
    example: ['email must be an email', 'phone inválido'],
  })
  message: string[];

  @ApiProperty({ example: 'Bad Request' })
  error: string;
}
