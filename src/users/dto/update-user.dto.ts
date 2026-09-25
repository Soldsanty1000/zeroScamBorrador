import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ACCOUNT_STATUSES, ROLES } from '../../common/constants';

export class UpdateUserDto {
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

  @ApiPropertyOptional({
    enum: ACCOUNT_STATUSES,
    description: 'SUSPENDIDO desactiva la cuenta: ya no puede hacer login',
  })
  @IsOptional()
  @IsIn(ACCOUNT_STATUSES)
  accountStatus?: string;

  @ApiPropertyOptional({
    enum: Object.values(ROLES),
    description: 'Solo el Owner puede cambiar roles',
  })
  @IsOptional()
  @IsIn(Object.values(ROLES))
  role?: string;
}
