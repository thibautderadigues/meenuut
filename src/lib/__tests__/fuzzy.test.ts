import { describe, expect, it } from 'vitest';
import { fuzzyMatch } from '../../palette/fuzzy';

describe('fuzzyMatch', () => {
  it('trouve les initiales de mots', () => {
    expect(fuzzyMatch('ldc', 'Liste de courses')?.indices).toEqual([0, 6, 9]);
  });

  it('ignore accents et casse', () => {
    expect(fuzzyMatch('reunion', 'Notes de Réunion')).not.toBeNull();
  });

  it('classe une sous-chaîne au-dessus d’une sous-séquence', () => {
    const substring = fuzzyMatch('cour', 'Liste de courses')!.score;
    const subsequence = fuzzyMatch('cour', 'Carnet de voyage ou route')?.score ?? -Infinity;
    expect(substring).toBeGreaterThan(subsequence);
  });

  it('rejette ce qui ne correspond pas', () => {
    expect(fuzzyMatch('zzz', 'Liste de courses')).toBeNull();
  });
});
