/**
 * Lógica pura (sem dependência de Firebase) para:
 *  1. Mesclar as notas guardadas em nós de usuários diferentes (diario-classe/dados/{uid}/notas),
 *     de modo que o administrador enxergue as notas lançadas por todos os professores.
 *  2. Decidir se uma nota de origem deve ou não ser gravada na linha de destino
 *     (desempate + idempotência da transposição de notas).
 */

export interface NotasAgregadas {
  /** Mapa chave da nota -> registro da nota que deve ser exibido. */
  notas: Record<string, any>;
  /**
   * Chave da nota -> uid do nó cuja versão está sendo exibida.
   * Vence a versão de maior createdAt; em caso de empate, vence a do usuário atual.
   */
  vencedor: Record<string, string>;
  /**
   * Chave da nota -> uids de TODOS os nós que guardam essa chave.
   * Usado na exclusão, para não deixar uma cópia "fantasma" em outro nó.
   */
  donos: Record<string, string[]>;
  /**
   * true quando só foi possível verificar o próprio nó do usuário (não administrador)
   * ou quando a leitura de algum nó de outro usuário falhou.
   */
  parcial?: boolean;
}

export function mesclarNotasDeUsuarios(
  porUsuario: Record<string, Record<string, any> | null | undefined>,
  currentUid: string
): NotasAgregadas {
  const resultado: NotasAgregadas = { notas: {}, vencedor: {}, donos: {} };

  // Usuário atual primeiro (vence empates); demais em ordem estável por uid.
  const uids = Object.keys(porUsuario)
    .filter((u) => u !== currentUid)
    .sort();
  if (porUsuario[currentUid]) uids.unshift(currentUid);

  uids.forEach((uid) => {
    const notas = porUsuario[uid] || {};
    Object.keys(notas).forEach((key) => {
      const g = notas[key];
      if (!g || typeof g !== 'object') return;

      if (!resultado.donos[key]) resultado.donos[key] = [];
      resultado.donos[key].push(uid);

      const atual = resultado.notas[key];
      if (!atual || (Number(g.createdAt) || 0) > (Number(atual.createdAt) || 0)) {
        resultado.notas[key] = g;
        resultado.vencedor[key] = uid;
      }
    });
  });

  return resultado;
}

export type DecisaoNotaOrigem = 'gravar' | 'pular';

/**
 * Decide se uma nota vinda da linha de origem deve ser gravada na linha de destino.
 *  - Sem nota no destino: grava.
 *  - Nota DIRETA no destino (lançada pelo professor do destino): nunca é sobrescrita.
 *  - Destino já tem cópia de origem e a nova também é de origem: mantém o destino.
 *  - Destino tem cópia de origem e a nova é DIRETA: grava apenas se o valor mudou
 *    (correção feita depois na origem). Com o mesmo valor, pula: evita regravar a cada
 *    abertura da tela e evita contar como "nota transposta" algo que não mudou.
 */
export function decidirGravacaoNotaOrigem(
  destino: { value: number; isOrigem: boolean } | undefined,
  item: { valNum: number; isOrigem: boolean }
): DecisaoNotaOrigem {
  if (!destino) return 'gravar';
  if (!destino.isOrigem) return 'pular';
  if (item.isOrigem) return 'pular';
  if (Number(destino.value) === Number(item.valNum)) return 'pular';
  return 'gravar';
}

/** Nota de uma linha de origem, já lida e validada, pronta para ser consolidada. */
export interface NotaOrigemColetada {
  bim: string;
  sub: string;
  valNum: number;
  teacher: string;
  ano: string;
  uId: string;
  isOrigem: boolean;
  /** Posição da linha de origem na cadeia (0 = mais antiga). Maior = mais recente. */
  sourceOrder: number;
  /** Data de gravação da nota, só para desempate entre a mesma nota guardada em dois nós. */
  criadoEm?: number;
}

/**
 * Reduz as notas de VÁRIAS linhas de origem a uma por disciplina e bimestre:
 *  1. Nota lançada direto vence cópia de origem.
 *  2. Entre notas do mesmo tipo, vence a da linha mais recente.
 *  3. Na mesma linha (mesma nota em dois nós), vence a gravada por último.
 * O resultado não depende da ordem em que as notas foram lidas.
 */
export function consolidarNotasDeOrigem<T extends NotaOrigemColetada>(lista: T[]): T[] {
  const mapa: Record<string, T> = {};
  for (const n of lista) {
    const k = `${n.bim}_${n.sub}`;
    const atual = mapa[k];
    if (!atual) {
      mapa[k] = n;
      continue;
    }
    if (!n.isOrigem && atual.isOrigem) {
      mapa[k] = n;
      continue;
    }
    if (n.isOrigem && !atual.isOrigem) continue;
    if (n.sourceOrder > atual.sourceOrder) {
      mapa[k] = n;
      continue;
    }
    if (n.sourceOrder === atual.sourceOrder && (n.criadoEm || 0) > (atual.criadoEm || 0)) {
      mapa[k] = n;
    }
  }
  return Object.values(mapa);
}
