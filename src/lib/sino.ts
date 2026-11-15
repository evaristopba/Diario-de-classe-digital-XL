/**
 * Sino (horários das aulas e dos intervalos) CONFIGURÁVEL por escola.
 *
 * Lógica PURA (sem Firebase/React). A configuração fica em `diario-classe/config/sino`:
 *   padrao/{matutino|vespertino}                 -> padrão da rede
 *   escolas/{schoolId}/{matutino|vespertino}     -> sobrescreve o padrão numa escola
 * Resolução: escola -> padrão da rede -> SINO_PADRAO (embutido). A busca é feita grupo a grupo, então uma
 * escola pode configurar só o que difere.
 *
 * No matutino há 3 grupos de recreio, conforme a série: 1º ano, 2º e 3º anos, 4º e 5º anos.
 */
import { minutosDe } from './horaAtividade';

export type GrupoSinoId = 'G1' | 'G23' | 'G45';

export const GRUPOS_SINO: { id: GrupoSinoId; nome: string; curto: string }[] = [
  { id: 'G1', nome: '1º ano', curto: '1º' },
  { id: 'G23', nome: '2º e 3º anos', curto: '2º/3º' },
  { id: 'G45', nome: '4º e 5º anos', curto: '4º/5º' }
];

export interface FaixaHora {
  inicio: string; // HH:MM
  fim: string; // HH:MM
}

export interface SinoGrupoCfg {
  intervalo: FaixaHora;
  /** Bloco de leitura/lanche antes do recreio (opcional). */
  complementar?: FaixaHora;
  /** Refeição e saída depois da última aula (opcional). */
  refeicaoFinal?: FaixaHora;
  /** Chaves '1' a '5' (objeto, não array: é assim que o Realtime Database guarda). */
  aulas: Record<string, FaixaHora>;
}

export interface SinoEscolaCfg {
  matutino?: Partial<Record<GrupoSinoId, SinoGrupoCfg>>;
  vespertino?: SinoGrupoCfg;
}

export interface SinoConfig {
  padrao?: SinoEscolaCfg;
  escolas?: Record<string, SinoEscolaCfg>;
}

const f = (inicio: string, fim: string): FaixaHora => ({ inicio, fim });

/** Padrão embutido (usado quando nada foi configurado). */
export const SINO_PADRAO: Required<SinoEscolaCfg> & { matutino: Record<GrupoSinoId, SinoGrupoCfg> } = {
  matutino: {
    // 1º ano: 2 aulas, complementar, recreio 09:10–09:30 e 3 aulas depois
    G1: {
      intervalo: f('09:10', '09:30'),
      complementar: f('08:40', '09:10'),
      aulas: { '1': f('07:00', '07:50'), '2': f('07:50', '08:40'), '3': f('09:30', '10:20'), '4': f('10:20', '11:10'), '5': f('11:10', '12:00') }
    },
    // 2º e 3º anos: 3 aulas, recreio 09:30–09:50, 2 aulas e refeição/saída
    G23: {
      intervalo: f('09:30', '09:50'),
      refeicaoFinal: f('11:30', '12:00'),
      aulas: { '1': f('07:00', '07:50'), '2': f('07:50', '08:40'), '3': f('08:40', '09:30'), '4': f('09:50', '10:40'), '5': f('10:40', '11:30') }
    },
    // 4º e 5º anos: 3 aulas, complementar, recreio 09:55–10:15 e 2 aulas
    G45: {
      intervalo: f('09:55', '10:15'),
      complementar: f('09:30', '09:55'),
      aulas: { '1': f('07:00', '07:50'), '2': f('07:50', '08:40'), '3': f('08:40', '09:30'), '4': f('10:20', '11:10'), '5': f('11:10', '12:00') }
    }
  },
  vespertino: {
    intervalo: f('15:00', '15:20'),
    aulas: { '1': f('12:30', '13:20'), '2': f('13:20', '14:10'), '3': f('14:10', '15:00'), '4': f('15:20', '16:10'), '5': f('16:10', '17:00') }
  }
};

