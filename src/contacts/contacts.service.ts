import { Injectable, NotFoundException } from '@nestjs/common';
import { removeStored, storeUpload, UPLOADS_DIR } from '../common/files';
import { Contact } from './entities/contact.entity';
import { ContactsRepository } from './contacts.repository';
import { ContactResponseDto } from './dto/contact-response.dto';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';

/**
 * Reglas de negocio de la agenda.
 *
 * No sabe de HTTP ni de SQL: recibe DTOs ya validados, habla con el
 * repository y regresa `ContactResponseDto`. Los errores de negocio se
 * expresan como excepciones de Nest para que el controller no tenga que
 * traducirlas.
 */
@Injectable()
export class ContactsService {
  constructor(private readonly repository: ContactsRepository) {}

  /**
   * Crea un contacto para un usuario.
   *
   * @param userId - Id del usuario dueño, tomado del `sub` del access token.
   * @param data - Body ya validado (`CreateContactDto`).
   * @returns El contacto creado, con el `id` y `createdAt` que quedaron en la
   * base.
   * @throws {@link ConflictException} `Agenda llena` si el usuario ya tiene
   * 100 contactos.
   */
  async create(
    userId: string,
    data: CreateContactDto,
  ): Promise<ContactResponseDto> {
    const contact = await this.repository.save(userId, {
      name: data.name,
      email: data.email,
      phone: data.phone,
      notes: data.notes,
    });
    return ContactResponseDto.fromEntity(contact);
  }

  /**
   * Lista los contactos de un usuario.
   *
   * @param userId - Id del usuario, tomado del `sub` del access token.
   * @returns Sus contactos ordenados por fecha de creación; vacío si no tiene.
   */
  async findAll(userId: string): Promise<ContactResponseDto[]> {
    const contacts = await this.repository.findAll(userId);
    return contacts.map((c) => ContactResponseDto.fromEntity(c));
  }

  /**
   * Obtiene un contacto del usuario.
   *
   * @param userId - Id del usuario, tomado del `sub` del access token.
   * @param id - UUID del contacto.
   * @throws {@link NotFoundException} si no existe o es de otro usuario.
   */
  async findOne(userId: string, id: string): Promise<ContactResponseDto> {
    return ContactResponseDto.fromEntity(await this.getOrFail(userId, id));
  }

  /**
   * Actualiza los campos enviados de un contacto del usuario.
   *
   * @param userId - Id del usuario, tomado del `sub` del access token.
   * @param id - UUID del contacto.
   * @param changes - Campos a cambiar; los que no vengan se conservan.
   * @throws {@link NotFoundException} si no existe o es de otro usuario.
   */
  async update(
    userId: string,
    id: string,
    changes: UpdateContactDto,
  ): Promise<ContactResponseDto> {
    // Buscamos antes de actualizar para poder responder 404. Un UPDATE sobre
    // un id inexistente no falla en MySQL: solo afecta 0 filas.
    await this.getOrFail(userId, id);
    // El `!` es seguro porque la fila existe: la acabamos de encontrar.
    const updated = (await this.repository.update(userId, id, changes))!;
    return ContactResponseDto.fromEntity(updated);
  }

  /**
   * Guarda la foto de un contacto del usuario y reemplaza la anterior.
   *
   * El archivo se guarda con un nombre aleatorio y solo si sus primeros
   * bytes son de JPEG o PNG: un `.html` disfrazado de imagen se rechaza, y
   * nadie puede adivinar el nombre de la foto de otro.
   *
   * @param userId - Id del usuario, tomado del `sub` del access token.
   * @param id - UUID del contacto.
   * @param content - Bytes del archivo recibido.
   * @throws {@link NotFoundException} si no existe o es de otro usuario.
   * @throws {@link BadRequestException} si no es imagen o pesa de más.
   */
  async setPhoto(
    userId: string,
    id: string,
    content: Buffer,
  ): Promise<ContactResponseDto> {
    const contact = await this.getOrFail(userId, id);
    const { fileName } = await storeUpload(UPLOADS_DIR, content, [
      'image/jpeg',
      'image/png',
    ]);
    const updated = (await this.repository.setPhoto(userId, id, fileName))!;
    if (contact.photo) await removeStored(UPLOADS_DIR, [contact.photo]);
    return ContactResponseDto.fromEntity(updated);
  }

  /**
   * Borra un contacto del usuario y su foto. Es definitivo: no hay papelera.
   *
   * @param userId - Id del usuario, tomado del `sub` del access token.
   * @param id - UUID del contacto.
   * @throws {@link NotFoundException} si no existe o es de otro usuario.
   */
  async remove(userId: string, id: string): Promise<void> {
    const contact = await this.getOrFail(userId, id);
    await this.repository.delete(userId, id);
    if (contact.photo) await removeStored(UPLOADS_DIR, [contact.photo]);
  }

  /**
   * El contacto si es del usuario. Uno ajeno responde igual que uno que no
   * existe (404): un 403 confirmaría que el id existe.
   */
  private async getOrFail(userId: string, id: string): Promise<Contact> {
    const contact = await this.repository.findById(userId, id);
    if (!contact) throw new NotFoundException('Contacto no encontrado');
    return contact;
  }
}
