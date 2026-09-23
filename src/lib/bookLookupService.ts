/**
 * Serviço de Busca e Reconhecimento de Livros
 * Suporta:
 * 1. Leitura visual com IA (Gemini Vision) via endpoint /api/books/scan
 * 2. Consulta instantânea de metadados por código ISBN (Brasil API, Google Books e OpenLibrary)
 * 3. Otimização e compressão automática de fotos no cliente antes do envio
 */

import { isValidIsbn, normalizeIsbn } from './isbn';

export interface ScannedBookData {
  title: string;
  subtitle?: string;
  author: string;
  illustrator?: string;
  publisher?: string;
  year?: string;
  isbn?: string;
  genre?: string;
  synopsis?: string;
  collection?: string;
  coverUrl?: string;
  /** Avisos da leitura (ISBN descartado, campos incertos, fotos de livros diferentes...) */
  warnings?: string[];
}

/** Tamanho aproximado, em bytes, do conteúdo de um data URL base64. */
function approxDataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  return Math.floor((dataUrl.length - (comma + 1)) * 0.75);
}

function loadImageFromUrl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Não foi possível abrir esta imagem. Use uma foto em JPEG, PNG ou WebP.'));
    img.src = src;
  });
}

async function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    return await loadImageFromUrl(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Converte a foto em JPEG (data URL) mantendo nitidez suficiente para ler o ISBN e a contracapa,
 * mas limitando o peso: as funções serverless da Vercel aceitam no máximo ~4,5 MB por requisição
 * (capa + contracapa + JSON), então cada foto é comprimida de forma adaptativa até caber em maxBytes.
 */
export async function fileToBase64Optimized(
  file: File,
  maxSide = 2000,
  quality = 0.9,
  maxBytes = 1_200_000
): Promise<{ base64: string; mimeType: string; width: number; height: number }> {
  const img = await loadImageFromFile(file);
  const naturalW = img.naturalWidth || img.width;
  const naturalH = img.naturalHeight || img.height;
  if (!naturalW || !naturalH) throw new Error('Imagem inválida ou vazia.');

  let scale = Math.min(1, maxSide / Math.max(naturalW, naturalH));
  let q = quality;
  let dataUrl = '';
  let width = naturalW;
  let height = naturalH;

  for (let attempt = 0; attempt < 8; attempt++) {
    width = Math.max(1, Math.round(naturalW * scale));
    height = Math.max(1, Math.round(naturalH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('O navegador não conseguiu processar a imagem.');

    // Fundo branco: evita fundo preto em PNG com transparência ao converter para JPEG
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, width, height);

    dataUrl = canvas.toDataURL('image/jpeg', q);
    if (approxDataUrlBytes(dataUrl) <= maxBytes) break;

    // Primeiro reduz a qualidade JPEG; depois a resolução
    if (q > 0.72) q -= 0.08;
    else scale *= 0.85;
  }

  return { base64: dataUrl, mimeType: 'image/jpeg', width, height };
}

/**
 * Gera uma miniatura leve da capa (~30 KB) para guardar no banco de dados.
 * Guardar a foto inteira (centenas de KB em base64) por livro deixaria o Realtime Database pesado e lento.
 * URLs http(s) são devolvidas como estão.
 */
export async function makeCoverThumbnail(src: string, maxSide = 420, quality = 0.78): Promise<string> {
  if (!src || !src.startsWith('data:image')) return src;
  try {
    const img = await loadImageFromUrl(src);
    const w0 = img.naturalWidth || img.width;
    const h0 = img.naturalHeight || img.height;
    const scale = Math.min(1, maxSide / Math.max(w0, h0));
    const width = Math.max(1, Math.round(w0 * scale));
    const height = Math.max(1, Math.round(h0 * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return src;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', quality);
  } catch {
    return src;
  }
}

/**
 * Tenta ler um código de barras ISBN (EAN-13 ou EAN-8) diretamente da imagem no navegador
 * utilizando a API nativa BarcodeDetector (presente no Chrome, Edge e Android).
 * Só devolve códigos com dígito verificador válido.
 */
export async function detectISBNFromImage(imageSrc: string): Promise<string | null> {
  if (typeof window === 'undefined' || !imageSrc) return null;

  try {
    if ('BarcodeDetector' in window) {
      const barcodeDetector = new (window as any).BarcodeDetector({
        formats: ['ean_13', 'ean_8', 'code_128', 'upc_a']
      });

      const img = await loadImageFromUrl(imageSrc);
      const barcodes = await barcodeDetector.detect(img);
      for (const b of barcodes) {
        const raw = normalizeIsbn(b.rawValue);
        // EAN-13 de livros inicia em 978 ou 979; ISBN-10 também é aceito
        if ((raw.length === 13 || raw.length === 10) && isValidIsbn(raw)) {
          return raw;
        }
      }
    }
  } catch (e) {
    console.warn('Detecção nativa de código de barras não disponível ou falhou:', e);
  }

  return null;
}

async function detectISBNFromAny(sources: (string | undefined)[]): Promise<string | null> {
  for (const src of sources) {
    if (!src) continue;
    const found = await detectISBNFromImage(src);
    if (found) return found;
  }
  return null;
}

/** Envia um POST JSON com limite de tempo e devolve status, tipo e corpo já interpretado. */
async function postJson(
  url: string,
  payload: unknown,
  timeoutMs = 58_000
): Promise<{ ok: boolean; status: number; isJson: boolean; json: any }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const isJson = (res.headers.get('content-type') || '').includes('json');
    let json: any = null;
    if (isJson) {
      try {
        json = await res.json();
      } catch {
        json = null;
      }
    }
    return { ok: res.ok, status: res.status, isJson, json };
  } finally {
    clearTimeout(timer);
  }
}

function friendlyScanError(res: { status: number; isJson: boolean; json: any }): string {
  if (res.json?.error) return String(res.json.error);
  if (res.status === 413) {
    return 'As fotos são grandes demais para envio. Tire as fotos novamente e tente de novo.';
  }
  if (res.status === 504) {
    return 'A leitura por IA demorou demais. Tente novamente em instantes ou use a busca por ISBN.';
  }
  if (res.status === 404 || (!res.isJson && res.status < 500)) {
    return 'O serviço de leitura por IA (/api/books/scan) não foi encontrado neste servidor. Verifique se o deploy inclui a pasta "api" e a variável GEMINI_API_KEY.';
  }
  return `Falha no servidor ao ler as fotos (HTTP ${res.status}). Tente novamente em instantes.`;
}

/**
 * Envia fotos da capa frontal e/ou verso (contracapa) para análise com Gemini no servidor.
 * O código de barras é lido localmente (quando o navegador suporta) e enviado como pista de ISBN:
 * o servidor o prefere à leitura da IA, que pode errar dígitos. Se a IA falhar, o código de barras
 * ainda permite recuperar a obra pelas bases públicas (CBL / Google Books).
 */
export async function scanBookWithAI(
  frontImageBase64: string,
  backImageBase64?: string,
  isbnHint?: string
): Promise<ScannedBookData> {
  const images: { data: string; mimeType: string; role: 'front' | 'back' }[] = [];
  if (frontImageBase64) images.push({ data: frontImageBase64, mimeType: 'image/jpeg', role: 'front' });
  if (backImageBase64) images.push({ data: backImageBase64, mimeType: 'image/jpeg', role: 'back' });

  let hint = normalizeIsbn(isbnHint);
  if (!isValidIsbn(hint)) {
    hint = (await detectISBNFromAny([backImageBase64, frontImageBase64])) || '';
  }

  let failure: Error | null = null;

  try {
    const res = await postJson('/api/books/scan', { images, isbnHint: hint || undefined });
    if (res.ok && res.json?.success && res.json.data) {
      const d = res.json.data;
      const warnings: string[] = Array.isArray(res.json.meta?.warnings) ? res.json.meta.warnings : [];
      return {
        title: d.title || '',
        subtitle: d.subtitle || '',
        author: d.author || '',
        illustrator: d.illustrator || '',
        publisher: d.publisher || '',
        year: d.year ? String(d.year) : '',
        isbn: d.isbn || '',
        genre: d.genre || 'Literatura Infantil',
        synopsis: d.synopsis || '',
        collection: d.collection || '',
        coverUrl: d.coverUrl || undefined,
        warnings
      };
    }
    failure = new Error(friendlyScanError(res));
  } catch (err: any) {
    failure =
      err?.name === 'AbortError'
        ? new Error('A leitura por IA demorou demais. Tente novamente em instantes ou use a busca por ISBN.')
        : new Error(err?.message || 'Falha de conexão ao ler as fotos. Verifique a internet e tente novamente.');
  }

  // Recuperação: a IA falhou, mas o código de barras foi lido no aparelho → bases públicas
  if (hint) {
    try {
      const byIsbn = await searchBookByISBN(hint);
      if (byIsbn && byIsbn.title) {
        return {
          ...byIsbn,
          warnings: [
            `A leitura por IA falhou (${failure.message}). Os dados vieram do código de barras (ISBN ${hint}); sinopse, ilustrador e coleção podem estar incompletos.`
          ]
        };
      }
    } catch {
      // segue para o erro original
    }
  }

  throw failure;
}

/**
 * Envia dados conhecidos de uma obra (ISBN, título, editora) para complementação
 * via IA pelo endpoint /api/books/enrich.
 */
export async function enrichBookDataWithAI(bookData: {
  isbn?: string;
  title?: string;
  author?: string;
  publisher?: string;
}): Promise<Partial<ScannedBookData> | null> {
  try {
    const res = await fetch('/api/books/enrich', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bookData),
      signal: AbortSignal.timeout(15_000)
    });
    if (res.ok) {
      const json = await res.json();
      if (json.success && json.data) {
        return json.data;
      }
    }
  } catch (e) {
    console.warn('Erro ao enriquecer dados com IA:', e);
  }
  return null;
}

