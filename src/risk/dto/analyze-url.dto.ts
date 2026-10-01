import { ApiProperty } from '@nestjs/swagger';
import { IsUrl, MaxLength } from 'class-validator';

export class AnalyzeUrlDto {
  @ApiProperty({
    description: 'URL completa a analizar; debe empezar con http:// o https://',
    example: 'https://banco-seguro-mx.com/login',
  })
  // 2048 es el tamaño de `SitioWeb_URL.url_texto`.
  @MaxLength(2048)
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true },
    { message: 'url debe ser una URL http o https válida' },
  )
  url: string;
}
