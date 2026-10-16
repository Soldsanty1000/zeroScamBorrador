import { CheckResult } from './checks/check-result';
import { evaluate, keepPreviousFindings, shouldAlert } from './scoring';

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

  describe('verificaciones sin verificar', () => {
    function unverified(name: string): CheckResult {
      return { name, passed: false, verified: false, detail: '?', points: 0 };
    }

    it('marca el análisis como incompleto', () => {
      expect(evaluate([check(10), unverified('blacklist')]).degraded).toBe(
        true,
      );
      expect(evaluate([check(10), check(0)]).degraded).toBe(false);
    });

    it('no suben ni bajan el nivel: queda como sin esa señal', () => {
      const complete = evaluate([check(30), check(25)]);
      const degraded = evaluate([check(30), check(25), unverified('x')]);
      expect(degraded.riskLevel).toBe(complete.riskLevel);
      expect(degraded.score).toBe(complete.score);
    });

    it('no quitan el nivel mínimo de las demás verificaciones', () => {
      expect(
        evaluate([check(45, 'ALTO'), unverified('blacklist')]).riskLevel,
      ).toBe('ALTO');
    });

    it('un análisis viejo sin el campo verified cuenta como verificado', () => {
      expect(evaluate([check(0)]).degraded).toBe(false);
    });
  });
});

describe('keepPreviousFindings', () => {
  const unverified: CheckResult = {
    name: 'blacklist',
    passed: false,
    verified: false,
    detail: 'No se pudo consultar la lista negra',
    points: 0,
  };
  const listed: CheckResult = {
    name: 'blacklist',
    passed: false,
    detail: 'Google Safe Browsing la tiene registrada como phishing',
    points: 100,
    minLevel: 'MUY_ALTO',
  };

  it('conserva lo que el análisis anterior encontró si ahora no se pudo verificar', () => {
    const [kept] = keepPreviousFindings([unverified], [listed]);
    expect(kept).toMatchObject({
      name: 'blacklist',
      passed: false,
      verified: false,
      points: 100,
      minLevel: 'MUY_ALTO',
    });
    expect(kept.detail).toContain('registrada como phishing');
    expect(kept.detail).toContain('ahora no se pudo verificar');
    // Sigue incompleto, pero el nivel no baja.
    const evaluation = evaluate([kept]);
    expect(evaluation.degraded).toBe(true);
    expect(evaluation.riskLevel).toBe('MUY_ALTO');
  });

  it('no repite el aviso si el hallazgo ya venía conservado', () => {
    const [once] = keepPreviousFindings([unverified], [listed]);
    const [twice] = keepPreviousFindings([unverified], [once]);
    expect(twice.detail).toBe(once.detail);
    expect(twice.points).toBe(100);
  });

  it('no deja nada pegado si antes tampoco hubo hallazgo', () => {
    const clean: CheckResult = {
      name: 'blacklist',
      passed: true,
      detail: 'No aparece',
      points: 0,
    };
    expect(keepPreviousFindings([unverified], [clean])).toEqual([unverified]);
    expect(keepPreviousFindings([unverified], [unverified])).toEqual([
      unverified,
    ]);
    expect(keepPreviousFindings([unverified])).toEqual([unverified]);
  });

  it('no toca una verificación que sí se hizo', () => {
    const fresh: CheckResult = { ...listed, points: 0, passed: true };
    expect(keepPreviousFindings([fresh], [listed])).toEqual([fresh]);
  });

  it('solo reemplaza la verificación del mismo nombre', () => {
    const other: CheckResult = { ...listed, name: 'certificate' };
    expect(keepPreviousFindings([unverified], [other])).toEqual([unverified]);
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
