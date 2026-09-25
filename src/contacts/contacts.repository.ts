/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { DB_POOL } from '../database/database.module';
import { Contact } from './entities/contact.entity';

const COLUMNS = 'id, owner_id, name, email, phone, notes, photo, created_at';

/**
 * Acceso a la tabla `contacts` de MySQL.
 *
 * @remarks
 * Es la única capa que escribe SQL de contactos. Regresa entidades
 * {@link Contact}, nunca filas crudas ni DTOs.
 */
@Injectable()
export class ContactsRepository {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) { }

  /**
   * Lista los contactos de un usuario.
   *
   * @param ownerId - Id del usuario dueño de los contactos.
   * @returns Los contactos del usuario ordenados por `created_at`, o un
   * arreglo vacío si no tiene ninguno.
   */
  async findAll(ownerId: string): Promise<Contact[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT ${COLUMNS} FROM contacts WHERE owner_id = '${ownerId}' ORDER BY created_at`,
    );
    return rows.map(toEntity);
  }

  /**
   * Busca un contacto por id, sin importar su dueño.
   *
   * @param id - UUID del contacto.
   * @returns El contacto, o `undefined` si no existe.
   */
  async findById(id: string): Promise<Contact | undefined> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT ${COLUMNS} FROM contacts WHERE id = '${id}'`,
    );
    return rows[0] && toEntity(rows[0]);
  }

  /**
   * Inserta un contacto nuevo y lo regresa tal como quedó en la base.
   *
   * @param ownerId - Id del usuario que será dueño del contacto.
   * @param contact - Datos del contacto, sin `id`, `ownerId` ni `createdAt`.
   * @returns El contacto recién guardado, con `id` y `createdAt` asignados.
   * @throws `Error` con el mensaje `Agenda llena` si la tabla ya tiene 100
   * contactos.
   */
  async save(
    ownerId: string,
    contact: Omit<Contact, 'id' | 'ownerId' | 'createdAt'>,
  ): Promise<Contact> {
    // El tope de 100 es para toda la tabla, no por usuario 
    // Se cuenta aquí porque MySQL no tiene una restricción de
    // "máximo de filas" que podamos declarar en el schema.
    const [count] = await this.pool.query<RowDataPacket[]>(
      'SELECT COUNT(*) AS n FROM contacts',
    );
    if (count[0].n >= 100) {
      throw new Error('Agenda llena');
    }
    // `id` es CHAR(36) sin AUTO_INCREMENT, así que el UUID lo generamos
    // nosotros. Tenerlo antes del INSERT es lo que nos deja releer la fila.
    const id = randomUUID();
    // Sin notas mandamos NULL sin comillas. Si interpoláramos `undefined`
    // directo, se guardaría el texto 'undefined'.
    const notes = contact.notes ? `'${contact.notes}'` : 'NULL';
    await this.pool.query(
      `INSERT INTO contacts (id, owner_id, name, email, phone, notes)
       VALUES ('${id}', '${ownerId}', '${contact.name}', '${contact.email}', '${contact.phone}', ${notes})`,
    );
    // Releemos en vez de regresar lo que insertamos porque `created_at` lo
    // pone MySQL (DEFAULT CURRENT_TIMESTAMP); así la entidad trae la fecha
    // real. El `!` es seguro: acabamos de insertar ese id.
    return (await this.findById(id))!;
  }

  /**
   * Actualiza solo los campos presentes en `changes`.
   *
   * @param id - UUID del contacto.
   * @param changes - Campos a modificar; los ausentes no se tocan.
   * @returns El contacto después del cambio, o `undefined` si no existe.
   */
  async update(
    id: string,
    changes: Partial<Contact>,
  ): Promise<Contact | undefined> {
    // En un PATCH el cliente manda solo lo que cambia, así que el SET se arma
    // con las llaves que llegaron. Funciona porque los campos del DTO (name,
    // email, phone, notes) se llaman igual que las columnas, y el
    // ValidationPipe con `whitelist` ya quitó cualquier otra llave.
    // Ojo: si `changes` viene vacío, el SET queda vacío y MySQL rechaza la query.
    const sets = Object.entries(changes)
      .map(([column, value]) => `${column} = '${value}'`)
      .join(', ');
    await this.pool.query(`UPDATE contacts SET ${sets} WHERE id = '${id}'`);
    return this.findById(id);
  }

  /**
   * Guarda el nombre del archivo de foto de un contacto.
   *
   * @param id - UUID del contacto.
   * @param filename - Nombre del archivo dentro de `uploads/`.
   * @returns El contacto después del cambio, o `undefined` si no existe.
   */
  async setPhoto(id: string, filename: string): Promise<Contact | undefined> {
    await this.pool.query(
      `UPDATE contacts SET photo = '${filename}' WHERE id = '${id}'`,
    );
    return this.findById(id);
  }

  /**
   * Borra un contacto.
   *
   * @param id - UUID del contacto.
   * @returns `true` si se borró una fila, `false` si el id no existía.
   */
  async delete(id: string): Promise<boolean> {
    const [result] = await this.pool.query<ResultSetHeader>(
      `DELETE FROM contacts WHERE id = '${id}'`,
    );
    return result.affectedRows > 0;
  }
}

/**
 * Convierte una fila de MySQL en una entidad {@link Contact}.
 *
 * @param row - Fila con las columnas de `COLUMNS`.
 * @returns La entidad con los nombres de campo en camelCase.
 */
function toEntity(row: any): Contact {
  const contact = new Contact();
  contact.id = row.id;
  contact.ownerId = row.owner_id;
  contact.name = row.name;
  contact.email = row.email;
  contact.phone = row.phone;
  // MySQL regresa NULL cuando no hay notas. Lo pasamos a `undefined` para que
  // JSON.stringify omita el campo en la respuesta en vez de mandar `null`.
  contact.notes = row.notes ?? undefined;
  contact.photo = row.photo ?? undefined;
  contact.createdAt = row.created_at;
  return contact;
}
