/**
 * Consulta de metadados de livros por ISBN em bases públicas:
 * Brasil API (CBL) → Google Books → OpenLibrary, com complementação opcional por IA
 * somente quando o título já foi localizado (nunca para "adivinhar" um livro só pelo ISBN).
 */
import { HttpError } from './http.js';
import { isValidIsbn, normalizeIsbn } from './isbn.js';
import {
  DEFAULT_TEXT_MODELS,
  extractJsonObject,
  getGeminiApiKey,
  makeDeadline,
  modelsFromEnv,
  runGemini
} from './gemini.js';

export interface BookRecord {
  isbn: string;
  title?: string;
  subtitle?: string;
  author?: string;
  illustrator?: string;
  publisher?: string;
  year?: string;
  genre?: string;
  synopsis?: string;
  coverUrl?: string;
}

const UA = 'DiarioDeClasse/1.0';

async function fetchJson(url: string, timeoutMs = 5000): Promise<any | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.warn(`[lookup] falha em ${url.split('?')[0]}:`, (e as Error)?.message || e);
    return null;
  }
}

function firstYear(value: unknown): string {
  const m = String(value ?? '').match(/\b(1[5-9]\d{2}|20\d{2})\b/);
  return m ? m[1] : '';
}

function genreFromCategories(categories: unknown): string {
  const cats = (Array.isArray(categories) ? categories : []).join(' ').toLowerCase();
  if (!cats) return '';
  if (cats.includes('poetry') || cats.includes('poesia')) return 'Poesia';
  if (cats.includes('comic') || cats.includes('graphic') || cats.includes('quadrinhos')) return 'Gibis & Quadrinhos';
  if (cats.includes('juvenile') || cats.includes('juvenil') || cats.includes('young')) return 'Juvenil';
  if (cats.includes('education') || cats.includes('didatico') || cats.includes('didático') || cats.includes('study'))
    return 'Didático & Apoio';
  if (cats.includes('science') || cats.includes('ciência') || cats.includes('nature')) return 'Enciclopédia & Ciências';
  if (cats.includes('fairy') || cats.includes('tales') || cats.includes('conto')) return 'Contos & Fábulas';
  return '';
}

export async function queryBrasilApi(isbn: string): Promise<Partial<BookRecord>> {
  const cbl = await fetchJson(`https://brasilapi.com.br/api/isbn/v1/${isbn}`);
  if (!cbl || !cbl.title) return {};
  const out: Partial<BookRecord> = { title: String(cbl.title) };
  if (cbl.subtitle) out.subtitle = String(cbl.subtitle);
  if (cbl.publisher) out.publisher = String(cbl.publisher);
  if (cbl.year) out.year = firstYear(cbl.year) || String(cbl.year);
  if (Array.isArray(cbl.authors) && cbl.authors.length > 0) out.author = cbl.authors.join(', ');
  if (cbl.synopsis) out.synopsis = String(cbl.synopsis);
  if (cbl.cover_url) out.coverUrl = String(cbl.cover_url);
  return out;
}

export async function queryGoogleBooks(isbn: string): Promise<Partial<BookRecord>> {
  const key = (process.env.GOOGLE_BOOKS_API_KEY || '').trim();
  const url =
    `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&maxResults=1` + (key ? `&key=${encodeURIComponent(key)}` : '');
  const gb = await fetchJson(url);
  const info = gb?.items?.[0]?.volumeInfo;
  if (!info) return {};
  const out: Partial<BookRecord> = {};
  if (info.title) out.title = String(info.title);
  if (info.subtitle) out.subtitle = String(info.subtitle);
  if (Array.isArray(info.authors) && info.authors.length) out.author = info.authors.join(', ');
  if (info.publisher) out.publisher = String(info.publisher);
  if (info.description) out.synopsis = String(info.description);
  const year = firstYear(info.publishedDate);
  if (year) out.year = year;
  const thumb = info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail;
  if (thumb) out.coverUrl = String(thumb).replace('http://', 'https://');
  const genre = genreFromCategories(info.categories);
  if (genre) out.genre = genre;
  return out;
}

