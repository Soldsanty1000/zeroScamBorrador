/* eslint-disable @typescript-eslint/unbound-method */
import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { checkBlacklist } from './checks/blacklist.check';
import { checkCertificate } from './checks/certificate.check';
import { CheckResult } from './checks/check-result';
import { checkDomainAge } from './checks/domain-age.check';
import { AnonymousReportDto } from './dto/risk-response.dto';
import { RiskRepository, StoredEvaluation } from './risk.repository';
import { RiskService } from './risk.service';
import { evaluate } from './scoring';
import { resolveTarget } from './target';
import type { Target } from './target';

// Ninguna prueba toca la red: el DNS y las verificaciones externas se
// simulan. `normalizeUrl` sí es el de verdad.
jest.mock('./target', () => ({
  ...jest.requireActual<typeof import('./target')>('./target'),
  resolveTarget: jest.fn(),
}));
jest.mock('./checks/certificate.check');
jest.mock('./checks/domain-age.check');
jest.mock('./checks/blacklist.check');
const resolveTargetMock = jest.mocked(resolveTarget);
const certificateMock = jest.mocked(checkCertificate);
const domainAgeMock = jest.mocked(checkDomainAge);
const blacklistMock = jest.mocked(checkBlacklist);

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
      findStored: jest.fn(),
      recordLookup: jest.fn(),
      alertRecentUsers: jest.fn(),
    } as unknown as jest.Mocked<RiskRepository>;
    service = new RiskService(repository);
  });

  describe('analyze', () => {
    it('regresa el análisis guardado sin volver a analizar', async () => {
      const stored = site('https://paypa1.com/login', TECHNICAL);
      stored.riskLevel = 'ALTO';
      repository.findEvaluation.mockResolvedValue(stored);

      const result = await service.analyze(
        'https://PayPa1.com/login#pago',
        '7',
      );

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
        verified: true,
        detail: 'imita a paypal',
      });
      expect(result.degraded).toBe(false);
      expect(repository.saveEvaluation).not.toHaveBeenCalled();
      // La consulta se anota aunque el resultado salga del caché (RF08).
      expect(repository.recordLookup).toHaveBeenCalledWith(
        '7',
        'https://paypa1.com/login',
      );
    });

    it('rechaza un puerto no permitido antes de consultar la base', async () => {
      await expect(
        service.analyze('https://ejemplo.com:3306/', '7'),
      ).rejects.toThrow('Solo se analizan los puertos 80 y 443');
      expect(repository.findEvaluation).not.toHaveBeenCalled();
    });

    it('busca y anota la URL sin cadena de consulta, fragmento ni usuario', async () => {
      const stored = site('https://paypa1.com/login', TECHNICAL);
      repository.findEvaluation.mockResolvedValue(stored);

      await service.analyze(
        'https://usuario:clave@PayPa1.com/login?token=SECRETO&correo=a@b.com#x',
        '7',
      );

      expect(repository.findEvaluation).toHaveBeenCalledWith(
        'https://paypa1.com/login',
        24,
      );
      expect(repository.recordLookup).toHaveBeenCalledWith(
        '7',
        'https://paypa1.com/login',
      );
    });
  });

  describe('analyze: verificaciones incompletas (degraded)', () => {
    const TARGET: Target = {
      url: 'https://ejemplo.com/login',
      hostname: 'ejemplo.com',
      protocol: 'https',
      port: 443,
      address: '93.184.216.34',
    };
    const CERTIFICATE = {
      name: 'certificate',
      passed: true,
      verified: true,
      detail: 'Certificado de Emisor',
      points: 0,
      status: 'VALIDO',
    };
    const DOMAIN_AGE: CheckResult = {
      name: 'domainAge',
      passed: true,
      detail: 'ejemplo.com se registró hace 5 años',
      points: 0,
    };
    const BLACKLIST_CLEAN: CheckResult = {
      name: 'blacklist',
      passed: true,
      detail: 'No aparece en la lista negra de Google Safe Browsing',
      points: 0,
    };
    const BLACKLIST_DOWN: CheckResult = {
      name: 'blacklist',
      passed: false,
      verified: false,
      detail: 'No se pudo consultar la lista negra',
      points: 0,
    };
    const BLACKLISTED: CheckResult = {
      name: 'blacklist',
      passed: false,
      detail: 'Google Safe Browsing la tiene registrada como phishing',
      points: 100,
      minLevel: 'MUY_ALTO',
    };

    beforeEach(() => {
      resolveTargetMock.mockReset().mockResolvedValue(TARGET);
      certificateMock.mockReset().mockResolvedValue(CERTIFICATE);
      domainAgeMock.mockReset().mockResolvedValue(DOMAIN_AGE);
      blacklistMock.mockReset().mockResolvedValue(BLACKLIST_CLEAN);
      repository.findEvaluation.mockResolvedValue(undefined);
      repository.findStored.mockResolvedValue(undefined);
      repository.findValidatedReportsByHost.mockResolvedValue([]);
    });

    it('un análisis completo no es degraded', async () => {
      const result = await service.analyze('https://ejemplo.com/login', '7');

      expect(result).toMatchObject({
        riskLevel: 'BAJO',
        degraded: false,
        cached: false,
      });
      expect(result.checks.every((c) => c.verified)).toBe(true);
      expect(repository.saveEvaluation.mock.calls[0][2].degraded).toBe(false);
    });

    it('si Safe Browsing falla queda degraded y el check sin verificar', async () => {
      blacklistMock.mockResolvedValue(BLACKLIST_DOWN);

      const result = await service.analyze('https://ejemplo.com/login', '7');

      expect(result.degraded).toBe(true);
      // Sin esa señal el nivel es el que dan las demás; no hay "limpio".
      expect(result.riskLevel).toBe('BAJO');
      expect(result.checks.find((c) => c.name === 'blacklist')).toEqual({
        name: 'blacklist',
        passed: false,
        verified: false,
        detail: 'No se pudo consultar la lista negra',
      });
      // Se guarda marcado, para que el caché lo trate como incompleto.
      expect(repository.saveEvaluation.mock.calls[0][2].degraded).toBe(true);
    });

    it('si el sitio no contesta (certificado INACCESIBLE) también es degraded', async () => {
      certificateMock.mockResolvedValue({
        ...CERTIFICATE,
        passed: false,
        verified: false,
        status: 'INACCESIBLE',
        detail: 'No se pudo conectar al sitio',
      });
      const result = await service.analyze('https://ejemplo.com/login', '7');
      expect(result.degraded).toBe(true);
      expect(result.certificateStatus).toBe('INACCESIBLE');
    });

    it('no baja a BAJO lo que el análisis anterior sí encontró', async () => {
      // La vez anterior estaba en la lista negra (MUY_ALTO); ahora Google no
      // contesta.
      const before = site('https://ejemplo.com/login', [
        BLACKLISTED,
        CERTIFICATE,
      ]);
      before.riskLevel = 'MUY_ALTO';
      repository.findStored.mockResolvedValue(before);
      blacklistMock.mockResolvedValue(BLACKLIST_DOWN);

      const result = await service.analyze('https://ejemplo.com/login', '7');

      expect(result.riskLevel).toBe('MUY_ALTO');
      expect(result.degraded).toBe(true);
      const kept = result.checks.find((c) => c.name === 'blacklist');
      expect(kept).toMatchObject({ passed: false, verified: false });
      expect(kept?.detail).toContain('phishing');
      // Ya estaba en MUY_ALTO: no es una subida, no hay alerta.
      expect(repository.alertRecentUsers).not.toHaveBeenCalled();
    });

    it('un análisis completo reemplaza lo que había conservado', async () => {
      const before = site('https://ejemplo.com/login', [BLACKLISTED]);
      before.riskLevel = 'MUY_ALTO';
      repository.findStored.mockResolvedValue(before);
      // Ahora Google contesta y ya no está.

      const result = await service.analyze('https://ejemplo.com/login', '7');

      expect(result).toMatchObject({ riskLevel: 'BAJO', degraded: false });
    });

    describe('caché', () => {
      function cached(degradedChecks: boolean, ageSeconds?: number) {
        const stored = site('https://ejemplo.com/login', [
          degradedChecks ? BLACKLIST_DOWN : BLACKLIST_CLEAN,
        ]);
        stored.ageSeconds = ageSeconds;
        return stored;
      }

      it('reutiliza un análisis completo', async () => {
        repository.findEvaluation.mockResolvedValue(cached(false, 20 * 3600));
        const result = await service.analyze('https://ejemplo.com/login', '7');
        expect(result).toMatchObject({ cached: true, degraded: false });
        expect(resolveTargetMock).not.toHaveBeenCalled();
      });

      it('reutiliza un análisis degraded solo durante unos minutos', async () => {
        repository.findEvaluation.mockResolvedValue(cached(true, 120));
        const result = await service.analyze('https://ejemplo.com/login', '7');
        expect(result).toMatchObject({ cached: true, degraded: true });
        expect(resolveTargetMock).not.toHaveBeenCalled();
      });

      it('repite un análisis degraded de hace más de 5 minutos', async () => {
        repository.findEvaluation.mockResolvedValue(cached(true, 301));
        const result = await service.analyze('https://ejemplo.com/login', '7');
        expect(result.cached).toBe(false);
        expect(resolveTargetMock).toHaveBeenCalledTimes(1);
      });

      it('repite un análisis degraded si no se sabe qué tan viejo es', async () => {
        repository.findEvaluation.mockResolvedValue(cached(true, undefined));
        const result = await service.analyze('https://ejemplo.com/login', '7');
        expect(result.cached).toBe(false);
      });

      it('un análisis guardado antes de existir "degraded" cuenta como completo', async () => {
        const old = site('https://ejemplo.com/login', [BLACKLIST_CLEAN]);
        delete old.evaluation!.degraded;
        repository.findEvaluation.mockResolvedValue(old);
        const result = await service.analyze('https://ejemplo.com/login', '7');
        expect(result).toMatchObject({ cached: true, degraded: false });
      });
    });

    describe('tope de análisis simultáneos', () => {
      const flush = () => new Promise((resolve) => setImmediate(resolve));

      /** `resolveTarget` que no contesta hasta que se llame a `release`. */
      function hold() {
        const waiting: (() => void)[] = [];
        resolveTargetMock.mockImplementation(
          () =>
            new Promise<Target>((resolve) => {
              waiting.push(() => resolve(TARGET));
            }),
        );
        return () => waiting.splice(0).forEach((release) => release());
      }

      it('rechaza con 503 el análisis que pasa del tope y no hace cola', async () => {
        const release = hold();
        const running = Array.from({ length: 10 }, (_, i) =>
          service.analyze('https://ejemplo.com/login', String(i)),
        );
        await flush();

        const rejected = service.analyze('https://ejemplo.com/login', '99');
        await expect(rejected).rejects.toBeInstanceOf(
          ServiceUnavailableException,
        );
        await expect(rejected).rejects.toThrow(
          'Hay muchos análisis en curso. Intenta de nuevo en unos segundos',
        );
        // El rechazado no abrió nada hacia afuera.
        expect(resolveTargetMock).toHaveBeenCalledTimes(10);

        release();
        await expect(Promise.all(running)).resolves.toHaveLength(10);
      });

      it('libera el lugar al terminar y también si el análisis falla', async () => {
        const release = hold();
        const running = Array.from({ length: 10 }, () =>
          service.analyze('https://ejemplo.com/login', '1'),
        );
        await flush();
        release();
        await Promise.all(running);

        // Hay lugar otra vez.
        resolveTargetMock.mockResolvedValue(TARGET);
        await expect(
          service.analyze('https://ejemplo.com/login', '1'),
        ).resolves.toMatchObject({ cached: false });

        // Diez fallos (URL interna) tampoco dejan lugares ocupados.
        resolveTargetMock.mockRejectedValue(new BadRequestException('interna'));
        for (let i = 0; i < 12; i++) {
          await expect(
            service.analyze('https://ejemplo.com/login', '1'),
          ).rejects.toBeInstanceOf(BadRequestException);
        }
        resolveTargetMock.mockResolvedValue(TARGET);
        await expect(
          service.analyze('https://ejemplo.com/login', '1'),
        ).resolves.toBeDefined();
      });

      it('un análisis guardado no ocupa lugar: responde aunque el tope esté lleno', async () => {
        const release = hold();
        const running = Array.from({ length: 10 }, () =>
          service.analyze('https://otro.com/', '1'),
        );
        await flush();

        repository.findEvaluation.mockResolvedValue(
          site('https://ejemplo.com/login', TECHNICAL),
        );
        await expect(
          service.analyze('https://ejemplo.com/login', '2'),
        ).resolves.toMatchObject({ cached: true });

        release();
        await Promise.all(running);
      });
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

    it('avisa cuando un reporte sube la URL a riesgo alto (RF08)', async () => {
      repository.findValidatedReportsByHost.mockResolvedValue([
        report('MUY_ALTO'),
      ]);
      repository.findEvaluationsByHost.mockResolvedValue([
        site('https://banco-falso.com/login'),
      ]);

      await service.refreshUrls(['https://banco-falso.com/login']);

      expect(repository.alertRecentUsers).toHaveBeenCalledTimes(1);
      const [url, message, days, except] =
        repository.alertRecentUsers.mock.calls[0];
      expect(url).toBe('https://banco-falso.com/login');
      expect(message).toContain('riesgo MUY ALTO');
      expect(days).toBe(30);
      // Lo provocó la administración: se avisa a todos, sin excepción.
      expect(except).toBeUndefined();
    });

    it('no avisa si el nivel no sube o no llega a alto', async () => {
      // BAJO → MEDIO: sube, pero no es riesgo alto.
      repository.findValidatedReportsByHost.mockResolvedValue([
        report('MEDIO'),
      ]);
      repository.findEvaluationsByHost.mockResolvedValue([
        site('https://dudoso.com/'),
      ]);
      await service.refreshUrls(['https://dudoso.com/']);

      // ALTO → ALTO: ya estaba en alto, no es una subida.
      const already = site('https://paypa1.com/login', TECHNICAL);
      already.riskLevel = 'ALTO';
      repository.findValidatedReportsByHost.mockResolvedValue([report('BAJO')]);
      repository.findEvaluationsByHost.mockResolvedValue([already]);
      await service.refreshUrls(['https://paypa1.com/login']);

      expect(repository.alertRecentUsers).not.toHaveBeenCalled();
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
