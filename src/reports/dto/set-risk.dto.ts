import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { RISK_LEVELS } from '../../common/constants';

export class SetRiskDto {
  @ApiProperty({ enum: RISK_LEVELS, example: 'ALTO' })
  @IsIn(RISK_LEVELS)
  riskLevel: string;
}