/**
 * Modelo para escolas em que as aulas depois do recreio são 10:20–11:10 e 11:10–12:00
 * (ex.: EMEF Capitão Neves): o mesmo desenho para os três grupos, com recreio 10:00–10:20.
 */
export function modeloPosRecreio1020(): Record<GrupoSinoId, SinoGrupoCfg> {
  const base = (): SinoGrupoCfg => ({
    intervalo: f('10:00', '10:20'),
    complementar: f('09:30', '10:00'),
    aulas: { '1': f('07:00', '07:50'), '2': f('07:50', '08:40'), '3': f('08:40', '09:30'), '4': f('10:20', '11:10'), '5': f('11:10', '12:00') }
  });
  return { G1: base(), G23: base(), G45: base() };
}

// ---------------------------------------------------------------------------------------------
// Grupo de cada turma
// ---------------------------------------------------------------------------------------------

const digitosDoAno = (year?: string) => String(year ?? '').replace(/\D/g, '');

/** Grupo padrão pela série: 1º ano -> G1; 4º e 5º -> G45; demais (Infantil, 2º, 3º) -> G23. */
export function grupoPorAno(year?: string): GrupoSinoId {
  const n = digitosDoAno(year);
  if (n === '1') return 'G1';
  if (n === '4' || n === '5') return 'G45';
  return 'G23';
}

export function tokenParaGrupo(raw?: unknown): GrupoSinoId | null {
  const s = String(raw ?? '').trim();
  if (s === 'G1' || s === '1' || s === 'ano1') return 'G1';
  if (s === 'G23' || s === 'A' || s === 'ano23') return 'G23';
  if (s === 'G45' || s === 'B' || s === 'ano45') return 'G45';
  return null;
}

/**
 * Normaliza `intervaloGrupoPorDia` vindo do Realtime Database (que pode serializar
 * chaves '1'..'5' tanto como objeto quanto como array esparso `[null, "G1", ...]`).
 */
export function normalizarIntervaloGrupoPorDia(raw: unknown): Partial<Record<1 | 2 | 3 | 4 | 5, GrupoSinoId>> {
  const res: Partial<Record<1 | 2 | 3 | 4 | 5, GrupoSinoId>> = {};
  if (!raw) return res;
  if (Array.isArray(raw)) {
    for (let d = 1; d <= 5; d++) {
      const g = tokenParaGrupo(raw[d]);
      if (g) res[d as 1 | 2 | 3 | 4 | 5] = g;
    }
    return res;
  }
  if (typeof raw === 'object') {
    Object.entries(raw as Record<string, unknown>).forEach(([k, v]) => {
      const num = Number(String(k).replace(/^d/i, ''));
      if (Number.isInteger(num) && num >= 1 && num <= 5) {
        const g = tokenParaGrupo(v);
        if (g) res[num as 1 | 2 | 3 | 4 | 5] = g;
      }
    });
  }
  return res;
}

/**
 * Grupo efetivo de uma turma (opcionalmente considerando o dia da semana 1..5).
 * Turmas antigas guardam 'A' ou 'B' (só havia dois grupos):
 *  - se o valor guardado coincide com o que o sistema antigo escolhia pela série, era o padrão automático
 *    e passa a seguir a série (assim os 1º anos deixam de cair no recreio das 09:30);
 *  - se difere, foi escolha manual da secretaria: A -> 2º e 3º, B -> 4º e 5º.
 * Já `intervaloGrupoPorDia` representa escolha explícita por dia e é aplicada diretamente.
 */
