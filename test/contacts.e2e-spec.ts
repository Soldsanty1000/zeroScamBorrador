import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Contacts (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const valid = {
    name: 'Danna Azul',
    email: 'dana@example.com',
    phone: '811-123-4567',
  };

  it('flujo CRUD completo', async () => {
    const created = await request(app.getHttpServer())
      .post('/contacts')
      .send(valid)
      .expect(201);
    expect(created.body.id).toBeDefined();
    expect(created.body.createdAt).toBeDefined();

    const list = await request(app.getHttpServer())
      .get('/contacts')
      .expect(200);
    expect(list.body).toHaveLength(1);

    const id = created.body.id;
    await request(app.getHttpServer()).get(`/contacts/${id}`).expect(200);

    const patched = await request(app.getHttpServer())
      .patch(`/contacts/${id}`)
      .send({ notes: 'compañera de clase' })
      .expect(200);
    expect(patched.body.notes).toBe('compañera de clase');

    await request(app.getHttpServer()).delete(`/contacts/${id}`).expect(204);
    await request(app.getHttpServer()).get(`/contacts/${id}`).expect(404);
  });

  it('rechaza body inválido con 400', async () => {
    await request(app.getHttpServer())
      .post('/contacts')
      .send({ name: 'X' })
      .expect(400);
  });
});
