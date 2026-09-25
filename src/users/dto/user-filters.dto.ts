import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { ACCOUNT_STATUSES, ROLES } from '../../common/constants';

export class UserFiltersDto {
  @ApiPropertyOptional({ enum: Object.values(ROLES) })
  @IsOptional()
  @IsIn(Object.values(ROLES))
  role?: string;

  @ApiPropertyOptional({ enum: ACCOUNT_STATUSES })
  @IsOptional()
  @IsIn(ACCOUNT_STATUSES)
  accountStatus?: string;

  @ApiPropertyOptional({
    description: 'Texto a buscar en nombre, apellido o email',
    example: 'danna',
  })
  @IsOptional()
  @IsString()
  q?: string;
}