export function grupoDaTurma(
  year?: string,
  intervaloGrupo?: string,
  dia?: number,
  intervaloGrupoPorDia?: unknown
): GrupoSinoId {
  if (typeof dia === 'number' && dia >= 1 && dia <= 5 && intervaloGrupoPorDia) {
    const mapa = normalizarIntervaloGrupoPorDia(intervaloGrupoPorDia);
    const grupoDia = mapa[dia as 1 | 2 | 3 | 4 | 5];
    if (grupoDia) return grupoDia;
  }
  if (intervaloGrupo === 'G1' || intervaloGrupo === '1' || intervaloGrupo === 'ano1') return 'G1';
  if (intervaloGrupo === 'G23' || intervaloGrupo === 'ano23') return 'G23';
  if (intervaloGrupo === 'G45' || intervaloGrupo === 'ano45') return 'G45';
  if (intervaloGrupo === 'A' || intervaloGrupo === 'B') {
    const n = digitosDoAno(year);
    const padraoAntigo = n === '4' || n === '5' ? 'B' : 'A';
    if (intervaloGrupo === padraoAntigo) return grupoPorAno(year);
    return intervaloGrupo === 'A' ? 'G23' : 'G45';
  }
  return grupoPorAno(year);
}

// ---------------------------------------------------------------------------------------------
// Configuração efetiva
// ---------------------------------------------------------------------------------------------

/** Aceita só uma configuração de grupo bem formada (intervalo e as 5 aulas com HH:MM válidos). */
export function grupoCfgValido(raw: any): SinoGrupoCfg | null {
  if (!raw || typeof raw !== 'object') return null;
  const faixaOk = (x: any) => x && minutosDe(x.inicio) !== null && minutosDe(x.fim) !== null;
  if (!faixaOk(raw.intervalo) || !raw.aulas) return null;
  for (const o of ['1', '2', '3', '4', '5']) if (!faixaOk(raw.aulas[o])) return null;
  const limpa = (x: any): FaixaHora => ({ inicio: x.inicio, fim: x.fim });
  const resultado: SinoGrupoCfg = {
    intervalo: limpa(raw.intervalo),
    aulas: Object.fromEntries(['1', '2', '3', '4', '5'].map((o) => [o, limpa(raw.aulas[o])]))
  };
  if (faixaOk(raw.complementar)) resultado.complementar = limpa(raw.complementar);
  if (faixaOk(raw.refeicaoFinal)) resultado.refeicaoFinal = limpa(raw.refeicaoFinal);
  return resultado;
}

export interface SinoEfetivo {
  matutino: Record<GrupoSinoId, SinoGrupoCfg>;
  vespertino: SinoGrupoCfg;
}

/** Resolve, grupo a grupo: escola -> padrão da rede -> padrão embutido. */
export function sinoEfetivo(config: SinoConfig | undefined | null, schoolId?: string): SinoEfetivo {
  const escola = schoolId ? config?.escolas?.[schoolId] : undefined;
  const rede = config?.padrao;
  const grupo = (g: GrupoSinoId) =>
    grupoCfgValido(escola?.matutino?.[g]) || grupoCfgValido(rede?.matutino?.[g]) || SINO_PADRAO.matutino[g];
  return {
    matutino: { G1: grupo('G1'), G23: grupo('G23'), G45: grupo('G45') },
    vespertino: grupoCfgValido(escola?.vespertino) || grupoCfgValido(rede?.vespertino) || SINO_PADRAO.vespertino
  };
}

// ---------------------------------------------------------------------------------------------
// Estado ativo (carregado pela tela) e horário de uma turma
// ---------------------------------------------------------------------------------------------

let configAtiva: SinoConfig | undefined;

/** Define a configuração carregada do banco. Chamada pelas telas ao abrir. */
export function definirSinoConfig(config: SinoConfig | undefined | null) {
  configAtiva = config || undefined;
}
export function getSinoConfigAtiva(): SinoConfig | undefined {
  return configAtiva;
}

const dur = (x: FaixaHora) => (minutosDe(x.fim) ?? 0) - (minutosDe(x.inicio) ?? 0);
const faixaTxt = (x: FaixaHora) => `${x.inicio} – ${x.fim}`;

export interface HorarioTurma {
  grupo: GrupoSinoId | 'T';
  nome: string;
  intervalo: { inicio: string; fim: string; duracaoMin: number; rotulo: string };
  complementar?: { inicio: string; fim: string; duracaoMin: number; rotulo: string };
  refeicaoFinal?: { inicio: string; fim: string; duracaoMin: number; rotulo: string };
  aulas: { ordem: number; nome: string; inicio: string; fim: string; duracaoMin: number }[];
}

