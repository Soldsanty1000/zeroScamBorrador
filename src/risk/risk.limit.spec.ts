import { HttpException, HttpStatus } from '@nestjs/common';
import { RiskRepository } from './risk.repository';
import { ANALYZE_LIMIT, RiskService } from './risk.service';

// Sin red: el análisis nuevo se corta al resolver el destino, después de
// contar el intento.
jest.mock('./target', () => ({
  ...jest.requireActual<typeof import('./target')>('./target'),
  resolveTarget: jest.fn(() => Promise.reject(new Error('sin red'))),
}));

describe('RiskService: límite de análisis nuevos', () => {
  let repository: jest.Mocked<RiskRepository>;
  let service: RiskService;

  beforeEach(() => {
    repository = {
      findEvaluation: jest.fn().mockResolvedValue(undefined),
      recordLookup: jest.fn(),
    } as unknown as jest.Mocked<RiskRepository>;
    service = new RiskService(repository);
  });

  it(`deja ${ANALYZE_LIMIT} análisis nuevos y el siguiente responde 429`, async () => {
    for (let i = 0; i < ANALYZE_LIMIT; i++) {
      await expect(
        service.analyze(`https://sitio${i}.com`, '7'),
      ).rejects.toThrow('sin red');
    }
    const error = await service
      .analyze('https://otro.com', '7')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(
      HttpStatus.TOO_MANY_REQUESTS,
    );
  });

  it('cada cuenta tiene su propio límite', async () => {
    for (let i = 0; i < ANALYZE_LIMIT; i++) {
      await service.analyze(`https://sitio${i}.com`, '7').catch(() => null);
    }
    await expect(service.analyze('https://otro.com', '8')).rejects.toThrow(
      'sin red',
    );
  });

  it('los análisis del caché no cuentan', async () => {
    repository.findEvaluation.mockResolvedValue({
      url: 'https://sitio.com',
      riskLevel: 'BAJO',
      certificateStatus: 'VALIDO',
      evaluatedAt: new Date(),
      evaluation: { score: 0, riskLevel: 'BAJO', checks: [] },
    });
    for (let i = 0; i < ANALYZE_LIMIT + 5; i++) {
      await expect(
        service.analyze('https://sitio.com', '7'),
      ).resolves.toMatchObject({ cached: true });
    }
  });

  it('libera el cupo cuando pasa la ventana', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    for (let i = 0; i < ANALYZE_LIMIT; i++) {
      await service.analyze(`https://sitio${i}.com`, '7').catch(() => null);
    }
    now.mockReturnValue(1_000_000 + 10 * 60 * 1000 + 1);
    await expect(service.analyze('https://otro.com', '7')).rejects.toThrow(
      'sin red',
    );
    now.mockRestore();
  });
});
