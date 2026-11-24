/**
 * Hybrid item-to-item similarity for "similar books" and "for you".
 *
 * Collaborative part: every reader is a dimension; a book's vector holds how
 * strongly each reader interacted with it (order 3, like 2, view 1 — the
 * strongest signal counts). Similarity is the cosine of two book vectors, so
 * a book everyone looks at doesn't become "similar" to everything.
 * Only books that share at least one reader are compared (inverted index), so
 * the cost grows with interactions, not with books².
 *
 * Content part: same author, genre, shelves, language. It carries the shop
 * while there are few orders (cold start) and fades as real signals grow.
 */
import { NeighborReason } from "../../schema/BookNeighbors.model";

export const SIGNAL_WEIGHT = { ORDER: 3, LIKE: 2, VIEW: 1 } as const;

export interface Interaction {
  member: string;
  book: string;
  weight: number;
}

export interface BookInfo {
  id: string;
  author?: string;
  collection?: string;
  shelves?: string[];
  language?: string;
}

export interface Neighbor {
  id: string;
  score: number;
  reason: NeighborReason;
}

export const BLEND = { collab: 0.65, content: 0.35, contentOnly: 0.6 } as const;
const CONTENT = { author: 0.6, genre: 0.25, shelves: 0.1, language: 0.05 } as const;
export const MIN_SCORE = 0.05;
export const NEIGHBORS_PER_BOOK = 12;

/** "Gʻafur Gʻulom" == "gafur gulom"; the migration's "Unknown" author counts as none */
export const authorKey = (author?: string) => {
  const key = (author || "").toLowerCase().replace(/[ʻʼ'’‘`]/g, "").replace(/\s+/g, " ").trim();
  return key && key !== "unknown" ? key : "";
};

/** book -> (member -> weight), keeping the strongest signal per pair */
export const buildVectors = (interactions: Interaction[]) => {
  const vectors = new Map<string, Map<string, number>>();
  for (const { member, book, weight } of interactions) {
    let v = vectors.get(book);
    if (!v) vectors.set(book, (v = new Map()));
    v.set(member, Math.max(v.get(member) ?? 0, weight));
  }
  return vectors;
};

const norm = (v: Map<string, number>) => Math.sqrt([...v.values()].reduce((s, w) => s + w * w, 0));

/** Cosine similarity of two sparse vectors */
export const cosine = (a: Map<string, number>, b: Map<string, number>) => {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [member, w] of small) dot += w * (large.get(member) ?? 0);
  return dot ? dot / (norm(a) * norm(b)) : 0;
};

/** Content similarity in [0, 1] and its strongest part */
export const contentSimilarity = (a: BookInfo, b: BookInfo): { score: number; main: NeighborReason | null } => {
  const sameAuthor = !!authorKey(a.author) && authorKey(a.author) === authorKey(b.author);
  const sameGenre = !!a.collection && a.collection === b.collection;
  const sa = new Set(a.shelves || []);
  const sb = new Set(b.shelves || []);
  const union = new Set([...sa, ...sb]).size;
  const shelves = union ? [...sa].filter((s) => sb.has(s)).length / union : 0;
  const sameLanguage = !!a.language && a.language === b.language;
  const score = (sameAuthor ? CONTENT.author : 0) + (sameGenre ? CONTENT.genre : 0) + shelves * CONTENT.shelves + (sameLanguage ? CONTENT.language : 0);
  const main = sameAuthor ? NeighborReason.AUTHOR : sameGenre ? NeighborReason.GENRE : score > 0 ? NeighborReason.SIMILAR : null;
  return { score, main };
};

/**
 * Neighbors of every book in `books` (the books that may be recommended).
 * Returns at most NEIGHBORS_PER_BOOK per book, best first.
 */
export const computeNeighbors = (books: BookInfo[], interactions: Interaction[]): Map<string, Neighbor[]> => {
  const ids = new Set(books.map((b) => b.id));
  const vectors = buildVectors(interactions.filter((i) => ids.has(i.book)));

  // collaborative: only pairs that share a reader (member -> books inverted index)
  const byMember = new Map<string, string[]>();
  for (const [book, v] of vectors) for (const member of v.keys()) (byMember.get(member) ?? byMember.set(member, []).get(member)!).push(book);
  const collab = new Map<string, Map<string, number>>();
  for (const list of byMember.values()) {
    for (const a of list) {
      for (const b of list) {
        if (a === b) continue;
        let row = collab.get(a);
        if (!row) collab.set(a, (row = new Map()));
        if (!row.has(b)) row.set(b, cosine(vectors.get(a)!, vectors.get(b)!));
      }
    }
  }

  const result = new Map<string, Neighbor[]>();
  for (const a of books) {
    const list: Neighbor[] = [];
    for (const b of books) {
      if (a.id === b.id) continue;
      const c = collab.get(a.id)?.get(b.id) ?? 0;
      const content = contentSimilarity(a, b);
      const score = c > 0 ? BLEND.collab * c + BLEND.content * content.score : BLEND.contentOnly * content.score;
      if (score < MIN_SCORE) continue;
      const reason = c > 0 && BLEND.collab * c >= BLEND.content * content.score ? NeighborReason.TOGETHER : content.main ?? NeighborReason.SIMILAR;
      list.push({ id: b.id, score: Math.round(score * 1000) / 1000, reason });
    }
    list.sort((x, y) => y.score - x.score);
    result.set(a.id, list.slice(0, NEIGHBORS_PER_BOOK));
  }
  return result;
};

/**
 * "For you": sum the neighbors of what the reader has touched, weighted by
 * how strongly they touched it. Books they ordered or liked are left out.
 */
export const personalize = (
  history: Map<string, number>,
  neighborsOf: (id: string) => Neighbor[],
  exclude: Set<string>
): { id: string; score: number; because: string }[] => {
  const total = new Map<string, { score: number; because: string; best: number }>();
  for (const [seed, weight] of history) {
    for (const n of neighborsOf(seed)) {
      if (exclude.has(n.id) || history.has(n.id)) continue;
      const add = weight * n.score;
      const cur = total.get(n.id) ?? { score: 0, because: seed, best: 0 };
      cur.score += add;
      if (add > cur.best) {
        cur.best = add;
        cur.because = seed;
      }
      total.set(n.id, cur);
    }
  }
  return [...total.entries()].map(([id, v]) => ({ id, score: v.score, because: v.because })).sort((a, b) => b.score - a.score);
};
