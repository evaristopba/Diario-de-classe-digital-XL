/**
 * Erros HTTP e helpers de resposta compartilhados entre o servidor Express (dev / AI Studio)
 * e as funções serverless da Vercel (pasta /api).
 */

export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export function toHttpError(e: unknown): { status: number; message: string } {
  if (e instanceof HttpError) return { status: e.status, message: e.message };
  const message = e instanceof Error && e.message ? e.message : 'Erro interno ao processar a requisição.';
  return { status: 500, message };
}

/** Resposta JSON no padrão Web (Request/Response) usado pelas funções da Vercel. */
export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

/**
 * O corpo de uma requisição às funções da Vercel é limitado a 4,5 MB.
 * Este é o teto para o total de caracteres base64 das fotos, deixando folga para o restante do JSON.
 */
export const MAX_BODY_BYTES = 4_200_000;
