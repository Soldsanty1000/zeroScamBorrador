import { ApiProperty } from '@nestjs/swagger';
import { IsUrl, MaxLength } from 'class-validator';

export class AnalyzeUrlDto {
  @ApiProperty({
    description:
      'URL completa a analizar (hasta 2048 caracteres); debe empezar con ' +
      'http:// o https://. Solo se usan el esquema, el host, el puerto y la ' +
      'ruta: la cadena de consulta (`?...`), el fragmento (`#...`) y el ' +
      '`usuario:clave@` se descartan y no se guardan ni se mandan a ' +
      'servicios externos',
    example: 'https://banco-seguro-mx.com/login',
    maxLength: 2048,
  })
  // 2048 es el tamaño de `SitioWeb_URL.url_texto`.
  @MaxLength(2048)
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true },
    { message: 'url debe ser una URL http o https válida' },
  )
  url: string;
}
