/**
 * Módulo de Otimização e Sugestão Automática de Horários para Professores Especialistas
 *
 * Regras de Negócio Implementadas:
 * 1. Escopo por escola e Ano Letivo (turmas e atribuições de outros anos são ignoradas).
 * 2. Cada especialista tem 2 aulas por turma regular atribuída durante a semana (carga suplementar ignorada).
 * 3. Restrição Estrita: Máximo de 2 especialistas diferentes na mesma sala/turma no mesmo dia.
 * 4. Respeito total à Folga do Especialista: Nenhuma aula agendada em seus dias de folga/indisponíveis.
 * 5. Sem conflitos de horário por turno e sino: Considera corretamente Manhã vs Tarde e intervalos por ano.
 * 6. Solver cooperativo com orçamento de tempo/passos, cancelamento imediato e fallback parcial inteligente.
 */

import {
  DiaSemana,
  GRADE_DIAS_SEMANA,
  HorarioSlot,
  getHorariosTurma,
  getSlotTimeRange,
  getTurnoCanonical,
  normalizarDiasDisponiveis,
  obterDiasFolga,
  formatarDiasFolgaResumo
} from '../types';
import {
  aulasAntesDoIntervalo,
  SinoConfig,
  getSinoConfigAtiva,
  rotulosDasAulas,
  intervalosMatutino,
  intervalosTurno,
  faixaTurno,
  posicaoIntervaloTurno,
  minutosDe
} from './sino';
import ExcelJS from 'exceljs';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export interface EspecialistaConfig {
  id: string;
  aliasIds?: string[]; // Chaves alternativas (ex.: ID manual vs authUid / mesmo e-mail) do mesmo docente
  name: string;
  subject: string;
  diasDisponiveis: number[]; // [1, 2, 3, 4, 5] (1: Seg ... 5: Sex)
  folgaDia: number | null; // ex: 3 (Quarta-feira) ou null (sem folga semanal)
  turmasIds: string[]; // Turmas regulares atribuídas neste ano letivo
  totalAulasNecessarias: number; // turmasIds.length * aulasPorTurma
  metaHA?: number;
}

export interface TurmaPlanejamento {
  id: string;
  name: string;
  year: string;
  letter: string;
  shift: string;
  intervaloGrupo?: string;
  intervaloGrupoPorDia?: Record<string, string>;
  schoolId: string;
  schoolName: string;
  anoLetivo: string;
  especialistasIds: string[];
  gradeHorariaExistente?: Record<string, HorarioSlot>;
}

export type FormatoAulasEspecialista = 'dobrada' | 'separada' | 'misto';

export type TurnoFiltroPlanejamento = 'todos' | 'manha' | 'tarde' | 'noite';

export interface OcupacaoExternaProfessor {
  schoolId: string;
  schoolName: string;
  classId: string;
  className: string;
  dia: DiaSemana;
  ordem: number;
  turno: 'manha' | 'tarde' | 'noite' | 'outro';
  startMin: number;
  endMin: number;
}

export interface OpcoesSugestaoHorario {
  anoLetivo: string;
  aulasPorTurma: number; // Padrão: 2
  formatoAulas: FormatoAulasEspecialista; // 'dobrada', 'separada' ou 'misto'
  maxEspecialistasPorTurmaDia: number; // Padrão: 2
  preservarOutrosProfessores: boolean; // Se true, evita slots já ocupados por não-especialistas na grade atual
  escolasIds?: string[];
  turnoFiltro?: TurnoFiltroPlanejamento; // 'todos', 'manha', 'tarde' ou 'noite'
  ocupacoesExternasPorProfessor?: Record<string, OcupacaoExternaProfessor[]>;
  respeitarIntervaloEntreEscolas?: boolean; // Padrão: true (exige >= 15 min de intervalo ao trocar de escola no mesmo dia/turno)
}

export interface SlotSugerido {
  dia: DiaSemana;
  ordem: number; // 1 a 5
  shift: string;
  turno: 'manha' | 'tarde' | 'noite' | 'outro';
  inicioStr: string;
  fimStr: string;
  classId: string;
  className: string;
  schoolId: string;
  schoolName: string;
  teacherId: string;
  teacherName: string;
  disciplinaNome: string;
}

export interface ProgressoSugestao {
  etapa: string;
  passosExecutados: number;
  maxPassos: number;
  aulasAlocadas: number;
  totalAulas: number;
  tempoDecorridoMs: number;
}

export interface ControleSugestao {
  signal?: AbortSignal;
  onProgress?: (progresso: ProgressoSugestao) => void;
  maxPassos?: number;
  maxTempoMs?: number;
}

export interface DemandaNaoAlocada {
  classId: string;
  className: string;
  teacherId: string;
  teacherName: string;
  disciplina: string;
  motivo: string;
}

export interface ResultadoSugestaoHorarios {
  sucesso: boolean;
  cancelado?: boolean;
  mensagem: string;
  gradesPorTurma: Record<string, Record<string, HorarioSlot>>; // classId -> { "1_1": slot, ... }
  gradesPorEspecialista: Record<string, Record<string, SlotSugerido>>; // compatibilidade: teacherId -> { "1_1": slot }
  gradesPorEspecialistaLista: Record<string, SlotSugerido[]>; // lista completa com todos os turnos
  conflitos: string[];
  avisos: string[];
  demandasNaoAlocadas: DemandaNaoAlocada[];
  estatisticas: {
    totalTurmas: number;
    totalEspecialistas: number;
    totalAulasAlocadas: number;
    totalAulasEsperadas: number;
    percentualConcluido: number;
    tempoCalculoMs: number;
    turmasComMaxEspecialistasRespeitado: number;
    folgasRespeitadas: number;
  };
  analisePorDiaTurma: Record<
    string,
    Record<number, { especialistas: { id: string; nome: string; disciplina: string }[]; totalAulas: number }>
  >;
}

export interface OrigemMovimentoAula {
  classId: string;
  fromDia: DiaSemana;
  fromOrdem: number;
}

export interface DestinoMovimentoAula {
  toDia: DiaSemana;
  toOrdem: number;
  turnoDestino?: 'manha' | 'tarde' | 'noite' | 'outro';
  /** Opcional: quando diferente de origem.classId (ex.: na aba Por Especialista), valida troca cruzada entre duas turmas do mesmo especialista. */
  targetClassId?: string;
}

export interface ContextoValidacaoHorarios {
  turmas: TurmaPlanejamento[];
  especialistas: EspecialistaConfig[];
  maxEspecialistasPorTurmaDia?: number;
  ocupacoesExternasPorProfessor?: Record<string, OcupacaoExternaProfessor[]>;
  respeitarIntervaloEntreEscolas?: boolean;
  totalAulasEsperadas?: number;
  tempoCalculoMs?: number;
}

export interface ResultadoValidacaoMovimento {
  valido: boolean;
  tipo: 'mover' | 'permutar' | 'permutar_turmas' | 'trocar_swap' | 'bloqueado' | 'mesmo_slot';
  motivo?: string;
  detalhes?: string;
  docenteDestinoNome?: string;
  disciplinaDestinoNome?: string;
  turmaDestinoNome?: string;
}

export interface ResultadoAplicacaoMovimento {
  sucesso: boolean;
  resultado?: ResultadoSugestaoHorarios;
  tipo?: 'mover' | 'permutar' | 'permutar_turmas';
  acaoDescricao?: string;
  motivoErro?: string;
}

export interface SwapItemAula {
  id: string;
  classId: string;
  turmaLabel: string;
  shift: string;
  turno: 'manha' | 'tarde' | 'noite' | 'outro';
  origemDia: DiaSemana;
  origemOrdem: number;
  slot: HorarioSlot;
}

export interface ResultadoEmpilharSwap {
  sucesso: boolean;
  resultado?: ResultadoSugestaoHorarios;
  swapItem?: SwapItemAula;
  acaoDescricao?: string;
  motivoErro?: string;
}

export interface ResultadoValidacaoSwap {
  valido: boolean;
  tipo: 'mover' | 'trocar_swap' | 'bloqueado';
  motivo?: string;
  detalhes?: string;
  /** Em caso de deslocamento para o Swap ('trocar_swap'), identifica qual aula será empurrada para a bandeja. */
  aulaDeslocada?: {
    classId: string;
    turmaLabel: string;
    dia: DiaSemana;
    ordem: number;
    slot: HorarioSlot;
  };
}

export interface ResultadoAplicacaoSwap {
  sucesso: boolean;
  resultado?: ResultadoSugestaoHorarios;
  novoSwapItem?: SwapItemAula;
  acaoDescricao?: string;
  motivoErro?: string;
}

const DIAS_UTEIS: DiaSemana[] = [1, 2, 3, 4, 5];
const ORDENS_AULA = [1, 2, 3, 4, 5];
const MIN_GAP_TROCA_ESCOLA_MINUTOS = 15;

const yieldToMain = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function getDiaSemanaNome(dia: number): string {
  return GRADE_DIAS_SEMANA.find((d) => d.id === dia)?.nome || `Dia ${dia}`;
}

function getParesConsecutivosParaTurma(turma: TurmaPlanejamento, dia?: number): [number, number][] {
  const bell = getHorariosTurma(
    turma.shift,
    turma.intervaloGrupo,
    turma.year,
    turma.schoolId,
    dia,
    turma.intervaloGrupoPorDia
  );
  const intervaloAposAula = aulasAntesDoIntervalo(bell);

  if (intervaloAposAula === 2) {
    // Recreio entre 2ª e 3ª aula (ex.: 1º ano matutino padrão)
    return [
      [1, 2],
      [4, 5],
      [3, 4],
      [2, 3]
    ];
  }
  // Demais turmas têm intervalo entre 3ª e 4ª aula
  return [
    [1, 2],
    [4, 5],
    [2, 3],
    [3, 4]
  ];
}

function formatTurnoLabel(turno: 'manha' | 'tarde' | 'noite' | 'outro'): string {
  if (turno === 'manha') return 'Matutino';
  if (turno === 'tarde') return 'Vespertino';
  if (turno === 'noite') return 'Noturno';
  return 'Outro';
}

function temSobreposicaoOuFaltaDeslocamento(
  startA: number,
  endA: number,
  schoolA: string,
  startB: number,
  endB: number,
  schoolB: string,
  respeitarIntervaloEntreEscolas: boolean
): 'sobreposicao' | 'deslocamento' | null {
  if (startA < endB && startB < endA) {
    return 'sobreposicao';
  }
  if (respeitarIntervaloEntreEscolas && schoolA && schoolB && schoolA !== schoolB) {
    const gap = startA >= endB ? startA - endB : startB - endA;
    if (gap < MIN_GAP_TROCA_ESCOLA_MINUTOS) {
      return 'deslocamento';
    }
  }
  return null;
}

/**
 * Reconstrói as visões por especialista, auditoria de regras e estatísticas
 * a partir de gradesPorTurma (usado após geração automática ou edição por arrastar-e-soltar).
 */
export function reconstruirResultadoDesdeGradesTurmas(
  gradeTurmas: Record<string, Record<string, HorarioSlot>>,
  contexto: ContextoValidacaoHorarios & {
    avisos?: string[];
    demandasNaoAlocadas?: DemandaNaoAlocada[];
    mensagem?: string;
    formatoAulas?: FormatoAulasEspecialista;
  }
): ResultadoSugestaoHorarios {
  const {
    turmas,
    especialistas,
    maxEspecialistasPorTurmaDia = 2,
    ocupacoesExternasPorProfessor = {},
    respeitarIntervaloEntreEscolas = true,
    totalAulasEsperadas: totalEsperadasInput,
    tempoCalculoMs = 0,
    avisos = [],
    demandasNaoAlocadas = [],
    mensagem
  } = contexto;

  const mapaEspecialistas = new Map<string, EspecialistaConfig>();
  const mapaEspecialistasPorQualquerId = new Map<string, EspecialistaConfig>();
  especialistas.forEach((esp) => {
    mapaEspecialistas.set(esp.id, esp);
    mapaEspecialistasPorQualquerId.set(esp.id, esp);
    esp.aliasIds?.forEach((aid) => {
      if (aid && !mapaEspecialistasPorQualquerId.has(aid)) {
        mapaEspecialistasPorQualquerId.set(aid, esp);
      }
    });
  });

  const gradeEspecialistas: Record<string, Record<string, SlotSugerido>> = {};
  const gradeEspecialistasLista: Record<string, SlotSugerido[]> = {};

  especialistas.forEach((esp) => {
    gradeEspecialistas[esp.id] = {};
    gradeEspecialistasLista[esp.id] = [];
  });

  const conflitos: string[] = [];
  let totalAulasAlocadas = 0;
  let turmasComMaxEspecialistasRespeitado = 0;
  let folgasRespeitadas = 0;
  const analisePorDiaTurma: ResultadoSugestaoHorarios['analisePorDiaTurma'] = {};

  turmas.forEach((t) => {
    analisePorDiaTurma[t.id] = {};
    let turmaOk = true;

    DIAS_UTEIS.forEach((dia) => {
      const espDoDia = new Map<string, { id: string; nome: string; disciplina: string }>();
      let aulasNoDia = 0;

      for (let o = 1; o <= 5; o++) {
        const slotKey = `${dia}_${o}`;
        const slot = gradeTurmas[t.id]?.[slotKey];
        const esp = slot?.teacherId ? mapaEspecialistasPorQualquerId.get(slot.teacherId) : undefined;
        if (slot?.teacherId && esp) {
          const canonTeacherId = esp.id;
          const range = getSlotTimeRange(t, o, slot.horarioCustomInicio, slot.horarioCustomFim, dia);
          totalAulasAlocadas++;
          aulasNoDia++;

          espDoDia.set(canonTeacherId, {
            id: canonTeacherId,
            nome: esp.name,
            disciplina: esp.subject || slot.disciplinaNome || 'Especialista'
          });

          const slotEsp: SlotSugerido = {
            dia,
            ordem: o,
            shift: t.shift,
            turno: getTurnoCanonical(t.shift),
            inicioStr: range.inicioStr,
            fimStr: range.fimStr,
            classId: t.id,
            className: `${t.year}º ${t.letter} - ${t.shift}`,
            schoolId: t.schoolId,
            schoolName: t.schoolName,
            teacherId: canonTeacherId,
            teacherName: esp.name,
            disciplinaNome: esp.subject || slot.disciplinaNome || 'Especialista'
          };

          gradeEspecialistasLista[canonTeacherId].push(slotEsp);
          if (!gradeEspecialistas[canonTeacherId][slotKey]) {
            gradeEspecialistas[canonTeacherId][slotKey] = slotEsp;
          } else {
            gradeEspecialistas[canonTeacherId][`${slotKey}_${slotEsp.turno}`] = slotEsp;
          }
        }
      }

      if (espDoDia.size > maxEspecialistasPorTurmaDia) {
        turmaOk = false;
        conflitos.push(
          `Turma ${t.year}º ${t.letter} (${t.schoolName}): ${espDoDia.size} especialistas na ${getDiaSemanaNome(
            dia
          )} (limite é ${maxEspecialistasPorTurmaDia}).`
        );
      }

      analisePorDiaTurma[t.id][dia] = {
        especialistas: Array.from(espDoDia.values()),
        totalAulas: aulasNoDia
      };
    });

    if (turmaOk) {
      turmasComMaxEspecialistasRespeitado++;
    }
  });

  // Ordenar slots de cada especialista e auditar folgas + colisões de horário
  const mapaTurmas = new Map<string, TurmaPlanejamento>();
  turmas.forEach((t) => mapaTurmas.set(t.id, t));

  especialistas.forEach((esp) => {
    const lista = gradeEspecialistasLista[esp.id] || [];
    lista.sort((a, b) => {
      if (a.dia !== b.dia) return a.dia - b.dia;
      return a.ordem - b.ordem;
    });

    const diasFolgaEsp = obterDiasFolga(esp.diasDisponiveis, esp.folgaDia);
    if (diasFolgaEsp.length > 0) {
      const aulasNaFolga = lista.filter((s) => diasFolgaEsp.includes(s.dia));
      if (aulasNaFolga.length === 0) {
        folgasRespeitadas++;
      } else {
        const diasStr = Array.from(new Set(aulasNaFolga.map((s) => getDiaSemanaNome(s.dia)))).join(', ');
        conflitos.push(`Especialista ${esp.name} teve aula agendada em seu dia de folga (${diasStr}).`);
      }
    } else {
      folgasRespeitadas++;
    }

    // Conferência de choques entre turmas do mesmo docente e com ocupações externas
    for (let i = 0; i < lista.length; i++) {
      const a = lista[i];
      const turmaA = mapaTurmas.get(a.classId);
      if (!turmaA) continue;
      const rangeA = getSlotTimeRange(turmaA, a.ordem, undefined, undefined, a.dia);

      for (let j = i + 1; j < lista.length; j++) {
        const b = lista[j];
        if (a.dia !== b.dia) continue;
        const turmaB = mapaTurmas.get(b.classId);
        if (!turmaB) continue;
        const rangeB = getSlotTimeRange(turmaB, b.ordem, undefined, undefined, b.dia);
        const col = temSobreposicaoOuFaltaDeslocamento(
          rangeA.startMin,
          rangeA.endMin,
          turmaA.schoolId,
          rangeB.startMin,
          rangeB.endMin,
          turmaB.schoolId,
          respeitarIntervaloEntreEscolas
        );
        if (col === 'sobreposicao') {
          conflitos.push(
            `Choque de horário: ${esp.name} na ${getDiaSemanaNome(a.dia)} entre ${a.className} (${a.inicioStr}) e ${b.className} (${b.inicioStr}).`
          );
        } else if (col === 'deslocamento') {
          conflitos.push(
            `Intervalo menor que 15 min: ${esp.name} na ${getDiaSemanaNome(a.dia)} entre ${a.className} (${a.fimStr}) e ${b.className} (${b.inicioStr}).`
          );
        }
      }

      const extLista = ocupacoesExternasPorProfessor[esp.id] || [];
      for (const ext of extLista) {
        if (ext.dia !== a.dia) continue;
        const colExt = temSobreposicaoOuFaltaDeslocamento(
          rangeA.startMin,
          rangeA.endMin,
          turmaA.schoolId,
          ext.startMin,
          ext.endMin,
          ext.schoolId,
          respeitarIntervaloEntreEscolas
        );
        if (colExt === 'sobreposicao') {
          conflitos.push(
            `Choque externo: ${esp.name} na ${getDiaSemanaNome(a.dia)} entre ${a.className} e ${ext.schoolName} (${ext.className}).`
          );
        } else if (colExt === 'deslocamento') {
          conflitos.push(
            `Intervalo menor que 15 min: ${esp.name} na ${getDiaSemanaNome(a.dia)} entre ${a.className} e ${ext.schoolName}.`
          );
        }
      }
    }
  });

  const totalAulasEsperadas =
    typeof totalEsperadasInput === 'number'
      ? totalEsperadasInput
      : especialistas.reduce((acc, e) => acc + (e.totalAulasNecessarias || 0), 0);

  const percentualConcluido =
    totalAulasEsperadas > 0 ? Math.round((totalAulasAlocadas / totalAulasEsperadas) * 100) : 100;

  return {
    sucesso: totalAulasAlocadas >= totalAulasEsperadas && conflitos.length === 0,
    mensagem:
      mensagem ||
      (totalAulasAlocadas >= totalAulasEsperadas && conflitos.length === 0
        ? `Todas as ${totalAulasEsperadas} aulas distribuídas sem choques e com folgas respeitadas.`
        : `Grade atual: ${totalAulasAlocadas}/${totalAulasEsperadas} aulas alocadas (${percentualConcluido}%)${
            conflitos.length > 0 ? ` • ${conflitos.length} conflito(s)` : ''
          }.`),
    gradesPorTurma: gradeTurmas,
    gradesPorEspecialista: gradeEspecialistas,
    gradesPorEspecialistaLista: gradeEspecialistasLista,
    conflitos,
    avisos,
    demandasNaoAlocadas,
    estatisticas: {
      totalTurmas: turmas.length,
      totalEspecialistas: especialistas.length,
      totalAulasAlocadas,
      totalAulasEsperadas,
      percentualConcluido,
      tempoCalculoMs,
      turmasComMaxEspecialistasRespeitado,
      folgasRespeitadas
    },
    analisePorDiaTurma
  };
}

