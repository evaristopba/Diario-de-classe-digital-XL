/**
 * Leitura de capa e contracapa de livros com Gemini Vision.
 *
 * Fluxo:
 *  1. Valida e rotula as fotos (CAPA / CONTRACAPA) — o modelo sabe qual é qual.
 *  2. Pede a ficha catalográfica ao Gemini (mídia em alta resolução, temperatura padrão do modelo).
 *  3. Normaliza os campos (placeholders, ano, gênero, ISBN).
 *  4. Valida o ISBN pelo dígito verificador; prefere o código de barras lido no navegador; se o ISBN
 *     lido pela IA estiver errado, tenta uma leitura focada só do ISBN antes de descartá-lo.
 *  5. Confere o ISBN nas bases públicas (Brasil API / Google Books): completa campos vazios e avisa
 *     quando o ISBN pertence a outra obra (fotos de livros diferentes).
 */
import { HttpError, MAX_BODY_BYTES } from './http.js';
import {
  DEFAULT_SCAN_MODELS,
  classifyError,
  describeGeminiError,
  extractJsonObject,
  getGeminiApiKey,
  makeDeadline,
  modelsFromEnv,
  runGemini,
  salvageFields
} from './gemini.js';
import { extractIsbn, isValidIsbn, normalizeIsbn, sameIsbn } from './isbn.js';
import { fetchRegistry } from './lookup.js';

export const GENRES = [
  'Literatura Infantil',
  'Contos & Fábulas',
  'Poesia',
  'Gibis & Quadrinhos',
  'Didático & Apoio',
  'Juvenil',
  'Enciclopédia & Ciências',
  'Folclore & Tradição Oral',
  'Outro'
];

export type ImageRole = 'front' | 'back';

export interface ScannedBook {
  title: string;
  subtitle: string;
  author: string;
  illustrator: string;
  publisher: string;
  year: string;
  isbn: string;
  genre: string;
  synopsis: string;
  collection: string;
}

export interface ScanResponse {
  success: true;
  data: ScannedBook;
  meta: {
    model: string;
    isbnSource: 'barcode' | 'ocr' | 'ocr-retry' | 'none';
    warnings: string[];
    uncertain: string[];
    elapsedMs: number;
  };
}

interface PreparedImage {
  data: string; // base64 puro, sem prefixo data:
  mimeType: string;
  role?: ImageRole;
}

const ALLOWED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const MAX_IMAGES = 3;
/** Orçamento total por requisição (as funções da Vercel são configuradas com 60 s em vercel.json). */
const TOTAL_BUDGET_MS = 50_000;

const FIELD_KEYS = [
  'title',
  'subtitle',
  'author',
  'illustrator',
  'publisher',
  'year',
  'isbn',
  'genre',
  'synopsis',
  'collection'
];

const FIELD_LABELS: Record<string, string> = {
  title: 'título',
  subtitle: 'subtítulo',
  author: 'autor',
  illustrator: 'ilustrador',
  publisher: 'editora',
  year: 'ano',
  isbn: 'ISBN',
  genre: 'gênero',
  synopsis: 'sinopse',
  collection: 'coleção'
};

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

function prepareImage(img: any, index: number): PreparedImage {
  let data = typeof img?.data === 'string' ? img.data.trim() : '';
  let mimeType = typeof img?.mimeType === 'string' && img.mimeType ? img.mimeType : 'image/jpeg';

  if (data.startsWith('data:')) {
    const comma = data.indexOf(',');
    if (comma > 0) {
      const header = data.slice(5, comma); // ex.: image/jpeg;base64
      const headerMime = header.split(';')[0]?.trim();
      if (headerMime) mimeType = headerMime;
      data = data.slice(comma + 1);
    }
  }
  data = data.replace(/\s+/g, '');
  mimeType = mimeType.toLowerCase();

  if (data.length < 500) {
    throw new HttpError(400, `A foto ${index + 1} está vazia ou corrompida. Tire a foto novamente.`);
  }
  if (!ALLOWED_MIME.has(mimeType)) {
    throw new HttpError(400, `Formato de imagem não suportado (${mimeType}). Use JPEG, PNG ou WebP.`);
  }
  if (mimeType === 'image/jpg') mimeType = 'image/jpeg';

  const role: ImageRole | undefined = img?.role === 'front' || img?.role === 'back' ? img.role : undefined;
  return { data, mimeType, role };
}

