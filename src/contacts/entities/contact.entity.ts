export class Contact {
  id: string | undefined;
  ownerId: string | undefined;
  name: string | undefined;
  email: string | undefined;
  phone: string | undefined;
  notes?: string | undefined;
  /** Nombre del archivo dentro de uploads/; undefined si no tiene foto. */
  photo?: string | undefined;
  createdAt: Date | undefined;
}
