import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { DB_POOL } from '../database/database.module';
import { Contact } from './entities/contact.entity';

const COLUMNS = 'id, owner_id, name, email, phone, notes, photo, created_at';
/** Columnas que un PATCH puede cambiar; se llaman igual que los campos del DTO. */
const EDITABLE = ['name', 'email', 'phone', 'notes'] as const;
/** Contactos que puede tener cada usuario. */
const MAX_CONTACTS_PER_USER = 100;

/**
 * Acceso a la tabla `contacts` de MySQL.
 *
 * @remarks
 * Es la única capa que escribe SQL de contactos. Regresa entidades
 * {@link Contact}, nunca filas crudas ni DTOs. Toda consulta filtra por
 * `owner_id`: la base decide qué contactos son de quién, así que un id ajeno
 * se comporta igual que uno que no existe.
 */
@Injectable()
export class ContactsRepository {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  /**
   * Lista los contactos de un usuario.
   *
   * @param ownerId - Id del usuario dueño de los contactos.
   * @returns Los contactos del usuario ordenados por `created_at`, o un
   * arreglo vacío si no tiene ninguno.
   */
  async findAll(ownerId: string): Promise<Contact[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT ${COLUMNS} FROM contacts WHERE owner_id = ? ORDER BY created_at`,
      [ownerId],
    );
    return rows.map(toEntity);
  }

  /**
   * Busca un contacto de un usuario.
   *
   * @param ownerId - Id del usuario dueño; un contacto ajeno no se encuentra.
   * @param id - UUID del contacto.
   * @returns El contacto, o `undefined` si no existe o es de otro usuario.
   */
  async findById(ownerId: string, id: string): Promise<Contact | undefined> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT ${COLUMNS} FROM contacts WHERE id = ? AND owner_id = ?`,
      [id, ownerId],
    );
    return rows[0] && toEntity(rows[0]);
  }

  /**
   * Inserta un contacto nuevo y lo regresa tal como quedó en la base.
   *
   * @param ownerId - Id del usuario que será dueño del contacto.
   * @param contact - Datos del contacto, sin `id`, `ownerId` ni `createdAt`.
   * @returns El contacto recién guardado, con `id` y `createdAt` asignados.
   * @throws {@link ConflictException} si el usuario ya tiene
   * {@link MAX_CONTACTS_PER_USER} contactos.
   */
  async save(
    ownerId: string,
    contact: Omit<Contact, 'id' | 'ownerId' | 'createdAt'>,
  ): Promise<Contact> {
    // El tope es por usuario: uno solo no puede llenar la agenda de todos.
    // Se cuenta aquí porque MySQL no tiene una restricción de "máximo de
    // filas" que podamos declarar en el schema.
    const [count] = await this.pool.query<RowDataPacket[]>(
      'SELECT COUNT(*) AS n FROM contacts WHERE owner_id = ?',
      [ownerId],
    );
    if (Number(count[0].n) >= MAX_CONTACTS_PER_USER) {
      throw new ConflictException('Agenda llena');
    }
    // `id` es CHAR(36) sin AUTO_INCREMENT, así que el UUID lo generamos
    // nosotros. Tenerlo antes del INSERT es lo que nos deja releer la fila.
    const id = randomUUID();
    // Sin notas mandamos `null`, que mysql2 convierte en NULL.
    await this.pool.query(
      `INSERT INTO contacts (id, owner_id, name, email, phone, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        id,
        ownerId,
        contact.name,
        contact.email,
        contact.phone,
        contact.notes || null,
      ],
    );
    // Releemos en vez de regresar lo que insertamos porque `created_at` lo
    // pone MySQL (DEFAULT CURRENT_TIMESTAMP); así la entidad trae la fecha
    // real. El `!` es seguro: acabamos de insertar ese id.
    return (await this.findById(ownerId, id))!;
  }

  /**
   * Actualiza solo los campos presentes en `changes`.
   *
   * @param ownerId - Id del usuario dueño; uno ajeno no se toca.
   * @param id - UUID del contacto.
   * @param changes - Campos a modificar; los ausentes no se tocan.
   * @returns El contacto después del cambio, o `undefined` si no existe.
   */
  async update(
    ownerId: string,
    id: string,
    changes: Partial<Contact>,
  ): Promise<Contact | undefined> {
    // En un PATCH el cliente manda solo lo que cambia, así que el SET se arma
    // con las llaves que llegaron. Los nombres de columna salen de esta lista
    // blanca, nunca del body; los valores van como `?`.
    const sets: string[] = [];
    const params: (string | null)[] = [];
    for (const column of EDITABLE) {
      if (changes[column] === undefined) continue;
      sets.push(`${column} = ?`);
      params.push(changes[column] ?? null);
    }
    // Sin cambios no hay UPDATE: MySQL rechaza un SET vacío.
    if (sets.length > 0) {
      await this.pool.query(
        `UPDATE contacts SET ${sets.join(', ')} WHERE id = ? AND owner_id = ?`,
        [...params, id, ownerId],
      );
    }
    return this.findById(ownerId, id);
  }

  /**
   * Guarda el nombre del archivo de foto de un contacto.
   *
   * @param ownerId - Id del usuario dueño; uno ajeno no se toca.
   * @param id - UUID del contacto.
   * @param filename - Nombre del archivo dentro de `uploads/`.
   * @returns El contacto después del cambio, o `undefined` si no existe.
   */
  async setPhoto(
    ownerId: string,
    id: string,
    filename: string,
  ): Promise<Contact | undefined> {
    await this.pool.query(
      'UPDATE contacts SET photo = ? WHERE id = ? AND owner_id = ?',
      [filename, id, ownerId],
    );
    return this.findById(ownerId, id);
  }

  /**
   * Borra un contacto.
   *
   * @param ownerId - Id del usuario dueño; uno ajeno no se borra.
   * @param id - UUID del contacto.
   * @returns `true` si se borró una fila, `false` si no existía o era ajeno.
   */
  async delete(ownerId: string, id: string): Promise<boolean> {
    const [result] = await this.pool.query<ResultSetHeader>(
      'DELETE FROM contacts WHERE id = ? AND owner_id = ?',
      [id, ownerId],
    );
    return result.affectedRows > 0;
  }
}

/** Fila de `contacts` tal como la regresa mysql2. */
interface ContactRow {
  id: string;
  owner_id: string;
  name: string;
  email: string;
  phone: string;
  notes: string | null;
  photo: string | null;
  created_at: Date;
}

/**
 * Convierte una fila de MySQL en una entidad {@link Contact}.
 *
 * @param row - Fila con las columnas de `COLUMNS`.
 * @returns La entidad con los nombres de campo en camelCase.
 */
function toEntity(row: RowDataPacket): Contact {
  const r = row as ContactRow;
  const contact = new Contact();
  contact.id = r.id;
  contact.ownerId = r.owner_id;
  contact.name = r.name;
  contact.email = r.email;
  contact.phone = r.phone;
  // MySQL regresa NULL cuando no hay notas. Lo pasamos a `undefined` para que
  // JSON.stringify omita el campo en la respuesta en vez de mandar `null`.
  contact.notes = r.notes ?? undefined;
  contact.photo = r.photo ?? undefined;
  contact.createdAt = r.created_at;
  return contact;
}
