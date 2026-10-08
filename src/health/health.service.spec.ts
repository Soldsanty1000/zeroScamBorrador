import { ServiceUnavailableException } from '@nestjs/common';
import { HealthRepository } from './health.repository';
import { HealthService } from './health.service';

describe('HealthService', () => {
  let ping: jest.Mock;
  let service: HealthService;

  beforeEach(() => {
    ping = jest.fn();
    service = new HealthService({ ping } as unknown as HealthRepository);
  });

  it('responde ok si la base de datos contesta', async () => {
    ping.mockResolvedValue(true);
    const health = await service.check();
    expect(health).toMatchObject({ status: 'ok', database: 'up' });
    expect(health.uptime).toBeGreaterThanOrEqual(0);
  });

  it('lanza 503 con el estado si la base de datos no contesta', async () => {
    ping.mockResolvedValue(false);
    const error = await service.check().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getResponse()).toMatchObject({
      status: 'error',
      database: 'down',
    });
  });
});
