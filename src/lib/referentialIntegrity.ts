import { rtdb, get, ref } from './firebase';

export interface IntegrityCheckResult {
  canDelete: boolean;
  reason?: string;
  count?: number;
  details?: Record<string, any>;
}

/**
 * Verifica se um professor pode ser excluído sem violar a integridade referencial.
 * Impede a exclusão se houver turmas atribuídas a ele ou se estiver como regente.
 */
export async function checkTeacherDeleteIntegrity(
  teacherId: string,
  authUid?: string
): Promise<IntegrityCheckResult> {
  try {
    const keysToCheck = new Set<string>([teacherId]);
    if (authUid) keysToCheck.add(authUid);

    // 1. Checar atribuições
    const atribsSnap = await get(ref(rtdb, 'diario-classe/atribuicoes'));
    const atribsVal = (atribsSnap.val() || {}) as Record<string, Record<string, boolean>>;

    const linkedClassIds = new Set<string>();
    keysToCheck.forEach((k) => {
      const teacherAtribs = atribsVal[k] || {};
      Object.keys(teacherAtribs).forEach((cid) => {
        if (teacherAtribs[cid]) {
          linkedClassIds.add(cid);
        }
      });
    });

    // 2. Checar turmas onde o professor é regente direto
    const turmasSnap = await get(ref(rtdb, 'diario-classe/turmas'));
    const turmasVal = (turmasSnap.val() || {}) as Record<string, any>;
    const linkedClassNames: string[] = [];

    Object.keys(turmasVal).forEach((cid) => {
      const t = turmasVal[cid];
      if (!t) return;
      const isRegente = t.teacherId && keysToCheck.has(t.teacherId);
      const isAtribuida = linkedClassIds.has(cid);

      if (isRegente || isAtribuida) {
        linkedClassIds.add(cid);
        const name = `${t.year || ''} ${t.letter || ''} - ${t.schoolName || 'Escola'}`.trim();
        if (name && !linkedClassNames.includes(name)) {
          linkedClassNames.push(name);
        }
      }
    });

    if (linkedClassIds.size > 0) {
      return {
        canDelete: false,
        count: linkedClassIds.size,
        reason: `Este(a) professor(a) possui ${linkedClassIds.size} turma(s) vinculada(s) ou atribuída(s) (${linkedClassNames.slice(0, 3).join(', ')}${linkedClassNames.length > 3 ? '...' : ''}). Desvincule ou reatribua as turmas antes de remover o cadastro.`,
        details: { linkedClassIds: Array.from(linkedClassIds), linkedClassNames }
      };
    }

    return { canDelete: true };
  } catch (err: any) {
    console.error('Erro na checagem de integridade do professor:', err);
    // Em caso de dúvida/falha de rede, bloqueia com cautela
    return {
      canDelete: false,
      reason: 'Não foi possível validar as vinculações do professor no momento. Tente novamente.'
    };
  }
}

/**
 * Verifica se um aluno pode ser excluído sem quebrar o histórico escolar.
 * Impede a exclusão se houver chamadas, notas ou ocorrências registradas para ele.
 */