function parseRequest(body: unknown): { images: PreparedImage[]; isbnHint: string } {
  const b = (body ?? {}) as any;
  const raw = Array.isArray(b.images) ? b.images : [];
  if (raw.length === 0) {
    throw new HttpError(400, 'Nenhuma foto da obra foi enviada para análise.');
  }

  const images: PreparedImage[] = [];
  for (let i = 0; i < Math.min(raw.length, MAX_IMAGES); i++) {
    images.push(prepareImage(raw[i], i));
  }

  const total = images.reduce((sum, im) => sum + im.data.length, 0);
  if (total > MAX_BODY_BYTES) {
    throw new HttpError(
      413,
      'As fotos enviadas são grandes demais. Tire as fotos novamente (ou use uma resolução menor) e tente de novo.'
    );
  }

  const hintRaw = normalizeIsbn(b.isbnHint);
  const isbnHint = isValidIsbn(hintRaw) ? hintRaw : '';
  return { images, isbnHint };
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

function buildParts(images: PreparedImage[], instruction: string): any[] {
  const parts: any[] = [];
  images.forEach((img, i) => {
    const label =
      img.role === 'front'
        ? 'CAPA (frente)'
        : img.role === 'back'
          ? 'CONTRACAPA (verso / quarta capa)'
          : 'capa ou contracapa (identifique pelo conteúdo)';
    parts.push({ text: `IMAGEM ${i + 1} — ${label}:` });
    parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
  });
  // Instruções por último, depois dos dados (recomendação do Google para modelos Gemini 3).
  parts.push({ text: instruction });
  return parts;
}

function buildCatalogPrompt(synopsisMode: 'transcribe' | 'summary'): string {
  const synopsisRule =
    synopsisMode === 'transcribe'
      ? '"synopsis": transcrição fiel e completa do texto de apresentação/sinopse da CONTRACAPA, parágrafo por parágrafo, sem resumir nem cortar. Ignore código de barras, preço, endereços de site/redes sociais e selos. Sem foto da contracapa ou sem texto de apresentação: "".'
      : '"synopsis": resumo curto (até 3 frases), escrito com suas palavras, do que a contracapa apresenta. Sem foto da contracapa ou sem texto de apresentação: "".';

  return `Você é bibliotecário escolar e catalogador. As imagens acima são fotos de UMA mesma obra (capa e/ou contracapa, conforme os rótulos). Leia o que está IMPRESSO e devolva a ficha catalográfica.

REGRAS GERAIS
- Transcreva exatamente o que está impresso: não traduza, não corrija a grafia e não complete de memória.
- Se um dado não estiver visível e legível nas fotos, use "" (texto vazio). Nunca invente nem deduza pelo que você acha que conhece do livro.
- Use caixa normal (iniciais maiúsculas), mesmo que a capa use CAIXA ALTA como recurso de design.

CAMPOS
- "title": título principal, o texto mais destacado da CAPA. Números e algarismos decorativos fazem parte do título ("99 Brincadeiras Cantadas", "365 Histórias"). Não inclua autor, editora, coleção nem slogan.
- "subtitle": subtítulo complementar impresso junto ao título, se houver.
- "author": autor(es), organizador(es) ou grupo/companhia responsável, separados por vírgula, sem prefixos como "texto de" ou "por".
- "illustrator": somente quem é creditado como ilustrador(a) ou desenhista.
- "publisher": editora (nome ou logotipo, geralmente no pé da capa ou na contracapa).
- "year": ano de publicação, edição ou copyright, com 4 dígitos, somente se estiver impresso.
- "isbn": número ISBN. Prefira o número escrito junto ao código de barras (ex.: "ISBN 978-85-359-0277-5") e copie dígito por dígito. ISBN-13 começa com 978 ou 979. Se algum dígito estiver ilegível, use "" — não chute dígitos.
- "genre": exatamente uma destas opções: ${GENRES.map((g) => `"${g}"`).join(', ')}.
- ${synopsisRule}
- "collection": coleção, série ou selo, se houver.
- "uncertain": lista com os nomes dos campos acima sobre os quais você tem dúvida real de leitura (foto borrada, reflexo, texto cortado). Lista vazia se tudo estiver claro.

Responda somente com um objeto JSON contendo estas chaves, sem markdown e sem texto adicional.`;
}

const ISBN_ONLY_PROMPT = `Leia SOMENTE o número ISBN impresso nas imagens acima. Procure o texto "ISBN" ao lado ou abaixo do código de barras (geralmente no canto inferior da contracapa) e a ficha catalográfica.
Copie dígito por dígito. ISBN-13 começa com 978 ou 979. Se algum dígito estiver ilegível, devolva "".
Responda somente com JSON: {"isbn": "..."}`;

// ---------------------------------------------------------------------------
// Normalização
// ---------------------------------------------------------------------------

const PLACEHOLDER_RE =
  /^(n\/?a|null|undefined|none|nenhum|nenhuma|desconhecid[oa]|não (identificad[oa]|informad[oa]|consta|visível|encontrad[oa]|legível|há)|sem (título|autor|informação)|[-–—.?]+)$/i;

function cleanText(value: unknown, keepLines = false): string {
  let text: string;
  if (Array.isArray(value)) text = value.map((v) => String(v ?? '').trim()).filter(Boolean).join(', ');
  else if (value === null || value === undefined) text = '';
  else text = String(value);

  if (keepLines) {
    text = text
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => line.replace(/[ \t]+/g, ' ').trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  } else {
    text = text.replace(/\s+/g, ' ').trim();
  }

  if (text.length <= 40 && PLACEHOLDER_RE.test(text)) return '';
  return text;
}

function cleanYear(value: unknown): string {
  const currentYear = new Date().getFullYear();
  const matches = String(value ?? '').match(/\b(1[5-9]\d{2}|20\d{2})\b/g) || [];
  for (const m of matches) {
    const y = Number(m);
    if (y >= 1500 && y <= currentYear + 1) return String(y);
  }
  return '';
}

function cleanGenre(value: unknown): string {
  const g = cleanText(value).toLowerCase();
  if (!g) return '';
  const exact = GENRES.find((x) => x.toLowerCase() === g);
  if (exact) return exact;
  const partial = GENRES.find((x) => g.includes(x.toLowerCase()) || x.toLowerCase().includes(g));
  return partial || '';
}

function normalizeFields(obj: Record<string, any>): { book: ScannedBook; aiIsbn: string; uncertain: string[] } {
  const book: ScannedBook = {
    title: cleanText(obj.title),
    subtitle: cleanText(obj.subtitle),
    author: cleanText(obj.author),
    illustrator: cleanText(obj.illustrator),
    publisher: cleanText(obj.publisher),
    year: cleanYear(obj.year),
    isbn: '',
    genre: cleanGenre(obj.genre),
    synopsis: cleanText(obj.synopsis, true),
    collection: cleanText(obj.collection)
  };

  const uncertain = (Array.isArray(obj.uncertain) ? obj.uncertain : [])
    .map((k: unknown) => String(k ?? '').trim().toLowerCase())
    .filter((k: string) => k in FIELD_LABELS);

  return { book, aiIsbn: extractIsbn(obj.isbn), uncertain: Array.from(new Set<string>(uncertain)) };
}

/** Resposta utilizável = ao menos um dado bibliográfico principal. */
function hasUsefulData(obj: Record<string, any> | null): boolean {
  if (!obj) return false;
  return ['title', 'author', 'isbn', 'publisher', 'synopsis'].some((k) => cleanText(obj[k]) !== '');
}

function parseCatalogText(text: string): Record<string, any> | null {
  const obj = extractJsonObject(text) ?? salvageFields(text, FIELD_KEYS);
  return hasUsefulData(obj) ? obj : null;
}

// ---------------------------------------------------------------------------
// Conferência com bases públicas
// ---------------------------------------------------------------------------

const STOPWORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'as', 'os', 'em', 'no', 'na', 'um', 'uma', 'para', 'com']);

function titleTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1 && !STOPWORDS.has(t))
  );
}

/** Coeficiente de sobreposição (interseção / menor conjunto), tolerante a subtítulos extras. */
function titleOverlap(a: string, b: string): number {
  const ta = titleTokens(a);
  const tb = titleTokens(b);
  if (ta.size === 0 || tb.size === 0) return 1; // sem base para comparar → não alerta
  let inter = 0;
  ta.forEach((t) => {
    if (tb.has(t)) inter++;
  });
  return inter / Math.min(ta.size, tb.size);
}

// ---------------------------------------------------------------------------
// Pipeline principal
// ---------------------------------------------------------------------------

export async function scanBook(body: unknown): Promise<ScanResponse> {
  const startedAt = Date.now();
  const { images, isbnHint } = parseRequest(body);

  if (!getGeminiApiKey()) {
    throw new HttpError(
      503,
      'A chave GEMINI_API_KEY não está configurada no servidor. Defina a variável de ambiente (na Vercel: Settings → Environment Variables) e refaça o deploy.'
    );
  }

  const models = modelsFromEnv('GEMINI_SCAN_MODELS', DEFAULT_SCAN_MODELS);
  const deadline = makeDeadline(TOTAL_BUDGET_MS);
  const warnings: string[] = [];

  // 1) Leitura principal
  const runCatalog = (mode: 'transcribe' | 'summary') =>
    runGemini<Record<string, any>>({
      models,
      contents: [{ role: 'user', parts: buildParts(images, buildCatalogPrompt(mode)) }],
      parse: parseCatalogText,
      media: true,
      deadline
    });

  let ai: { model: string; value: Record<string, any> };
  try {
    try {
      ai = await runCatalog('transcribe');
    } catch (e) {
      // Filtro de recitação (transcrever texto longo protegido): refaz pedindo um resumo da contracapa.
      if (classifyError(e).kind === 'recitation') {
        ai = await runCatalog('summary');
        warnings.push('A sinopse foi resumida (a IA não pôde transcrever o texto da contracapa). Confira e ajuste se necessário.');
      } else {
        throw e;
      }
    }
  } catch (e) {
    const { status, message } = describeGeminiError(classifyError(e));
    throw new HttpError(
      status,
      status === 422
        ? `${message} Dica: fotografe a capa e a contracapa de frente, sem reflexos, com o livro bem enquadrado.`
        : message
    );
  }

  const { book, aiIsbn, uncertain } = normalizeFields(ai.value);

  if (!book.title && !book.author && !aiIsbn) {
    throw new HttpError(
      422,
      'Não foi possível identificar título, autor ou ISBN nas fotos enviadas. Tente com fotos mais nítidas e bem enquadradas, ou use a busca por ISBN.'
    );
  }

  // 2) ISBN: código de barras (navegador) > leitura da IA > leitura focada > descartar
  let isbnSource: ScanResponse['meta']['isbnSource'] = 'none';

  if (isbnHint) {
    book.isbn = isbnHint;
    isbnSource = 'barcode';
    if (aiIsbn && isValidIsbn(aiIsbn) && !sameIsbn(aiIsbn, isbnHint)) {
      warnings.push('O ISBN lido pela IA difere do código de barras; foi usado o do código de barras.');
    }
  } else if (aiIsbn && isValidIsbn(aiIsbn)) {
    book.isbn = aiIsbn;
    isbnSource = 'ocr';
  } else if (aiIsbn) {
    // Dígito verificador não confere → leitura focada somente do ISBN (foto da contracapa, se houver)
    let retried = '';
    if (deadline - Date.now() > 9_000) {
      const target = images.some((im) => im.role === 'back') ? images.filter((im) => im.role === 'back') : images;
      try {
        const r = await runGemini<{ isbn: string }>({
          models: [ai.model],
          contents: [{ role: 'user', parts: buildParts(target, ISBN_ONLY_PROMPT) }],
          parse: (t) => {
            const o = extractJsonObject(t) ?? salvageFields(t, ['isbn']);
            return o && typeof o.isbn === 'string' ? { isbn: o.isbn } : null;
          },
          media: true,
          startWithJson: true,
          deadline,
          perCallTimeoutMs: 20_000
        });
        retried = extractIsbn(r.value.isbn);
      } catch {
        retried = '';
      }
    }
    if (retried && isValidIsbn(retried)) {
      book.isbn = retried;
      isbnSource = 'ocr-retry';
    } else {
      warnings.push(
        'O ISBN lido nas fotos não passou na validação (dígito verificador) e foi descartado. Confira o número impresso na contracapa ou use a busca por ISBN.'
      );
    }
  }

  // 3) Confere/completa com bases públicas quando há ISBN válido
  if (book.isbn && deadline - Date.now() > 3_000) {
    try {
      const reg = await fetchRegistry(book.isbn);
      if (reg.title && book.title && titleOverlap(book.title, reg.title) < 0.34) {
        warnings.push(
          `O ISBN ${book.isbn} consta nas bases públicas como "${reg.title}", diferente do título lido. Confira se as fotos são do mesmo livro.`
        );
      }
      if (!book.title && reg.title) book.title = reg.title;
      if (!book.subtitle && reg.subtitle) book.subtitle = reg.subtitle;
      if (!book.author && reg.author) book.author = reg.author;
      if (!book.publisher && reg.publisher) book.publisher = reg.publisher;
      if (!book.year && reg.year) book.year = cleanYear(reg.year);
      if (!book.synopsis && reg.synopsis) book.synopsis = reg.synopsis;
      if (!book.genre && reg.genre) book.genre = cleanGenre(reg.genre);
    } catch {
      // conferência é best-effort
    }
  }

  const uncertainLabels = uncertain.map((k) => FIELD_LABELS[k]).filter(Boolean);
  if (uncertainLabels.length > 0) {
    warnings.push(`Confira estes campos, a leitura teve dúvida: ${uncertainLabels.join(', ')}.`);
  }

  return {
    success: true,
    data: book,
    meta: {
      model: ai.model,
      isbnSource,
      warnings,
      uncertain,
      elapsedMs: Date.now() - startedAt
    }
  };
}
