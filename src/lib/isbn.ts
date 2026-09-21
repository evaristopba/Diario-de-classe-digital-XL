/**
 * Utilitários de ISBN no navegador (validação por dígito verificador).
 * Cópia equivalente de api/_lib/isbn.ts (o servidor é empacotado separadamente).
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
  return (10 - (sum % 10)) % 10 === Number(isbn[12]);
}

/** ISBN-10 ou ISBN-13 com dígito verificador correto. */
export function isValidIsbn(raw: unknown): boolean {
  const isbn = normalizeIsbn(raw);
  if (isbn.length === 10) return isValidIsbn10(isbn);
  if (isbn.length === 13) return isValidIsbn13(isbn) && /^97[89]/.test(isbn);
  return false;
}
