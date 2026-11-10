/**
 * Lógica pura (sem Firebase) para decidir se duas linhas de cadastro são do MESMO aluno.
 * O RA sozinho não basta: RA digitado errado, repetido ou placeholder ("0", "00000")
 * faria notas de um aluno serem migradas para outro.
 */

/** Remove pontuação, traços e espaços e converte para minúsculas: "121.076.533-0" -> "1210765330". */
export function normalizarRA(ra?: string | null): string {
  if (!ra) return '';
  return String(ra).replace(/[^a-zA-Z0-9]/g, '').toLowerCase().trim();
}

/** RA utilizável para vincular linhas: ao menos 3 caracteres e não pode ser um único caractere repetido. */
export function raValidoParaVinculo(ra?: string | null): boolean {
  const n = normalizarRA(ra);
  if (n.length < 3) return false;
  if (/^(.)\1+$/.test(n)) return false;
  return true;
}

/** Compara dois RAs de forma normalizada. Só é verdadeiro se forem iguais E utilizáveis para vínculo. */
export function saoRAsIguais(ra1?: string | null, ra2?: string | null): boolean {
  return raValidoParaVinculo(ra1) && normalizarRA(ra1) === normalizarRA(ra2);
}

/** Minúsculas, sem acentos, só letras/números/espaços, espaços colapsados. */
export function normalizarNome(nome?: string | null): string {
  if (!nome) return '';
  return String(nome)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type IdentidadeAluno = 'confere' | 'divergente';

/**
 * Confere se duas linhas parecem ser da mesma pessoa:
 *  - mesmo nome (sem acentos/caixa), ou um nome contido no outro com 2+ palavras; OU
 *  - mesma data de nascimento.
 * Se nenhum dos dois bater, é 'divergente' e a migração automática de notas NÃO deve ocorrer.
 */
export function compararIdentidade(
  a: { name?: string | null; birthdate?: string | null },
  b: { name?: string | null; birthdate?: string | null }
): IdentidadeAluno {
  const na = normalizarNome(a.name);
  const nb = normalizarNome(b.name);
  if (na && na === nb) return 'confere';

  if (na && nb) {
    const ta = na.split(' ');
    const tb = nb.split(' ');
    const [menor, maior] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
    if (menor.length >= 2 && menor.every((t) => maior.includes(t))) return 'confere';
  }

  const da = (a.birthdate || '').trim();
  const db = (b.birthdate || '').trim();
  if (da && db && da === db) return 'confere';

  return 'divergente';
}
