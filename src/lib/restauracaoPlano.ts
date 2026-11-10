/**
 * Planejamento PURO (sem Firebase) da restauração de backup.
 *
 * Regras que valem para todos os modos:
 *  - Nada é apagado: registro que existe no banco e não está no backup permanece.
 *  - A gravação é sempre registro a registro (`.../{id}`), nunca troca um nó inteiro
 *    (uma turma inteira, o nó inteiro de um professor, o mapa inteiro de atribuições).
 *  - Registro idêntico ao do banco não é regravado.
 *
 * Modos:
 *  - 'merge' (Mesclar): cria o que falta. Em registro existente e diferente, só atualiza se o do
 *    backup for comprovadamente MAIS RECENTE (updatedAt/createdAt). Sem como comparar, mantém o do banco.
 *  - 'overwrite_selected' (Substituição): nos módulos marcados, grava a versão do backup por cima de
 *    cada registro de mesmo ID, mesmo que o do banco seja mais recente (isso é contado e informado).
 */

export type ModoRestauracao = 'merge' | 'overwrite_selected';

export interface EstatisticaGrupo {
  novos: number;
  atualizados: number;
  mantidos: number;
  /** Registros do banco que eram mais recentes que o backup e serão sobrescritos (só no modo Substituição). */
  maisRecentesSobrescritos: number;
  /**
   * Modo Mesclar: registros que DIFEREM do banco mas foram mantidos porque não há data nos dois
   * lados para decidir qual é o mais novo (escolas, disciplinas, notas, chamadas... costumam não ter
   * `updatedAt`). Para aplicá-los é preciso o modo Substituição.
   */
  mantidosSemData: number;
  /** Modo Mesclar: registros que diferem, mas o do banco é igual ou mais recente que o do backup. */
  mantidosBancoMaisNovo: number;
}

export function novaEstatistica(): EstatisticaGrupo {
  return { novos: 0, atualizados: 0, mantidos: 0, maisRecentesSobrescritos: 0, mantidosSemData: 0, mantidosBancoMaisNovo: 0 };
}

/** Comparação profunda tolerante: null/undefined são ignorados; arrays e objetos são comparados por chave. */
export function igualProfundo(a: any, b: any): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  const ka = Object.keys(a).filter((k) => a[k] !== undefined && a[k] !== null);
  const kb = Object.keys(b).filter((k) => b[k] !== undefined && b[k] !== null);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => igualProfundo(a[k], b[k]));
}

