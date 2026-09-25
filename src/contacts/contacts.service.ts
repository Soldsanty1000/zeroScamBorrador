/* eslint-disable @typescript-eslint/require-await */
import { Injectable, NotFoundException } from '@nestjs/common';
import { ContactsRepository } from './contacts.repository';
import { ContactResponseDto } from './dto/contact-response.dto';
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
  constructor(private readonly repository: ContactsRepository) { }

  /**
   * Crea un contacto para un usuario.
   *
   * @param userId - Id del usuario dueño, tomado del `sub` del access token.
   * @param data - Body ya validado (`CreateContactDto`).
   * @returns El contacto creado, con el `id` y `createdAt` que quedaron en la
   * base.
   * @throws `Error` con el mensaje `Agenda llena` si ya hay 100 contactos.
   */
  async create(userId: string, data: any): Promise<ContactResponseDto> {
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
   * Obtiene un contacto por id.
   *
   * @param id - UUID del contacto.
   * @returns El contacto encontrado.
   * @throws {@link NotFoundException} si no existe un contacto con ese id.
   */
  async findOne(id: string): Promise<ContactResponseDto> {
    const contact = await this.repository.findById(id);
    if (!contact) {
      throw new NotFoundException('Contacto ' + id + ' no encontrado');
    }
    return ContactResponseDto.fromEntity(contact);
  }

  /**
   * Actualiza los campos enviados de un contacto.
   *
   * @param id - UUID del contacto.
   * @param changes - Campos a cambiar; los que no vengan se conservan.
   * @returns El contacto ya actualizado.
   * @throws {@link NotFoundException} si no existe un contacto con ese id.
   */
  async update(
    id: string,
    changes: UpdateContactDto,
  ): Promise<ContactResponseDto> {
    // Buscamos antes de actualizar para poder responder 404. Un UPDATE sobre
    // un id inexistente no falla en MySQL: solo afecta 0 filas.
    const contact = await this.repository.findById(id);
    if (!contact) {
      throw new NotFoundException('Contacto ' + id + ' no encontrado');
    }
    // El `!` es seguro porque la fila existe: la acabamos de encontrar.
    const updated = (await this.repository.update(id, changes))!;
    return ContactResponseDto.fromEntity(updated);
  }

  /**
   * Borra un contacto. Es definitivo: no hay papelera.
   *
   * @param id - UUID del contacto.
   * @throws {@link NotFoundException} si no existe un contacto con ese id.
   */
  async remove(id: string): Promise<void> {
    // Mismo motivo que en `update`: un DELETE sobre un id inexistente no
    // lanza error, así que sin esta búsqueda el cliente recibiría 204 siempre.
    const contact = await this.repository.findById(id);
    if (!contact) {
      throw new NotFoundException('Contacto ' + id + ' no encontrado');
    }
    await this.repository.delete(id);
  }
}
