/**
 * Operações PURAS (sem Firebase) sobre a grade de horários de uma turma
 * (`turmas/{id}/gradeHoraria/{dia}_{ordem}`).
 *
 * Cada operação devolve:
 *  - `updates`: gravações por HORÁRIO (`gradeHoraria/1_3`), prontas para `update(ref(turma), updates)`.
 *    Só os horários alterados são enviados, então duas edições simultâneas na mesma turma
 *    não apagam uma à outra (antes a grade inteira era regravada a partir da cópia da tela).
 *  - `novaGrade`: a grade resultante, para atualizar a tela.
 */

type Grade = Record<string, any>;

/**
 * O Realtime Database rejeita `undefined` e é inútil guardar texto vazio.
 * Remove esses campos antes de gravar o horário.
 */
export function limparSlot<T extends Record<string, any>>(slot: T): T {
  const limpo: Record<string, any> = {};
  Object.keys(slot).forEach((k) => {
    const v = slot[k];
    if (v === undefined || v === null) return;
    if (typeof v === 'string' && v.trim() === '') return;
    limpo[k] = v;
  });
  return limpo as T;
}

const chave = (dia: number, ordem: number) => `${dia}_${ordem}`;

/** Define a aula de um horário (e, opcionalmente, o bloco dobrado na aula seguinte, ou anterior se for a 5ª). */
export function definirAula(
  grade: Grade,
  dia: number,
  ordem: number,
  slot: Record<string, any>,
  dobrar: boolean
): { updates: Record<string, any>; novaGrade: Grade } {
  const limpo = limparSlot(slot);
  const updates: Record<string, any> = { [`gradeHoraria/${chave(dia, ordem)}`]: limpo };
  const novaGrade: Grade = { ...grade, [chave(dia, ordem)]: limpo };

  if (dobrar) {
    const proxima = ordem < 5 ? ordem + 1 : ordem - 1;
    if (proxima >= 1 && proxima <= 5) {
      updates[`gradeHoraria/${chave(dia, proxima)}`] = { ...limpo };
      novaGrade[chave(dia, proxima)] = { ...limpo };
    }
  }
  return { updates, novaGrade };
}

/** Remove a aula de um horário. */
export function removerAula(
  grade: Grade,
  dia: number,
  ordem: number
): { updates: Record<string, any>; novaGrade: Grade } {
  const novaGrade: Grade = { ...grade };
  delete novaGrade[chave(dia, ordem)];
  return { updates: { [`gradeHoraria/${chave(dia, ordem)}`]: null }, novaGrade };
}

/**
 * Sobe/desce uma aula (ordemDestino = ordemAtual -/+ 1) com permuta automática quando o horário
 * de destino já tem aula. Registra a observação ("Aula adiantada...", "Permutada com...").
 * Devolve null se não há aula no horário de origem.
 */
export function trocarAulas(
  grade: Grade,
  dia: number,
  ordemAtual: number,
  ordemDestino: number,
  direcao: 'up' | 'down'
): { updates: Record<string, any>; novaGrade: Grade; alvo: Record<string, any> | undefined } | null {
  const chaveAtual = chave(dia, ordemAtual);
  const chaveAlvo = chave(dia, ordemDestino);
  const atual = grade[chaveAtual];
  if (!atual) return null;
  const alvo = grade[chaveAlvo];

  const novaGrade: Grade = { ...grade };
  const slotNoDestino = limparSlot({
    ...atual,
    observacao:
      atual.observacao ||
      (direcao === 'up'
        ? `Aula adiantada (${ordemAtual}ª ➔ ${ordemDestino}ª)`
        : `Aula remanejada (${ordemAtual}ª ➔ ${ordemDestino}ª)`)
  });
  novaGrade[chaveAlvo] = slotNoDestino;
  const updates: Record<string, any> = { [`gradeHoraria/${chaveAlvo}`]: slotNoDestino };

  if (alvo) {
    const slotNaOrigem = limparSlot({
      ...alvo,
      observacao: alvo.observacao || `Permutada com ${atual.disciplinaNome}`
    });
    novaGrade[chaveAtual] = slotNaOrigem;
    updates[`gradeHoraria/${chaveAtual}`] = slotNaOrigem;
  } else {
    delete novaGrade[chaveAtual];
    updates[`gradeHoraria/${chaveAtual}`] = null;
  }
  return { updates, novaGrade, alvo };
}