export async function queryOpenLibrary(isbn: string): Promise<Partial<BookRecord>> {
  const data = await fetchJson(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
  const ol = data?.[`ISBN:${isbn}`];
  if (!ol) return {};
  const out: Partial<BookRecord> = {};
  if (ol.title) out.title = String(ol.title);
  if (ol.subtitle) out.subtitle = String(ol.subtitle);
  if (Array.isArray(ol.authors) && ol.authors.length) out.author = ol.authors.map((a: any) => a.name).join(', ');
  if (Array.isArray(ol.publishers) && ol.publishers.length) out.publisher = String(ol.publishers[0].name);
  const year = firstYear(ol.publish_date);
  if (year) out.year = year;
  const cover = ol.cover?.medium || ol.cover?.large;
  if (cover) out.coverUrl = String(cover);
  return out;
}

/** Junta registros: valores já preenchidos em `base` têm prioridade sobre `extra`. */
function mergeRecords(base: Partial<BookRecord>, extra: Partial<BookRecord>): Partial<BookRecord> {
  const out: Partial<BookRecord> = { ...base };
  for (const [k, v] of Object.entries(extra)) {
    if (v && !(out as any)[k]) (out as any)[k] = v;
  }
  return out;
}

/** Brasil API (CBL) + Google Books em paralelo. Usado também para validar a leitura por foto. */
export async function fetchRegistry(isbn: string): Promise<Partial<BookRecord>> {
  const [br, gb] = await Promise.all([queryBrasilApi(isbn), queryGoogleBooks(isbn)]);
  return mergeRecords(br, gb);
}

async function enrichWithAI(isbn: string, book: Partial<BookRecord>): Promise<Partial<BookRecord>> {
  if (!getGeminiApiKey() || !book.title) return {};

  const prompt = `Você é bibliotecário catalogador brasileiro. Complete a ficha da obra abaixo SOMENTE com dados que você conhece com segurança sobre ESTA obra específica.
Se não tiver certeza de algum campo, devolva "" nesse campo. Nunca invente.

Dados conhecidos:
- ISBN: "${isbn}"
- Título: "${book.title}"
- Autor: "${book.author || ''}"
- Editora: "${book.publisher || ''}"

Responda somente com um objeto JSON:
{"author": string, "illustrator": string, "publisher": string, "year": string, "genre": string, "synopsis": string}`;

  try {
    const { value } = await runGemini<Record<string, any>>({
      models: modelsFromEnv('GEMINI_TEXT_MODELS', DEFAULT_TEXT_MODELS),
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      parse: (t) => extractJsonObject(t),
      startWithJson: true,
      deadline: makeDeadline(15_000),
      perCallTimeoutMs: 10_000
    });

    const out: Partial<BookRecord> = {};
    const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    if (s(value.author)) {
      out.author = s(value.author);
      const ill = s(value.illustrator);
      if (ill && !out.author.includes(ill)) out.author += ` (Ilustrações: ${ill})`;
    }
    if (s(value.publisher)) out.publisher = s(value.publisher);
    const y = firstYear(value.year);
    if (y) out.year = y;
    if (s(value.genre)) out.genre = s(value.genre);
    if (s(value.synopsis)) out.synopsis = s(value.synopsis);
    return out;
  } catch (e) {
    console.warn('[lookup] complementação por IA indisponível:', (e as Error)?.message || e);
    return {};
  }
}

/** Fluxo completo da rota GET /api/books/isbn/:isbn. */
export async function lookupBookByIsbn(rawIsbn: string): Promise<BookRecord> {
  const isbn = normalizeIsbn(rawIsbn);
  if (!isbn || (isbn.length !== 10 && isbn.length !== 13)) {
    throw new HttpError(400, 'Código ISBN deve conter 10 ou 13 dígitos.');
  }

  let book = await fetchRegistry(isbn);

  if (!book.title) {
    book = mergeRecords(book, await queryOpenLibrary(isbn));
  }

  if (!book.title) {
    const hint = isValidIsbn(isbn) ? '' : ' O dígito verificador deste ISBN não confere — confira a digitação.';
    throw new HttpError(404, `Nenhum registro encontrado para este código ISBN.${hint}`);
  }

  // Complementa autor/ano/sinopse por IA apenas quando o título já é conhecido.
  if (!book.author || !book.synopsis || !book.year) {
    book = mergeRecords(book, await enrichWithAI(isbn, book));
  }

  if (!book.coverUrl) {
    const testUrl = `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg?default=false`;
    try {
      const res = await fetch(testUrl, { method: 'HEAD', signal: AbortSignal.timeout(3000) });
      if (res.ok) book.coverUrl = testUrl;
    } catch {
      // capa é opcional
    }
  }

  return { ...book, isbn } as BookRecord;
}