function montar(cfg: SinoGrupoCfg, grupo: GrupoSinoId | 'T', nome: string): HorarioTurma {
  const bloco = (x: FaixaHora, prefixo: string) => ({ inicio: x.inicio, fim: x.fim, duracaoMin: dur(x), rotulo: `${prefixo} (${faixaTxt(x)})` });
  const resultado: HorarioTurma = {
    grupo,
    nome,
    intervalo: bloco(cfg.intervalo, 'Intervalo / Recreio'),
    aulas: ['1', '2', '3', '4', '5'].map((o) => ({
      ordem: Number(o),
      nome: `${o}ª Aula`,
      inicio: cfg.aulas[o].inicio,
      fim: cfg.aulas[o].fim,
      duracaoMin: dur(cfg.aulas[o])
    }))
  };
  if (cfg.complementar) resultado.complementar = bloco(cfg.complementar, 'Leitura / Lanche');
  if (cfg.refeicaoFinal) resultado.refeicaoFinal = bloco(cfg.refeicaoFinal, 'Refeição e Saída');
  return resultado;
}

const ehVespertino = (shift?: string) => {
  const s = (shift || '').toLowerCase();
  return s.includes('vesp') || s.includes('tarde');
};

/** Horário completo de uma turma, considerando a escola dela e opcionalmente o dia da semana. */
export function horarioDaTurma(
  config: SinoConfig | undefined | null,
  turma: { shift?: string; year?: string; intervaloGrupo?: string; intervaloGrupoPorDia?: unknown; schoolId?: string },
  dia?: number
): HorarioTurma {
  const efetivo = sinoEfetivo(config, turma.schoolId);
  if (ehVespertino(turma.shift)) return montar(efetivo.vespertino, 'T', 'Vespertino (Todas as Turmas)');
  const g = grupoDaTurma(turma.year, turma.intervaloGrupo, dia, turma.intervaloGrupoPorDia);
  return montar(efetivo.matutino[g], g, GRUPOS_SINO.find((x) => x.id === g)!.nome);
}

/** Linhas de rótulo de cada aula do turno: um horário só, ou um por grupo quando diferem. */
export function rotulosDasAulas(
  config: SinoConfig | undefined | null,
  schoolId: string | undefined,
  turno: 'manha' | 'tarde'
): { ordem: number; linhas: string[] }[] {
  const ef = sinoEfetivo(config, schoolId);
  if (turno === 'tarde') {
    return ['1', '2', '3', '4', '5'].map((o) => ({ ordem: Number(o), linhas: [faixaTxt(ef.vespertino.aulas[o])] }));
  }
  return ['1', '2', '3', '4', '5'].map((o) => {
    const porHorario = new Map<string, string[]>();
    GRUPOS_SINO.forEach((g) => {
      const t = faixaTxt(ef.matutino[g.id].aulas[o]);
      porHorario.set(t, [...(porHorario.get(t) || []), g.curto]);
    });
    if (porHorario.size === 1) return { ordem: Number(o), linhas: [Array.from(porHorario.keys())[0]] };
    return { ordem: Number(o), linhas: Array.from(porHorario.entries()).map(([t, gs]) => `${gs.join(' e ')}: ${t}`) };
  });
}

/** Quantas aulas terminam até o início do recreio (a linha do recreio vem depois delas, de 0 a 5). */
export function aulasAntesDoIntervalo(h: { intervalo: { inicio: string }; aulas: { fim: string }[] }): number {
  const ini = minutosDe(h.intervalo.inicio) ?? 0;
  return h.aulas.filter((a) => (minutosDe(a.fim) ?? 0) <= ini).length;
}

