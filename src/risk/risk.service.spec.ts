/* eslint-disable @typescript-eslint/unbound-method */
import { CheckResult } from './checks/check-result';
import { AnonymousReportDto } from './dto/risk-response.dto';
import { RiskRepository, StoredEvaluation } from './risk.repository';
import { RiskService } from './risk.service';
import { evaluate } from './scoring';

function report(riskLevel: string): AnonymousReportDto {
  return {
    fraudType: 'Phishing',
    description: 'Me pidieron mi NIP',
    incidentDate: '2026-09-10T18:30:00.000Z',
    riskLevel,
  };
}

function site(url: string, checks?: CheckResult[]): StoredEvaluation {
  return {
    url,
    riskLevel: 'BAJO',
    certificateStatus: checks ? 'VALIDO' : undefined,
    evaluatedAt: checks ? new Date('2026-10-01T12:00:00.000Z') : undefined,
    evaluation: checks && evaluate(checks),
  };
}

/** Señales que dejó un análisis anterior: 55 puntos, ALTO. */
const TECHNICAL: CheckResult[] = [
  { name: 'heuristics', passed: false, detail: 'imita a paypal', points: 35 },
  { name: 'certificate', passed: false, detail: 'sin HTTPS', points: 20 },
  { name: 'communityReports', passed: true, detail: 'Sin reportes', points: 0 },
];

describe('RiskService', () => {
  let repository: jest.Mocked<RiskRepository>;
  let service: RiskService;

  beforeEach(() => {
    repository = {
      findEvaluation: jest.fn(),
      findValidatedReportsByHost: jest.fn(),
      findEvaluationsByHost: jest.fn(),
      saveEvaluation: jest.fn(),
      saveRisk: jest.fn(),
    } as unknown as jest.Mocked<RiskRepository>;
    service = new RiskService(repository);
  });

  describe('analyze', () => {
    it('regresa el análisis guardado sin volver a analizar', async () => {
      const stored = site('https://paypa1.com/login', TECHNICAL);
      stored.riskLevel = 'ALTO';
      repository.findEvaluation.mockResolvedValue(stored);

      const result = await service.analyze('https://PayPa1.com/login#pago');

      // Se busca por la URL normalizada: host en minúsculas, sin fragmento.
      expect(repository.findEvaluation).toHaveBeenCalledWith(
        'https://paypa1.com/login',
        24,
      );
      expect(result).toMatchObject({
        url: 'https://paypa1.com/login',
        hostname: 'paypa1.com',
        riskLevel: 'ALTO',
        score: 55,
        certificateStatus: 'VALIDO',
        evaluatedAt: '2026-10-01T12:00:00.000Z',
        cached: true,
      });
      // Los puntos de cada verificación son internos: no salen en la API.
      expect(result.checks[0]).toEqual({
        name: 'heuristics',
        passed: false,
        detail: 'imita a paypal',
      });
      expect(repository.saveEvaluation).not.toHaveBeenCalled();
    });

    it('rechaza un puerto no permitido antes de consultar la base', async () => {
      await expect(
        service.analyze('https://ejemplo.com:3306/'),
      ).rejects.toThrow('Solo se analizan los puertos 80 y 443');
      expect(repository.findEvaluation).not.toHaveBeenCalled();
    });
  });

  describe('refreshUrls', () => {
    it('conserva las señales del análisis al validar un reporte BAJO', async () => {
      repository.findValidatedReportsByHost.mockResolvedValue([report('BAJO')]);
      repository.findEvaluationsByHost.mockResolvedValue([
        site('https://paypa1.com/login', TECHNICAL),
      ]);

      await service.refreshUrls(['https://paypa1.com/login']);

      // 55 del análisis + 15 del reporte: sigue ALTO, no baja a BAJO.
      expect(repository.saveRisk).toHaveBeenCalledTimes(1);
      const [url, evaluation] = repository.saveRisk.mock.calls[0];
      expect(url).toBe('https://paypa1.com/login');
      expect(evaluation).toMatchObject({ score: 70, riskLevel: 'ALTO' });
      expect(evaluation.checks.map((c) => c.name)).toEqual([
        'heuristics',
        'certificate',
        'communityReports',
      ]);
    });

    it('sube al nivel del reporte en una URL que nunca se analizó', async () => {
      repository.findValidatedReportsByHost.mockResolvedValue([
        report('MUY_ALTO'),
      ]);
      repository.findEvaluationsByHost.mockResolvedValue([
        site('banco-falso.com/login'),
      ]);

      await service.refreshUrls(['banco-falso.com/login']);

      expect(repository.findValidatedReportsByHost).toHaveBeenCalledWith(
        'banco-falso.com',
      );
      expect(repository.saveRisk.mock.calls[0][1]).toMatchObject({
        score: 60,
        riskLevel: 'MUY_ALTO',
      });
    });

    it('regresa a lo que dio el análisis si ya no hay reportes validados', async () => {
      repository.findValidatedReportsByHost.mockResolvedValue([]);
      repository.findEvaluationsByHost.mockResolvedValue([
        site('https://ejemplo.com/', [
          { name: 'certificate', passed: true, detail: 'ok', points: 0 },
          {
            name: 'communityReports',
            passed: false,
            detail: '1 reporte validado',
            points: 45,
            minLevel: 'ALTO',
          },
        ]),
      ]);

      await service.refreshUrls(['https://ejemplo.com/']);

      expect(repository.saveRisk.mock.calls[0][1]).toMatchObject({
        score: 0,
        riskLevel: 'BAJO',
      });
    });

    it('actualiza todas las URLs del sitio, una vez por sitio', async () => {
      repository.findValidatedReportsByHost.mockResolvedValue([report('ALTO')]);
      repository.findEvaluationsByHost.mockResolvedValue([
        site('https://malo.com/a'),
        site('https://malo.com/b'),
      ]);

      await service.refreshUrls(['https://malo.com/a', 'https://MALO.com/b']);

      expect(repository.findEvaluationsByHost).toHaveBeenCalledTimes(1);
      expect(repository.saveRisk).toHaveBeenCalledTimes(2);
    });
  });
});