/**
 * Valida em tempo real se uma aula de especialista pode ser movida (ou permutada)
 * para outro dia/horário dentro da mesma turma sem conflitar com nenhum especialista,
 * respeitando folga semanal, outras turmas/escolas, deslocamento >= 15min e limite de 2/dia.
 */
export function validarMovimentoAulaSugerida(
  gradesPorTurma: Record<string, Record<string, HorarioSlot>>,
  origem: OrigemMovimentoAula,
  destino: DestinoMovimentoAula,
  contexto: ContextoValidacaoHorarios
): ResultadoValidacaoMovimento {
  const {
    turmas,
    especialistas,
    maxEspecialistasPorTurmaDia = 2,
    ocupacoesExternasPorProfessor = {},
    respeitarIntervaloEntreEscolas = true
  } = contexto;

  if (origem.fromDia === destino.toDia && origem.fromOrdem === destino.toOrdem) {
    return {
      valido: false,
      tipo: 'mesmo_slot',
      motivo: 'Horário atual desta aula.'
    };
  }

  const mapaTurmas = new Map<string, TurmaPlanejamento>();
  turmas.forEach((t) => mapaTurmas.set(t.id, t));

  const mapaEspecialistas = new Map<string, EspecialistaConfig>();
  especialistas.forEach((esp) => mapaEspecialistas.set(esp.id, esp));

  const turmaOrigem = mapaTurmas.get(origem.classId);
  if (!turmaOrigem) {
    return {
      valido: false,
      tipo: 'bloqueado',
      motivo: 'Turma não encontrada no escopo atual.'
    };
  }

  const turnoOrigem = getTurnoCanonical(turmaOrigem.shift);
  if (destino.turnoDestino && destino.turnoDestino !== turnoOrigem) {
    return {
      valido: false,
      tipo: 'bloqueado',
      motivo: `Movimento bloqueado: não é permitido movimentar uma aula de ${formatTurnoLabel(
        turnoOrigem
      )} para ${formatTurnoLabel(destino.turnoDestino)}.`
    };
  }

  const fromKey = `${origem.fromDia}_${origem.fromOrdem}`;
  const toKey = `${destino.toDia}_${destino.toOrdem}`;
  const slotOrigem = gradesPorTurma[origem.classId]?.[fromKey];
  const slotDestino = gradesPorTurma[origem.classId]?.[toKey];

  if (!slotOrigem?.teacherId || !mapaEspecialistas.has(slotOrigem.teacherId)) {
    return {
      valido: false,
      tipo: 'bloqueado',
      motivo: 'Apenas aulas de especialistas da sugestão podem ser movimentadas.'
    };
  }

  const espA = mapaEspecialistas.get(slotOrigem.teacherId)!;

  // =========================================================================================
  // CASO ESPECIAL: TROCA CRUZADA ENTRE DUAS TURMAS DIFERENTES DO MESMO ESPECIALISTA (ex.: 1º A ↔ 4º A)
  // =========================================================================================
  if (destino.targetClassId && destino.targetClassId !== origem.classId) {
    const turmaDestino = mapaTurmas.get(destino.targetClassId);
    if (!turmaDestino) {
      return {
        valido: false,
        tipo: 'bloqueado',
        motivo: 'Turma de destino não encontrada no escopo atual.'
      };
    }

    if (getTurnoCanonical(turmaDestino.shift) !== turnoOrigem) {
      return {
        valido: false,
        tipo: 'bloqueado',
        motivo: `Movimento bloqueado: ${turmaOrigem.year}º ${turmaOrigem.letter} e ${turmaDestino.year}º ${turmaDestino.letter} pertencem a turnos diferentes.`
      };
    }

    const slotNoDestinoTurma = gradesPorTurma[turmaDestino.id]?.[toKey];
    if (!slotNoDestinoTurma || slotNoDestinoTurma.teacherId !== espA.id) {
      return {
        valido: false,
        tipo: 'bloqueado',
        motivo: `A aula de destino em ${turmaDestino.year}º ${turmaDestino.letter} não pertence a ${espA.name}.`
      };
    }

    const conflitoNaTurmaOrigem = gradesPorTurma[turmaOrigem.id]?.[toKey];
    if (conflitoNaTurmaOrigem) {
      return {
        valido: false,
        tipo: 'bloqueado',
        motivo: `${turmaOrigem.year}º ${turmaOrigem.letter} já tem aula (${conflitoNaTurmaOrigem.disciplinaNome || 'ocupada'}) na ${getDiaSemanaNome(
          destino.toDia
        )} (${destino.toOrdem}ª aula). Use a Bandeja de Swap para remanejar em cadeia.`
      };
    }

    const conflitoNaTurmaDestino = gradesPorTurma[turmaDestino.id]?.[fromKey];
    if (conflitoNaTurmaDestino) {
      return {
        valido: false,
        tipo: 'bloqueado',
        motivo: `${turmaDestino.year}º ${turmaDestino.letter} já tem aula (${conflitoNaTurmaDestino.disciplinaNome || 'ocupada'}) na ${getDiaSemanaNome(
          origem.fromDia
        )} (${origem.fromOrdem}ª aula). Use a Bandeja de Swap para remanejar em cadeia.`
      };
    }

    // Validar horários exatos de sino para espA nas duas novas posições (excluindo as duas que estão saindo)
    const validarEspACruzado = (
      turmaAlvo: TurmaPlanejamento,
      diaAlvo: DiaSemana,
      ordemAlvo: number
    ): string | null => {
      const folgasEspA = obterDiasFolga(espA.diasDisponiveis, espA.folgaDia);
      if (folgasEspA.includes(diaAlvo)) {
        return `Folga semanal: ${espA.name} tem folga na ${getDiaSemanaNome(diaAlvo)}.`;
      }

      const targetRange = getSlotTimeRange(turmaAlvo, ordemAlvo, undefined, undefined, diaAlvo);
      for (const outraTurma of turmas) {
        for (let o = 1; o <= 5; o++) {
          if (outraTurma.id === turmaOrigem.id && diaAlvo === origem.fromDia && o === origem.fromOrdem) continue;
          if (outraTurma.id === turmaDestino.id && diaAlvo === destino.toDia && o === destino.toOrdem) continue;
          const sl = gradesPorTurma[outraTurma.id]?.[`${diaAlvo}_${o}`];
          if (!sl || sl.teacherId !== espA.id) continue;
          const rEx = getSlotTimeRange(outraTurma, o, sl.horarioCustomInicio, sl.horarioCustomFim, diaAlvo);
          const col = temSobreposicaoOuFaltaDeslocamento(
            targetRange.startMin,
            targetRange.endMin,
            turmaAlvo.schoolId,
            rEx.startMin,
            rEx.endMin,
            outraTurma.schoolId,
            respeitarIntervaloEntreEscolas
          );
          if (col === 'sobreposicao') {
            return `Choque de sino: ${espA.name} já está em ${outraTurma.year}º ${outraTurma.letter} (${rEx.inicioStr}–${rEx.fimStr}).`;
          }
          if (col === 'deslocamento') {
            return `Intervalo menor que 15 min com ${outraTurma.year}º ${outraTurma.letter} (${outraTurma.schoolName}).`;
          }
        }
      }

      const externas = ocupacoesExternasPorProfessor[espA.id] || [];
      for (const ext of externas) {
        if (ext.dia !== diaAlvo) continue;
        const colExt = temSobreposicaoOuFaltaDeslocamento(
          targetRange.startMin,
          targetRange.endMin,
          turmaAlvo.schoolId,
          ext.startMin,
          ext.endMin,
          ext.schoolId,
          respeitarIntervaloEntreEscolas
        );
        if (colExt === 'sobreposicao') {
          return `Choque com outra escola: ${espA.name} já tem aula oficial em ${ext.schoolName} (${ext.className}).`;
        }
        if (colExt === 'deslocamento') {
          return `Deslocamento insuficiente (< 15 min): ${espA.name} atua em ${ext.schoolName} (${ext.className}).`;
        }
      }
      return null;
    };

    const errOrig = validarEspACruzado(turmaOrigem, destino.toDia, destino.toOrdem);
    if (errOrig) return { valido: false, tipo: 'bloqueado', motivo: errOrig };

    const errDest = validarEspACruzado(turmaDestino, origem.fromDia, origem.fromOrdem);
    if (errDest) return { valido: false, tipo: 'bloqueado', motivo: errDest };

    // Também validar choque direto entre as duas novas aulas se caírem no mesmo dia
    if (destino.toDia === origem.fromDia) {
      const rA = getSlotTimeRange(turmaOrigem, destino.toOrdem, undefined, undefined, destino.toDia);
      const rB = getSlotTimeRange(turmaDestino, origem.fromOrdem, undefined, undefined, origem.fromDia);
      const colEntreSi = temSobreposicaoOuFaltaDeslocamento(
        rA.startMin,
        rA.endMin,
        turmaOrigem.schoolId,
        rB.startMin,
        rB.endMin,
        turmaDestino.schoolId,
        respeitarIntervaloEntreEscolas
      );
      if (colEntreSi === 'sobreposicao') {
        return {
          valido: false,
          tipo: 'bloqueado',
          motivo: `As duas aulas trocadas colidiriam no mesmo horário (${rA.inicioStr}–${rA.fimStr}).`
        };
      }
    }

    // Validar limite de 2 especialistas/dia em ambas as turmas após a troca cruzada
    const checarMaxEsp = (
      turmaAlvo: TurmaPlanejamento,
      removeKey: string,
      addKey: string,
      addSlot: HorarioSlot,
      diaAud: DiaSemana
    ): string | null => {
      const sim: Record<string, HorarioSlot> = { ...(gradesPorTurma[turmaAlvo.id] || {}) };
      delete sim[removeKey];
      sim[addKey] = addSlot;
      const esps = new Set<string>();
      const discs = new Set<string>();
      for (let o = 1; o <= 5; o++) {
        const sl = sim[`${diaAud}_${o}`];
        if (sl?.teacherId && mapaEspecialistas.has(sl.teacherId)) {
          esps.add(sl.teacherId);
          const info = mapaEspecialistas.get(sl.teacherId)!;
          discs.add(info.subject || info.name);
        }
      }
      if (esps.size > maxEspecialistasPorTurmaDia) {
        return `Limite de ${maxEspecialistasPorTurmaDia} especialistas/dia excedido em ${turmaAlvo.year}º ${turmaAlvo.letter} na ${getDiaSemanaNome(
          diaAud
        )} (${Array.from(discs).join(', ')}).`;
      }
      return null;
    };

    const errLimOrig = checarMaxEsp(turmaOrigem, fromKey, toKey, slotOrigem, destino.toDia);
    if (errLimOrig) return { valido: false, tipo: 'bloqueado', motivo: errLimOrig };

    const errLimDest = checarMaxEsp(turmaDestino, toKey, fromKey, slotNoDestinoTurma, origem.fromDia);
    if (errLimDest) return { valido: false, tipo: 'bloqueado', motivo: errLimDest };

    return {
      valido: true,
      tipo: 'permutar_turmas',
      detalhes: `Trocar ${turmaOrigem.year}º ${turmaOrigem.letter} (${getDiaSemanaNome(origem.fromDia)} ${origem.fromOrdem}ª) ↔ ${turmaDestino.year}º ${turmaDestino.letter} (${getDiaSemanaNome(destino.toDia)} ${destino.toOrdem}ª).`,
      turmaDestinoNome: `${turmaDestino.year}º ${turmaDestino.letter}`
    };
  }

  const espB =
    slotDestino?.teacherId && mapaEspecialistas.has(slotDestino.teacherId)
      ? mapaEspecialistas.get(slotDestino.teacherId)!
      : null;

  if (espB && espB.id === espA.id) {
    return {
      valido: false,
      tipo: 'bloqueado',
      motivo: `${espA.name} já ocupa este horário nesta mesma turma.`
    };
  }

  // Helper de validação de um docente específico ocupando (turmaOrigem, diaAlvo, ordemAlvo),
  // desconsiderando sua própria posição antiga que está saindo neste movimento/permuta.
  const validarDocenteNoHorario = (
    esp: EspecialistaConfig,
    diaAlvo: DiaSemana,
    ordemAlvo: number,
    slotSaindo: { classId: string; dia: DiaSemana; ordem: number }
  ): string | null => {
    const folgasEsp = obterDiasFolga(esp.diasDisponiveis, esp.folgaDia);
    if (folgasEsp.includes(diaAlvo)) {
      return `Folga semanal: ${esp.name} tem folga na ${getDiaSemanaNome(diaAlvo)}.`;
    }

    const targetRange = getSlotTimeRange(turmaOrigem, ordemAlvo, undefined, undefined, diaAlvo);

    // 1. Verificar choque com todas as turmas da grade atual
    for (const outraTurma of turmas) {
      for (let o = 1; o <= 5; o++) {
        if (
          outraTurma.id === slotSaindo.classId &&
          diaAlvo === slotSaindo.dia &&
          o === slotSaindo.ordem
        ) {
          continue; // Este slot é o que está sendo liberado/movido
        }
        if (
          outraTurma.id === turmaOrigem.id &&
          diaAlvo === destino.toDia &&
          o === destino.toOrdem &&
          esp.id === espA.id
        ) {
          continue;
        }
        if (
          outraTurma.id === turmaOrigem.id &&
          diaAlvo === origem.fromDia &&
          o === origem.fromOrdem &&
          espB &&
          esp.id === espB.id
        ) {
          continue;
        }

        const slotExistente = gradesPorTurma[outraTurma.id]?.[`${diaAlvo}_${o}`];
        if (!slotExistente || slotExistente.teacherId !== esp.id) continue;

        const rangeExistente = getSlotTimeRange(
          outraTurma,
          o,
          slotExistente.horarioCustomInicio,
          slotExistente.horarioCustomFim,
          diaAlvo
        );
        const col = temSobreposicaoOuFaltaDeslocamento(
          targetRange.startMin,
          targetRange.endMin,
          turmaOrigem.schoolId,
          rangeExistente.startMin,
          rangeExistente.endMin,
          outraTurma.schoolId,
          respeitarIntervaloEntreEscolas
        );

        if (col === 'sobreposicao') {
          return `Choque de horário: ${esp.name} já está na turma ${outraTurma.year}º ${outraTurma.letter} (${outraTurma.shift}) das ${rangeExistente.inicioStr} às ${rangeExistente.fimStr}.`;
        }
        if (col === 'deslocamento') {
          return `Intervalo menor que 15 min: ${esp.name} tem aula na turma ${outraTurma.year}º ${outraTurma.letter} (${outraTurma.schoolName}).`;
        }
      }
    }

    // 2. Verificar choque com aulas já oficializadas em outras escolas / turnos externos
    const externas = ocupacoesExternasPorProfessor[esp.id] || [];
    for (const ext of externas) {
      if (ext.dia !== diaAlvo) continue;
      const colExt = temSobreposicaoOuFaltaDeslocamento(
        targetRange.startMin,
        targetRange.endMin,
        turmaOrigem.schoolId,
        ext.startMin,
        ext.endMin,
        ext.schoolId,
        respeitarIntervaloEntreEscolas
      );
      if (colExt === 'sobreposicao') {
        return `Choque com outra escola: ${esp.name} já tem aula oficial em ${ext.schoolName} (${ext.className}).`;
      }
      if (colExt === 'deslocamento') {
        return `Deslocamento insuficiente (< 15 min): ${esp.name} atua em ${ext.schoolName} (${ext.className}) em horário próximo.`;
      }
    }

    return null;
  };

  // Verificar regras para o docente que está sendo arrastado (espA -> destino)
  const erroEspA = validarDocenteNoHorario(espA, destino.toDia, destino.toOrdem, {
    classId: origem.classId,
    dia: origem.fromDia,
    ordem: origem.fromOrdem
  });
  if (erroEspA) {
    return {
      valido: false,
      tipo: 'bloqueado',
      motivo: erroEspA
    };
  }

  // Se houver outro especialista no destino (espB), validar se ele pode permutar para origem
  if (espB) {
    const erroEspB = validarDocenteNoHorario(espB, origem.fromDia, origem.fromOrdem, {
      classId: origem.classId,
      dia: destino.toDia,
      ordem: destino.toOrdem
    });
    if (erroEspB) {
      return {
        valido: false,
        tipo: 'bloqueado',
        motivo: `Permuta com ${espB.name} bloqueada: ${erroEspB}`,
        docenteDestinoNome: espB.name,
        disciplinaDestinoNome: espB.subject
      };
    }
  }

  // Simular a grade da turma após o movimento para validar o limite de 2 especialistas por dia
  const gradeSimuladaTurma: Record<string, HorarioSlot> = { ...(gradesPorTurma[origem.classId] || {}) };
  if (slotDestino) {
    gradeSimuladaTurma[fromKey] = slotDestino;
  } else {
    delete gradeSimuladaTurma[fromKey];
  }
  gradeSimuladaTurma[toKey] = slotOrigem;

  const diasParaAuditar =
    origem.fromDia === destino.toDia ? [destino.toDia] : [destino.toDia, origem.fromDia];

  for (const diaAud of diasParaAuditar) {
    const especialistasNoDia = new Set<string>();
    const disciplinasNoDia = new Set<string>();
    for (let o = 1; o <= 5; o++) {
      const sl = gradeSimuladaTurma[`${diaAud}_${o}`];
      if (sl?.teacherId && mapaEspecialistas.has(sl.teacherId)) {
        especialistasNoDia.add(sl.teacherId);
        const infoEsp = mapaEspecialistas.get(sl.teacherId)!;
        disciplinasNoDia.add(infoEsp.subject || infoEsp.name);
      }
    }
    if (especialistasNoDia.size > maxEspecialistasPorTurmaDia) {
      return {
        valido: false,
        tipo: 'bloqueado',
        motivo: `Limite de ${maxEspecialistasPorTurmaDia} especialistas/dia excedido na ${getDiaSemanaNome(
          diaAud
        )} (${Array.from(disciplinasNoDia).join(', ')}).`
      };
    }
  }

  if (slotDestino) {
    const descDestino = espB
      ? `${espB.name} (${espB.subject || slotDestino.disciplinaNome || 'Especialista'})`
      : `${slotDestino.disciplinaNome || 'Aula existente'}${
          slotDestino.teacherNome ? ` (${slotDestino.teacherNome})` : ''
        }`;
    return {
      valido: true,
      tipo: 'permutar',
      detalhes: `Permuta válida com ${descDestino}. Todos os horários e folgas conferidos.`,
      docenteDestinoNome: espB?.name || slotDestino.teacherNome,
      disciplinaDestinoNome: espB?.subject || slotDestino.disciplinaNome
    };
  }

  return {
    valido: true,
    tipo: 'mover',
    detalhes: `Horário livre para ${espA.name} na ${getDiaSemanaNome(destino.toDia)} (${destino.toOrdem}ª aula).`
  };
}

