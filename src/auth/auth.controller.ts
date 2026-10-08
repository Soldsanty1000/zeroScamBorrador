import {
  Body,
  Controller,
  HttpCode,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  ErrorResponseDto,
  ValidationErrorResponseDto,
} from '../common/dto/error-response.dto';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import {
  LoginResponseDto,
  RefreshResponseDto,
  RegisterResponseDto,
} from './dto/auth-response.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';
import type { JwtPayload } from './jwt';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly service: AuthService) {}

  @Post('register')
  @ApiOperation({
    summary: 'Registrar un usuario',
    description:
      'El password se guarda hasheado; nunca se regresa. Exige ' +
      '`acceptsPrivacy: true` y guarda la fecha del consentimiento (RNF07).',
  })
  @ApiCreatedResponse({ type: RegisterResponseDto })
  @ApiBadRequestResponse({
    description: 'Body inválido o sin aceptar el aviso de privacidad',
    type: ValidationErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'El email ya está registrado',
    type: ErrorResponseDto,
  })
  register(@Body() dto: RegisterDto) {
    return this.service.register(dto);
  }

  @Post('login')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Iniciar sesión',
    description:
      'Regresa un `accessToken` (15 min) para mandar como Bearer y un ' +
      '`refreshToken` (7 días) para `POST /auth/refresh`.',
  })
  @ApiOkResponse({ type: LoginResponseDto })
  @ApiBadRequestResponse({
    description: 'Body inválido',
    type: ValidationErrorResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'El usuario no existe o el password es incorrecto',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'La cuenta está suspendida',
    type: ErrorResponseDto,
  })
  login(@Body() dto: LoginDto) {
    return this.service.login(dto);
  }

  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Renovar el access token',
    description:
      'Recibe el `refreshToken` y regresa un `accessToken` nuevo sin pedir ' +
      'password. Un access token aquí es rechazado.',
  })
  @ApiOkResponse({ type: RefreshResponseDto })
  @ApiBadRequestResponse({
    description: 'Body inválido',
    type: ValidationErrorResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Refresh token inválido, expirado o de tipo access',
    type: ErrorResponseDto,
  })
  refresh(@Body() dto: RefreshDto) {
    return this.service.refresh(dto);
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Cerrar sesión (CU03, CU10, CU15)',
    description:
      'Los tokens no se guardan en el servidor, así que cerrar sesión es ' +
      'responsabilidad de la app: al recibir 204 borra el accessToken y el ' +
      'refreshToken que tenga guardados.',
  })
  @ApiNoContentResponse({ description: 'Sesión cerrada, sin cuerpo' })
  @ApiUnauthorizedResponse({
    description: 'Falta el token, o es inválido o expiró',
    type: ErrorResponseDto,
  })
  logout(): void {}

  @Patch('password')
  @HttpCode(204)
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Cambiar mi password',
    description:
      'Cualquier rol. Pide el password actual y el nuevo, que debe cumplir ' +
      'las reglas del registro. Los tokens ya emitidos siguen sirviendo ' +
      'hasta que expiran.',
  })
  @ApiNoContentResponse({ description: 'Password cambiado, sin cuerpo' })
  @ApiBadRequestResponse({
    description:
      'Body inválido, password actual incorrecto o nuevo igual al actual',
    type: ValidationErrorResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Falta el token, o es inválido o expiró',
    type: ErrorResponseDto,
  })
  changePassword(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    return this.service.changePassword(user.sub, dto);
  }
}
