import { containsPattern, escapeLike } from './sql';

describe('sql helpers', () => {
  it('escapa los comodines de LIKE', () => {
    expect(escapeLike('100%_\\')).toBe('100\\%\\_\\\\');
  });

  it('arma el patrón %texto% con el texto escapado', () => {
    expect(containsPattern("a'b%")).toBe("%a'b\\%%");
  });
});