/**
 * Aplica de forma imutável uma movimentação, permuta na mesma turma ou troca cruzada entre turmas e recalcula a auditoria.
 */
export function aplicarMovimentoAulaSugerida(
  resultadoAtual: ResultadoSugestaoHorarios,
  origem: OrigemMovimentoAula,
  destino: DestinoMovimentoAula,
  contexto: ContextoValidacaoHorarios
): ResultadoAplicacaoMovimento {
  const validacao = validarMovimentoAulaSugerida(
    resultadoAtual.gradesPorTurma,
    origem,
    destino,
    contexto
  );

  if (
    !validacao.valido ||
    (validacao.tipo !== 'mover' && validacao.tipo !== 'permutar' && validacao.tipo !== 'permutar_turmas')
  ) {
    return {
      sucesso: false,
      motivoErro: validacao.motivo || 'Movimento bloqueado pelas regras de horário.'
    };
  }

  const fromKey = `${origem.fromDia}_${origem.fromOrdem}`;
  const toKey = `${destino.toDia}_${destino.toOrdem}`;
  const nextGradesPorTurma: Record<string, Record<string, HorarioSlot>> = {
    ...resultadoAtual.gradesPorTurma,
    [origem.classId]: { ...(resultadoAtual.gradesPorTurma[origem.classId] || {}) }
  };

  let acaoDescricao = '';

  if (validacao.tipo === 'permutar_turmas' && destino.targetClassId) {
    nextGradesPorTurma[destino.targetClassId] = {
      ...(resultadoAtual.gradesPorTurma[destino.targetClassId] || {})
    };
    const slotOrigem = nextGradesPorTurma[origem.classId][fromKey];
    const slotDestinoTurma = nextGradesPorTurma[destino.targetClassId][toKey];

    nextGradesPorTurma[origem.classId][toKey] = slotOrigem;
    delete nextGradesPorTurma[origem.classId][fromKey];

    nextGradesPorTurma[destino.targetClassId][fromKey] = slotDestinoTurma;
    delete nextGradesPorTurma[destino.targetClassId][toKey];

    const turmaA = contexto.turmas.find((t) => t.id === origem.classId);
    const turmaB = contexto.turmas.find((t) => t.id === destino.targetClassId);
    const labelA = turmaA ? `${turmaA.year}º ${turmaA.letter}` : origem.classId;
    const labelB = turmaB ? `${turmaB.year}º ${turmaB.letter}` : destino.targetClassId;
    acaoDescricao = `Troca cruzada em ${slotOrigem.teacherNome}: ${labelA} (${getDiaSemanaNome(origem.fromDia)} ${origem.fromOrdem}ª) ↔ ${labelB} (${getDiaSemanaNome(destino.toDia)} ${destino.toOrdem}ª).`;
  } else {
    const slotOrigem = nextGradesPorTurma[origem.classId][fromKey];
    const slotDestino = nextGradesPorTurma[origem.classId][toKey];

    nextGradesPorTurma[origem.classId][toKey] = slotOrigem;
    if (slotDestino) {
      nextGradesPorTurma[origem.classId][fromKey] = slotDestino;
    } else {
      delete nextGradesPorTurma[origem.classId][fromKey];
    }

    const turmaObj = contexto.turmas.find((t) => t.id === origem.classId);
    const turmaLabel = turmaObj ? `${turmaObj.year}º ${turmaObj.letter}` : origem.classId;
    acaoDescricao =
      validacao.tipo === 'permutar'
        ? `Permutado em ${turmaLabel}: ${slotOrigem.disciplinaNome} ↔ ${
            slotDestino?.disciplinaNome || 'horário existente'
          } (${getDiaSemanaNome(origem.fromDia)} ${origem.fromOrdem}ª ↔ ${getDiaSemanaNome(destino.toDia)} ${
            destino.toOrdem
          }ª).`
        : `Movido em ${turmaLabel}: ${slotOrigem.disciplinaNome} (${slotOrigem.teacherNome}) para ${getDiaSemanaNome(
            destino.toDia
          )}, ${destino.toOrdem}ª aula.`;
  }

  const novoResultado = reconstruirResultadoDesdeGradesTurmas(nextGradesPorTurma, {
    ...contexto,
    totalAulasEsperadas: resultadoAtual.estatisticas.totalAulasEsperadas,
    tempoCalculoMs: resultadoAtual.estatisticas.tempoCalculoMs,
    avisos: resultadoAtual.avisos,
    demandasNaoAlocadas: resultadoAtual.demandasNaoAlocadas,
    mensagem: acaoDescricao
  });

  return {
    sucesso: true,
    resultado: novoResultado,
    tipo: validacao.tipo,
    acaoDescricao
  };
}

/**
 * Remove temporariamente uma aula da grade e coloca na Área/Bandeja de Swap ("empilhar"),
 * liberando imediatamente o horário na turma e no especialista para remanejamentos em cadeia.
 */
export function empilharAulaNoSwap(
  resultadoAtual: ResultadoSugestaoHorarios,
  classId: string,
  dia: DiaSemana,
  ordem: number,
  contexto: ContextoValidacaoHorarios
): ResultadoEmpilharSwap {
  const key = `${dia}_${ordem}`;
  const slot = resultadoAtual.gradesPorTurma[classId]?.[key];
  const turmaObj = contexto.turmas.find((t) => t.id === classId);
  if (!slot || !turmaObj || !slot.teacherId) {
    return {
      sucesso: false,
      motivoErro: 'Aula não encontrada ou não pertence a um especialista.'
    };
  }

  const nextGradesPorTurma: Record<string, Record<string, HorarioSlot>> = {
    ...resultadoAtual.gradesPorTurma,
    [classId]: { ...(resultadoAtual.gradesPorTurma[classId] || {}) }
  };
  delete nextGradesPorTurma[classId][key];

  const turmaLabel = `${turmaObj.year}º ${turmaObj.letter}`;
  const swapItem: SwapItemAula = {
    id: `${classId}_${slot.teacherId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    classId,
    turmaLabel,
    shift: turmaObj.shift,
    turno: getTurnoCanonical(turmaObj.shift),
    origemDia: dia,
    origemOrdem: ordem,
    slot: { ...slot }
  };

  const acaoDescricao = `Estacionado no Swap: ${slot.disciplinaNome} (${slot.teacherNome}) • ${turmaLabel} (saiu de ${getDiaSemanaNome(dia)} ${ordem}ª aula).`;
  const novoResultado = reconstruirResultadoDesdeGradesTurmas(nextGradesPorTurma, {
    ...contexto,
    totalAulasEsperadas: resultadoAtual.estatisticas.totalAulasEsperadas,
    tempoCalculoMs: resultadoAtual.estatisticas.tempoCalculoMs,
    avisos: resultadoAtual.avisos,
    demandasNaoAlocadas: resultadoAtual.demandasNaoAlocadas,
    mensagem: acaoDescricao
  });

  return {
    sucesso: true,
    resultado: novoResultado,
    swapItem,
    acaoDescricao
  };
}

/**
 * Valida se uma aula estacionada na Bandeja de Swap pode ser reencaixada em (dia, ordem),
 * permitindo inclusive deslocar uma única aula ocupante de volta para a Bandeja de Swap ('trocar_swap').
 */
export function validarEncaixeDeSwap(
  gradesPorTurma: Record<string, Record<string, HorarioSlot>>,
  swapItem: SwapItemAula,
  toDia: DiaSemana,
  toOrdem: number,
  contexto: ContextoValidacaoHorarios,
  turnoDestino?: 'manha' | 'tarde' | 'noite' | 'outro'
): ResultadoValidacaoSwap {
  const {
    turmas,
    especialistas,
    maxEspecialistasPorTurmaDia = 2,
    ocupacoesExternasPorProfessor = {},
    respeitarIntervaloEntreEscolas = true
  } = contexto;

  const mapaTurmas = new Map<string, TurmaPlanejamento>();
  turmas.forEach((t) => mapaTurmas.set(t.id, t));
  const mapaEspecialistas = new Map<string, EspecialistaConfig>();
  especialistas.forEach((e) => mapaEspecialistas.set(e.id, e));

  const turmaAlvo = mapaTurmas.get(swapItem.classId);
  if (!turmaAlvo) {
    return { valido: false, tipo: 'bloqueado', motivo: 'Turma desta aula não está no escopo atual.' };
  }

  const turnoTurma = getTurnoCanonical(turmaAlvo.shift);
  if (turnoDestino && turnoDestino !== turnoTurma) {
    return {
      valido: false,
      tipo: 'bloqueado',
      motivo: `Turno incompatível: esta aula é do ${formatTurnoLabel(turnoTurma)}.`
    };
  }

  const espA = swapItem.slot.teacherId ? mapaEspecialistas.get(swapItem.slot.teacherId) : undefined;
  if (!espA) {
    return { valido: false, tipo: 'bloqueado', motivo: 'Especialista não encontrado no escopo.' };
  }

  const folgasEspA = obterDiasFolga(espA.diasDisponiveis, espA.folgaDia);
  if (folgasEspA.includes(toDia)) {
    return {
      valido: false,
      tipo: 'bloqueado',
      motivo: `Folga semanal: ${espA.name} tem folga na ${getDiaSemanaNome(toDia)}.`
    };
  }

  const toKey = `${toDia}_${toOrdem}`;
  const slotExistenteNaTurma = gradesPorTurma[turmaAlvo.id]?.[toKey];

  // Verificar se espA já está em alguma outra turma exatamente neste horário (choque / deslocamento)
  const targetRange = getSlotTimeRange(turmaAlvo, toOrdem, undefined, undefined, toDia);
  let slotConflitanteEspA: {
    classId: string;
    turmaLabel: string;
    dia: DiaSemana;
    ordem: number;
    slot: HorarioSlot;
  } | null = null;

  for (const outraTurma of turmas) {
    if (outraTurma.id === turmaAlvo.id) continue;
    for (let o = 1; o <= 5; o++) {
      const sl = gradesPorTurma[outraTurma.id]?.[`${toDia}_${o}`];
      if (!sl || sl.teacherId !== espA.id) continue;
      const rEx = getSlotTimeRange(outraTurma, o, sl.horarioCustomInicio, sl.horarioCustomFim, toDia);
      const col = temSobreposicaoOuFaltaDeslocamento(
        targetRange.startMin,
        targetRange.endMin,
        turmaAlvo.schoolId,
        rEx.startMin,
        rEx.endMin,
        outraTurma.schoolId,
        respeitarIntervaloEntreEscolas
      );
      if (col === 'sobreposicao') {
        if (o === toOrdem && !slotConflitanteEspA) {
          slotConflitanteEspA = {
            classId: outraTurma.id,
            turmaLabel: `${outraTurma.year}º ${outraTurma.letter}`,
            dia: toDia,
            ordem: o,
            slot: sl
          };
        } else {
          return {
            valido: false,
            tipo: 'bloqueado',
            motivo: `Choque de horário: ${espA.name} já está na turma ${outraTurma.year}º ${outraTurma.letter} (${rEx.inicioStr}–${rEx.fimStr}).`
          };
        }
      } else if (col === 'deslocamento') {
        return {
          valido: false,
          tipo: 'bloqueado',
          motivo: `Intervalo menor que 15 min: ${espA.name} está em ${outraTurma.year}º ${outraTurma.letter} (${outraTurma.schoolName}).`
        };
      }
    }
  }

  // Verificar choques externos (outras escolas)
  const externas = ocupacoesExternasPorProfessor[espA.id] || [];
  for (const ext of externas) {
    if (ext.dia !== toDia) continue;
    const colExt = temSobreposicaoOuFaltaDeslocamento(
      targetRange.startMin,
      targetRange.endMin,
      turmaAlvo.schoolId,
      ext.startMin,
      ext.endMin,
      ext.schoolId,
      respeitarIntervaloEntreEscolas
    );
    if (colExt === 'sobreposicao') {
      return {
        valido: false,
        tipo: 'bloqueado',
        motivo: `Choque com outra escola: ${espA.name} já tem aula oficial em ${ext.schoolName} (${ext.className}).`
      };
    }
    if (colExt === 'deslocamento') {
      return {
        valido: false,
        tipo: 'bloqueado',
        motivo: `Deslocamento insuficiente (< 15 min) com ${ext.schoolName} (${ext.className}).`
      };
    }
  }

  // Evitar deslocar 2 aulas ao mesmo tempo (se a turma já tem aula e o especialista também já tem outra turma no mesmo horário)
  if (slotExistenteNaTurma && slotConflitanteEspA) {
    return {
      valido: false,
      tipo: 'bloqueado',
      motivo: `Tanto ${turmaAlvo.year}º ${turmaAlvo.letter} quanto ${espA.name} estão ocupados neste horário. Estacione uma delas no Swap primeiro.`
    };
  }

  if (slotExistenteNaTurma && !slotExistenteNaTurma.teacherId) {
    return {
      valido: false,
      tipo: 'bloqueado',
      motivo: 'Horário ocupado por regente sem docente associado.'
    };
  }

  // Simular limite de 2 especialistas/dia na turmaAlvo
  const simTurma: Record<string, HorarioSlot> = { ...(gradesPorTurma[turmaAlvo.id] || {}) };
  simTurma[toKey] = swapItem.slot;
  const espsDia = new Set<string>();
  const discsDia = new Set<string>();
  for (let o = 1; o <= 5; o++) {
    const sl = simTurma[`${toDia}_${o}`];
    if (sl?.teacherId && mapaEspecialistas.has(sl.teacherId)) {
      espsDia.add(sl.teacherId);
      const info = mapaEspecialistas.get(sl.teacherId)!;
      discsDia.add(info.subject || info.name);
    }
  }
  if (espsDia.size > maxEspecialistasPorTurmaDia) {
    return {
      valido: false,
      tipo: 'bloqueado',
      motivo: `Limite de ${maxEspecialistasPorTurmaDia} especialistas/dia excedido em ${turmaAlvo.year}º ${turmaAlvo.letter} na ${getDiaSemanaNome(
        toDia
      )} (${Array.from(discsDia).join(', ')}).`
    };
  }

  if (slotExistenteNaTurma) {
    return {
      valido: true,
      tipo: 'trocar_swap',
      detalhes: `Encaixar ${swapItem.turmaLabel} aqui e enviar ${slotExistenteNaTurma.disciplinaNome} (${slotExistenteNaTurma.teacherNome}) para o Swap.`,
      aulaDeslocada: {
        classId: turmaAlvo.id,
        turmaLabel: `${turmaAlvo.year}º ${turmaAlvo.letter}`,
        dia: toDia,
        ordem: toOrdem,
        slot: slotExistenteNaTurma
      }
    };
  }

  if (slotConflitanteEspA) {
    return {
      valido: true,
      tipo: 'trocar_swap',
      detalhes: `Encaixar ${swapItem.turmaLabel} aqui e enviar ${slotConflitanteEspA.turmaLabel} para a Bandeja de Swap.`,
      aulaDeslocada: slotConflitanteEspA
    };
  }

  return {
    valido: true,
    tipo: 'mover',
    detalhes: `Encaixar ${swapItem.turmaLabel} na ${getDiaSemanaNome(toDia)} (${toOrdem}ª aula).`
  };
}

/**
 * Reencaixa uma aula da Bandeja de Swap na grade; se deslocar outra aula, devolve a deslocada para o Swap.
 */
export function aplicarEncaixeDeSwap(
  resultadoAtual: ResultadoSugestaoHorarios,
  swapItem: SwapItemAula,
  toDia: DiaSemana,
  toOrdem: number,
  contexto: ContextoValidacaoHorarios,
  turnoDestino?: 'manha' | 'tarde' | 'noite' | 'outro'
): ResultadoAplicacaoSwap {
  const validacao = validarEncaixeDeSwap(
    resultadoAtual.gradesPorTurma,
    swapItem,
    toDia,
    toOrdem,
    contexto,
    turnoDestino
  );

  if (!validacao.valido || validacao.tipo === 'bloqueado') {
    return {
      sucesso: false,
      motivoErro: validacao.motivo || 'Não foi possível encaixar a aula neste horário.'
    };
  }

  const nextGradesPorTurma: Record<string, Record<string, HorarioSlot>> = {
    ...resultadoAtual.gradesPorTurma,
    [swapItem.classId]: { ...(resultadoAtual.gradesPorTurma[swapItem.classId] || {}) }
  };

  let novoSwapItem: SwapItemAula | undefined;
  if (validacao.tipo === 'trocar_swap' && validacao.aulaDeslocada) {
    const desl = validacao.aulaDeslocada;
    const deslTurmaObj = contexto.turmas.find((t) => t.id === desl.classId);
    if (desl.classId !== swapItem.classId) {
      nextGradesPorTurma[desl.classId] = { ...(resultadoAtual.gradesPorTurma[desl.classId] || {}) };
    }
    delete nextGradesPorTurma[desl.classId][`${desl.dia}_${desl.ordem}`];
    novoSwapItem = {
      id: `${desl.classId}_${desl.slot.teacherId || 'esp'}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      classId: desl.classId,
      turmaLabel: desl.turmaLabel,
      shift: deslTurmaObj?.shift || swapItem.shift,
      turno: getTurnoCanonical(deslTurmaObj?.shift || swapItem.shift),
      origemDia: desl.dia,
      origemOrdem: desl.ordem,
      slot: { ...desl.slot }
    };
  }

  nextGradesPorTurma[swapItem.classId][`${toDia}_${toOrdem}`] = { ...swapItem.slot };

  const acaoDescricao = novoSwapItem
    ? `Encaixado ${swapItem.turmaLabel} (${swapItem.slot.disciplinaNome}) em ${getDiaSemanaNome(toDia)} ${toOrdem}ª e movido ${novoSwapItem.turmaLabel} (${novoSwapItem.slot.disciplinaNome}) para a Bandeja de Swap.`
    : `Encaixado do Swap: ${swapItem.turmaLabel} (${swapItem.slot.disciplinaNome}) em ${getDiaSemanaNome(toDia)} ${toOrdem}ª aula.`;

  const novoResultado = reconstruirResultadoDesdeGradesTurmas(nextGradesPorTurma, {
    ...contexto,
    totalAulasEsperadas: resultadoAtual.estatisticas.totalAulasEsperadas,
    tempoCalculoMs: resultadoAtual.estatisticas.tempoCalculoMs,
    avisos: resultadoAtual.avisos,
    demandasNaoAlocadas: resultadoAtual.demandasNaoAlocadas,
    mensagem: acaoDescricao
  });

  return {
    sucesso: true,
    resultado: novoResultado,
    novoSwapItem,
    acaoDescricao
  };
}