/**
 * Busca dados da obra a partir do código ISBN utilizando a rota do servidor (com Brasil API / CBL + IA),
 * e com fallbacks locais caso o servidor não esteja disponível.
 */
export async function searchBookByISBN(isbnInput: string): Promise<ScannedBookData | null> {
  // Limpa caracteres não numéricos (exceto X no ISBN-10)
  const cleanIsbn = isbnInput.replace(/[^0-9X]/gi, '').trim();
  if (!cleanIsbn || (cleanIsbn.length !== 10 && cleanIsbn.length !== 13)) {
    throw new Error('ISBN inválido. O ISBN deve conter 10 ou 13 dígitos.');
  }

  // 1. Tentar rota unificada do servidor (CBL + Google Books + Enriquecimento Gemini)
  try {
    const serverRes = await fetch(`/api/books/isbn/${cleanIsbn}`, {
      signal: AbortSignal.timeout(14_000)
    });
    if (serverRes.ok) {
      const json = await serverRes.json();
      if (json.success && json.data && json.data.title) {
        const d = json.data;
        const warnings: string[] = [];
        if (!d.author || d.author === 'Autor Desconhecido') {
          warnings.push('Autoria não localizada nas bases públicas. Você pode preencher manualmente.');
        }
        return {
          title: d.title,
          subtitle: d.subtitle || '',
          author: d.author || 'Autor Desconhecido',
          illustrator: d.illustrator || '',
          publisher: d.publisher || '',
          year: d.year || '',
          isbn: cleanIsbn,
          genre: d.genre || 'Literatura Infantil',
          synopsis: d.synopsis || '',
          coverUrl: d.coverUrl,
          warnings
        };
      }
    }
  } catch {
    // Continua para os fallbacks diretos no navegador
  }

  // 2. Consulta direta à Brasil API (CBL - Câmara Brasileira do Livro)
  let partialBook: Partial<ScannedBookData> | null = null;
  try {
    const cblRes = await fetch(`https://brasilapi.com.br/api/isbn/v1/${cleanIsbn}`);
    if (cblRes.ok) {
      const cbl = await cblRes.json();
      if (cbl && cbl.title) {
        let author = '';
        if (Array.isArray(cbl.authors) && cbl.authors.length > 0) {
          author = cbl.authors.join(', ');
        }
        partialBook = {
          title: cbl.title,
          subtitle: cbl.subtitle || '',
          author: author || '',
          publisher: cbl.publisher || '',
          year: cbl.year ? String(cbl.year) : '',
          isbn: cleanIsbn,
          genre: 'Literatura Infantil',
          synopsis: cbl.synopsis || '',
          coverUrl: cbl.cover_url || undefined
        };
      }
    }
  } catch (e) {
    console.warn('Erro na Brasil API direta:', e);
  }

  // 3. Consulta complementar ao Google Books API (caso falte autor, sinopse ou livro não achado na CBL)
  if (!partialBook || !partialBook.author || !partialBook.synopsis) {
    try {
      const gbUrl = `https://www.googleapis.com/books/v1/volumes?q=isbn:${cleanIsbn}`;
      const gbRes = await fetch(gbUrl);
      if (gbRes.ok) {
        const gbData = await gbRes.json();
        if (gbData.items && gbData.items.length > 0) {
          const item = gbData.items[0];
          const info = item.volumeInfo || {};

          let genre = 'Literatura Infantil';
          const cats = (info.categories || []).join(' ').toLowerCase();
          if (cats.includes('poetry') || cats.includes('poesia')) genre = 'Poesia';
          else if (cats.includes('comic') || cats.includes('graphic') || cats.includes('quadrinhos'))
            genre = 'Gibis & Quadrinhos';
          else if (cats.includes('juvenile') || cats.includes('juvenil') || cats.includes('young'))
            genre = 'Juvenil';
          else if (cats.includes('education') || cats.includes('didatico') || cats.includes('study'))
            genre = 'Didático & Apoio';
          else if (cats.includes('science') || cats.includes('ciência') || cats.includes('nature'))
            genre = 'Enciclopédia & Ciências';
          else if (cats.includes('fairy') || cats.includes('tales') || cats.includes('conto'))
            genre = 'Contos & Fábulas';

          let year = '';
          if (info.publishedDate) {
            const matchYear = info.publishedDate.match(/\d{4}/);
            if (matchYear) year = matchYear[0];
          }

          const coverUrl =
            info.imageLinks?.thumbnail ||
            info.imageLinks?.smallThumbnail ||
            undefined;

          const gbAuthor = (info.authors || []).join(', ') || '';

          if (!partialBook) {
            partialBook = {
              title: info.title || '',
              subtitle: info.subtitle || '',
              author: gbAuthor,
              publisher: info.publisher || '',
              year,
              isbn: cleanIsbn,
              genre,
              synopsis: info.description || '',
              coverUrl: coverUrl ? coverUrl.replace('http://', 'https://') : undefined
            };
          } else {
            if (!partialBook.author && gbAuthor) partialBook.author = gbAuthor;
            if (!partialBook.publisher && info.publisher) partialBook.publisher = info.publisher;
            if (!partialBook.year && year) partialBook.year = year;
            if (!partialBook.synopsis && info.description) partialBook.synopsis = info.description;
            if (!partialBook.coverUrl && coverUrl) partialBook.coverUrl = coverUrl.replace('http://', 'https://');
          }
        }
      }
    } catch (e) {
      console.warn('Erro ao consultar Google Books API:', e);
    }
  }

  // 4. Fallback complementar: OpenLibrary API
  if (!partialBook || !partialBook.author || !partialBook.synopsis) {
    try {
      const olUrl = `https://openlibrary.org/api/books?bibkeys=ISBN:${cleanIsbn}&format=json&jscmd=data`;
      const olRes = await fetch(olUrl);
      if (olRes.ok) {
        const olData = await olRes.json();
        const bookKey = `ISBN:${cleanIsbn}`;
        if (olData[bookKey]) {
          const olBook = olData[bookKey];
          const olAuthors = (olBook.authors || []).map((a: any) => a.name).join(', ');
          const olPublishers = (olBook.publishers || []).map((p: any) => p.name).join(', ');
          const olYear = (olBook.publish_date || '').match(/\d{4}/)?.[0] || '';

          if (!partialBook) {
            partialBook = {
              title: olBook.title || '',
              subtitle: olBook.subtitle || '',
              author: olAuthors,
              publisher: olPublishers,
              year: olYear,
              isbn: cleanIsbn,
              genre: 'Literatura Infantil',
              synopsis: typeof olBook.description === 'string' ? olBook.description : '',
              coverUrl: olBook.cover?.medium || olBook.cover?.large || undefined
            };
          } else {
            if (!partialBook.author && olAuthors) partialBook.author = olAuthors;
            if (!partialBook.publisher && olPublishers) partialBook.publisher = olPublishers;
            if (!partialBook.year && olYear) partialBook.year = olYear;
            if (!partialBook.synopsis && typeof olBook.description === 'string') partialBook.synopsis = olBook.description;
            if (!partialBook.coverUrl && (olBook.cover?.medium || olBook.cover?.large)) {
              partialBook.coverUrl = olBook.cover?.medium || olBook.cover?.large;
            }
          }
        }
      }
    } catch (e) {
      console.warn('Erro ao consultar OpenLibrary API:', e);
    }
  }

  // 5. Se o livro tem título mas ainda faltou autor ou sinopse, tenta enriquecer com IA
  if (partialBook && partialBook.title && (!partialBook.author || !partialBook.synopsis)) {
    try {
      const aiData = await enrichBookDataWithAI({
        isbn: cleanIsbn,
        title: partialBook.title,
        publisher: partialBook.publisher,
        author: partialBook.author
      });
      if (aiData) {
        if (aiData.author && !partialBook.author) partialBook.author = aiData.author;
        if (aiData.illustrator) partialBook.illustrator = aiData.illustrator;
        if (aiData.year && !partialBook.year) partialBook.year = aiData.year;
        if (aiData.publisher && !partialBook.publisher) partialBook.publisher = aiData.publisher;
        if (aiData.genre && (!partialBook.genre || partialBook.genre === 'Literatura Infantil')) partialBook.genre = aiData.genre;
        if (aiData.synopsis && !partialBook.synopsis) partialBook.synopsis = aiData.synopsis;
      }
    } catch {
      // Best-effort
    }
  }

  if (partialBook && partialBook.title) {
    const warnings: string[] = [];
    if (!partialBook.author) {
      partialBook.author = 'Autor Desconhecido';
      warnings.push('Autoria não informada na base oficial da CBL. Você pode usar "Completar com IA" ou preencher manualmente.');
    }
    return {
      title: partialBook.title,
      subtitle: partialBook.subtitle || '',
      author: partialBook.author,
      illustrator: partialBook.illustrator || '',
      publisher: partialBook.publisher || '',
      year: partialBook.year || '',
      isbn: cleanIsbn,
      genre: partialBook.genre || 'Literatura Infantil',
      synopsis: partialBook.synopsis || '',
      coverUrl: partialBook.coverUrl,
      warnings
    };
  }

  return null;
}
