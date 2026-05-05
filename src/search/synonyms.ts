const SYNONYM_GROUPS = [
  ['popular', 'featured', 'recommended', 'recommendation', 'discovery', 'discover', 'highlighted'],
  ['recipe', 'recipes', 'meal', 'meals', 'dish', 'dishes'],
  ['basket', 'cart', 'shoppingcart', 'shopping-cart'],
  ['shopping', 'shoppinglist', 'shopping-list', 'list', 'lists'],
  ['auth', 'authentication', 'login', 'signin', 'sign-in', 'session', 'token'],
  ['environment', 'env', 'configuration', 'config'],
  ['customer', 'user', 'profile', 'account'],
  ['offer', 'offers', 'campaign', 'promotion', 'deal', 'deals'],
  ['store', 'shop', 'retail', 'location'],
  ['product', 'products', 'item', 'items', 'sku'],
];

const SYNONYMS = buildSynonymMap();

export function expandSearchTerms(query: string): string[] {
  const normalized = normalize(query);
  if (!normalized) return [''];

  const terms = new Set<string>();

  addTerm(terms, normalized);

  for (const token of tokenize(normalized)) {
    addTerm(terms, token);
    for (const synonym of SYNONYMS.get(token) ?? []) {
      addTerm(terms, synonym);
    }
  }

  return [...terms].slice(0, 20);
}

export function expandTags(tags: string[]): string[] {
  const expanded = new Set<string>();

  for (const tag of tags) {
    const normalized = normalize(tag);
    if (!normalized) continue;
    addTerm(expanded, normalized);

    for (const synonym of SYNONYMS.get(normalized) ?? []) {
      addTerm(expanded, synonym);
    }
  }

  return [...expanded];
}

function addTerm(terms: Set<string>, term: string): void {
  const normalized = normalize(term);
  if (normalized.length > 1) {
    terms.add(normalized);
  }
}

function tokenize(query: string): string[] {
  return query.split(/[\s,;/_-]+/).filter(Boolean);
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function buildSynonymMap(): Map<string, string[]> {
  const map = new Map<string, string[]>();

  for (const group of SYNONYM_GROUPS) {
    for (const term of group) {
      map.set(term, group.filter((candidate) => candidate !== term));
    }
  }

  return map;
}
