import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
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
import {
  ErrorResponseDto,
  ValidationErrorResponseDto,
} from '../common/dto/error-response.dto';
import { ContactsService } from './contacts.service';
import { ContactResponseDto } from './dto/contact-response.dto';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';

const ID_PARAM = {
  name: 'id',
  description: 'UUID del contacto',
  example: '3f2b9c1e-8d4a-4e6f-9b7c-1a2d3e4f5a6b',
};

@ApiTags('contacts')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Falta el token, o es inválido o expiró',
  type: ErrorResponseDto,
})
@Controller('contacts')
@UseGuards(AuthGuard)
export class ContactsController {
  constructor(private readonly service: ContactsService) {}

  @Post()
  @ApiOperation({
    summary: 'Crear un contacto',
    description:
      'Crea el contacto con el usuario del token como dueño. ' +
      'El servidor genera `id` y `createdAt`.',
  })
  @ApiCreatedResponse({ type: ContactResponseDto })
  @ApiBadRequestResponse({
    description: 'Body inválido',
    type: ValidationErrorResponseDto,
  })
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateContactDto,
  ): Promise<ContactResponseDto> {
    return this.service.create(user.sub, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Listar mis contactos',
    description:
      'Regresa solo los contactos cuyo dueño es el usuario del token, ' +
      'ordenados por fecha de creación.',
  })
  @ApiOkResponse({ type: ContactResponseDto, isArray: true })
  findAll(@CurrentUser() user: JwtPayload): Promise<ContactResponseDto[]> {
    return this.service.findAll(user.sub);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Ver un contacto por id' })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: ContactResponseDto })
  @ApiNotFoundResponse({
    description: 'Contacto no encontrado',
    type: ErrorResponseDto,
  })
  findOne(@Param('id') id: string): Promise<ContactResponseDto> {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Actualizar un contacto',
    description: 'Solo se modifican los campos que vengan en el body.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: ContactResponseDto })
  @ApiBadRequestResponse({
    description: 'Body inválido',
    type: ValidationErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Contacto no encontrado',
    type: ErrorResponseDto,
  })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateContactDto,
  ): Promise<ContactResponseDto> {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Borrar un contacto' })
  @ApiParam(ID_PARAM)
  @ApiNoContentResponse({ description: 'Contacto borrado, sin cuerpo' })
  @ApiNotFoundResponse({
    description: 'Contacto no encontrado',
    type: ErrorResponseDto,
  })
  remove(@Param('id') id: string): Promise<void> {
    return this.service.remove(id);
  }
}