export async function checkStudentDeleteIntegrity(
  classId: string,
  studentId: string
): Promise<IntegrityCheckResult> {
  try {
    let chamadasCount = 0;
    let notasCount = 0;
    let eventosCount = 0;

    // Varre o nó de dados diários de todos os usuários ou do usuário logado
    const dadosSnap = await get(ref(rtdb, 'diario-classe/dados'));
    if (dadosSnap.exists()) {
      const dadosVal = dadosSnap.val() || {};
      Object.keys(dadosVal).forEach((userUid) => {
        const uData = dadosVal[userUid] || {};

        // 1. Checar Chamadas
        const chamadas = uData.chamada || {};
        Object.keys(chamadas).forEach((chId) => {
          const ch = chamadas[chId];
          if (ch && ch.studentId === studentId) {
            chamadasCount++;
          }
        });

        // 2. Checar Notas
        const notas = uData.notas || {};
        Object.keys(notas).forEach((nId) => {
          const n = notas[nId];
          if (n && n.studentId === studentId) {
            notasCount++;
          }
        });

        // 3. Checar Ocorrências
        const eventos = uData.eventos || {};
        Object.keys(eventos).forEach((evId) => {
          const ev = eventos[evId];
          if (ev && ev.studentId === studentId) {
            eventosCount++;
          }
        });
      });
    }

    const totalRegistros = chamadasCount + notasCount + eventosCount;

    if (totalRegistros > 0) {
      const parts: string[] = [];
      if (chamadasCount > 0) parts.push(`${chamadasCount} registro(s) de chamada`);
      if (notasCount > 0) parts.push(`${notasCount} nota(s) lançada(s)`);
      if (eventosCount > 0) parts.push(`${eventosCount} ocorrência(s)`);

      return {
        canDelete: false,
        count: totalRegistros,
        reason: `O aluno possui ${totalRegistros} registro(s) no sistema (${parts.join(', ')}). Para preservar a integridade do histórico acadêmico e dos relatórios, altere a situação do aluno para 'Transferido' ou 'Inativo' em vez de excluí-lo.`,
        details: { chamadasCount, notasCount, eventosCount, totalRegistros }
      };
    }

    return { canDelete: true };
  } catch (err: any) {
    console.error('Erro na checagem de integridade do aluno:', err);
    return {
      canDelete: false,
      reason: 'Não foi possível validar os registros acadêmicos do aluno no momento.'
    };
  }
}

/**
 * Verifica se uma turma pode ser excluída.
 * Impede se houver alunos, registros de diário ou atribuições ativas.
 */
export async function checkClassDeleteIntegrity(
  classId: string
): Promise<IntegrityCheckResult> {
  try {
    // 1. Checar alunos
    const alunosSnap = await get(ref(rtdb, `diario-classe/turmas/${classId}/alunos`));
    const numAlunos = alunosSnap.exists() ? Object.keys(alunosSnap.val() || {}).length : 0;

    if (numAlunos > 0) {
      return {
        canDelete: false,
        count: numAlunos,
        reason: `A turma possui ${numAlunos} aluno(s) cadastrado(s). Remova ou transfira os alunos antes de excluir a turma.`
      };
    }

    // 2. Checar atribuições
    const atribsSnap = await get(ref(rtdb, 'diario-classe/atribuicoes'));
    let atribsCount = 0;
    if (atribsSnap.exists()) {
      const atribsVal = atribsSnap.val() || {};
      Object.keys(atribsVal).forEach((profUid) => {
        if (atribsVal[profUid] && atribsVal[profUid][classId]) {
          atribsCount++;
        }
      });
    }

    if (atribsCount > 0) {
      return {
        canDelete: false,
        count: atribsCount,
        reason: `A turma está atribuída a ${atribsCount} professor(es). Desvincule a turma nas atribuições antes de excluí-la.`
      };
    }

    // 3. Checar se existem chamadas, notas ou planos de aula vinculados à turma
    let recordsCount = 0;
    const dadosSnap = await get(ref(rtdb, 'diario-classe/dados'));
    if (dadosSnap.exists()) {
      const dadosVal = dadosSnap.val() || {};
      Object.keys(dadosVal).forEach((uid) => {
        const u = dadosVal[uid] || {};
        ['chamada', 'notas', 'planos-aula', 'eventos'].forEach((node) => {
          const items = u[node] || {};
          Object.keys(items).forEach((k) => {
            if (items[k] && items[k].classId === classId) {
              recordsCount++;
            }
          });
        });
      });
    }

    if (recordsCount > 0) {
      return {
        canDelete: false,
        count: recordsCount,
        reason: `A turma possui ${recordsCount} registro(s) de diário (chamadas, notas ou planos de aula). Não é possível excluí-la sem perder o histórico do diário.`
      };
    }

    return { canDelete: true };
  } catch (err: any) {
    console.error('Erro na checagem de integridade da turma:', err);
    return {
      canDelete: false,
      reason: 'Não foi possível validar as vinculações da turma no momento.'
    };
  }
}

