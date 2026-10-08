import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  ErrorResponseDto,
  ValidationErrorResponseDto,
} from '../common/dto/error-response.dto';
import { ROLES } from '../common/constants';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserFiltersDto } from './dto/user-filters.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { UsersService } from './users.service';

const ID_PARAM = { name: 'id', description: 'id_usuario', example: '1' };

@ApiTags('users')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Falta el token, o es inválido o expiró',
  type: ErrorResponseDto,
})
@Controller('users')
@UseGuards(AuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly service: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Mi perfil', description: 'Cualquier rol.' })
  @ApiOkResponse({ type: UserResponseDto })
  me(@CurrentUser() user: JwtPayload): Promise<UserResponseDto> {
    return this.service.findOne(user.sub);
  }

  // Va antes de `@Patch(':id')`: si no, Nest tomaría "me" como un id.
  @Patch('me')
  @ApiOperation({
    summary: 'Editar mi perfil',
    description:
      'Cualquier rol. Cambia `name`, `lastName` o `country` de la cuenta ' +
      'del token; solo se modifican los campos que vengan. El rol y el ' +
      'estado de la cuenta no se cambian aquí.',
  })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiBadRequestResponse({
    description: 'Body inválido',
    type: ValidationErrorResponseDto,
  })
  updateMe(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateProfileDto,
  ): Promise<UserResponseDto> {
    return this.service.updateMe(user.sub, dto);
  }

  @Get()
  @Roles(ROLES.ADMIN, ROLES.OWNER)
  @ApiOperation({ summary: 'Listar cuentas (RF03). Administrador u Owner' })
  @ApiOkResponse({ type: UserResponseDto, isArray: true })
  @ApiForbiddenResponse({
    description: 'Rol sin acceso',
    type: ErrorResponseDto,
  })
  findAll(@Query() filters: UserFiltersDto): Promise<UserResponseDto[]> {
    return this.service.findAll(filters);
  }

  @Get(':id')
  @Roles(ROLES.ADMIN, ROLES.OWNER)
  @ApiOperation({ summary: 'Ver una cuenta. Administrador u Owner' })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: UserResponseDto })
  @ApiForbiddenResponse({
    description: 'Rol sin acceso',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Usuario no encontrado',
    type: ErrorResponseDto,
  })
  findOne(@Param('id') id: string): Promise<UserResponseDto> {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @Roles(ROLES.ADMIN, ROLES.OWNER)
  @ApiOperation({
    summary: 'Editar o desactivar una cuenta (RF03)',
    description:
      'Administrador u Owner. `accountStatus: SUSPENDIDO` desactiva la ' +
      'cuenta. Solo el Owner puede cambiar `role` o editar a otro Owner.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: UserResponseDto })
  @ApiBadRequestResponse({
    description: 'Body inválido',
    type: ValidationErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'Rol sin acceso o cambio reservado al Owner',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Usuario no encontrado',
    type: ErrorResponseDto,
  })
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ): Promise<UserResponseDto> {
    return this.service.update(user, id, dto);
  }
}
