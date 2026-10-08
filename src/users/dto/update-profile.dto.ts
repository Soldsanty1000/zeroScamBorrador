import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

// Lo que un usuario puede cambiar de su propia cuenta. `role` y
// `accountStatus` no están: esos los cambia la administración en
// `PATCH /users/:id` (UpdateUserDto).
export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Danna' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name?: string;

  @ApiPropertyOptional({ example: 'Azul' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  lastName?: string;

  @ApiPropertyOptional({ example: 'México' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  country?: string;
}