/**
 * Verifica se uma escola pode ser excluída.
 * Impede se houver turmas cadastradas na base global vinculadas a ela.
 */
export async function checkSchoolDeleteIntegrity(
  schoolId: string
): Promise<IntegrityCheckResult> {
  try {
    const turmasSnap = await get(ref(rtdb, 'diario-classe/turmas'));
    if (turmasSnap.exists()) {
      const turmasVal = turmasSnap.val() || {};
      const linkedTurmas = Object.keys(turmasVal).filter(
        (k) => turmasVal[k] && turmasVal[k].schoolId === schoolId
      );

      if (linkedTurmas.length > 0) {
        return {
          canDelete: false,
          count: linkedTurmas.length,
          reason: `A escola possui ${linkedTurmas.length} turma(s) vinculada(s). Exclua ou desvincule as turmas antes de remover a escola.`
        };
      }
    }

    return { canDelete: true };
  } catch (err: any) {
    console.error('Erro na checagem de integridade da escola:', err);
    return {
      canDelete: false,
      reason: 'Não foi possível validar as vinculações da escola no momento.'
    };
  }
}

/**
 * Verifica se uma disciplina pode ser excluída.
 * Impede se houver planos de aula ou notas associadas a ela.
 */
export async function checkSubjectDeleteIntegrity(
  subjectId: string,
  subjectName: string
): Promise<IntegrityCheckResult> {
  try {
    let inUseCount = 0;
    const dadosSnap = await get(ref(rtdb, 'diario-classe/dados'));
    if (dadosSnap.exists()) {
      const dadosVal = dadosSnap.val() || {};
      Object.keys(dadosVal).forEach((uid) => {
        const u = dadosVal[uid] || {};
        const planos = u['planos-aula'] || {};
        Object.keys(planos).forEach((k) => {
          const p = planos[k];
          if (p && (p.subjectId === subjectId || p.subject === subjectName)) {
            inUseCount++;
          }
        });
      });
    }

    if (inUseCount > 0) {
      return {
        canDelete: false,
        count: inUseCount,
        reason: `A disciplina "${subjectName}" possui ${inUseCount} plano(s) de aula registrado(s). Remova os registros antes de excluí-la.`
      };
    }

    return { canDelete: true };
  } catch (err: any) {
    console.error('Erro na checagem de integridade da disciplina:', err);
    return { canDelete: true };
  }
}

/**
 * Verifica se uma habilidade da BNCC pode ser excluída.
 * Impede a exclusão se houver algum plano de aula ativo utilizando o código ou id da BNCC.
 */
export async function checkBnccDeleteIntegrity(
  bnccId: string,
  bnccCode?: string
): Promise<IntegrityCheckResult> {
  try {
    let inUseCount = 0;
    const targetKeys = new Set<string>([bnccId]);
    if (bnccCode) {
      targetKeys.add(bnccCode.trim().toUpperCase());
    }

    const dadosSnap = await get(ref(rtdb, 'diario-classe/dados'));
    if (dadosSnap.exists()) {
      const dadosVal = dadosSnap.val() || {};
      Object.keys(dadosVal).forEach((uid) => {
        const u = dadosVal[uid] || {};
        const planos = u['planos-aula'] || {};
        Object.keys(planos).forEach((k) => {
          const p = planos[k];
          if (!p) return;

          let matched = false;

          // Checagem por bnccId único
          if (p.bnccId && targetKeys.has(p.bnccId)) {
            matched = true;
          }

          // Checagem pelo código direto se armazenado
          if (p.bnccCode && targetKeys.has(p.bnccCode.trim().toUpperCase())) {
            matched = true;
          }

          // Checagem por array bnccCodes / bnccIds caso múltiplos
          if (Array.isArray(p.bnccCodes)) {
            if (p.bnccCodes.some((c: string) => targetKeys.has(String(c).trim().toUpperCase()))) {
              matched = true;
            }
          }
          if (Array.isArray(p.bnccIds)) {
            if (p.bnccIds.some((id: string) => targetKeys.has(id))) {
              matched = true;
            }
          }

          if (matched) {
            inUseCount++;
          }
        });
      });
    }

    if (inUseCount > 0) {
      const label = bnccCode ? ` "${bnccCode}"` : '';
      return {
        canDelete: false,
        count: inUseCount,
        reason: `A habilidade da BNCC${label} está vinculada a ${inUseCount} plano(s) de aula registrado(s). Por integridade do histórico pedagógico, não é permitido excluí-la enquanto houver planos de aula associados.`
      };
    }

    return { canDelete: true };
  } catch (err: any) {
    console.error('Erro na checagem de integridade da BNCC:', err);
    return {
      canDelete: false,
      reason: 'Não foi possível validar os vínculos da habilidade BNCC no momento.'
    };
  }
}