/** Data de criação/edição de um registro (ms), ou null se não houver como saber. */
export function carimboDoRegistro(r: any): number | null {
  if (!r || typeof r !== 'object') return null;
  for (const campo of ['updatedAt', 'createdAt', 'timestamp']) {
    const n = Number(r[campo]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

interface ParamsRegistros {
  /** Caminho completo até o nó que contém os registros, sem barra final. */
  basePath: string;
  backup: Record<string, any> | null | undefined;
  atual: Record<string, any> | null | undefined;
  modo: ModoRestauracao;
  updates: Record<string, any>;
  stats: EstatisticaGrupo;
  /** Momento da exportação do backup (ms): referência para dizer se o registro do banco é mais novo. */
  referenciaBackup?: number;
}

export function planejarRegistros(p: ParamsRegistros): void {
  const backup = p.backup || {};
  const atual = p.atual || {};
  Object.keys(backup).forEach((id) => {
    const novo = backup[id];
    if (novo === null || novo === undefined) return;
    const existente = atual[id];
    const caminho = `${p.basePath}/${id}`;

    if (existente === null || existente === undefined) {
      p.updates[caminho] = novo;
      p.stats.novos++;
      return;
    }
    if (igualProfundo(novo, existente)) {
      p.stats.mantidos++;
      return;
    }

    const tNovo = carimboDoRegistro(novo);
    const tAtual = carimboDoRegistro(existente);

    if (p.modo === 'overwrite_selected') {
      p.updates[caminho] = novo;
      p.stats.atualizados++;
      const tComparavel = tNovo ?? p.referenciaBackup ?? null;
      if (tAtual !== null && tComparavel !== null && tAtual > tComparavel) {
        p.stats.maisRecentesSobrescritos++;
      }
      return;
    }

    // Mesclar: só atualiza com prova de que o backup é mais recente
    if (tNovo !== null && tAtual !== null) {
      if (tNovo > tAtual) {
        p.updates[caminho] = novo;
        p.stats.atualizados++;
      } else {
        p.stats.mantidos++;
        p.stats.mantidosBancoMaisNovo++;
      }
    } else {
      // Sem data nos dois lados: não há como saber qual é o mais novo, então mantém o do banco
      p.stats.mantidos++;
      p.stats.mantidosSemData++;
    }
  });
}

interface ParamsTurmas {
  backup: Record<string, any> | null | undefined;
  atuais: Record<string, any> | null | undefined;
  modo: ModoRestauracao;
  updates: Record<string, any>;
  statsTurmas: EstatisticaGrupo;
  statsAlunos: EstatisticaGrupo;
  /** Grade de horários (turmas/{id}/gradeHoraria/{dia}_{ordem}); opcional. */
  statsGrade?: EstatisticaGrupo;
  referenciaBackup?: number;
}

/**
 * Turmas, alunos e grade de horários. NUNCA grava `turmas/{id}` inteiro: isso apagaria alunos
 * cadastrados, alterados ou transferidos depois do backup. Metadados vão campo a campo, cada aluno
 * vai no seu próprio caminho `turmas/{id}/alunos/{alunoId}` e cada horário da grade em
 * `turmas/{id}/gradeHoraria/{dia}_{ordem}` (a grade inteira nunca é trocada de uma vez).
 */
export function planejarTurmas(p: ParamsTurmas): void {
  const backup = p.backup || {};
  const atuais = p.atuais || {};
  Object.keys(backup).forEach((turmaId) => {
    const turma = backup[turmaId];
    if (!turma) return;
    const { alunos, gradeHoraria, ...meta } = turma;
    const atualTurma = atuais[turmaId];
    const base = `diario-classe/turmas/${turmaId}`;

    if (!atualTurma) {
      // Turma nova: metadados primeiro (a regra do banco exige year/letter/shift/schoolId/schoolName)
      Object.keys(meta).forEach((campo) => {
        if (meta[campo] !== null && meta[campo] !== undefined) p.updates[`${base}/${campo}`] = meta[campo];
      });
      p.statsTurmas.novos++;
    } else {
      const { alunos: _ignorado, gradeHoraria: _grade, ...metaAtual } = atualTurma;
      let mudou = false;
      let diferenteMantido = false;
      Object.keys(meta).forEach((campo) => {
        const valor = meta[campo];
        if (valor === null || valor === undefined) return;
        const atualValor = (metaAtual as any)[campo];
        if (atualValor === null || atualValor === undefined) {
          // Campo ausente no banco: preenche em qualquer modo
          p.updates[`${base}/${campo}`] = valor;
          mudou = true;
        } else if (!igualProfundo(valor, atualValor)) {
          if (p.modo === 'overwrite_selected') {
            p.updates[`${base}/${campo}`] = valor;
            mudou = true;
          } else {
            diferenteMantido = true; // campo da turma não tem data própria: o do banco é mantido
          }
        }
      });
      if (mudou) p.statsTurmas.atualizados++;
      else {
        p.statsTurmas.mantidos++;
        if (diferenteMantido) p.statsTurmas.mantidosSemData++;
      }
    }

    planejarRegistros({
      basePath: `${base}/alunos`,
      backup: alunos,
      atual: atualTurma ? atualTurma.alunos : undefined,
      modo: p.modo,
      updates: p.updates,
      stats: p.statsAlunos,
      referenciaBackup: p.referenciaBackup
    });

    planejarRegistros({
      basePath: `${base}/gradeHoraria`,
      backup: gradeHoraria,
      atual: atualTurma ? atualTurma.gradeHoraria : undefined,
      modo: p.modo,
      updates: p.updates,
      stats: p.statsGrade ?? novaEstatistica(),
      referenciaBackup: p.referenciaBackup
    });
  });
}

export type NoUsuario = 'chamada' | 'notas' | 'planos-aula' | 'eventos' | 'bncc' | 'categorias' | 'tipos-evento';
export type DadosPorUsuario = Record<string, Partial<Record<NoUsuario, Record<string, any>>>>;

/**
 * Separa os dados pedagógicos do backup POR USUÁRIO DONO.
 *  - `allUsersPedagogical` já vem por uid.
 *  - As listas do topo (attendances, grades, ...) são do usuário que EXPORTOU o backup, e não
 *    necessariamente de quem está restaurando. Quem exportou é `exportedByUid`.
 */
export function extrairDadosPorUsuario(
  data: {
    allUsersPedagogical?: Record<string, any> | null;
    attendances?: Record<string, any> | null;
    grades?: Record<string, any> | null;
    lessonPlans?: Record<string, any> | null;
    events?: Record<string, any> | null;
    /** BNCC, categorias e tipos de ocorrência guardados no nó pessoal de quem exportou. */
    ownUserExtras?: { bncc?: any; categorias?: any; 'tipos-evento'?: any } | null;
  },
  donoDasListasDoTopo: string
): DadosPorUsuario {
  const resultado: DadosPorUsuario = {};
  const todos = data.allUsersPedagogical || {};
  Object.keys(todos).forEach((uid) => {
    const u = todos[uid] || {};
    resultado[uid] = {
      chamada: u.chamada,
      notas: u.notas,
      'planos-aula': u['planos-aula'] || u.planos,
      eventos: u.eventos,
      bncc: u.bncc,
      categorias: u.categorias,
      'tipos-evento': u['tipos-evento']
    };
  });

  const topo: Partial<Record<NoUsuario, Record<string, any> | null | undefined>> = {
    chamada: data.attendances,
    notas: data.grades,
    'planos-aula': data.lessonPlans,
    eventos: data.events,
    bncc: data.ownUserExtras?.bncc,
    categorias: data.ownUserExtras?.categorias,
    'tipos-evento': data.ownUserExtras?.['tipos-evento']
  };
  const temTopo = Object.values(topo).some((v) => v && Object.keys(v).length > 0);
  if (temTopo) {
    if (!resultado[donoDasListasDoTopo]) resultado[donoDasListasDoTopo] = {};
    const alvo = resultado[donoDasListasDoTopo];
    (Object.keys(topo) as NoUsuario[]).forEach((no) => {
      const lista = topo[no];
      if (lista && Object.keys(lista).length > 0 && !alvo[no]) alvo[no] = lista;
    });
  }
  return resultado;
}

/** Divide um conjunto de gravações em lotes, preservando a ordem de inserção (metadados de turma primeiro). */
export function dividirEmLotes(updates: Record<string, any>, tamanho = 800): Record<string, any>[] {
  const chaves = Object.keys(updates);
  const lotes: Record<string, any>[] = [];
  for (let i = 0; i < chaves.length; i += tamanho) {
    const lote: Record<string, any> = {};
    chaves.slice(i, i + tamanho).forEach((k) => {
      lote[k] = updates[k];
    });
    lotes.push(lote);
  }
  return lotes;
}