/** Recreio de cada grupo (matutino) na escola, para exibir em avisos. */
export function intervalosMatutino(
  config: SinoConfig | undefined | null,
  schoolId?: string
): { id: GrupoSinoId; curto: string; nome: string; intervalo: FaixaHora }[] {
  const ef = sinoEfetivo(config, schoolId);
  return GRUPOS_SINO.map((g) => ({ id: g.id, curto: g.curto, nome: g.nome, intervalo: ef.matutino[g.id].intervalo }));
}

// ---------------------------------------------------------------------------------------------
// Validação (usada pelo editor)
// ---------------------------------------------------------------------------------------------

export interface AvisoSino {
  nivel: 'erro' | 'aviso';
  mensagem: string;
}

export function validarSinoGrupo(cfg: SinoGrupoCfg): AvisoSino[] {
  const out: AvisoSino[] = [];
  const faixa = (nome: string, x?: FaixaHora): [number, number] | null => {
    if (!x) return null;
    const i = minutosDe(x.inicio);
    const fi = minutosDe(x.fim);
    if (i === null || fi === null) {
      out.push({ nivel: 'erro', mensagem: `${nome}: informe início e fim no formato HH:MM.` });
      return null;
    }
    if (fi <= i) {
      out.push({ nivel: 'erro', mensagem: `${nome}: o fim precisa ser depois do início.` });
      return null;
    }
    return [i, fi];
  };

  const aulas = ['1', '2', '3', '4', '5'].map((o) => ({ o, r: faixa(`${o}ª aula`, cfg.aulas?.[o]) }));
  const iv = faixa('Intervalo', cfg.intervalo);
  const comp = faixa('Complementar', cfg.complementar);
  const ref = faixa('Refeição e saída', cfg.refeicaoFinal);
  const ov = (a: [number, number], b: [number, number]) => a[0] < b[1] && b[0] < a[1];

  aulas.forEach(({ o, r }) => {
    if (r && r[1] - r[0] !== 50) out.push({ nivel: 'aviso', mensagem: `${o}ª aula com ${r[1] - r[0]} min (o usual são 50).` });
  });
  for (let i = 1; i < aulas.length; i++) {
    const a = aulas[i - 1].r;
    const b = aulas[i].r;
    if (a && b && b[0] < a[1]) {
      out.push({ nivel: 'erro', mensagem: `A ${aulas[i].o}ª aula começa antes de a ${aulas[i - 1].o}ª terminar.` });
    }
  }
  aulas.forEach(({ o, r }) => {
    if (r && iv && ov(r, iv)) out.push({ nivel: 'erro', mensagem: `O intervalo cai dentro da ${o}ª aula.` });
    if (r && comp && ov(r, comp)) out.push({ nivel: 'erro', mensagem: `O bloco complementar cai dentro da ${o}ª aula.` });
    if (r && ref && ov(r, ref)) out.push({ nivel: 'erro', mensagem: `A refeição/saída cai dentro da ${o}ª aula.` });
  });
  if (iv && comp && ov(iv, comp)) out.push({ nivel: 'erro', mensagem: 'O complementar e o intervalo se sobrepõem.' });

  // Lacunas entre aulas que não são intervalo nem complementar
  for (let i = 1; i < aulas.length; i++) {
    const a = aulas[i - 1].r;
    const b = aulas[i].r;
    if (!a || !b || b[0] <= a[1]) continue;
    let descoberto = b[0] - a[1];
    [iv, comp].forEach((blk) => {
      if (blk) descoberto -= Math.max(0, Math.min(b[0], blk[1]) - Math.max(a[1], blk[0]));
    });
    if (descoberto > 5) {
      out.push({ nivel: 'aviso', mensagem: `Há ${descoberto} min livres entre a ${aulas[i - 1].o}ª e a ${aulas[i].o}ª aula que não são intervalo nem complementar.` });
    }
  }
  return out;
}

/** Remove campos opcionais vazios antes de gravar (o Realtime Database rejeita `undefined`). */
export function sinoGrupoParaGravar(cfg: SinoGrupoCfg): SinoGrupoCfg {
  const ok = grupoCfgValido(cfg);
  if (!ok) throw new Error('Configuração de sino incompleta.');
  return ok;
}
