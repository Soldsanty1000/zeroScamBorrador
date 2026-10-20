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
  ApiTooManyRequestsResponse,
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
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  ResetPasswordDto,
} from './dto/change-password.dto';
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

  @Post('two-factor/verify')
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
  verifyCode(@Body() dto: VerifyCodeDto) {
    return this.service.verifyCode(dto);
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

  @Post('password/code')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Pedir el código para cambiar mi password',
    description:
      'Manda al correo de la cuenta un código de 6 dígitos (10 minutos, 3 ' +
      'intentos) que pide `PATCH /auth/password`.',
  })
  @ApiOkResponse({ description: '`challengeId`, `destination` y `expiresAt`' })
  @ApiTooManyRequestsResponse({
    description: 'Más de 3 códigos en 15 minutos',
    type: ErrorResponseDto,
  })
  requestChangeCode(@CurrentUser() user: JwtPayload) {
    return this.service.requestChangeCode(user.sub);
  }

  @Patch('password')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Cambiar mi password',
    description:
      'Cualquier rol. Pide el password actual, el nuevo (reglas del ' +
      'registro) y el código de `POST /auth/password/code`. Avisa por ' +
      'correo y regresa tokens nuevos: los refresh tokens emitidos antes ya ' +
      'no se renuevan (las demás sesiones se cierran al vencer su access ' +
      'token).',
  })
  @ApiOkResponse({ type: LoginResponseDto })
  @ApiBadRequestResponse({
    description:
      'Body inválido, password actual incorrecto, nuevo igual al actual o ' +
      'código inválido',
    type: ValidationErrorResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Falta el token, o es inválido o expiró',
    type: ErrorResponseDto,
  })
  changePassword(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.service.changePassword(user.sub, dto);
  }

  @Post('password/forgot')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Olvidé mi password',
    description:
      'Si el correo tiene una cuenta activa, le manda un código de 6 dígitos ' +
      '(10 minutos, 3 intentos). La respuesta es la misma exista o no la ' +
      'cuenta, para no revelar qué correos están registrados.',
  })
  @ApiOkResponse({ description: '`challengeId`, `expiresAt` y `message`' })
  @ApiBadRequestResponse({
    description: 'Correo inválido',
    type: ValidationErrorResponseDto,
  })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.service.forgotPassword(dto);
  }

  @Post('password/reset')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Poner un password nuevo con el código del correo',
    description:
      'Cambia el password, avisa por correo y cierra las demás sesiones ' +
      '(sus refresh tokens dejan de servir).',
  })
  @ApiNoContentResponse({ description: 'Password cambiado, sin cuerpo' })
  @ApiBadRequestResponse({
    description: 'Body inválido, o código inválido, vencido o sin intentos',
    type: ValidationErrorResponseDto,
  })
  resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    return this.service.resetPassword(dto);
  }
}
