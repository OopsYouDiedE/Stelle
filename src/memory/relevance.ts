import type { MemorySearchQuery } from "./types.js";

export interface MemoryRelevanceQuery {
  phrase?: string;
  keywords: string[];
  tokens: string[];
}

export function buildMemoryRelevanceQuery(query: MemorySearchQuery): MemoryRelevanceQuery {
  const phrase = normalizeText(query.text ?? "");
  const keywordTerms = uniqueTerms(query.keywords ?? []);
  const textTerms = uniqueTerms(query.text ? query.text.split(/[\s,，。！？!?;；:：、]+/) : []);
  return {
    phrase: phrase || undefined,
    keywords: keywordTerms,
    tokens: uniqueTerms([...keywordTerms, ...textTerms]),
  };
}

export function scoreMemoryText(text: string, query: MemoryRelevanceQuery, options: { recent?: boolean } = {}): number {
  if (!query.tokens.length && !query.keywords.length && !query.phrase) return 1;

  const haystack = normalizeText(text);
  const phraseHit = Boolean(query.phrase && query.phrase.length >= 4 && haystack.includes(query.phrase));
  const tokenCoverage = coverage(query.tokens, haystack);
  const keywordCoverage = coverage(query.keywords, haystack);

  const hasBroadQuery = query.tokens.length >= 3 || query.keywords.length >= 2;
  const weakSingleHit = hasBroadQuery && tokenCoverage.hits <= 1 && keywordCoverage.hits <= 1 && !phraseHit;
  if (weakSingleHit) return 0;

  const phraseScore = phraseHit ? 1.3 : 0;
  const keywordScore = Math.min(1.1, keywordCoverage.ratio * 1.1);
  const tokenScore = Math.min(1.2, tokenCoverage.ratio * 1.2);
  const diversityBonus = Math.min(0.6, Math.max(tokenCoverage.hits, keywordCoverage.hits) * 0.12);
  const recentBonus = options.recent ? 0.08 : 0;

  return phraseScore + keywordScore + tokenScore + diversityBonus + recentBonus;
}

function coverage(terms: string[], haystack: string): { hits: number; ratio: number } {
  if (!terms.length) return { hits: 0, ratio: 0 };
  const hits = terms.filter((term) => haystack.includes(term)).length;
  return { hits, ratio: hits / terms.length };
}

function uniqueTerms(values: string[]): string[] {
  return [...new Set(values.map(normalizeText).filter((value) => value.length >= 2))];
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}
