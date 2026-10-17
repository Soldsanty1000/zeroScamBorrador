import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ContactsRepository } from './contacts.repository';
import { ContactsService } from './contacts.service';
import { Contact } from './entities/contact.entity';

describe('ContactsService', () => {
  const ana = '1';
  const beto = '2';
  const contact = Object.assign(new Contact(), {
    id: 'c1',
    ownerId: ana,
    name: 'Contacto de Ana',
    createdAt: new Date(),
  });

  // El repository solo encuentra el contacto si se lo pide su dueño, como
  // hace el `WHERE id = ? AND owner_id = ?`.
  const repository = {
    findById: jest.fn((ownerId: string, id: string) =>
      Promise.resolve(ownerId === ana && id === 'c1' ? contact : undefined),
    ),
    update: jest.fn(),
    setPhoto: jest.fn(),
    delete: jest.fn(),
  };
  const service = new ContactsService(
    repository as unknown as ContactsRepository,
  );

  beforeEach(() => jest.clearAllMocks());

  it('el dueño ve su contacto', async () => {
    await expect(service.findOne(ana, 'c1')).resolves.toMatchObject({
      id: 'c1',
    });
  });

  it('otro usuario no puede ver, editar, cambiar la foto ni borrar', async () => {
    await expect(service.findOne(beto, 'c1')).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.update(beto, 'c1', {})).rejects.toThrow(
      NotFoundException,
    );
    await expect(
      service.setPhoto(beto, 'c1', Buffer.from([0xff, 0xd8, 0xff])),
    ).rejects.toThrow(NotFoundException);
    await expect(service.remove(beto, 'c1')).rejects.toThrow(NotFoundException);
    expect(repository.update).not.toHaveBeenCalled();
    expect(repository.setPhoto).not.toHaveBeenCalled();
    expect(repository.delete).not.toHaveBeenCalled();
  });

  it('rechaza una "foto" que en realidad es HTML', async () => {
    await expect(
      service.setPhoto(ana, 'c1', Buffer.from('<script>alert(1)</script>')),
    ).rejects.toThrow(BadRequestException);
    expect(repository.setPhoto).not.toHaveBeenCalled();
  });
});