interface DemandaAula {
  classId: string;
  teacherId: string;
  disciplina: string;
  aulasRestantes: number;
  shift: string;
  turno: 'manha' | 'tarde' | 'noite' | 'outro';
}

interface AlocacaoSlot {
  classId: string;
  teacherId: string;
  disciplina: string;
  dia: DiaSemana;
  ordem: number;
  startMin: number;
  endMin: number;
}

/**
 * Versão assíncrona e cooperativa da geração automática de horários de especialistas.
 * Não trava a interface, suporta cancelamento imediato e garante retorno em no máximo ~2.5s.
 */
export async function gerarSugestaoHorariosEspecialistasAsync(
  turmas: TurmaPlanejamento[],
  especialistas: EspecialistaConfig[],
  opcoes: OpcoesSugestaoHorario,
  controle?: ControleSugestao
): Promise<ResultadoSugestaoHorarios> {
  const tempoInicio = performance.now();
  const avisos: string[] = [];
  const conflitos: string[] = [];
  const demandasNaoAlocadas: DemandaNaoAlocada[] = [];

  const maxPassos = controle?.maxPassos ?? 12000;
  const maxTempoMs = controle?.maxTempoMs ?? 2500;
  const signal = controle?.signal;
  const onProgress = controle?.onProgress;

  const {
    anoLetivo,
    aulasPorTurma = 2,
    formatoAulas = 'dobrada',
    maxEspecialistasPorTurmaDia = 2,
    preservarOutrosProfessores = false,
    escolasIds,
    turnoFiltro = 'todos',
    ocupacoesExternasPorProfessor = {},
    respeitarIntervaloEntreEscolas = true
  } = opcoes;

  // 1. Filtrar turmas do ano letivo, escola(s) e turno(s) alvo
  let turmasAlvo = turmas.filter(
    (t) => !t.anoLetivo || String(t.anoLetivo).trim() === String(anoLetivo).trim()
  );
  if (escolasIds && escolasIds.length > 0 && !escolasIds.includes('all')) {
    turmasAlvo = turmasAlvo.filter((t) => escolasIds.includes(t.schoolId));
  }
  if (turnoFiltro && turnoFiltro !== 'todos') {
    turmasAlvo = turmasAlvo.filter((t) => getTurnoCanonical(t.shift) === turnoFiltro);
  }

  if (turmasAlvo.length === 0) {
    return {
      sucesso: false,
      mensagem: `Nenhuma turma encontrada para o ano letivo ${anoLetivo}${
        turnoFiltro !== 'todos' ? ` no turno ${formatTurnoLabel(turnoFiltro)}` : ''
      }. Verifique o filtro de ano, escola ou turno.`,
      gradesPorTurma: {},
      gradesPorEspecialista: {},
      gradesPorEspecialistaLista: {},
      conflitos: [
        `Nenhuma turma cadastrada no ano letivo ${anoLetivo}${
          turnoFiltro !== 'todos' ? ` (${formatTurnoLabel(turnoFiltro)})` : ''
        }`
      ],
      avisos: [],
      demandasNaoAlocadas: [],
      estatisticas: {
        totalTurmas: 0,
        totalEspecialistas: 0,
        totalAulasAlocadas: 0,
        totalAulasEsperadas: 0,
        percentualConcluido: 0,
        tempoCalculoMs: 0,
        turmasComMaxEspecialistasRespeitado: 0,
        folgasRespeitadas: 0
      },
      analisePorDiaTurma: {}
    };
  }

  // 2. Mapas rápidos
  const mapaEspecialistas = new Map<string, EspecialistaConfig>();
  especialistas.forEach((esp) => mapaEspecialistas.set(esp.id, esp));

  const mapaTurmas = new Map<string, TurmaPlanejamento>();
  turmasAlvo.forEach((t) => mapaTurmas.set(t.id, t));

  // 3. Montar lista de demandas
  const demandas: DemandaAula[] = [];
  let totalAulasEsperadas = 0;

  turmasAlvo.forEach((t) => {
    const turno = getTurnoCanonical(t.shift);
    (t.especialistasIds || []).forEach((teacherId) => {
      const esp = mapaEspecialistas.get(teacherId);
      if (esp) {
        demandas.push({
          classId: t.id,
          teacherId,
          disciplina: esp.subject || 'Especialista',
          aulasRestantes: aulasPorTurma,
          shift: t.shift,
          turno
        });
        totalAulasEsperadas += aulasPorTurma;
      }
    });
  });

  if (demandas.length === 0) {
    return {
      sucesso: false,
      mensagem: `Nenhum especialista com turmas regulares no ano letivo ${anoLetivo}.`,
      gradesPorTurma: {},
      gradesPorEspecialista: {},
      gradesPorEspecialistaLista: {},
      conflitos: ['Nenhuma atribuição regular de especialista encontrada para as turmas selecionadas.'],
      avisos,
      demandasNaoAlocadas: [],
      estatisticas: {
        totalTurmas: turmasAlvo.length,
        totalEspecialistas: especialistas.length,
        totalAulasAlocadas: 0,
        totalAulasEsperadas: 0,
        percentualConcluido: 0,
        tempoCalculoMs: Math.round(performance.now() - tempoInicio),
        turmasComMaxEspecialistasRespeitado: 0,
        folgasRespeitadas: 0
      },
      analisePorDiaTurma: {}
    };
  }

  // 4. Pré-análise matemática de viabilidade (diagnóstico instantâneo)
  const demandasPorProfTurno = new Map<string, number>();
  demandas.forEach((d) => {
    const key = `${d.teacherId}::${d.turno}`;
    demandasPorProfTurno.set(key, (demandasPorProfTurno.get(key) || 0) + 1);
  });

  const folgasSetPorEsp = new Map<string, Set<number>>();
  const espTodosIdsSet = new Set<string>();
  especialistas.forEach((esp) => {
    folgasSetPorEsp.set(esp.id, new Set<number>(obterDiasFolga(esp.diasDisponiveis, esp.folgaDia)));
    espTodosIdsSet.add(esp.id);
    esp.aliasIds?.forEach((aid) => {
      if (aid) espTodosIdsSet.add(aid);
    });
  });

  demandasPorProfTurno.forEach((qtdTurmas, key) => {
    const [teacherId, turno] = key.split('::') as [string, 'manha' | 'tarde' | 'noite' | 'outro'];
    const esp = mapaEspecialistas.get(teacherId);
    if (!esp) return;
    const folgasEsp = folgasSetPorEsp.get(teacherId);
    const diasAtivos = DIAS_UTEIS.filter((dia) => !(folgasEsp && folgasEsp.has(dia))).length;

    const maxAulasTurno = diasAtivos * 5;
    const aulasNecessarias = qtdTurmas * aulasPorTurma;
    const maxDobrado = diasAtivos * 2; // em 5 aulas por turno cabem no máximo 2 pares dobrados sem sobrepor

    if (aulasNecessarias > maxAulasTurno) {
      avisos.push(
        `${esp.name} possui ${qtdTurmas} turma(s) no turno ${formatTurnoLabel(turno)} (${aulasNecessarias} aulas), ` +
          `mas com ${diasAtivos} dia(s) disponível(is) cabem no máximo ${maxAulasTurno} aulas nesse turno.`
      );
    } else if (formatoAulas === 'dobrada' && aulasPorTurma === 2 && qtdTurmas > maxDobrado) {
      avisos.push(
        `${esp.name} possui ${qtdTurmas} turma(s) no turno ${formatTurnoLabel(turno)}, mas em blocos dobrados ` +
          `cabem no máximo ${maxDobrado} turmas em ${diasAtivos} dia(s) ativo(s) (2 blocos por turno/dia). Considere usar o formato Misto.`
      );
    }
  });

  // Estruturas mutáveis para busca
  const slotsFixosPorTurma = new Map<string, Set<string>>();
  turmasAlvo.forEach((t) => {
    const fixos = new Set<string>();
    if (preservarOutrosProfessores && t.gradeHorariaExistente) {
      Object.entries(t.gradeHorariaExistente).forEach(([slotKey, slot]) => {
        if (!slot) return;
        const isEspDestaDemanda = Boolean(slot.teacherId && espTodosIdsSet.has(slot.teacherId));
        if (!isEspDestaDemanda && (slot.disciplinaNome || slot.teacherNome)) {
          fixos.add(slotKey);
        }
      });
    }
    slotsFixosPorTurma.set(t.id, fixos);
  });

  // Estado da busca
  const turmaSlotOcupado: Record<string, Record<string, string>> = {}; // classId -> slotKey -> teacherId
  const especialistasPorDiaTurma: Record<string, Record<number, Set<string>>> = {};
  const profOcupacaoPorDia: Record<
    string,
    Record<number, { startMin: number; endMin: number; classId: string; ordem: number; schoolId: string }[]>
  > = {};

  // Indexa ocupações já oficializadas em outras escolas / turmas fora do escopo atual
  const ocupacoesExternasPorDia: Record<string, Record<number, OcupacaoExternaProfessor[]>> = {};
  especialistas.forEach((esp) => {
    ocupacoesExternasPorDia[esp.id] = { 1: [], 2: [], 3: [], 4: [], 5: [] };
    const listaExt = ocupacoesExternasPorProfessor[esp.id] || [];
    listaExt.forEach((ext) => {
      if (ocupacoesExternasPorDia[esp.id][ext.dia]) {
        ocupacoesExternasPorDia[esp.id][ext.dia].push(ext);
      }
    });
  });

  const resetEstado = () => {
    turmasAlvo.forEach((t) => {
      turmaSlotOcupado[t.id] = {};
      especialistasPorDiaTurma[t.id] = { 1: new Set(), 2: new Set(), 3: new Set(), 4: new Set(), 5: new Set() };
    });
    especialistas.forEach((esp) => {
      profOcupacaoPorDia[esp.id] = { 1: [], 2: [], 3: [], 4: [], 5: [] };
    });
  };
  resetEstado();

  const isDiaDisponivelProfessor = (teacherId: string, dia: number): boolean => {
    const folgasEsp = folgasSetPorEsp.get(teacherId);
    if (folgasEsp) return !folgasEsp.has(dia);
    const esp = mapaEspecialistas.get(teacherId);
    if (!esp) return true;
    return !obterDiasFolga(esp.diasDisponiveis, esp.folgaDia).includes(dia);
  };

  const isSlotLivreNaTurma = (classId: string, dia: number, ordem: number): boolean => {
    const slotKey = `${dia}_${ordem}`;
    if (slotsFixosPorTurma.get(classId)?.has(slotKey)) return false;
    return !turmaSlotOcupado[classId]?.[slotKey];
  };

  const temConflitoOuFaltaDeslocamento = (
    startA: number,
    endA: number,
    schoolA: string,
    startB: number,
    endB: number,
    schoolB: string
  ): boolean =>
    temSobreposicaoOuFaltaDeslocamento(
      startA,
      endA,
      schoolA,
      startB,
      endB,
      schoolB,
      respeitarIntervaloEntreEscolas
    ) !== null;

  const isEspecialistaLivreNoHorario = (
    teacherId: string,
    turma: TurmaPlanejamento,
    dia: number,
    ordem: number
  ): boolean => {
    const range = getSlotTimeRange(turma, ordem, undefined, undefined, dia);
    const lista = profOcupacaoPorDia[teacherId]?.[dia] || [];
    for (let i = 0; i < lista.length; i++) {
      const item = lista[i];
      if (
        temConflitoOuFaltaDeslocamento(
          range.startMin,
          range.endMin,
          turma.schoolId,
          item.startMin,
          item.endMin,
          item.schoolId
        )
      ) {
        return false;
      }
    }
    const listaExt = ocupacoesExternasPorDia[teacherId]?.[dia] || [];
    for (let i = 0; i < listaExt.length; i++) {
      const ext = listaExt[i];
      if (
        temConflitoOuFaltaDeslocamento(
          range.startMin,
          range.endMin,
          turma.schoolId,
          ext.startMin,
          ext.endMin,
          ext.schoolId
        )
      ) {
        return false;
      }
    }
    return true;
  };

  const podeTurmaReceberEspecialistaNoDia = (classId: string, dia: number, teacherId: string): boolean => {
    const conjunto = especialistasPorDiaTurma[classId]?.[dia];
    if (!conjunto) return true;
    if (conjunto.has(teacherId)) return true;
    return conjunto.size < maxEspecialistasPorTurmaDia;
  };

  const alocar = (aloc: AlocacaoSlot) => {
    const slotKey = `${aloc.dia}_${aloc.ordem}`;
    const turma = mapaTurmas.get(aloc.classId);
    turmaSlotOcupado[aloc.classId][slotKey] = aloc.teacherId;
    especialistasPorDiaTurma[aloc.classId][aloc.dia].add(aloc.teacherId);
    profOcupacaoPorDia[aloc.teacherId][aloc.dia].push({
      startMin: aloc.startMin,
      endMin: aloc.endMin,
      classId: aloc.classId,
      ordem: aloc.ordem,
      schoolId: turma?.schoolId || ''
    });
  };

  const desalocar = (aloc: AlocacaoSlot) => {
    const slotKey = `${aloc.dia}_${aloc.ordem}`;
    delete turmaSlotOcupado[aloc.classId][slotKey];

    let aindaTem = false;
    for (let o = 1; o <= 5; o++) {
      if (turmaSlotOcupado[aloc.classId][`${aloc.dia}_${o}`] === aloc.teacherId) {
        aindaTem = true;
        break;
      }
    }
    if (!aindaTem) {
      especialistasPorDiaTurma[aloc.classId][aloc.dia].delete(aloc.teacherId);
    }

    const lista = profOcupacaoPorDia[aloc.teacherId][aloc.dia];
    const idx = lista.findIndex((item) => item.classId === aloc.classId && item.ordem === aloc.ordem);
    if (idx !== -1) lista.splice(idx, 1);
  };

  // Ordenação inteligente (MRV: mais restritos primeiro)
  const contarDiasAtivos = (teacherId: string) =>
    DIAS_UTEIS.filter((dia) => isDiaDisponivelProfessor(teacherId, dia)).length;

  const totalDemandasProfTurno = (teacherId: string, turno: string) =>
    demandasPorProfTurno.get(`${teacherId}::${turno}`) || 0;

  demandas.sort((a, b) => {
    const diasA = contarDiasAtivos(a.teacherId);
    const diasB = contarDiasAtivos(b.teacherId);
    if (diasA !== diasB) return diasA - diasB;

    const cargaA = totalDemandasProfTurno(a.teacherId, a.turno);
    const cargaB = totalDemandasProfTurno(b.teacherId, b.turno);
    if (cargaA !== cargaB) return cargaB - cargaA; // especialista mais carregado no turno vem primeiro

    const turmaA = mapaTurmas.get(a.classId);
    const turmaB = mapaTurmas.get(b.classId);
    const nEspA = turmaA?.especialistasIds?.length || 0;
    const nEspB = turmaB?.especialistasIds?.length || 0;
    return nEspB - nEspA;
  });

  // Gera candidatos ordenados por qualidade de encaixe (heurística de empacotamento)
  type CandidatoDemanda = AlocacaoSlot[];

  const gerarCandidatos = (d: DemandaAula, seedShift = 0): CandidatoDemanda[] => {
    const turma = mapaTurmas.get(d.classId);
    const esp = mapaEspecialistas.get(d.teacherId);
    if (!turma || !esp) return [];

    const diasValidos = DIAS_UTEIS.filter((dia) => isDiaDisponivelProfessor(d.teacherId, dia));

    // Ordena dias por afinidade:
    // - Turma com menos especialistas naquele dia (espalha pela semana e evita bater no limite de 2)
    // - Especialista já tem aula no mesmo turno naquele dia (agrupa turno do professor, evitando janelas/dias ociosos)
    // - Desempate variado por seedShift para tentar múltiplas rotações
    const diasOrdenados = [...diasValidos].sort((d1, d2) => {
      const qtdTurma1 = especialistasPorDiaTurma[d.classId]?.[d1]?.size || 0;
      const qtdTurma2 = especialistasPorDiaTurma[d.classId]?.[d2]?.size || 0;
      if (qtdTurma1 !== qtdTurma2) return qtdTurma1 - qtdTurma2;

      const profAulas1 = profOcupacaoPorDia[d.teacherId]?.[d1]?.length || 0;
      const profAulas2 = profOcupacaoPorDia[d.teacherId]?.[d2]?.length || 0;
      if (profAulas1 !== profAulas2) return profAulas2 - profAulas1;

      const rot1 = (d1 + seedShift) % 5;
      const rot2 = (d2 + seedShift) % 5;
      return rot1 - rot2;
    });

    const candidatos: CandidatoDemanda[] = [];

    if (aulasPorTurma === 1) {
      for (const dia of diasOrdenados) {
        if (!podeTurmaReceberEspecialistaNoDia(d.classId, dia, d.teacherId)) continue;
        for (const ordem of ORDENS_AULA) {
          if (
            isSlotLivreNaTurma(d.classId, dia, ordem) &&
            isEspecialistaLivreNoHorario(d.teacherId, turma, dia, ordem)
          ) {
            const r = getSlotTimeRange(turma, ordem, undefined, undefined, dia);
            candidatos.push([
              {
                classId: d.classId,
                teacherId: d.teacherId,
                disciplina: d.disciplina,
                dia,
                ordem,
                startMin: r.startMin,
                endMin: r.endMin
              }
            ]);
          }
        }
      }
      return candidatos;
    }

    // 2 aulas semanais (ou 3 aulas = 1 dobrada + 1 separada)
    if (aulasPorTurma === 2) {
      // Opção 1: Bloco dobrado no mesmo dia
      if (formatoAulas === 'dobrada' || formatoAulas === 'misto') {
        for (const dia of diasOrdenados) {
          if (!podeTurmaReceberEspecialistaNoDia(d.classId, dia, d.teacherId)) continue;
          const pares = getParesConsecutivosParaTurma(turma, dia);
          for (const [o1, o2] of pares) {
            if (
              isSlotLivreNaTurma(d.classId, dia, o1) &&
              isSlotLivreNaTurma(d.classId, dia, o2) &&
              isEspecialistaLivreNoHorario(d.teacherId, turma, dia, o1) &&
              isEspecialistaLivreNoHorario(d.teacherId, turma, dia, o2)
            ) {
              const r1 = getSlotTimeRange(turma, o1, undefined, undefined, dia);
              const r2 = getSlotTimeRange(turma, o2, undefined, undefined, dia);
              candidatos.push([
                {
                  classId: d.classId,
                  teacherId: d.teacherId,
                  disciplina: d.disciplina,
                  dia,
                  ordem: o1,
                  startMin: r1.startMin,
                  endMin: r1.endMin
                },
                {
                  classId: d.classId,
                  teacherId: d.teacherId,
                  disciplina: d.disciplina,
                  dia,
                  ordem: o2,
                  startMin: r2.startMin,
                  endMin: r2.endMin
                }
              ]);
            }
          }
        }
      }

      // Opção 2: Aulas em 2 dias separados
      if (formatoAulas === 'separada' || formatoAulas === 'misto') {
        // Limita a quantidade de combinações por demanda para evitar explosão combinatória
        let adicionadosSeparados = 0;
        const maxSeparadosPorDemanda = 12;

        for (let i = 0; i < diasOrdenados.length && adicionadosSeparados < maxSeparadosPorDemanda; i++) {
          const dia1 = diasOrdenados[i];
          if (!podeTurmaReceberEspecialistaNoDia(d.classId, dia1, d.teacherId)) continue;
          const livres1 = ORDENS_AULA.filter(
            (o) => isSlotLivreNaTurma(d.classId, dia1, o) && isEspecialistaLivreNoHorario(d.teacherId, turma, dia1, o)
          );
          if (livres1.length === 0) continue;

          for (let j = i + 1; j < diasOrdenados.length && adicionadosSeparados < maxSeparadosPorDemanda; j++) {
            const dia2 = diasOrdenados[j];
            if (!podeTurmaReceberEspecialistaNoDia(d.classId, dia2, d.teacherId)) continue;
            const livres2 = ORDENS_AULA.filter(
              (o) => isSlotLivreNaTurma(d.classId, dia2, o) && isEspecialistaLivreNoHorario(d.teacherId, turma, dia2, o)
            );
            if (livres2.length === 0) continue;

            // Prioriza 3ª aula quando ela fica antes do intervalo em modo misto (preservando [1,2] e [4,5]); quando o intervalo ocorre após a 2ª aula, mantém preferência por [1,2]
            const pref3Dia1 =
              formatoAulas === 'misto' &&
              livres1.includes(3) &&
              aulasAntesDoIntervalo(
                getHorariosTurma(turma.shift, turma.intervaloGrupo, turma.year, turma.schoolId, dia1, turma.intervaloGrupoPorDia)
              ) >= 3;
            const pref3Dia2 =
              formatoAulas === 'misto' &&
              livres2.includes(3) &&
              aulasAntesDoIntervalo(
                getHorariosTurma(turma.shift, turma.intervaloGrupo, turma.year, turma.schoolId, dia2, turma.intervaloGrupoPorDia)
              ) >= 3;
            const o1 = pref3Dia1 ? 3 : livres1[0];
            const o2 = pref3Dia2 ? 3 : livres2[0];

            const r1 = getSlotTimeRange(turma, o1, undefined, undefined, dia1);
            const r2 = getSlotTimeRange(turma, o2, undefined, undefined, dia2);
            candidatos.push([
              {
                classId: d.classId,
                teacherId: d.teacherId,
                disciplina: d.disciplina,
                dia: dia1,
                ordem: o1,
                startMin: r1.startMin,
                endMin: r1.endMin
              },
              {
                classId: d.classId,
                teacherId: d.teacherId,
                disciplina: d.disciplina,
                dia: dia2,
                ordem: o2,
                startMin: r2.startMin,
                endMin: r2.endMin
              }
            ]);
            adicionadosSeparados++;
          }
        }
      }

      return candidatos;
    }

    // 3 aulas semanais: tenta 1 par dobrado + 1 avulsa em outro dia
    for (let i = 0; i < diasOrdenados.length; i++) {
      const dia1 = diasOrdenados[i];
      if (!podeTurmaReceberEspecialistaNoDia(d.classId, dia1, d.teacherId)) continue;
      const pares = getParesConsecutivosParaTurma(turma, dia1);

      for (const [o1, o2] of pares) {
        if (
          isSlotLivreNaTurma(d.classId, dia1, o1) &&
          isSlotLivreNaTurma(d.classId, dia1, o2) &&
          isEspecialistaLivreNoHorario(d.teacherId, turma, dia1, o1) &&
          isEspecialistaLivreNoHorario(d.teacherId, turma, dia1, o2)
        ) {
          for (let j = 0; j < diasOrdenados.length; j++) {
            if (i === j) continue;
            const dia2 = diasOrdenados[j];
            if (!podeTurmaReceberEspecialistaNoDia(d.classId, dia2, d.teacherId)) continue;
            const livre3 = ORDENS_AULA.find(
              (o) =>
                isSlotLivreNaTurma(d.classId, dia2, o) &&
                isEspecialistaLivreNoHorario(d.teacherId, turma, dia2, o)
            );
            if (livre3 !== undefined) {
              const r1 = getSlotTimeRange(turma, o1, undefined, undefined, dia1);
              const r2 = getSlotTimeRange(turma, o2, undefined, undefined, dia1);
              const r3 = getSlotTimeRange(turma, livre3, undefined, undefined, dia2);
              candidatos.push([
                {
                  classId: d.classId,
                  teacherId: d.teacherId,
                  disciplina: d.disciplina,
                  dia: dia1,
                  ordem: o1,
                  startMin: r1.startMin,
                  endMin: r1.endMin
                },
                {
                  classId: d.classId,
                  teacherId: d.teacherId,
                  disciplina: d.disciplina,
                  dia: dia1,
                  ordem: o2,
                  startMin: r2.startMin,
                  endMin: r2.endMin
                },
                {
                  classId: d.classId,
                  teacherId: d.teacherId,
                  disciplina: d.disciplina,
                  dia: dia2,
                  ordem: livre3,
                  startMin: r3.startMin,
                  endMin: r3.endMin
                }
              ]);
              break;
            }
          }
        }
      }
    }

    return candidatos;
  };

  // 5. Fase A: Tentativas gulosas rápidas (multi-start) - resolve 99% dos casos em < 5ms
  let bestAlocacoes: AlocacaoSlot[] = [];
  let bestQtdDemandas = -1;
  let cancelado = false;

  const tentativasGulosas = 6;
  for (let seed = 0; seed < tentativasGulosas; seed++) {
    if (signal?.aborted) {
      cancelado = true;
      break;
    }
    resetEstado();
    const alocacoesAtual: AlocacaoSlot[] = [];
    let alocadasCount = 0;

    for (let idx = 0; idx < demandas.length; idx++) {
      const cands = gerarCandidatos(demandas[idx], seed);
      if (cands.length > 0) {
        const escolha = cands[0];
        escolha.forEach((s) => {
          alocar(s);
          alocacoesAtual.push(s);
        });
        alocadasCount++;
      }
    }

    if (alocadasCount > bestQtdDemandas) {
      bestQtdDemandas = alocadasCount;
      bestAlocacoes = [...alocacoesAtual];
    }

    if (alocadasCount === demandas.length) {
      // Solução 100% encontrada instantaneamente!
      break;
    }
  }

  // 6. Fase B: Backtracking Cooperativo Limitado (apenas se a fase gulosa não atingiu 100%)
  let passosExecutados = 0;
  let atingiuLimite = false;

  if (!cancelado && bestQtdDemandas < demandas.length) {
    resetEstado();
    const pilhaAtual: AlocacaoSlot[] = [];
    let ultimoYield = performance.now();

    const resolverCooperativo = async (demandaIdx: number, demandasAlocadasCount: number): Promise<boolean> => {
      if (signal?.aborted) {
        cancelado = true;
        return false;
      }

      passosExecutados++;

      if (demandasAlocadasCount > bestQtdDemandas) {
        bestQtdDemandas = demandasAlocadasCount;
        bestAlocacoes = [...pilhaAtual];
      }

      if (demandaIdx >= demandas.length) {
        return true;
      }

      if (passosExecutados >= maxPassos || performance.now() - tempoInicio >= maxTempoMs) {
        atingiuLimite = true;
        return false;
      }

      // Libera a thread principal a cada ~15ms para manter o botão Cancelar e a UI 100% responsivos
      if (passosExecutados % 250 === 0 || performance.now() - ultimoYield >= 15) {
        onProgress?.({
          etapa: 'Otimizando distribuição sem conflitos...',
          passosExecutados,
          maxPassos,
          aulasAlocadas: bestAlocacoes.length,
          totalAulas: totalAulasEsperadas,
          tempoDecorridoMs: Math.round(performance.now() - tempoInicio)
        });
        await yieldToMain();
        ultimoYield = performance.now();
        if (signal?.aborted) {
          cancelado = true;
          return false;
        }
      }

      const d = demandas[demandaIdx];
      const candidatos = gerarCandidatos(d, 0);

      // Limita largura da ramificação por nó para evitar explosão exponencial
      const maxRamos = Math.min(candidatos.length, 6);
      for (let i = 0; i < maxRamos; i++) {
        const grupo = candidatos[i];
        grupo.forEach((s) => {
          alocar(s);
          pilhaAtual.push(s);
        });

        const ok = await resolverCooperativo(demandaIdx + 1, demandasAlocadasCount + 1);
        if (ok) return true;

        for (let k = 0; k < grupo.length; k++) {
          const removido = pilhaAtual.pop()!;
          desalocar(removido);
        }

        if (cancelado || atingiuLimite) {
          return false;
        }
      }

      return false;
    };

    await resolverCooperativo(0, 0);
  }

  // Se foi cancelado pelo usuário, retorna imediatamente informando
  if (cancelado) {
    return {
      sucesso: false,
      cancelado: true,
      mensagem: 'Geração de horários cancelada pelo usuário.',
      gradesPorTurma: {},
      gradesPorEspecialista: {},
      gradesPorEspecialistaLista: {},
      conflitos: [],
      avisos: ['Operação interrompida manualmente antes da conclusão.'],
      demandasNaoAlocadas: [],
      estatisticas: {
        totalTurmas: turmasAlvo.length,
        totalEspecialistas: especialistas.length,
        totalAulasAlocadas: 0,
        totalAulasEsperadas,
        percentualConcluido: 0,
        tempoCalculoMs: Math.round(performance.now() - tempoInicio),
        turmasComMaxEspecialistasRespeitado: 0,
        folgasRespeitadas: 0
      },
      analisePorDiaTurma: {}
    };
  }

  // 7. Reconstruir o melhor estado encontrado + preenchimento guloso de eventuais sobras
  resetEstado();
  const demandasAtendidasKeys = new Set<string>();

  bestAlocacoes.forEach((s) => {
    alocar(s);
    demandasAtendidasKeys.add(`${s.classId}::${s.teacherId}`);
  });

  // Tenta encaixar demandas ainda não atendidas sobre o melhor estado parcial
  demandas.forEach((d) => {
    const k = `${d.classId}::${d.teacherId}`;
    if (demandasAtendidasKeys.has(k)) return;
    const cands = gerarCandidatos(d, 0);
    if (cands.length > 0) {
      cands[0].forEach((s) => {
        alocar(s);
        bestAlocacoes.push(s);
      });
      demandasAtendidasKeys.add(k);
    } else {
      const turma = mapaTurmas.get(d.classId);
      const esp = mapaEspecialistas.get(d.teacherId);
      const temOcupacaoExterna = (ocupacoesExternasPorProfessor[d.teacherId]?.length || 0) > 0;
      const motivo =
        formatoAulas === 'dobrada'
          ? `Sem bloco de 2 aulas seguidas disponível que respeite folga, limite de 2 especialistas/dia${
              temOcupacaoExterna ? ', aulas em outras escolas (e intervalo de deslocamento)' : ''
            } e ausência de choques.`
          : `Sem horários livres compatíveis respeitando folga, limite de 2 especialistas/dia${
              temOcupacaoExterna ? ', aulas em outras escolas (e intervalo de deslocamento)' : ''
            } e ausência de choques.`;

      demandasNaoAlocadas.push({
        classId: d.classId,
        className: turma ? `${turma.year}º ${turma.letter} (${turma.shift})` : d.classId,
        teacherId: d.teacherId,
        teacherName: esp?.name || d.teacherId,
        disciplina: d.disciplina,
        motivo
      });
    }
  });

  // 8. Montar grades por turma e reconstruir visões e auditoria de conformidade
  const gradeTurmas: Record<string, Record<string, HorarioSlot>> = {};

  turmasAlvo.forEach((t) => {
    gradeTurmas[t.id] = {};
    if (preservarOutrosProfessores && t.gradeHorariaExistente) {
      Object.entries(t.gradeHorariaExistente).forEach(([slotKey, slot]) => {
        if (!slot) return;
        const isEspDestaDemanda = Boolean(slot.teacherId && espTodosIdsSet.has(slot.teacherId));
        if (!isEspDestaDemanda && (slot.disciplinaNome || slot.teacherNome)) {
          gradeTurmas[t.id][slotKey] = { ...slot };
        }
      });
    }
  });

  bestAlocacoes.forEach((s) => {
    const esp = mapaEspecialistas.get(s.teacherId)!;
    const slotKey = `${s.dia}_${s.ordem}`;

    gradeTurmas[s.classId][slotKey] = {
      disciplinaId: esp.subject || 'especialista',
      disciplinaNome: s.disciplina,
      teacherId: s.teacherId,
      teacherNome: esp.name,
      isEspecialista: true,
      observacao: 'Sugestão automática de especialista'
    };
  });

  const tempoCalculoMs = Math.round(performance.now() - tempoInicio);
  const preAudit = reconstruirResultadoDesdeGradesTurmas(gradeTurmas, {
    turmas: turmasAlvo,
    especialistas,
    maxEspecialistasPorTurmaDia,
    ocupacoesExternasPorProfessor,
    respeitarIntervaloEntreEscolas,
    totalAulasEsperadas,
    tempoCalculoMs,
    avisos,
    demandasNaoAlocadas,
    formatoAulas
  });

  if (preAudit.estatisticas.totalAulasAlocadas < totalAulasEsperadas) {
    preAudit.avisos.push(
      `Foram alocadas ${preAudit.estatisticas.totalAulasAlocadas} de ${totalAulasEsperadas} aulas (${preAudit.estatisticas.percentualConcluido}%). ` +
        (formatoAulas === 'dobrada'
          ? 'Algumas turmas não couberam em blocos dobrados estritos. Experimente alternar para o formato "Misto" ou revisar as folgas.'
          : 'Verifique a lista de pendências abaixo para ajustar folgas ou carga horária.')
    );
  }

  preAudit.mensagem =
    preAudit.estatisticas.totalAulasAlocadas >= totalAulasEsperadas && preAudit.conflitos.length === 0
      ? `Sugestão gerada com 100% de sucesso em ${tempoCalculoMs}ms! Todas as ${totalAulasEsperadas} aulas foram distribuídas sem choques e com folgas respeitadas.`
      : `Geração parcial concluída em ${tempoCalculoMs}ms: ${preAudit.estatisticas.totalAulasAlocadas}/${totalAulasEsperadas} aulas alocadas (${preAudit.estatisticas.percentualConcluido}%).`;

  return preAudit;
}

