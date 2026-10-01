import { AnonymousReportDto } from '../dto/risk-response.dto';
import { checkCommunity } from './community.check';

function report(riskLevel: string, fraudType = 'Phishing'): AnonymousReportDto {
  return {
    fraudType,
    description: 'Me pidieron mi NIP',
    incidentDate: '2026-09-10T18:30:00.000Z',
    riskLevel,
  };
}

describe('checkCommunity', () => {
  it('pasa si no hay reportes', () => {
    const result = checkCommunity([]);
    expect(result.passed).toBe(true);
    expect(result.points).toBe(0);
  });

  it('da puntos según el nivel de un reporte', () => {
    expect(checkCommunity([report('BAJO')]).points).toBe(15);
    expect(checkCommunity([report('MUY_ALTO')]).points).toBe(60);
  });

  it('usa el nivel más alto y suma por cada reporte extra', () => {
    const result = checkCommunity([
      report('BAJO'),
      report('ALTO', 'Robo de Identidad'),
      report('MEDIO'),
    ]);
    expect(result.passed).toBe(false);
    expect(result.points).toBe(45 + 10);
    expect(result.detail).toContain('3 reportes validados');
    expect(result.detail).toContain('ALTO');
    expect(result.detail).toContain('Phishing, Robo de Identidad');
  });

  it('limita lo que suman los reportes extra', () => {
    const many = Array.from({ length: 30 }, () => report('MEDIO'));
    expect(checkCommunity(many).points).toBe(30 + 20);
  });

  it('cuenta un reporte validado sin clasificar', () => {
    const result = checkCommunity([report('NO_EVALUADO')]);
    expect(result.points).toBe(15);
    expect(result.detail).not.toContain('NO_EVALUADO');
  });
});
