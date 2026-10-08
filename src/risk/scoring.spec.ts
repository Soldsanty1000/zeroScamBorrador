import { CheckResult } from './checks/check-result';
import { evaluate, shouldAlert } from './scoring';

function check(points: number, minLevel?: string): CheckResult {
  return { name: 'x', passed: points === 0, detail: '', points, minLevel };
}

describe('evaluate', () => {
  it('da BAJO sin señales', () => {
    expect(evaluate([check(0), check(0)])).toMatchObject({
      score: 0,
      riskLevel: 'BAJO',
    });
  });

  it('sube un nivel cada 25 puntos', () => {
    expect(evaluate([check(24)]).riskLevel).toBe('BAJO');
    expect(evaluate([check(25)]).riskLevel).toBe('MEDIO');
    expect(evaluate([check(30), check(20)]).riskLevel).toBe('ALTO');
    expect(evaluate([check(75)]).riskLevel).toBe('MUY_ALTO');
  });

  it('no pasa de 100 puntos', () => {
    expect(evaluate([check(80), check(60)])).toMatchObject({
      score: 100,
      riskLevel: 'MUY_ALTO',
    });
  });

  it('no baja del nivel mínimo de una verificación', () => {
    // 45 puntos serían MEDIO, pero un reporte clasificado ALTO manda.
    expect(evaluate([check(45, 'ALTO')]).riskLevel).toBe('ALTO');
  });

  it('usa los puntos si superan al nivel mínimo', () => {
    expect(evaluate([check(15, 'BAJO'), check(65)]).riskLevel).toBe('MUY_ALTO');
  });

  it('ignora un nivel mínimo desconocido', () => {
    expect(evaluate([check(10, 'NO_EVALUADO')]).riskLevel).toBe('BAJO');
  });
});

describe('shouldAlert', () => {
  it('avisa cuando sube a ALTO o MUY_ALTO', () => {
    expect(shouldAlert('BAJO', 'ALTO')).toBe(true);
    expect(shouldAlert('MEDIO', 'MUY_ALTO')).toBe(true);
    expect(shouldAlert('ALTO', 'MUY_ALTO')).toBe(true);
  });

  it('no avisa si sube sin llegar a ALTO', () => {
    expect(shouldAlert('BAJO', 'MEDIO')).toBe(false);
  });

  it('no avisa si se queda igual o baja', () => {
    expect(shouldAlert('ALTO', 'ALTO')).toBe(false);
    expect(shouldAlert('MUY_ALTO', 'ALTO')).toBe(false);
  });
});
