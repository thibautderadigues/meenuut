import { normalizeForSearch } from '../lib/format';

export interface FuzzyMatch {
  score: number;
  /** Positions des caractères trouvés, pour les mettre en évidence. */
  indices: number[];
}

const WORD_SEPARATOR = /[\s\-_/.:'’]/;

function isWordStart(text: string, index: number) {
  return index === 0 || WORD_SEPARATOR.test(text[index - 1] ?? '');
}

/**
 * Correspondance floue insensible à la casse et aux accents.
 * Une sous-chaîne exacte l'emporte ; sinon, sous-séquence avec bonus pour
 * les lettres consécutives et les débuts de mots ("nd" → "Nouveau Document").
 */
export function fuzzyMatch(query: string, target: string): FuzzyMatch | null {
  const needle = normalizeForSearch(query.replace(/\s+/g, ' ').trim());
  if (!needle) return { score: 0, indices: [] };
  const haystack = normalizeForSearch(target);
  const lengthPenalty = haystack.length * 0.01; // à égalité, les cibles courtes d'abord

  const substring = haystack.indexOf(needle);
  if (substring >= 0) {
    const score = 100 + (substring === 0 ? 20 : isWordStart(haystack, substring) ? 10 : 0);
    return {
      score: score - lengthPenalty,
      indices: Array.from({ length: needle.length }, (_, i) => substring + i),
    };
  }

  const compact = needle.replace(/ /g, '');
  const indices: number[] = [];
  let score = 0;
  let from = 0;
  for (const char of compact) {
    const found = haystack.indexOf(char, from);
    if (found < 0) return null;
    score += 1;
    if (found === (indices.at(-1) ?? -2) + 1) score += 3;
    if (isWordStart(haystack, found)) score += 4;
    indices.push(found);
    from = found + 1;
  }
  return { score: score - lengthPenalty, indices };
}
