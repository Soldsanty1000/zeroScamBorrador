import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ROLES } from '../common/constants';
import { MAX_IMAGE_BYTES } from '../common/files';
import { AccountService } from './account.service';
import {
  AccountResponseDto,
  DeleteAccountDto,
  RegisterAccountDto,
  UpdateAccountDto,
  UpdatePreferencesDto,
} from './dto/account.dto';

const FILE_BODY = {
  schema: {
    type: 'object',
    properties: { file: { type: 'string', format: 'binary' } },
    required: ['file'],
  },
};

@ApiTags('account')
@Controller('account')
export class AccountController {
  constructor(private readonly service: AccountService) {}

  @Post('register')
  @ApiOperation({
    summary: 'Registrar una cuenta desde la app',
    description:
      'Igual que `POST /auth/register`, más el `alias` (nombre público, ' +
      'único) y la versión del aviso de privacidad aceptada.',
  })
  @ApiCreatedResponse({ type: AccountResponseDto })
  register(@Body() dto: RegisterAccountDto): Promise<AccountResponseDto> {
    return this.service.register(dto);
  }

  @Get()
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mi cuenta: perfil, preferencias y consentimiento' })
  @ApiOkResponse({ type: AccountResponseDto })
  me(@CurrentUser() user: JwtPayload): Promise<AccountResponseDto> {
    return this.service.me(user.sub);
  }

  @Patch()
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Editar mi perfil',
    description: 'Cambiar el email pide `currentPassword`.',
  })
  @ApiOkResponse({ type: AccountResponseDto })
  update(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateAccountDto,
  ): Promise<AccountResponseDto> {
    return this.service.update(user.sub, dto);
  }

  @Patch('preferences')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Guardar mis preferencias',
    description: 'Apagar `twoStep` pide `password`.',
  })
  @ApiOkResponse({ type: AccountResponseDto })
  updatePreferences(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdatePreferencesDto,
  ): Promise<AccountResponseDto> {
    return this.service.updatePreferences(user.sub, dto);
  }

  @Post('avatar')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
    }),
  )
  @ApiOperation({ summary: 'Subir mi avatar (JPEG, máx. 5 MB)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody(FILE_BODY)
  @ApiOkResponse({ type: AccountResponseDto })
  setAvatar(
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<AccountResponseDto> {
    if (!file) throw new BadRequestException('Falta el campo file');
    return this.service.setAvatar(user.sub, file.buffer);
  }

  @Delete('avatar')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Quitar mi avatar' })
  @ApiOkResponse({ type: AccountResponseDto })
  removeAvatar(@CurrentUser() user: JwtPayload): Promise<AccountResponseDto> {
    return this.service.removeAvatar(user.sub);
  }

  @Get('avatar/:id')
  @Header('X-Content-Type-Options', 'nosniff')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Bajar el avatar de una cuenta',
    description:
      'El propio, el de cualquiera si moderas, o el de quien tiene perfil ' +
      'público. 404 en cualquier otro caso.',
  })
  async avatar(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<StreamableFile> {
    const content = await this.service.avatar(user.sub, id);
    if (!content) throw new NotFoundException('Avatar no encontrado');
    return new StreamableFile(content, {
      type: 'image/jpeg',
      disposition: 'attachment; filename="avatar-' + id + '.jpg"',
    });
  }

  @Delete()
  @HttpCode(204)
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Eliminar mi cuenta',
    description:
      'Pide el password. Los reportes ya validados quedan anónimos y sin ' +
      'evidencia; todo lo demás se borra.',
  })
  @ApiNoContentResponse({ description: 'Cuenta eliminada, sin cuerpo' })
  remove(
    @CurrentUser() user: JwtPayload,
    @Body() dto: DeleteAccountDto,
  ): Promise<void> {
    return this.service.remove(user.sub, dto.password!);
  }

  @Get('users')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN, ROLES.OWNER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Todas las cuentas con su perfil de la app' })
  @ApiOkResponse({ type: AccountResponseDto, isArray: true })
  list(@CurrentUser() user: JwtPayload): Promise<AccountResponseDto[]> {
    return this.service.list(user.sub);
  }

  @Get('analytics')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(ROLES.OWNER)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Contadores anónimos de uso',
    description: 'Un total por evento, sin ids de usuario. Solo Owner.',
  })
  analytics(@CurrentUser() user: JwtPayload): Promise<Record<string, number>> {
    return this.service.analyticsTotals(user.sub);
  }
}
