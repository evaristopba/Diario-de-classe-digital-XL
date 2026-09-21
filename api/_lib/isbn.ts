/**
 * Utilitários de ISBN (validação por dígito verificador).
 * Código puro, sem dependências — usado pelas rotas de servidor (Express e Vercel).
 * Existe uma cópia equivalente para o navegador em src/lib/isbn.ts.
 */

/** Remove tudo que não é dígito ou X (ISBN-10 pode terminar em X). */
export function normalizeIsbn(raw: unknown): string {
  return String(raw ?? '')
    .replace(/[^0-9Xx]/g, '')
    .toUpperCase();
}

export function isValidIsbn10(isbn: string): boolean {
  if (!/^\d{9}[\dX]$/.test(isbn)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const c = isbn[i] === 'X' ? 10 : Number(isbn[i]);
    sum += c * (10 - i);
  }
  return sum % 11 === 0;
}

export function isValidIsbn13(isbn: string): boolean {
  if (!/^\d{13}$/.test(isbn)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(isbn[i]) * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  return check === Number(isbn[12]);
}

/** ISBN-10 ou ISBN-13 com dígito verificador correto. */
export function isValidIsbn(raw: unknown): boolean {
  const isbn = normalizeIsbn(raw);
  if (isbn.length === 10) return isValidIsbn10(isbn);
  if (isbn.length === 13) return isValidIsbn13(isbn) && /^97[89]/.test(isbn);
  return false;
}

/** Converte um ISBN-10 válido em ISBN-13 (prefixo 978). ISBN-13 é devolvido como está. */
export function toIsbn13(raw: unknown): string {
  const isbn = normalizeIsbn(raw);
  if (isbn.length === 13) return isbn;
  if (isbn.length !== 10) return '';
  const base = '978' + isbn.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(base[i]) * (i % 2 === 0 ? 1 : 3);
  return base + String((10 - (sum % 10)) % 10);
}

/** Verdadeiro se os dois valores representam o mesmo livro (10 vs 13 dígitos incluídos). */
export function sameIsbn(a: unknown, b: unknown): boolean {
  const x = toIsbn13(a);
  const y = toIsbn13(b);
  return !!x && x === y;
}

/**
 * Extrai um ISBN de um texto livre (ex.: "ISBN 978-85-359-0277-5 (broch.)").
 * Devolve string vazia se não houver nada com formato de ISBN.
 * Não valida o dígito verificador — use isValidIsbn() no resultado.
 */
export function extractIsbn(raw: unknown): string {
  const text = String(raw ?? '');
  if (!text.trim()) return '';

  const direct = normalizeIsbn(text);
  if (direct.length === 13 || direct.length === 10) return direct;

  // ISBN-13 com hifens/espaços no meio de outro texto
  const m13 = text.match(/97[89](?:[\s\-.]?\d){10}/);
  if (m13) return normalizeIsbn(m13[0]);

  // ISBN-10 com hifens/espaços (último caractere pode ser X)
  const m10 = text.match(/\d(?:[\s\-.]?\d){8}[\s\-.]?[\dXx]/);
  if (m10) return normalizeIsbn(m10[0]);

  return '';
}
