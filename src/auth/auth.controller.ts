import {
  Body,
  Controller,
  HttpCode,
  Ip,
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
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
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
import { VerifyCodeDto } from './dto/verify-code.dto';
import type { JwtPayload } from './jwt';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly service: AuthService) {}

  @Post('register')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
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
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @ApiOperation({
    summary: 'Iniciar sesión',
    description:
      'Regresa un `accessToken` (15 min) para mandar como Bearer y un ' +
      '`refreshToken` (7 días) para `POST /auth/refresh`. Si la cuenta tiene ' +
      'verificación en dos pasos regresa `twoFactorRequired: true` con un ' +
      '`challengeId`, sin tokens: se canjea en `POST /auth/two-factor/verify`.',
  })
  @ApiOkResponse({ type: LoginResponseDto })
  @ApiBadRequestResponse({
    description: 'Body inválido',
    type: ValidationErrorResponseDto,
  })
  @ApiUnauthorizedResponse({
    description:
      'Correo o contraseña incorrectos (mismo mensaje en ambos casos)',
    type: ErrorResponseDto,
  })
  @ApiTooManyRequestsResponse({
    description: 'Demasiados intentos fallidos: espera antes de reintentar',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'La cuenta está suspendida',
    type: ErrorResponseDto,
  })
  login(@Body() dto: LoginDto, @Ip() ip: string) {
    return this.service.login(dto, ip);
  }

  @Post('two-factor/verify')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @ApiOperation({
    summary: 'Segundo paso del login',
    description:
      'Canjea el `challengeId` del login y el código de 6 dígitos por los ' +
      'tokens. El código dura 5 minutos y admite 3 intentos.',
  })
  @ApiOkResponse({ type: LoginResponseDto })
  @ApiBadRequestResponse({
    description: 'Body inválido',
    type: ValidationErrorResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Código incorrecto, expirado o sin intentos',
    type: ErrorResponseDto,
  })
  verifyCode(@Body() dto: VerifyCodeDto, @Ip() ip: string) {
    return this.service.verifyCode(dto, ip);
  }

  @Post('refresh')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
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
      'Revoca la sesión del token en el servidor: su accessToken y su ' +
      'refreshToken dejan de valer de inmediato. La app además borra los ' +
      'tokens que tenga guardados.',
  })
  @ApiNoContentResponse({ description: 'Sesión cerrada, sin cuerpo' })
  @ApiUnauthorizedResponse({
    description: 'Falta el token, o es inválido o expiró',
    type: ErrorResponseDto,
  })
  logout(@CurrentUser() user: JwtPayload, @Ip() ip: string): Promise<void> {
    return this.service.logout(user, ip);
  }

  @Patch('password')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(204)
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Cambiar mi password',
    description:
      'Cualquier rol. Pide el password actual y el nuevo, que debe cumplir ' +
      'las reglas del registro. Cierra todas las demás sesiones de la ' +
      'cuenta; la sesión que hace el cambio sigue abierta.',
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
    @Ip() ip: string,
  ): Promise<void> {
    return this.service.changePassword(user, dto, ip);
  }
}
