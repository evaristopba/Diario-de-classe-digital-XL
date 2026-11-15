/**
 * Regras PURAS (sem Firebase/React) da Hora-Atividade (H.A.).
 *
 * A H.A. é registrada por professor, em blocos com dia e horário reais (HH:MM), e não presa à
 * numeração das aulas: especialistas atuam em várias escolas e turnos, cada um com seu sino.
 */

export type NivelConflito = 'erro' | 'aviso' | 'info';

export interface ConflitoHA {
  nivel: NivelConflito;
  codigo: 'ha_sobreposta' | 'aula_sobreposta' | 'natural_regente' | 'dia_indisponivel';
  mensagem: string;
}

/** Uma aula do professor num dia, já convertida para minutos desde 00:00. */
export interface AulaDoProfessor {
  dia: number;
  startMin: number;
  endMin: number;
  /**
   * 'especialista': aula que o professor ministra como especialista;
   * 'regencia': aula de regência na turma dele;
   * 'aula_de_especialista_na_turma': a turma do regente está com um especialista (H.A. natural do regente).
   */
  natureza: 'especialista' | 'regencia' | 'aula_de_especialista_na_turma';
  rotulo: string;
}

export interface BlocoHA {
  chave: string;
  dia: number;
  inicio: string;
  fim: string;
}

const NOMES_DIA = ['', 'segunda', 'terça', 'quarta', 'quinta', 'sexta'];
const HORA_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function minutosDe(hhmm?: string): number | null {
  if (!hhmm || !HORA_RE.test(hhmm)) return null;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function formatarMinutos(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}min`;
  return m === 0 ? `${h}h` : `${h}h ${m}min`;
}

/** Chave do bloco: dia + hora de início sem os dois pontos (ex.: "2_0930"). */
export function chaveHA(dia: number, inicio: string): string {
  return `${dia}_${inicio.replace(':', '')}`;
}

export function sobrepoe(aIni: number, aFim: number, bIni: number, bFim: number): boolean {
  return aIni < bFim && bIni < aFim;
}

/** Valida um bloco de H.A. Devolve a mensagem de erro, ou null se estiver válido. */
export function validarHA(e: { dia: number; inicio: string; fim: string; observacao?: string }): string | null {
  if (!Number.isInteger(e.dia) || e.dia < 1 || e.dia > 5) return 'Escolha um dia de segunda a sexta.';
  const ini = minutosDe(e.inicio);
  const fim = minutosDe(e.fim);
  if (ini === null || fim === null) return 'Informe o horário de início e de término no formato HH:MM.';
  if (fim <= ini) return 'O término precisa ser depois do início.';
  if (fim - ini < 10) return 'A H.A. precisa ter pelo menos 10 minutos.';
  if (fim - ini > 480) return 'A H.A. não pode passar de 8 horas em um mesmo bloco.';
  if ((e.observacao || '').length > 200) return 'A observação pode ter no máximo 200 caracteres.';
  return null;
}

/**
 * Confere um bloco de H.A. contra as outras H.A. do mesmo professor, as aulas dele e os dias em que atua.
 *  - erro  : H.A. sobreposta a outra H.A. do mesmo professor (bloqueia o salvamento).
 *  - aviso : cai sobre aula do professor (especialista ou regência) ou em dia em que ele não atua.
 *  - info  : regente com H.A. durante aula de especialista na própria turma (H.A. "natural").
 */
export function detectarConflitosHA(
  novo: { dia: number; inicio: string; fim: string },
  contexto: { outrasHA: BlocoHA[]; aulas: AulaDoProfessor[]; diasDisponiveis?: number[] }
): ConflitoHA[] {
  const ini = minutosDe(novo.inicio);
  const fim = minutosDe(novo.fim);
  if (ini === null || fim === null || fim <= ini) return [];
  const conflitos: ConflitoHA[] = [];
  const dia = NOMES_DIA[novo.dia] || `dia ${novo.dia}`;

  contexto.outrasHA
    .filter((o) => o.dia === novo.dia)
    .forEach((o) => {
      const oi = minutosDe(o.inicio);
      const of = minutosDe(o.fim);
      if (oi !== null && of !== null && sobrepoe(ini, fim, oi, of)) {
        conflitos.push({
          nivel: 'erro',
          codigo: 'ha_sobreposta',
          mensagem: `Já existe H.A. na ${dia} das ${o.inicio} às ${o.fim}, que se sobrepõe a este horário.`
        });
      }
    });

  contexto.aulas
    .filter((a) => a.dia === novo.dia && sobrepoe(ini, fim, a.startMin, a.endMin))
    .forEach((a) => {
      if (a.natureza === 'aula_de_especialista_na_turma') {
        conflitos.push({
          nivel: 'info',
          codigo: 'natural_regente',
          mensagem: `Coincide com aula de especialista na turma (${a.rotulo}): é a H.A. natural do regente.`
        });
      } else {
        conflitos.push({
          nivel: 'aviso',
          codigo: 'aula_sobreposta',
          mensagem: `Coincide com ${a.natureza === 'regencia' ? 'aula de regência' : 'aula'} (${a.rotulo}).`
        });
      }
    });

  const dias = contexto.diasDisponiveis && contexto.diasDisponiveis.length > 0 ? contexto.diasDisponiveis : [1, 2, 3, 4, 5];
  if (!dias.includes(novo.dia)) {
    conflitos.push({
      nivel: 'aviso',
      codigo: 'dia_indisponivel',
      mensagem: `O professor não atua na ${dia} (folga ou fora da escola).`
    });
  }
  return conflitos;
}

/** Total semanal e por dia de um conjunto de blocos de H.A. */
export function resumoHA(blocos: { dia: number; inicio: string; fim: string }[]): {
  totalMin: number;
  porDia: Record<number, number>;
} {
  const porDia: Record<number, number> = {};
  let totalMin = 0;
  blocos.forEach((b) => {
    const ini = minutosDe(b.inicio);
    const fim = minutosDe(b.fim);
    if (ini === null || fim === null || fim <= ini) return;
    totalMin += fim - ini;
    porDia[b.dia] = (porDia[b.dia] || 0) + (fim - ini);
  });
  return { totalMin, porDia };
}

/** Remove campos vazios/undefined antes de gravar (o Realtime Database rejeita `undefined`). */
export function limparCamposHA<T extends Record<string, any>>(e: T): T {
  const limpo: Record<string, any> = {};
  Object.keys(e).forEach((k) => {
    const v = e[k];
    if (v === undefined || v === null) return;
    if (typeof v === 'string' && v.trim() === '') return;
    limpo[k] = typeof v === 'string' ? v.trim() : v;
  });
  return limpo as T;
}
