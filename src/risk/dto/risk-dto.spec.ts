import { validateSync } from 'class-validator';
import { AnalyzeUrlDto } from './analyze-url.dto';
import { RiskQueryDto } from './risk-query.dto';

function errors<T extends object>(type: new () => T, values: object) {
  return validateSync(Object.assign(new type(), values)).map((e) => e.property);
}

describe('RiskQueryDto', () => {
  it('acepta de 3 a 200 caracteres', () => {
    expect(errors(RiskQueryDto, { q: 'abc' })).toEqual([]);
    expect(errors(RiskQueryDto, { q: 'a'.repeat(200) })).toEqual([]);
  });

  it('rechaza uno muy corto, uno muy largo y lo que no es texto', () => {
    expect(errors(RiskQueryDto, { q: 'ab' })).toEqual(['q']);
    expect(errors(RiskQueryDto, { q: 'a'.repeat(201) })).toEqual(['q']);
    expect(errors(RiskQueryDto, { q: 12345 })).toEqual(['q']);
    expect(errors(RiskQueryDto, {})).toEqual(['q']);
  });
});

describe('AnalyzeUrlDto', () => {
  it('acepta una URL http o https de hasta 2048 caracteres', () => {
    expect(errors(AnalyzeUrlDto, { url: 'https://ejemplo.com/login' })).toEqual(
      [],
    );
    const long = 'https://ejemplo.com/' + 'a'.repeat(2048 - 20);
    expect(long).toHaveLength(2048);
    expect(errors(AnalyzeUrlDto, { url: long })).toEqual([]);
  });

  it('rechaza una URL de más de 2048 caracteres', () => {
    const long = 'https://ejemplo.com/' + 'a'.repeat(2048 - 19);
    expect(errors(AnalyzeUrlDto, { url: long })).toEqual(['url']);
  });

  it('rechaza lo que no es una URL http/https', () => {
    expect(errors(AnalyzeUrlDto, { url: 'ejemplo.com' })).toEqual(['url']);
    expect(errors(AnalyzeUrlDto, { url: 'ftp://ejemplo.com/' })).toEqual([
      'url',
    ]);
    expect(errors(AnalyzeUrlDto, { url: 'javascript:alert(1)' })).toEqual([
      'url',
    ]);
    expect(errors(AnalyzeUrlDto, { url: ['https://ejemplo.com'] })).toEqual([
      'url',
    ]);
    expect(errors(AnalyzeUrlDto, {})).toEqual(['url']);
  });
});