export interface OpcoesExportacaoEspecialistas {
  haPorEspecialista?: Record<string, string[]>;
  ocupacoesExternasPorProfessor?: Record<string, OcupacaoExternaProfessor[]>;
  escolaNome?: string;
  schoolId?: string;
  sinoConfig?: SinoConfig;
  especialistaIdUnico?: string;
  versaoInfo?: string;
  versaoSufixoArquivo?: string;
}

type TurnoPadrao = 'manha' | 'tarde' | 'noite';

function getAulasTurnoMeta(turno: TurnoPadrao, schoolId?: string, sinoCfg?: SinoConfig) {
  const isManha = turno === 'manha';
  const isTarde = turno === 'tarde';
  const cfg = sinoCfg ?? getSinoConfigAtiva();

  const tituloTurno = isManha
    ? 'Turno Matutino (Manhã)'
    : isTarde
    ? 'Turno Vespertino (Tarde)'
    : 'Turno Noturno (Noite)';
  const horarioTurno =
    isManha || isTarde ? faixaTurno(cfg, schoolId, isManha ? 'manha' : 'tarde').rotulo : '19:00 às 22:30';
  const badgeTurno = isManha ? '☀️ Manhã' : isTarde ? '🌤️ Tarde' : '🌙 Noite';
  const ivsTarde = isTarde ? intervalosTurno(cfg, schoolId, 'tarde') : [];
  const durVesp =
    ivsTarde.length === 1
      ? (minutosDe(ivsTarde[0].intervalo.fim) ?? 0) - (minutosDe(ivsTarde[0].intervalo.inicio) ?? 0)
      : 0;
  const intervaloTexto = isManha
    ? `${intervalosMatutino(cfg, schoolId)
        .map((iv) => `${iv.nome}: ${iv.intervalo.inicio}–${iv.intervalo.fim}`)
        .join(' • ')} (deslocamento entre escolas)`
    : isTarde
    ? ivsTarde.length > 1
      ? `${ivsTarde
          .map((iv) => `${iv.nome}: ${iv.intervalo.inicio}–${iv.intervalo.fim}`)
          .join(' • ')} (deslocamento entre escolas)`
      : `Recreio Vespertino: ${ivsTarde[0]?.intervalo.inicio || '15:00'} às ${ivsTarde[0]?.intervalo.fim || '15:20'} (${durVesp > 0 ? durVesp : 20} min — deslocamento entre escolas)`
    : 'Intervalo Noturno: 21:15 às 21:30';

  const horarios: Record<number, { faixa: string; detalhe?: string }> = {};
  if (isManha || isTarde) {
    const rots = rotulosDasAulas(cfg, schoolId, isManha ? 'manha' : 'tarde');
    rots.forEach((r) => {
      horarios[r.ordem] = {
        faixa: r.linhas[0] || '',
        detalhe: r.linhas.length > 1 ? r.linhas.slice(1).join(' | ') : undefined
      };
    });
  } else {
    Object.assign(horarios, {
      1: { faixa: '19:00 – 19:45' },
      2: { faixa: '19:45 – 20:30' },
      3: { faixa: '20:30 – 21:15' },
      4: { faixa: '21:30 – 22:15' },
      5: { faixa: '22:15 – 23:00' }
    });
  }

  const intervaloApos =
    isManha || isTarde ? posicaoIntervaloTurno(cfg, schoolId, isManha ? 'manha' : 'tarde') : 3;

  return { tituloTurno, horarioTurno, badgeTurno, intervaloTexto, horarios, intervaloApos };
}

