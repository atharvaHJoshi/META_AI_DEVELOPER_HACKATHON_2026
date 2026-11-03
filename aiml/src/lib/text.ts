const STOP_WORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "when", "have", "has",
  "are", "was", "were", "will", "would", "could", "should", "into", "onto",
  "customer", "customers", "user", "users", "some", "after", "before", "they",
  "them", "their", "our", "not", "but", "can", "may", "all", "any", "you",
  "your", "about", "over", "under", "more", "less", "than", "then", "also",
  "issue", "ticket", "problem", "report", "reported", "please", "need",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

export function lexicalScore(query: string, target: string): number {
  const queryTokens = new Set(tokenize(query));
  const targetTokens = new Set(tokenize(target));
  if (queryTokens.size === 0 || targetTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of queryTokens) {
    if (targetTokens.has(token)) overlap += 1;
    else if (
      token.length > 4 &&
      [...targetTokens].some(
        (candidate) => candidate.includes(token) || token.includes(candidate),
      )
    ) {
      overlap += 0.5;
    }
  }
  return overlap / Math.sqrt(queryTokens.size * targetTokens.size);
}

export function excerpt(text: string, max = 240): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

export function sentenceExcerpt(text: string, keywords: string[], max = 240): string {
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);
  const match = sentences.find((sentence) =>
    keywords.some((keyword) => sentence.toLowerCase().includes(keyword.toLowerCase())),
  );
  return excerpt(match ?? text, max);
}