/**
 * Verifica se uma categoria pode ser excluída.
 * Impede a exclusão se houver algum plano de aula ativo utilizando a categoria.
 */
export async function checkCategoryDeleteIntegrity(
  categoryId: string,
  categoryName?: string
): Promise<IntegrityCheckResult> {
  try {
    let inUseCount = 0;
    const dadosSnap = await get(ref(rtdb, 'diario-classe/dados'));
    if (dadosSnap.exists()) {
      const dadosVal = dadosSnap.val() || {};
      Object.keys(dadosVal).forEach((uid) => {
        const u = dadosVal[uid] || {};
        const planos = u['planos-aula'] || {};
        Object.keys(planos).forEach((k) => {
          const p = planos[k];
          if (!p) return;
          if (p.categoryId === categoryId || (categoryName && p.categoryName === categoryName)) {
            inUseCount++;
          }
        });
      });
    }

    if (inUseCount > 0) {
      const label = categoryName ? ` "${categoryName}"` : '';
      return {
        canDelete: false,
        count: inUseCount,
        reason: `A categoria${label} está vinculada a ${inUseCount} plano(s) de aula registrado(s). Por integridade do histórico pedagógico, não é permitido excluí-la enquanto houver planos de aula associados.`
      };
    }

    return { canDelete: true };
  } catch (err: any) {
    console.error('Erro na checagem de integridade da categoria:', err);
    return {
      canDelete: false,
      reason: 'Não foi possível validar os vínculos da categoria no momento.'
    };
  }
}

/**
 * Valida se um livro do acervo da biblioteca pode ser excluído.
 * Bloqueia caso existam empréstimos ativos pendentes de devolução.
 */
export async function checkBookDeleteIntegrity(
  bookId: string,
  bookTitle?: string
): Promise<IntegrityCheckResult> {
  try {
    const loansSnap = await get(ref(rtdb, 'diario-classe/biblioteca/emprestimos'));
    if (!loansSnap.exists()) {
      return { canDelete: true };
    }

    const loans = loansSnap.val() || {};
    let activeLoansCount = 0;
    const activeStudentNames: string[] = [];

    Object.keys(loans).forEach((id) => {
      const loan = loans[id];
      if (loan?.bookId === bookId && (loan.status === 'ativo' || loan.status === 'atrasado')) {
        activeLoansCount++;
        if (loan.studentName && !activeStudentNames.includes(loan.studentName)) {
          activeStudentNames.push(loan.studentName);
        }
      }
    });

    if (activeLoansCount > 0) {
      const titleLabel = bookTitle ? ` "${bookTitle}"` : '';
      return {
        canDelete: false,
        count: activeLoansCount,
        reason: `O livro${titleLabel} possui ${activeLoansCount} empréstimo(s) em aberto com aluno(s) (${activeStudentNames.slice(0, 3).join(', ')}${activeStudentNames.length > 3 ? '...' : ''}). Registre a devolução antes de excluir o livro do acervo.`
      };
    }

    return { canDelete: true };
  } catch (err: any) {
    console.error('Erro ao verificar integridade do livro:', err);
    return {
      canDelete: false,
      reason: 'Não foi possível validar a situação dos empréstimos deste livro no momento.'
    };
  }
}