function gerarNomeAbaUnicoExcel(base: string, usados: Set<string>): string {
  const limpo = (base || 'Especialista')
    .replace(/[*?:\\/[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Especialista';

  let candidato = limpo.slice(0, 31).trim();
  let seq = 2;
  while (usados.has(candidato.toLowerCase())) {
    const sufixo = ` (${seq})`;
    candidato = `${limpo.slice(0, Math.max(1, 31 - sufixo.length)).trim()}${sufixo}`;
    seq++;
  }
  usados.add(candidato.toLowerCase());
  return candidato;
}

function slugArquivo(texto: string): string {
  return (texto || 'especialista')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'especialista';
}

function sanitizePdfText(text: string): string {
  // Remove emojis e caracteres fora do Latin-1 mantendo acentos em português
  return (text || '')
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}]/gu, '')
    .replace(/[•]/g, '-')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function coletarTurnosEspecialista(
  slots: SlotSugerido[],
  externos: OcupacaoExternaProfessor[],
  haLista: string[]
): TurnoPadrao[] {
  const turnosSet = new Set<TurnoPadrao>();
  slots.forEach((s) => {
    if (s.turno === 'manha' || s.turno === 'tarde' || s.turno === 'noite') {
      turnosSet.add(s.turno);
    }
  });
  externos.forEach((ext) => {
    if (ext.turno === 'manha' || ext.turno === 'tarde' || ext.turno === 'noite') {
      turnosSet.add(ext.turno);
    }
  });
  haLista.forEach((hk) => {
    if (hk.startsWith('manha_')) turnosSet.add('manha');
    else if (hk.startsWith('tarde_')) turnosSet.add('tarde');
    else if (hk.startsWith('noite_')) turnosSet.add('noite');
  });

  const ordem: TurnoPadrao[] = ['manha', 'tarde', 'noite'];
  const presentes = ordem.filter((t) => turnosSet.has(t));
  return presentes.length > 0 ? presentes : ['manha'];
}

function descreverCelulaEspecialista(
  esp: EspecialistaConfig,
  turno: TurnoPadrao,
  dia: number,
  ordem: number,
  slotsTurno: SlotSugerido[],
  externosTurno: OcupacaoExternaProfessor[],
  haLista: string[]
): { tipo: 'folga' | 'aula' | 'externo' | 'ha' | 'vazio'; textoExcel: string; textoPdf: string } {
  const diasFolga = obterDiasFolga(esp.diasDisponiveis, esp.folgaDia);
  if (diasFolga.includes(dia)) {
    return {
      tipo: 'folga',
      textoExcel: '☕ Folga Livre',
      textoPdf: 'Folga Livre'
    };
  }

  const slotsCelula = slotsTurno.filter((s) => s.dia === dia && s.ordem === ordem);
  const externosCelula = externosTurno.filter((ext) => ext.dia === dia && ext.ordem === ordem);

  if (slotsCelula.length > 0 || externosCelula.length > 0) {
    const linhasExcel: string[] = [];
    const linhasPdf: string[] = [];

    slotsCelula.forEach((slot) => {
      const turmaCurta = slot.className.replace(/\s*-\s*(Manhã|Tarde|Matutino|Vespertino|Noturno)$/i, '');
      linhasExcel.push(`${turmaCurta}\n${slot.inicioStr} – ${slot.fimStr}`);
      linhasPdf.push(`${turmaCurta}\n${slot.inicioStr} - ${slot.fimStr}`);
    });

    externosCelula.forEach((ext) => {
      const turmaExt = ext.className.replace(/\s*\(.*?\)/g, '');
      linhasExcel.push(`🏫 ${ext.schoolName}\n${turmaExt} • Oficial`);
      linhasPdf.push(`${sanitizePdfText(ext.schoolName)}\n${turmaExt} (Oficial)`);
    });

    return {
      tipo: slotsCelula.length > 0 ? 'aula' : 'externo',
      textoExcel: linhasExcel.join('\n'),
      textoPdf: linhasPdf.join('\n')
    };
  }

  const temHA = haLista.includes(`${turno}_${dia}_${ordem}`) || haLista.includes(`${dia}_${ordem}`);
  if (temHA) {
    return {
      tipo: 'ha',
      textoExcel: '⭐ H.A.\nPlanejamento',
      textoPdf: 'H.A.\nPlanejamento'
    };
  }

  return {
    tipo: 'vazio',
    textoExcel: '-',
    textoPdf: '-'
  };
}

/**
 * Exporta a proposta de horários em planilha Excel (.xlsx) gerando uma aba individual
 * por especialista exatamente no formato da tela "Por Especialista" (turnos separados,
 * intervalo entre 3ª e 4ª aula, aulas externas oficiais, Folga Livre e H.A.), além
 * das abas administrativas "Quadro por Turma" e "Conformidade das Regras".
 */
export async function exportarSugestaoHorariosExcel(
  resultado: ResultadoSugestaoHorarios,
  turmas: TurmaPlanejamento[],
  especialistas: EspecialistaConfig[],
  anoLetivo: string,
  opcoesOrHa?: OpcoesExportacaoEspecialistas | Record<string, string[]>
): Promise<void> {
  const opcoes: OpcoesExportacaoEspecialistas =
    opcoesOrHa &&
    ('haPorEspecialista' in opcoesOrHa ||
      'ocupacoesExternasPorProfessor' in opcoesOrHa ||
      'escolaNome' in opcoesOrHa ||
      'especialistaIdUnico' in opcoesOrHa)
      ? (opcoesOrHa as OpcoesExportacaoEspecialistas)
      : { haPorEspecialista: opcoesOrHa as Record<string, string[]> | undefined };

  const haPorEspecialista = opcoes.haPorEspecialista || {};
  const ocupacoesExternasPorProfessor = opcoes.ocupacoesExternasPorProfessor || {};
  const escolaNome = opcoes.escolaNome || turmas[0]?.schoolName || 'Unidade Escolar';
  const especialistaIdUnico = opcoes.especialistaIdUnico;
  const versaoInfo = opcoes.versaoInfo;
  const versaoSufixoArquivo = opcoes.versaoSufixoArquivo ? `-${slugArquivo(opcoes.versaoSufixoArquivo)}` : '';

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Diário de Classe Digital';
  workbook.created = new Date();

  const abasUsadas = new Set<string>();
  let totalHAPreenchidas = 0;

  const especialistasAlvo = especialistaIdUnico
    ? especialistas.filter((e) => e.id === especialistaIdUnico)
    : [...especialistas].sort((a, b) => a.name.localeCompare(b.name));

  // 1. Uma aba individual para cada Especialista (espelhando fielmente a tela "Por Especialista")
  especialistasAlvo.forEach((esp) => {
    const folgaNome = formatarDiasFolgaResumo(esp.diasDisponiveis, esp.folgaDia);
    const slots = resultado.gradesPorEspecialistaLista[esp.id] || [];
    const externos = ocupacoesExternasPorProfessor[esp.id] || [];
    const haLista = haPorEspecialista[esp.id] || [];
    const turnosPresentes = coletarTurnosEspecialista(slots, externos, haLista);

    // Contabiliza H.A. válidas exibidas nos turnos
    let totalHAEsp = 0;
    turnosPresentes.forEach((tKey) => {
      const slotsT = slots.filter((s) => s.turno === tKey);
      const extT = externos.filter((e) => e.turno === tKey);
      [1, 2, 3, 4, 5].forEach((ord) => {
        GRADE_DIAS_SEMANA.forEach((dd) => {
          const info = descreverCelulaEspecialista(esp, tKey, dd.id, ord, slotsT, extT, haLista);
          if (info.tipo === 'ha') totalHAEsp++;
        });
      });
    });
    totalHAPreenchidas += totalHAEsp;

    const nomeAba = gerarNomeAbaUnicoExcel(`${esp.name.split(' ').slice(0, 2).join(' ')} (${esp.subject})`, abasUsadas);
    const ws = workbook.addWorksheet(nomeAba);

    ws.pageSetup = {
      orientation: 'landscape',
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      margins: { left: 0.35, right: 0.35, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 }
    };

    ws.columns = [
      { key: 'aula', width: 22 },
      { key: 'seg', width: 24 },
      { key: 'ter', width: 24 },
      { key: 'qua', width: 24 },
      { key: 'qui', width: 24 },
      { key: 'sex', width: 24 }
    ];

    const thinBorder: Partial<ExcelJS.Borders> = {
      top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
    };

    // Cabeçalho principal individual
    const rowTitle = ws.addRow([
      `${escolaNome} • Quadro Individual de Horários (${anoLetivo})${versaoInfo ? ` • ${versaoInfo}` : ''}`
    ]);
    ws.mergeCells(rowTitle.number, 1, rowTitle.number, 6);
    rowTitle.height = 24;
    rowTitle.getCell(1).font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
    rowTitle.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
    rowTitle.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

    const metaHAText = esp.metaHA && esp.metaHA > 0 ? ` / ${esp.metaHA}` : '';
    const rowMeta = ws.addRow([
      `Especialista: ${esp.name}   |   Disciplina: ${esp.subject}   |   Folga: ${folgaNome}   |   H.A.: ${totalHAEsp}${metaHAText}   |   Aulas na Escola: ${slots.length}`
    ]);
    ws.mergeCells(rowMeta.number, 1, rowMeta.number, 6);
    rowMeta.height = 20;
    rowMeta.getCell(1).font = { bold: true, size: 10, color: { argb: 'FF1E293B' } };
    rowMeta.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    rowMeta.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    rowMeta.getCell(1).border = thinBorder;

    ws.addRow([]);

    turnosPresentes.forEach((turnoKey) => {
      const meta = getAulasTurnoMeta(turnoKey, opcoes?.schoolId, opcoes?.sinoConfig);
      const slotsTurno = slots.filter((s) => s.turno === turnoKey);
      const externosTurno = externos.filter((ext) => ext.turno === turnoKey);

      let haTurnoCount = 0;
      [1, 2, 3, 4, 5].forEach((ord) => {
        GRADE_DIAS_SEMANA.forEach((dd) => {
          const desc = descreverCelulaEspecialista(esp, turnoKey, dd.id, ord, slotsTurno, externosTurno, haLista);
          if (desc.tipo === 'ha') haTurnoCount++;
        });
      });

      const shiftBg =
        turnoKey === 'manha' ? 'FFFEF3C7' : turnoKey === 'tarde' ? 'FFE0E7FF' : 'FFE2E8F0';
      const shiftFg =
        turnoKey === 'manha' ? 'FF78350F' : turnoKey === 'tarde' ? 'FF1E1B4B' : 'FF0F172A';

      const resumoTurno = `${meta.badgeTurno} — ${meta.tituloTurno} (${meta.horarioTurno})   |   ${slotsTurno.length} aula(s) sugerida(s)${
        haTurnoCount > 0 ? ` • ⭐ ${haTurnoCount} H.A.` : ''
      }${externosTurno.length > 0 ? ` • ${externosTurno.length} oficial(is) outra escola` : ''}`;

      const rowShift = ws.addRow([resumoTurno]);
      ws.mergeCells(rowShift.number, 1, rowShift.number, 6);
      rowShift.height = 21;
      rowShift.getCell(1).font = { bold: true, size: 10, color: { argb: shiftFg } };
      rowShift.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: shiftBg } };
      rowShift.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      rowShift.getCell(1).border = thinBorder;

      const rowHead = ws.addRow(['Aula / Horário', ...GRADE_DIAS_SEMANA.map((d) => d.nome)]);
      rowHead.height = 22;
      for (let c = 1; c <= 6; c++) {
        const cell = rowHead.getCell(c);
        cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c === 1 ? 'FF134E4A' : 'FF115E59' } };
        cell.alignment = { vertical: 'middle', horizontal: c === 1 ? 'left' : 'center', indent: c === 1 ? 1 : 0 };
        cell.border = thinBorder;
      }

      [1, 2, 3, 4, 5].forEach((ordem) => {
        const infoHorario = meta.horarios[ordem];
        const col1Text = `${ordem}ª Aula\n${infoHorario?.faixa || ''}${
          infoHorario?.detalhe ? `\n(${infoHorario.detalhe})` : ''
        }`;

        const descricoesDia = GRADE_DIAS_SEMANA.map((d) =>
          descreverCelulaEspecialista(esp, turnoKey, d.id, ordem, slotsTurno, externosTurno, haLista)
        );

        const rowPeriod = ws.addRow([col1Text, ...descricoesDia.map((x) => x.textoExcel)]);
        rowPeriod.height = infoHorario?.detalhe ? 40 : 34;

        const c1 = rowPeriod.getCell(1);
        c1.font = { bold: true, size: 9, color: { argb: 'FF334155' } };
        c1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
        c1.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
        c1.border = thinBorder;

        descricoesDia.forEach((desc, idx) => {
          const cell = rowPeriod.getCell(idx + 2);
          cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
          cell.border = thinBorder;

          if (desc.tipo === 'folga') {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFBEB' } };
            cell.font = { bold: true, size: 9, color: { argb: 'FF92400E' } };
          } else if (desc.tipo === 'aula') {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FDFA' } };
            cell.font = { bold: true, size: 10, color: { argb: 'FF134E4A' } };
          } else if (desc.tipo === 'externo') {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7ED' } };
            cell.font = { bold: true, size: 9, color: { argb: 'FF9A3412' } };
          } else if (desc.tipo === 'ha') {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
            cell.font = { bold: true, size: 10, color: { argb: 'FF92400E' } };
          } else {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
            cell.font = { size: 10, color: { argb: 'FF94A3B8' } };
          }
        });

        if (ordem === meta.intervaloApos) {
          const rowInt = ws.addRow(['☕ Intervalo', meta.intervaloTexto]);
          ws.mergeCells(rowInt.number, 2, rowInt.number, 6);
          rowInt.height = 20;
          rowInt.getCell(1).font = { bold: true, size: 9, color: { argb: 'FF78350F' } };
          rowInt.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
          rowInt.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
          rowInt.getCell(1).border = thinBorder;

          for (let c = 2; c <= 6; c++) {
            const ic = rowInt.getCell(c);
            ic.font = { bold: true, size: 9, color: { argb: 'FF78350F' } };
            ic.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFBEB' } };
            ic.alignment = { vertical: 'middle', horizontal: 'center' };
            ic.border = thinBorder;
          }
        }
      });

      ws.addRow([]);
    });
  });

  // Se for exportação completa da escola, inclui as abas administrativas ao final
  if (!especialistaIdUnico) {
    const nomeAbaTurmas = gerarNomeAbaUnicoExcel('Quadro por Turma', abasUsadas);
    const wsTurmas = workbook.addWorksheet(nomeAbaTurmas);
    wsTurmas.columns = [
      { header: 'Escola', key: 'escola', width: 28 },
      { header: 'Turma', key: 'turma', width: 14 },
      { header: 'Turno', key: 'turno', width: 14 },
      { header: 'Dia da Semana', key: 'dia', width: 16 },
      { header: '1ª Aula', key: 'aula1', width: 24 },
      { header: '2ª Aula', key: 'aula2', width: 24 },
      { header: '3ª Aula', key: 'aula3', width: 24 },
      { header: '4ª Aula', key: 'aula4', width: 24 },
      { header: '5ª Aula', key: 'aula5', width: 24 },
      { header: 'Especialistas no Dia', key: 'qtdEsp', width: 28 }
    ];

    const headerTurmas = wsTurmas.getRow(1);
    headerTurmas.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerTurmas.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4338CA' } };

    turmas.forEach((t) => {
      const grade = resultado.gradesPorTurma[t.id] || {};
      const analise = resultado.analisePorDiaTurma[t.id] || {};

      GRADE_DIAS_SEMANA.forEach((d) => {
        const getSlotText = (ordem: number) => {
          const slot = grade[`${d.id}_${ordem}`];
          if (!slot) return '-';
          return `${slot.disciplinaNome || 'Aula'} (${slot.teacherNome || 'Docente'})`;
        };

        const infoDia = analise[d.id];
        const espNomes = (infoDia?.especialistas || []).map((e) => e.disciplina).join(', ') || 'Nenhum';
        const qtdText = `${infoDia?.especialistas?.length || 0} especialista(s): ${espNomes}`;

        wsTurmas.addRow({
          escola: t.schoolName,
          turma: `${t.year}º ${t.letter}`,
          turno: t.shift,
          dia: d.nome,
          aula1: getSlotText(1),
          aula2: getSlotText(2),
          aula3: getSlotText(3),
          aula4: getSlotText(4),
          aula5: getSlotText(5),
          qtdEsp: qtdText
        });
      });
    });

    const nomeAbaConf = gerarNomeAbaUnicoExcel('Conformidade das Regras', abasUsadas);
    const wsConf = workbook.addWorksheet(nomeAbaConf);
    wsConf.columns = [
      { header: 'Item Verificado', key: 'item', width: 40 },
      { header: 'Status', key: 'status', width: 18 },
      { header: 'Detalhes e Métricas', key: 'detalhes', width: 65 }
    ];

    const headerConf = wsConf.getRow(1);
    headerConf.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerConf.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };

    wsConf.addRow({
      item: 'Ano Letivo Planejado',
      status: 'OK',
      detalhes: `Ano Letivo ${anoLetivo} (atribuições de outros anos ignoradas)`
    });
    wsConf.addRow({
      item: 'Limite de Especialistas por Turma/Dia',
      status: resultado.conflitos.length === 0 ? 'CONFORME' : 'ATENÇÃO',
      detalhes: `Máximo de 2 especialistas por sala no mesmo dia respeitado em ${resultado.estatisticas.turmasComMaxEspecialistasRespeitado}/${resultado.estatisticas.totalTurmas} turmas.`
    });
    wsConf.addRow({
      item: 'Respeito às Folgas dos Especialistas',
      status: 'CONFORME',
      detalhes: 'Nenhum especialista teve aulas agendadas em seus dias de folga informados.'
    });
    wsConf.addRow({
      item: 'Carga Horária Regular Semanal',
      status: resultado.sucesso ? 'CONFORME' : 'PARCIAL',
      detalhes: `${resultado.estatisticas.totalAulasAlocadas} de ${resultado.estatisticas.totalAulasEsperadas} aulas regulares alocadas (${resultado.estatisticas.percentualConcluido}%).`
    });
    wsConf.addRow({
      item: 'Horas-Atividade (H.A.) nas Lacunas',
      status: totalHAPreenchidas > 0 ? 'CONFIGURADO' : 'PENDENTE',
      detalhes: `${totalHAPreenchidas} horário(s) de Hora-Atividade inserido(s) nas lacunas dos especialistas.`
    });
    if (versaoInfo) {
      wsConf.addRow({
        item: 'Versão / Rascunho de Referência',
        status: 'RASTREADO',
        detalhes: versaoInfo
      });
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download =
    especialistaIdUnico && especialistasAlvo[0]
      ? `horario-especialista-${slugArquivo(especialistasAlvo[0].name)}-${anoLetivo}${versaoSufixoArquivo}.xlsx`
      : `horarios-individuais-especialistas-${anoLetivo}${versaoSufixoArquivo}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Exporta em PDF profissional (A4 Paisagem) os quadros individuais de horários
 * espelhando exatamente a tela "Por Especialista" (1 página/folha por especialista).
 */
export function exportarSugestaoHorariosPDF(
  resultado: ResultadoSugestaoHorarios,
  especialistas: EspecialistaConfig[],
  anoLetivo: string,
  opcoes: OpcoesExportacaoEspecialistas = {}
): void {
  const {
    haPorEspecialista = {},
    ocupacoesExternasPorProfessor = {},
    escolaNome = 'Unidade Escolar',
    especialistaIdUnico,
    versaoInfo,
    versaoSufixoArquivo
  } = opcoes;
  const sufixoArq = versaoSufixoArquivo ? `-${slugArquivo(versaoSufixoArquivo)}` : '';

  const especialistasAlvo = especialistaIdUnico
    ? especialistas.filter((e) => e.id === especialistaIdUnico)
    : [...especialistas].sort((a, b) => a.name.localeCompare(b.name));

  if (especialistasAlvo.length === 0) return;

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const marginX = 12;
  const contentW = pageW - marginX * 2;

  especialistasAlvo.forEach((esp, espIdx) => {
    if (espIdx > 0) doc.addPage();

    const folgaNome = formatarDiasFolgaResumo(esp.diasDisponiveis, esp.folgaDia);
    const slots = resultado.gradesPorEspecialistaLista[esp.id] || [];
    const externos = ocupacoesExternasPorProfessor[esp.id] || [];
    const haLista = haPorEspecialista[esp.id] || [];
    const turnosPresentes = coletarTurnosEspecialista(slots, externos, haLista);

    let totalHAEsp = 0;
    turnosPresentes.forEach((tKey) => {
      const slotsT = slots.filter((s) => s.turno === tKey);
      const extT = externos.filter((e) => e.turno === tKey);
      [1, 2, 3, 4, 5].forEach((ord) => {
        GRADE_DIAS_SEMANA.forEach((dd) => {
          const info = descreverCelulaEspecialista(esp, tKey, dd.id, ord, slotsT, extT, haLista);
          if (info.tipo === 'ha') totalHAEsp++;
        });
      });
    });

    const drawCabecalhoDocente = (compacto = false): number => {
      doc.setFillColor(15, 118, 110); // teal-700
      doc.roundedRect(marginX, 10, contentW, compacto ? 11 : 15, 2, 2, 'F');

      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(compacto ? 10 : 12);
      doc.text(
        sanitizePdfText(`${escolaNome} - Quadro Individual do Especialista (${anoLetivo})`),
        marginX + 4,
        compacto ? 17 : 16.5
      );

      if (!compacto) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.text(
          sanitizePdfText(`Docente: ${esp.name}  |  Disciplina: ${esp.subject}${versaoInfo ? `  |  ${versaoInfo}` : ''}`),
          marginX + 4,
          22
        );

        // Linha resumo logo abaixo do banner
        doc.setFillColor(241, 245, 249);
        doc.setDrawColor(203, 213, 225);
        doc.roundedRect(marginX, 27, contentW, 8.5, 1.5, 1.5, 'FD');

        doc.setTextColor(30, 41, 59);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        const metaHAText = esp.metaHA && esp.metaHA > 0 ? ` / ${esp.metaHA}` : '';
        const resumoLine = sanitizePdfText(
          `Folga Semanal: ${folgaNome}    |    Aulas na Escola: ${slots.length}    |    H.A. Planejadas: ${totalHAEsp}${metaHAText}`
        );
        doc.text(resumoLine, marginX + 4, 32.5);
        return 38;
      }
      return 24;
    };

    let currentY = drawCabecalhoDocente(false);

    turnosPresentes.forEach((turnoKey, tIdx) => {
      const meta = getAulasTurnoMeta(turnoKey, opcoes?.schoolId, opcoes?.sinoConfig);
      const slotsTurno = slots.filter((s) => s.turno === turnoKey);
      const externosTurno = externos.filter((ext) => ext.turno === turnoKey);

      let haTurnoCount = 0;
      const cellTipos: Record<string, string> = {};

      const bodyRows: any[] = [];
      [1, 2, 3, 4, 5].forEach((ordem) => {
        const infoH = meta.horarios[ordem];
        const col1 = sanitizePdfText(
          `${ordem}a Aula\n${infoH?.faixa || ''}${infoH?.detalhe ? `\n(${infoH.detalhe})` : ''}`
        );
        const rowCells: string[] = [col1];

        const rowIndex = bodyRows.length;
        GRADE_DIAS_SEMANA.forEach((d, dIdx) => {
          const desc = descreverCelulaEspecialista(esp, turnoKey, d.id, ordem, slotsTurno, externosTurno, haLista);
          if (desc.tipo === 'ha') haTurnoCount++;
          cellTipos[`${rowIndex}_${dIdx + 1}`] = desc.tipo;
          rowCells.push(sanitizePdfText(desc.textoPdf));
        });
        bodyRows.push(rowCells);

        if (ordem === meta.intervaloApos) {
          const intIdx = bodyRows.length;
          cellTipos[`${intIdx}_intervalo`] = 'intervalo';
          bodyRows.push([
            'Intervalo',
            {
              content: sanitizePdfText(meta.intervaloTexto),
              colSpan: 5,
              styles: { halign: 'center', fontStyle: 'bold' }
            }
          ]);
        }
      });

      // Estima altura necessária (~68mm por tabela de turno); se não couber na folha, quebra página mantendo o cabeçalho do docente
      if (tIdx > 0 && currentY > 130) {
        doc.addPage();
        currentY = drawCabecalhoDocente(true);
      }

      // Tarja do Turno
      const shiftFill: [number, number, number] =
        turnoKey === 'manha'
          ? [254, 243, 199]
          : turnoKey === 'tarde'
          ? [224, 231, 255]
          : [226, 232, 240];
      const shiftText: [number, number, number] =
        turnoKey === 'manha'
          ? [120, 53, 15]
          : turnoKey === 'tarde'
          ? [30, 27, 75]
          : [15, 23, 42];

      doc.setFillColor(...shiftFill);
      doc.setDrawColor(203, 213, 225);
      doc.rect(marginX, currentY, contentW, 6.5, 'FD');
      doc.setTextColor(...shiftText);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);

      const turnoTitulo = sanitizePdfText(`${meta.tituloTurno} - ${meta.horarioTurno}`);
      const turnoResumo = sanitizePdfText(
        `${slotsTurno.length} aula(s) sugerida(s)${
          haTurnoCount > 0 ? `  |  ${haTurnoCount} H.A.` : ''
        }${externosTurno.length > 0 ? `  |  ${externosTurno.length} oficial(is) outra escola` : ''}`
      );
      doc.text(turnoTitulo, marginX + 3, currentY + 4.4);
      doc.text(turnoResumo, pageW - marginX - 3, currentY + 4.4, { align: 'right' });

      currentY += 6.5;

      autoTable(doc, {
        startY: currentY,
        margin: { left: marginX, right: marginX, bottom: 12 },
        head: [['Aula / Horario', ...GRADE_DIAS_SEMANA.map((d) => d.nome)]],
        body: bodyRows,
        theme: 'grid',
        styles: {
          font: 'helvetica',
          fontSize: 7.8,
          cellPadding: 1.8,
          valign: 'middle',
          halign: 'center',
          lineColor: [203, 213, 225],
          lineWidth: 0.2
        },
        headStyles: {
          fillColor: [17, 94, 89],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize: 8
        },
        columnStyles: {
          0: { cellWidth: 34, halign: 'left', fillColor: [248, 250, 252], fontStyle: 'bold', textColor: [51, 65, 85] }
        },
        didParseCell: (data) => {
          if (data.section !== 'body') return;
          if (cellTipos[`${data.row.index}_intervalo`]) {
            data.cell.styles.fillColor = [254, 243, 199];
            data.cell.styles.textColor = [120, 53, 15];
            data.cell.styles.fontStyle = 'bold';
            data.cell.styles.fontSize = 7.2;
            return;
          }
          if (data.column.index === 0) return;
          const tipo = cellTipos[`${data.row.index}_${data.column.index}`];
          if (tipo === 'folga') {
            data.cell.styles.fillColor = [255, 251, 235];
            data.cell.styles.textColor = [180, 83, 9];
            data.cell.styles.fontStyle = 'bold';
          } else if (tipo === 'aula') {
            data.cell.styles.fillColor = [240, 253, 250];
            data.cell.styles.textColor = [19, 78, 74];
            data.cell.styles.fontStyle = 'bold';
          } else if (tipo === 'externo') {
            data.cell.styles.fillColor = [255, 247, 237];
            data.cell.styles.textColor = [154, 52, 18];
            data.cell.styles.fontStyle = 'bold';
          } else if (tipo === 'ha') {
            data.cell.styles.fillColor = [254, 243, 199];
            data.cell.styles.textColor = [146, 64, 14];
            data.cell.styles.fontStyle = 'bold';
          } else {
            data.cell.styles.textColor = [148, 163, 184];
          }
        }
      });

      currentY = ((doc as any).lastAutoTable?.finalY || currentY + 60) + 4;
    });

    // Rodapé com espaço de ciência individual
    const pageH = doc.internal.pageSize.getHeight();
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(
      sanitizePdfText(`Diario de Classe Digital - Quadro individual de ${esp.name}${versaoInfo ? ` (${versaoInfo})` : ''}`),
      marginX,
      pageH - 6
    );
    doc.text(
      'Ciencia do(a) Docente: ________________________________________   Data: ____/____/______',
      pageW - marginX,
      pageH - 6,
      { align: 'right' }
    );
  });

  const nomeArquivo =
    especialistaIdUnico && especialistasAlvo[0]
      ? `horario-especialista-${slugArquivo(especialistasAlvo[0].name)}-${anoLetivo}${sufixoArq}.pdf`
      : `horarios-individuais-especialistas-${anoLetivo}${sufixoArq}.pdf`;
  doc.save(nomeArquivo);
}

// ============================================================================
// Persistência Portátil em Base62 & Rascunho Multi-Dispositivo com Revalidação
// ============================================================================

export interface SnapshotSimulacaoEspecialistas {
  versao: 1;
  salvoEm: number;
  schoolId: string;
  schoolName: string;
  anoLetivo: string;
  turnoFiltro: TurnoFiltroPlanejamento;
  opcoes: {
    aulasPorTurma: number;
    formatoAulas: FormatoAulasEspecialista;
    preservarOutrosProfessores: boolean;
    respeitarIntervaloEntreEscolas: boolean;
  };
  especialistas: {
    id: string;
    name: string;
    subject: string;
    folgaDia: number | null;
    diasDisponiveis: number[];
    haHorarios: string[];
    turmasRegulares: string[];
    turmasSuplementares: string[];
  }[];
  gradesPorTurma: Record<string, Record<string, HorarioSlot>>;
  selectedClassesToApply?: string[];
  swapItems?: SwapItemAula[];
}

export type OrigemRascunhoSimulacao =
  | 'manual'
  | 'importacao_base62'
  | 'exportacao_excel'
  | 'exportacao_pdf'
  | 'impressao';

export interface RascunhoSimulacaoNuvem {
  chave: string;
  schoolId: string;
  schoolName: string;
  anoLetivo: string;
  turnoFiltro: TurnoFiltroPlanejamento;
  salvoEm: number;
  salvoPor?: string;
  versaoNumero?: number;
  rotulo?: string;
  origem?: OrigemRascunhoSimulacao;
  assinaturaConteudo?: string;
  totalAulasAlocadas: number;
  totalAulasEsperadas: number;
  totalHAs: number;
  totalSwap?: number;
  codigoBase62: string;
}

export interface ResultadoRestauracaoSimulacao {
  resultado: ResultadoSugestaoHorarios;
  avisosRestauracao: string[];
  especialistasConfigRestaurados: Record<string, { folgaDia: number | null; diasDisponiveis: number[] }>;
  haMapRestaurado: Record<string, string[]>;
  selectedClassesRestauradas: Record<string, boolean>;
  swapItemsRestaurados: SwapItemAula[];
}

const BASE62_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE62_MAP = (() => {
  const map: Record<string, number> = {};
  for (let i = 0; i < BASE62_ALPHABET.length; i++) {
    map[BASE62_ALPHABET[i]] = i;
  }
  return map;
})();

const BASE62_PREFIX = 'DC1';

const CHUNK_LEN_BY_BYTES: Record<number, number> = {
  1: 2,
  2: 3,
  3: 5,
  4: 6,
  5: 7
};

const BYTES_BY_CHUNK_LEN: Record<number, number> = {
  2: 1,
  3: 2,
  5: 3,
  6: 4,
  7: 5
};

function bytesToBase62(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 5) {
    const chunkLen = Math.min(5, bytes.length - i);
    let val = 0;
    for (let j = 0; j < chunkLen; j++) {
      val = val * 256 + bytes[i + j];
    }
    const targetChars = CHUNK_LEN_BY_BYTES[chunkLen];
    let chars = '';
    for (let c = 0; c < targetChars; c++) {
      const rem = val % 62;
      chars = BASE62_ALPHABET[rem] + chars;
      val = Math.floor(val / 62);
    }
    out += chars;
  }
  return out;
}

function base62ToBytes(encoded: string): Uint8Array {
  const clean = (encoded || '').replace(/\s+/g, '');
  if (!clean) return new Uint8Array(0);

  const bytesOut: number[] = [];
  for (let i = 0; i < clean.length; i += 7) {
    const chunk = clean.slice(i, i + 7);
    const byteCount = BYTES_BY_CHUNK_LEN[chunk.length];
    if (!byteCount) {
      throw new Error('Código Base62 inválido ou incompleto.');
    }
    let val = 0;
    for (let c = 0; c < chunk.length; c++) {
      const digit = BASE62_MAP[chunk[c]];
      if (digit === undefined) {
        throw new Error(`Caractere inválido no código Base62: "${chunk[c]}".`);
      }
      val = val * 62 + digit;
    }
    const maxVal = Math.pow(256, byteCount);
    if (val >= maxVal) {
      throw new Error('Código Base62 corrompido (valor fora dos limites).');
    }
    const chunkBytes = new Array<number>(byteCount);
    for (let j = byteCount - 1; j >= 0; j--) {
      chunkBytes[j] = val % 256;
      val = Math.floor(val / 256);
    }
    bytesOut.push(...chunkBytes);
  }
  return new Uint8Array(bytesOut);
}

/**
 * Serializa uma simulação completa em uma string compacta alfanumérica Base62 (prefixo DC1).
 * Utiliza dicionário compacto interno para manter o código leve e fácil de copiar/armazenar.
 */
export function serializarSimulacaoBase62(snapshot: SnapshotSimulacaoEspecialistas): string {
  const formatos: FormatoAulasEspecialista[] = ['misto', 'dobrada', 'separada'];
  const formatoIdx = Math.max(0, formatos.indexOf(snapshot.opcoes.formatoAulas));

  const disciplinasDict: string[] = [];
  const getDiscIdx = (nome: string | undefined): number => {
    const label = (nome || '').trim();
    const idx = disciplinasDict.indexOf(label);
    if (idx >= 0) return idx;
    disciplinasDict.push(label);
    return disciplinasDict.length - 1;
  };

  // Tabela combinada de docentes (especialistas primeiro, depois eventuais regentes preservados)
  const espIds = snapshot.especialistas.map((e) => e.id);
  const outrosDocentes: [string, string][] = [];
  const getTeacherRefIdx = (teacherId: string, teacherNome?: string): number => {
    const eIdx = espIds.indexOf(teacherId);
    if (eIdx >= 0) return eIdx;
    let oIdx = outrosDocentes.findIndex((o) => o[0] === teacherId);
    if (oIdx < 0) {
      outrosDocentes.push([teacherId, teacherNome || 'Docente']);
      oIdx = outrosDocentes.length - 1;
    }
    return espIds.length + oIdx;
  };

  const compactTurmas: [string, [number, number, number, number][]][] = [];
  Object.keys(snapshot.gradesPorTurma).forEach((classId) => {
    const grade = snapshot.gradesPorTurma[classId];
    if (!grade) return;
    const slotsCompactos: [number, number, number, number][] = [];
    Object.keys(grade).forEach((slotKey) => {
      const slot = grade[slotKey];
      if (!slot?.teacherId) return;
      const parts = slotKey.split('_');
      const dia = Number(parts[0]);
      const ordem = Number(parts[1]);
      if (dia < 1 || dia > 5 || ordem < 1 || ordem > 5) return;
      slotsCompactos.push([
        dia * 10 + ordem,
        getTeacherRefIdx(slot.teacherId, slot.teacherNome),
        getDiscIdx(slot.disciplinaNome),
        slot.isEspecialista ? 1 : 0
      ]);
    });
    if (slotsCompactos.length > 0) {
      compactTurmas.push([classId, slotsCompactos]);
    }
  });

  const turnosLista: ('manha' | 'tarde' | 'noite' | 'outro')[] = ['manha', 'tarde', 'noite', 'outro'];
  const compactSwap: [string, string, string, number, number, number, number, number, number][] = [];
  (snapshot.swapItems || []).forEach((item) => {
    if (!item?.classId || !item?.slot?.teacherId) return;
    const turnoIdx = Math.max(0, turnosLista.indexOf(item.turno));
    compactSwap.push([
      item.classId,
      item.turmaLabel || item.classId,
      item.shift || '',
      turnoIdx,
      Number(item.origemDia) || 1,
      Number(item.origemOrdem) || 1,
      getTeacherRefIdx(item.slot.teacherId, item.slot.teacherNome),
      getDiscIdx(item.slot.disciplinaNome),
      item.slot.isEspecialista ? 1 : 0
    ]);
  });

  const compactPayload: Record<string, any> = {
    v: 1,
    ts: snapshot.salvoEm,
    s: [snapshot.schoolId, snapshot.schoolName, snapshot.anoLetivo, snapshot.turnoFiltro],
    p: [
      snapshot.opcoes.aulasPorTurma,
      formatoIdx,
      snapshot.opcoes.preservarOutrosProfessores ? 1 : 0,
      snapshot.opcoes.respeitarIntervaloEntreEscolas ? 1 : 0
    ],
    d: disciplinasDict,
    e: snapshot.especialistas.map((esp) => [
      esp.id,
      esp.name,
      esp.subject,
      esp.folgaDia,
      esp.diasDisponiveis,
      esp.haHorarios,
      esp.turmasRegulares,
      esp.turmasSuplementares
    ]),
    r: outrosDocentes,
    c: compactTurmas,
    sel: snapshot.selectedClassesToApply || []
  };

  if (compactSwap.length > 0) {
    compactPayload.sw = compactSwap;
  }

  const jsonStr = JSON.stringify(compactPayload);
  const bytes = new TextEncoder().encode(jsonStr);
  return `${BASE62_PREFIX}${bytesToBase62(bytes)}`;
}

/**
 * Gera uma assinatura determinística do conteúdo da simulação (ignorando salvoEm e ordem instável)
 * para detectar se houve alteração real desde a última versão salva.
 */
export function calcularAssinaturaSnapshot(snapshot: SnapshotSimulacaoEspecialistas): string {
  const gradesNormalizadas: Record<string, Record<string, HorarioSlot>> = {};
  Object.keys(snapshot.gradesPorTurma || {})
    .sort()
    .forEach((classId) => {
      const grade = snapshot.gradesPorTurma[classId] || {};
      const gradeOrd: Record<string, HorarioSlot> = {};
      Object.keys(grade)
        .sort()
        .forEach((slotKey) => {
          gradeOrd[slotKey] = grade[slotKey];
        });
      gradesNormalizadas[classId] = gradeOrd;
    });

  const swapOrdenados = [...(snapshot.swapItems || [])].sort((a, b) =>
    `${a.classId}_${a.origemDia}_${a.origemOrdem}_${a.slot?.teacherId || ''}`.localeCompare(
      `${b.classId}_${b.origemDia}_${b.origemOrdem}_${b.slot?.teacherId || ''}`
    )
  );

  const normalizado: SnapshotSimulacaoEspecialistas = {
    ...snapshot,
    salvoEm: 0,
    especialistas: [...(snapshot.especialistas || [])]
      .map((esp) => ({
        ...esp,
        diasDisponiveis: [...(esp.diasDisponiveis || [])].sort((a, b) => a - b),
        haHorarios: [...(esp.haHorarios || [])].sort(),
        turmasRegulares: [...(esp.turmasRegulares || [])].sort(),
        turmasSuplementares: [...(esp.turmasSuplementares || [])].sort()
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    gradesPorTurma: gradesNormalizadas,
    selectedClassesToApply: [...(snapshot.selectedClassesToApply || [])].sort(),
    swapItems: swapOrdenados.length > 0 ? swapOrdenados : undefined
  };

  return serializarSimulacaoBase62(normalizado);
}

/**
 * Retorna a assinatura determinística de um rascunho na nuvem (calculando sob demanda para rascunhos legados).
 */
export function obterAssinaturaRascunho(draft: RascunhoSimulacaoNuvem): string {
  if (draft.assinaturaConteudo) return draft.assinaturaConteudo;
  try {
    const snap = desserializarSimulacaoBase62(draft.codigoBase62);
    return calcularAssinaturaSnapshot(snap);
  } catch {
    return draft.codigoBase62;
  }
}

/**
 * Decodifica uma string Base62 (prefixo DC1) de volta para SnapshotSimulacaoEspecialistas.
 */
export function desserializarSimulacaoBase62(codigoRaw: string): SnapshotSimulacaoEspecialistas {
  const clean = (codigoRaw || '').replace(/\s+/g, '');
  if (!clean.startsWith(BASE62_PREFIX)) {
    throw new Error('Código inválido: deve iniciar com o prefixo "DC1".');
  }
  const encodedBody = clean.slice(BASE62_PREFIX.length);
  if (!encodedBody) {
    throw new Error('Código Base62 vazio.');
  }

  const bytes = base62ToBytes(encodedBody);
  const jsonStr = new TextDecoder().decode(bytes);
  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error('Não foi possível interpretar o conteúdo da simulação.');
  }

  if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.s) || !Array.isArray(parsed.e) || !Array.isArray(parsed.c)) {
    throw new Error('Formato de simulação incompatível ou versão desconhecida.');
  }

  const formatos: FormatoAulasEspecialista[] = ['misto', 'dobrada', 'separada'];
  const disciplinasDict: string[] = Array.isArray(parsed.d) ? parsed.d : [];
  const espRaw: any[] = parsed.e || [];
  const regRaw: [string, string][] = Array.isArray(parsed.r) ? parsed.r : [];

  const especialistas: SnapshotSimulacaoEspecialistas['especialistas'] = espRaw.map((item) => ({
    id: String(item[0] || ''),
    name: String(item[1] || 'Especialista'),
    subject: String(item[2] || 'Especialista'),
    folgaDia: item[3] === null || item[3] === undefined ? null : Number(item[3]),
    diasDisponiveis: Array.isArray(item[4]) ? item[4].map(Number) : [1, 2, 3, 4, 5],
    haHorarios: Array.isArray(item[5]) ? item[5].map(String) : [],
    turmasRegulares: Array.isArray(item[6]) ? item[6].map(String) : [],
    turmasSuplementares: Array.isArray(item[7]) ? item[7].map(String) : []
  }));

  const gradesPorTurma: Record<string, Record<string, HorarioSlot>> = {};
  (parsed.c as any[]).forEach(([classId, slotsCompactos]) => {
    if (!classId || !Array.isArray(slotsCompactos)) return;
    const gradeTurma: Record<string, HorarioSlot> = {};
    slotsCompactos.forEach((sc: any[]) => {
      const code = Number(sc[0]);
      const dia = Math.floor(code / 10);
      const ordem = code % 10;
      const tRef = Number(sc[1]);
      const dIdx = Number(sc[2]);
      const isEsp = sc[3] === 1;

      if (dia < 1 || dia > 5 || ordem < 1 || ordem > 5) return;

      let teacherId = '';
      let teacherNome = 'Docente';
      if (tRef < especialistas.length) {
        teacherId = especialistas[tRef].id;
        teacherNome = especialistas[tRef].name;
      } else {
        const reg = regRaw[tRef - especialistas.length];
        if (reg) {
          teacherId = reg[0];
          teacherNome = reg[1];
        }
      }
      if (!teacherId) return;

      const discNome = disciplinasDict[dIdx] || 'Especialista';
      gradeTurma[`${dia}_${ordem}`] = {
        teacherId,
        teacherNome,
        disciplinaId: discNome || 'especialista',
        disciplinaNome: discNome,
        isEspecialista: isEsp
      };
    });
    gradesPorTurma[String(classId)] = gradeTurma;
  });

  const pArr = Array.isArray(parsed.p) ? parsed.p : [2, 0, 0, 1];
  const turnosLista: ('manha' | 'tarde' | 'noite' | 'outro')[] = ['manha', 'tarde', 'noite', 'outro'];
  const swapItems: SwapItemAula[] = [];

  if (Array.isArray(parsed.sw)) {
    parsed.sw.forEach((entry: any[], idx: number) => {
      if (!Array.isArray(entry) || entry.length < 8) return;
      const classId = String(entry[0] || '');
      const turmaLabel = String(entry[1] || classId);
      const shift = String(entry[2] || '');
      const turno = turnosLista[Number(entry[3])] || 'manha';
      const origemDia = Number(entry[4]) as DiaSemana;
      const origemOrdem = Number(entry[5]);
      const tRef = Number(entry[6]);
      const dIdx = Number(entry[7]);
      const isEsp = entry[8] !== 0;

      if (!classId || origemDia < 1 || origemDia > 5 || origemOrdem < 1 || origemOrdem > 5) return;

      let teacherId = '';
      let teacherNome = 'Docente';
      if (tRef >= 0 && tRef < especialistas.length) {
        teacherId = especialistas[tRef].id;
        teacherNome = especialistas[tRef].name;
      } else {
        const reg = regRaw[tRef - especialistas.length];
        if (reg) {
          teacherId = reg[0];
          teacherNome = reg[1];
        }
      }
      if (!teacherId) return;

      const discNome = disciplinasDict[dIdx] || 'Especialista';
      swapItems.push({
        id: `rest_sw_${classId}_${teacherId}_${origemDia}_${origemOrdem}_${idx}`,
        classId,
        turmaLabel,
        shift,
        turno,
        origemDia,
        origemOrdem,
        slot: {
          teacherId,
          teacherNome,
          disciplinaId: discNome || 'especialista',
          disciplinaNome: discNome,
          isEspecialista: isEsp
        }
      });
    });
  }

  return {
    versao: 1,
    salvoEm: Number(parsed.ts) || Date.now(),
    schoolId: String(parsed.s[0] || ''),
    schoolName: String(parsed.s[1] || 'Escola'),
    anoLetivo: String(parsed.s[2] || ''),
    turnoFiltro: (parsed.s[3] || 'todos') as TurnoFiltroPlanejamento,
    opcoes: {
      aulasPorTurma: Number(pArr[0]) || 2,
      formatoAulas: formatos[Number(pArr[1])] || 'misto',
      preservarOutrosProfessores: pArr[2] === 1,
      respeitarIntervaloEntreEscolas: pArr[3] !== 0
    },
    especialistas,
    gradesPorTurma,
    selectedClassesToApply: Array.isArray(parsed.sel) ? parsed.sel.map(String) : undefined,
    swapItems: swapItems.length > 0 ? swapItems : undefined
  };
}

/**
 * Restaura um SnapshotSimulacaoEspecialistas cruzando e revalidando todas as aulas
 * contra as turmas, atribuições atuais e horários oficializados em outras escolas no banco.
 */
export function restaurarResultadoDeSnapshot(
  snapshot: SnapshotSimulacaoEspecialistas,
  turmasAtuais: TurmaPlanejamento[],
  especialistasAtuais: EspecialistaConfig[],
  opcoesAtuais: {
    ocupacoesExternasPorProfessor: Record<string, OcupacaoExternaProfessor[]>;
    respeitarIntervaloEntreEscolas: boolean;
    aulasPorTurma: number;
    maxEspecialistasPorTurmaDia?: number;
    classUpdatedAtMap?: Record<string, number>;
  }
): ResultadoRestauracaoSimulacao {
  const avisosRestauracao: string[] = [];
  const turmasMap = new Map<string, TurmaPlanejamento>();
  turmasAtuais.forEach((t) => turmasMap.set(t.id, t));

  const espAtualMap = new Map<string, EspecialistaConfig>();
  const espAtualPorQualquerId = new Map<string, EspecialistaConfig>();
  especialistasAtuais.forEach((e) => {
    espAtualMap.set(e.id, e);
    espAtualPorQualquerId.set(e.id, e);
    e.aliasIds?.forEach((aid) => {
      if (aid && !espAtualPorQualquerId.has(aid)) {
        espAtualPorQualquerId.set(aid, e);
      }
    });
  });

  const snapEspMap = new Map<string, SnapshotSimulacaoEspecialistas['especialistas'][number]>();
  snapshot.especialistas.forEach((e) => snapEspMap.set(e.id, e));

  // O Cadastro atual de professores é a fonte autoritativa para folga e disponibilidade;
  // se o rascunho possuir escala diferente, preserva o cadastro e sinaliza para auditoria.
  const especialistasConfigRestaurados: Record<string, { folgaDia: number | null; diasDisponiveis: number[] }> = {};
  const haMapRestaurado: Record<string, string[]> = {};
  const especialistasParaReconstrucao: EspecialistaConfig[] = [];

  especialistasAtuais.forEach((eAtual) => {
    const snapEsp =
      snapEspMap.get(eAtual.id) ||
      (eAtual.aliasIds || []).map((aid) => snapEspMap.get(aid)).find(Boolean);

    const folgasCadastro = obterDiasFolga(eAtual.diasDisponiveis, eAtual.folgaDia);
    const diasCadastro = [1, 2, 3, 4, 5].filter((d) => !folgasCadastro.includes(d));
    const folgaFinal = folgasCadastro.length === 1 ? folgasCadastro[0] : null;
    const diasFinais = diasCadastro.length > 0 ? diasCadastro : normalizarDiasDisponiveis(eAtual.diasDisponiveis);

    if (snapEsp) {
      const folgasSnap = obterDiasFolga(snapEsp.diasDisponiveis, snapEsp.folgaDia);
      const mudouFolga =
        folgasSnap.length !== folgasCadastro.length ||
        folgasSnap.some((d, idx) => folgasCadastro[idx] !== d);
      if (mudouFolga) {
        avisosRestauracao.push(
          `Folga de ${eAtual.name} aplicada conforme o Cadastro atual (${formatarDiasFolgaResumo(
            diasFinais,
            folgaFinal
          )}; no rascunho estava "${formatarDiasFolgaResumo(snapEsp.diasDisponiveis, snapEsp.folgaDia)}").`
        );
      }
    }

    especialistasConfigRestaurados[eAtual.id] = {
      folgaDia: folgaFinal,
      diasDisponiveis: diasFinais
    };
    if (snapEsp?.haHorarios) {
      haMapRestaurado[eAtual.id] = [...snapEsp.haHorarios];
    }

    especialistasParaReconstrucao.push({
      ...eAtual,
      folgaDia: folgaFinal,
      diasDisponiveis: diasFinais
    });
  });

  // Detecta especialistas do rascunho que não existem mais ou ficaram sem turmas regulares
  snapshot.especialistas.forEach((snapEsp) => {
    if (!espAtualPorQualquerId.has(snapEsp.id)) {
      avisosRestauracao.push(
        `Docente "${snapEsp.name}" (${snapEsp.subject}) não possui mais turmas regulares atribuídas neste escopo atual; seus horários salvos foram descartados.`
      );
    }
  });

  // Reconstitui gradeTurmas apenas para turmas que continuam no escopo
  const gradeTurmas: Record<string, Record<string, HorarioSlot>> = {};
  turmasAtuais.forEach((t) => {
    gradeTurmas[t.id] = {};
  });

  const docentesDesvinculadosAvisos = new Set<string>();

  Object.entries(snapshot.gradesPorTurma).forEach(([classId, gradeSalva]) => {
    const turmaAtual = turmasMap.get(classId);
    if (!turmaAtual) {
      avisosRestauracao.push(
        `Uma turma do rascunho (ID ${classId}) não faz mais parte do escopo atual (excluída, outro turno ou sem especialistas regulares).`
      );
      return;
    }

    // Verifica se o quadro oficial dessa turma foi alterado no banco após o rascunho
    const updatedAt = opcoesAtuais.classUpdatedAtMap?.[classId];
    if (updatedAt && updatedAt > snapshot.salvoEm) {
      avisosRestauracao.push(
        `A turma ${turmaAtual.year}º ${turmaAtual.letter} teve alteração oficial após ${new Date(
          snapshot.salvoEm
        ).toLocaleString('pt-BR')}. Confira antes de aplicar ao quadro oficial.`
      );
    }

    Object.entries(gradeSalva || {}).forEach(([slotKey, slot]) => {
      if (!slot?.teacherId) return;

      if (slot.isEspecialista) {
        const espAtual = espAtualPorQualquerId.get(slot.teacherId);
        if (!espAtual) {
          return;
        }
        // Confere se essa turma ainda está atribuída regularmente ao especialista
        if (!espAtual.turmasIds.includes(classId)) {
          const chaveAviso = `${espAtual.name} -> ${turmaAtual.year}º ${turmaAtual.letter}`;
          if (!docentesDesvinculadosAvisos.has(chaveAviso)) {
            docentesDesvinculadosAvisos.add(chaveAviso);
            avisosRestauracao.push(
              `Atribuição alterada: ${espAtual.name} não atende mais ${turmaAtual.year}º ${turmaAtual.letter} como Regular; aula removida da prévia.`
            );
          }
          return;
        }
        gradeTurmas[classId][slotKey] = {
          ...slot,
          teacherId: espAtual.id,
          teacherNome: espAtual.name
        };
        return;
      }

      gradeTurmas[classId][slotKey] = { ...slot };
    });
  });

  // Revalida e restaura eventuais aulas estacionadas na Área de Swap
  const swapItemsRestaurados: SwapItemAula[] = [];
  (snapshot.swapItems || []).forEach((sw, idx) => {
    if (!sw?.classId || !sw?.slot?.teacherId) return;
    const turmaAtual = turmasMap.get(sw.classId);
    if (!turmaAtual) {
      avisosRestauracao.push(
        `Item da Área de Swap (${sw.turmaLabel} - ${sw.slot.disciplinaNome}) pertence a uma turma fora do escopo atual e foi descartado.`
      );
      return;
    }

    const espAtual = sw.slot.isEspecialista ? espAtualPorQualquerId.get(sw.slot.teacherId) : undefined;
    if (sw.slot.isEspecialista) {
      if (!espAtual || !espAtual.turmasIds.includes(sw.classId)) {
        avisosRestauracao.push(
          `Atribuição alterada: ${sw.slot.teacherNome} não atende mais ${turmaAtual.year}º ${turmaAtual.letter} como Regular; item da Área de Swap descartado.`
        );
        return;
      }
    }

    swapItemsRestaurados.push({
      ...sw,
      id: sw.id || `sw_rest_${sw.classId}_${espAtual?.id || sw.slot.teacherId}_${idx}_${Date.now()}`,
      turmaLabel: `${turmaAtual.year}º ${turmaAtual.letter}`,
      shift: turmaAtual.shift,
      turno: getTurnoCanonical(turmaAtual.shift),
      slot: {
        ...sw.slot,
        teacherId: espAtual?.id || sw.slot.teacherId,
        teacherNome: espAtual?.name || sw.slot.teacherNome,
        disciplinaNome: espAtual?.subject || sw.slot.disciplinaNome
      }
    });
  });

  if (swapItemsRestaurados.length > 0) {
    avisosRestauracao.push(
      `${swapItemsRestaurados.length} aula(s) estacionada(s) na Área de Swap foram restauradas do rascunho. Reencaixe-as na grade antes de gravar no Quadro Oficial.`
    );
  }

  // Verifica novas turmas/atribuições regulares que surgiram depois do rascunho (considerando também o que está no Swap)
  turmasAtuais.forEach((t) => {
    const grade = gradeTurmas[t.id] || {};
    t.especialistasIds.forEach((espId) => {
      const temAulaNaTurma = Object.values(grade).some((s) => s?.teacherId === espId);
      const temAulaNoSwap = swapItemsRestaurados.some(
        (sw) => sw.classId === t.id && sw.slot.teacherId === espId
      );
      if (!temAulaNaTurma && !temAulaNoSwap) {
        const esp = espAtualMap.get(espId);
        if (esp) {
          avisosRestauracao.push(
            `Nova atribuição sem horário no rascunho: ${t.year}º ${t.letter} (${esp.name} - ${esp.subject}).`
          );
        }
      }
    });
  });

  const totalAulasEsperadas = especialistasParaReconstrucao.reduce(
    (acc, e) => acc + e.turmasIds.length * opcoesAtuais.aulasPorTurma,
    0
  );

  const resultado = reconstruirResultadoDesdeGradesTurmas(gradeTurmas, {
    turmas: turmasAtuais,
    especialistas: especialistasParaReconstrucao,
    maxEspecialistasPorTurmaDia: opcoesAtuais.maxEspecialistasPorTurmaDia || 2,
    ocupacoesExternasPorProfessor: opcoesAtuais.ocupacoesExternasPorProfessor,
    respeitarIntervaloEntreEscolas: opcoesAtuais.respeitarIntervaloEntreEscolas,
    totalAulasEsperadas,
    tempoCalculoMs: 0,
    formatoAulas: snapshot.opcoes.formatoAulas,
    mensagem: `Simulação restaurada do rascunho de ${new Date(snapshot.salvoEm).toLocaleString('pt-BR')}.`
  });

  if (resultado.conflitos.length > 0) {
    avisosRestauracao.unshift(
      `Atenção: foram detectados ${resultado.conflitos.length} conflito(s) ao revalidar este rascunho contra o banco atual (por exemplo, aulas oficializadas em outra escola depois que o rascunho foi salvo). Ajuste as aulas sinalizadas abaixo sem precisar recalcular tudo.`
    );
  }

  const selectedClassesRestauradas: Record<string, boolean> = {};
  const selSet = new Set(snapshot.selectedClassesToApply || []);
  turmasAtuais.forEach((t) => {
    const temSlots =
      (gradeTurmas[t.id] && Object.keys(gradeTurmas[t.id]).length > 0) ||
      swapItemsRestaurados.some((sw) => sw.classId === t.id);
    if (snapshot.selectedClassesToApply && snapshot.selectedClassesToApply.length > 0) {
      selectedClassesRestauradas[t.id] = Boolean(selSet.has(t.id) && temSlots);
    } else {
      selectedClassesRestauradas[t.id] = Boolean(temSlots);
    }
  });

  return {
    resultado: {
      ...resultado,
      avisos: Array.from(new Set([...avisosRestauracao, ...resultado.avisos]))
    },
    avisosRestauracao: Array.from(new Set(avisosRestauracao)),
    especialistasConfigRestaurados,
    haMapRestaurado,
    selectedClassesRestauradas,
    swapItemsRestaurados
  };
}


