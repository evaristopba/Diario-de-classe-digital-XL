/**
 * Sino (horários das aulas e dos intervalos) CONFIGURÁVEL por escola, turno e perfil/faixa.
 *
 * Lógica PURA (sem Firebase/React). A configuração fica em `diario-classe/config/sino`:
 *   padrao/{matutino|vespertino}                 -> padrão da rede
 *   escolas/{schoolId}/{matutino|vespertino}     -> sobrescreve o padrão numa escola
 *
 * Cada turno pode ter quantos perfis de horário a escola precisar (1, 2, 3, 4...),
 * cada um com nome livre (ex.: "1º ao 3º Ano", "4º e 5º Anos"), séries sugeridas,
 * 5 aulas, intervalo/recreio e blocos opcionais de lanche e refeição.
 * Resolução por turno: escola (se tiver >=1 perfil válido) -> padrão da rede -> SINO_PADRAO (embutido).
 */
import { minutosDe } from './horaAtividade';
export { minutosDe };

export type GrupoSinoId = string;

export const GRUPOS_SINO: { id: 'G1' | 'G23' | 'G45'; nome: string; curto: string }[] = [
  { id: 'G1', nome: '1º ano', curto: '1º' },
  { id: 'G23', nome: '2º e 3º anos', curto: '2º/3º' },
  { id: 'G45', nome: '4º e 5º anos', curto: '4º/5º' }
];

export interface FaixaHora {
  inicio: string; // HH:MM
  fim: string; // HH:MM
}

export interface SinoGrupoCfg {
  /** Nome amigável do perfil (ex.: "1º ao 3º Ano", "4º e 5º Anos"). */
  nome?: string;
  /** Rótulo curto para badges/colunas (ex.: "1º–3º", "4º/5º"). */
  curto?: string;
  /** Ordem de exibição do perfil no turno. */
  ordem?: number;
  /** Séries vinculadas automaticamente quando a turma não escolheu manualmente (ex.: ['1', '2', '3']). */
  anosSugeridos?: string[];
  intervalo: FaixaHora;
  /** Bloco de leitura/lanche antes do recreio (opcional). */
  complementar?: FaixaHora;
  /** Refeição e saída depois da última aula (opcional). */
  refeicaoFinal?: FaixaHora;
  /** Chaves '1' a '5' (objeto, não array: é assim que o Realtime Database guarda). */
  aulas: Record<string, FaixaHora>;
}

export interface SinoEscolaCfg {
  matutino?: Record<string, SinoGrupoCfg>;
  vespertino?: SinoGrupoCfg | Record<string, SinoGrupoCfg>;
}

export interface SinoConfig {
  padrao?: SinoEscolaCfg;
  escolas?: Record<string, SinoEscolaCfg>;
}

export interface PerfilSino {
  id: string;
  nome: string;
  curto: string;
  ordem: number;
  anosSugeridos: string[];
  cfg: SinoGrupoCfg;
}

const f = (inicio: string, fim: string): FaixaHora => ({ inicio, fim });

/** Padrão embutido (usado quando nada foi configurado). */
export const SINO_PADRAO: {
  matutino: Record<'G1' | 'G23' | 'G45', SinoGrupoCfg>;
  vespertino: SinoGrupoCfg;
} = {
  matutino: {
    // 1º ano: 2 aulas, complementar, recreio 09:10–09:30 e 3 aulas depois
    G1: {
      nome: '1º ano',
      curto: '1º',
      ordem: 1,
      anosSugeridos: ['1'],
      intervalo: f('09:10', '09:30'),
      complementar: f('08:40', '09:10'),
      aulas: { '1': f('07:00', '07:50'), '2': f('07:50', '08:40'), '3': f('09:30', '10:20'), '4': f('10:20', '11:10'), '5': f('11:10', '12:00') }
    },
    // 2º e 3º anos: 3 aulas, recreio 09:30–09:50, 2 aulas e refeição/saída
    G23: {
      nome: '2º e 3º anos',
      curto: '2º/3º',
      ordem: 2,
      anosSugeridos: ['2', '3', 'infantil'],
      intervalo: f('09:30', '09:50'),
      refeicaoFinal: f('11:30', '12:00'),
      aulas: { '1': f('07:00', '07:50'), '2': f('07:50', '08:40'), '3': f('08:40', '09:30'), '4': f('09:50', '10:40'), '5': f('10:40', '11:30') }
    },
    // 4º e 5º anos: 3 aulas, complementar, recreio 09:55–10:15 e 2 aulas
    G45: {
      nome: '4º e 5º anos',
      curto: '4º/5º',
      ordem: 3,
      anosSugeridos: ['4', '5'],
      intervalo: f('09:55', '10:15'),
      complementar: f('09:30', '09:55'),
      aulas: { '1': f('07:00', '07:50'), '2': f('07:50', '08:40'), '3': f('08:40', '09:30'), '4': f('10:20', '11:10'), '5': f('11:10', '12:00') }
    }
  },
  vespertino: {
    nome: 'Vespertino (Todas as Turmas)',
    curto: 'Único',
    ordem: 1,
    intervalo: f('15:00', '15:20'),
    aulas: { '1': f('12:30', '13:20'), '2': f('13:20', '14:10'), '3': f('14:10', '15:00'), '4': f('15:20', '16:10'), '5': f('16:10', '17:00') }
  }
};

/**
 * Modelo com 2 horários de intervalo no matutino:
 *  - 1º ao 3º ano: recreio 09:30–09:50
 *  - 4º e 5º anos: lanche 09:30–09:55 e recreio 09:55–10:15
 */
export function modeloDoisIntervalos(): Record<string, SinoGrupoCfg> {
  return {
    P123: {
      nome: '1º, 2º e 3º anos',
      curto: '1º–3º',
      ordem: 1,
      anosSugeridos: ['1', '2', '3', 'infantil'],
      intervalo: f('09:30', '09:50'),
      refeicaoFinal: f('11:30', '12:00'),
      aulas: { '1': f('07:00', '07:50'), '2': f('07:50', '08:40'), '3': f('08:40', '09:30'), '4': f('09:50', '10:40'), '5': f('10:40', '11:30') }
    },
    P45: {
      nome: '4º e 5º anos',
      curto: '4º/5º',
      ordem: 2,
      anosSugeridos: ['4', '5'],
      intervalo: f('09:55', '10:15'),
      complementar: f('09:30', '09:55'),
      aulas: { '1': f('07:00', '07:50'), '2': f('07:50', '08:40'), '3': f('08:40', '09:30'), '4': f('10:20', '11:10'), '5': f('11:10', '12:00') }
    }
  };
}

/**
 * Modelo para escolas com recreio único 10:00–10:20 e aulas após o recreio 10:20–11:10 e 11:10–12:00
 * (ex.: EMEF Capitão Neves).
 */
export function modeloPosRecreio1020(): Record<string, SinoGrupoCfg> {
  return {
    UNICO: {
      nome: 'Todas as turmas (1º ao 5º)',
      curto: 'Único',
      ordem: 1,
      anosSugeridos: ['1', '2', '3', '4', '5', 'infantil'],
      intervalo: f('10:00', '10:20'),
      complementar: f('09:30', '10:00'),
      aulas: { '1': f('07:00', '07:50'), '2': f('07:50', '08:40'), '3': f('08:40', '09:30'), '4': f('10:20', '11:10'), '5': f('11:10', '12:00') }
    }
  };
}

// ---------------------------------------------------------------------------------------------
// Metadados padrão e normalização de nomes/séries
// ---------------------------------------------------------------------------------------------

const PADRAO_META: Record<string, { nome: string; curto: string; ordem: number; anosSugeridos: string[] }> = {
  G1: { nome: '1º ano', curto: '1º', ordem: 1, anosSugeridos: ['1'] },
  G23: { nome: '2º e 3º anos', curto: '2º/3º', ordem: 2, anosSugeridos: ['2', '3', 'infantil'] },
  G45: { nome: '4º e 5º anos', curto: '4º/5º', ordem: 3, anosSugeridos: ['4', '5'] },
  T: { nome: 'Vespertino (Todas as Turmas)', curto: 'Único', ordem: 1, anosSugeridos: ['1', '2', '3', '4', '5', 'infantil'] }
};

export function sugerirNomeCurto(nome: string): string {
  const limpo = (nome || '').trim();
  if (!limpo) return 'Perfil';
  if (limpo.length <= 10) return limpo;
  return limpo.slice(0, 10).trim();
}

const digitosDoAno = (year?: string) => String(year ?? '').replace(/\D/g, '');

const serieTokenDaTurma = (year?: string): string => {
  const raw = String(year ?? '').trim().toLowerCase();
  const n = digitosDoAno(raw);
  if (n) return n;
  if (raw.includes('inf') || raw.includes('pré') || raw.includes('pre') || raw.includes('creche') || raw.includes('mat')) {
    return 'infantil';
  }
  return '';
};

const normalizarAnosSugeridos = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return [];
  const res: string[] = [];
  raw.forEach((item) => {
    const s = String(item ?? '').trim().toLowerCase();
    if (!s) return;
    const norm = s === 'infantil' ? 'infantil' : digitosDoAno(s) || s;
    if (norm && !res.includes(norm)) res.push(norm);
  });
  return res;
};

/** Grupo padrão legado pela série: 1º ano -> G1; 4º e 5º -> G45; demais (Infantil, 2º, 3º) -> G23. */
export function grupoPorAno(year?: string): 'G1' | 'G23' | 'G45' {
  const n = digitosDoAno(year);
  if (n === '1') return 'G1';
  if (n === '4' || n === '5') return 'G45';
  return 'G23';
}

export function tokenParaGrupo(raw?: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (s === 'G1' || s === '1' || s === 'ano1') return 'G1';
  if (s === 'G23' || s === 'A' || s === 'ano23') return 'G23';
  if (s === 'G45' || s === 'B' || s === 'ano45') return 'G45';
  return s;
}

/**
 * Normaliza `intervaloGrupoPorDia` vindo do Realtime Database (que pode serializar
 * chaves '1'..'5' tanto como objeto quanto como array esparso `[null, "G1", ...]`).
 */
export function normalizarIntervaloGrupoPorDia(raw: unknown): Partial<Record<1 | 2 | 3 | 4 | 5, string>> {
  const res: Partial<Record<1 | 2 | 3 | 4 | 5, string>> = {};
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
 * Grupo legado da turma (para compatibilidade com chamadas antigas sem `config/sino`).
 * Para resolução completa considerando perfis livres da escola, use `resolverPerfilIdTurma`.
 */
export function grupoDaTurma(
  year?: string,
  intervaloGrupo?: string,
  dia?: number,
  intervaloGrupoPorDia?: unknown
): string {
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
  if (intervaloGrupo && intervaloGrupo.trim()) return intervaloGrupo.trim();
  return grupoPorAno(year);
}

// ---------------------------------------------------------------------------------------------
// Configuração efetiva e lista de perfis por escola/turno
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
  if (typeof raw.nome === 'string' && raw.nome.trim()) resultado.nome = raw.nome.trim();
  if (typeof raw.curto === 'string' && raw.curto.trim()) resultado.curto = raw.curto.trim();
  if (typeof raw.ordem === 'number' && Number.isFinite(raw.ordem)) resultado.ordem = raw.ordem;
  const anos = normalizarAnosSugeridos(raw.anosSugeridos);
  if (anos.length > 0) resultado.anosSugeridos = anos;
  if (faixaOk(raw.complementar)) resultado.complementar = limpa(raw.complementar);
  if (faixaOk(raw.refeicaoFinal)) resultado.refeicaoFinal = limpa(raw.refeicaoFinal);
  return resultado;
}

function extrairMapaPerfis(raw: unknown): Record<string, SinoGrupoCfg> | null {
  if (!raw || typeof raw !== 'object') return null;
  // Formato legado de objeto único (vespertino antigo)
  const unico = grupoCfgValido(raw);
  if (unico) {
    return { T: unico };
  }
  const mapa: Record<string, SinoGrupoCfg> = {};
  Object.entries(raw as Record<string, unknown>).forEach(([id, val]) => {
    const ok = grupoCfgValido(val);
    if (ok) mapa[id] = ok;
  });
  return Object.keys(mapa).length > 0 ? mapa : null;
}

export interface SinoEfetivo {
  matutino: Record<string, SinoGrupoCfg>;
  vespertino: SinoGrupoCfg;
  vespertinoPerfis: Record<string, SinoGrupoCfg>;
}

/** Resolve por turno completo: escola (se tiver >=1 perfil válido) -> padrão da rede -> padrão embutido. */
export function sinoEfetivo(config: SinoConfig | undefined | null, schoolId?: string): SinoEfetivo {
  const escola = schoolId ? config?.escolas?.[schoolId] : undefined;
  const rede = config?.padrao;

  const matutino =
    extrairMapaPerfis(escola?.matutino) ||
    extrairMapaPerfis(rede?.matutino) ||
    SINO_PADRAO.matutino;

  const vespertinoPerfis =
    extrairMapaPerfis(escola?.vespertino) ||
    extrairMapaPerfis(rede?.vespertino) ||
    { T: SINO_PADRAO.vespertino };

  const primeiroVespertino = Object.values(vespertinoPerfis)[0] || SINO_PADRAO.vespertino;

  return {
    matutino,
    vespertino: primeiroVespertino,
    vespertinoPerfis
  };
}

/** Lista ordenada de perfis configurados para a escola e turno informados. */
export function perfisDoTurno(
  config: SinoConfig | undefined | null,
  schoolId: string | undefined,
  turno: 'manha' | 'tarde'
): PerfilSino[] {
  const ef = sinoEfetivo(config, schoolId);
  const mapa = turno === 'tarde' ? ef.vespertinoPerfis : ef.matutino;
  return Object.entries(mapa)
    .map(([id, cfg], idx) => {
      const def = PADRAO_META[id];
      const nome = cfg.nome || def?.nome || `Perfil ${id}`;
      const curto = cfg.curto || def?.curto || sugerirNomeCurto(nome);
      const ordem = cfg.ordem ?? def?.ordem ?? idx + 10;
      const anosSugeridos = cfg.anosSugeridos || def?.anosSugeridos || [];
      return { id, nome, curto, ordem, anosSugeridos, cfg };
    })
    .sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome));
}

export function perfilPorAno(perfis: PerfilSino[], year?: string): PerfilSino {
  const serie = serieTokenDaTurma(year);
  if (serie) {
    const porAnos = perfis.find((p) => p.anosSugeridos.includes(serie));
    if (porAnos) return porAnos;
  }
  const legadoId = grupoPorAno(year);
  const legado = perfis.find((p) => p.id === legadoId);
  if (legado) return legado;
  return perfis[0];
}

/** Resolve o ID do perfil efetivo de uma turma (considerando override do dia, vínculo da turma e série). */
export function resolverPerfilIdTurma(
  config: SinoConfig | undefined | null,
  turma: { shift?: string; year?: string; intervaloGrupo?: string; intervaloGrupoPorDia?: unknown; schoolId?: string },
  dia?: number
): string {
  const ehVesp = ehVespertino(turma.shift);
  const perfis = perfisDoTurno(config, turma.schoolId, ehVesp ? 'tarde' : 'manha');
  const ids = new Set(perfis.map((p) => p.id));

  // 1. Sobrescrita explícita por dia da semana
  if (typeof dia === 'number' && dia >= 1 && dia <= 5 && turma.intervaloGrupoPorDia) {
    const mapa = normalizarIntervaloGrupoPorDia(turma.intervaloGrupoPorDia);
    const rawDia = mapa[dia as 1 | 2 | 3 | 4 | 5];
    if (rawDia) {
      if (ids.has(rawDia)) return rawDia;
      const tok = tokenParaGrupo(rawDia);
      if (tok && ids.has(tok)) return tok;
    }
  }

  // 2. Vínculo explícito da turma (se o perfil ainda existir nesta escola)
  const rawGrupo = String(turma.intervaloGrupo ?? '').trim();
  if (rawGrupo) {
    if (ids.has(rawGrupo)) return rawGrupo;

    if (!ehVesp) {
      if (rawGrupo === 'A' || rawGrupo === 'B') {
        const temLegados = ids.has('G1') && ids.has('G23') && ids.has('G45');
        if (temLegados) {
          const n = digitosDoAno(turma.year);
          const padraoAntigo = n === '4' || n === '5' ? 'B' : 'A';
          if (rawGrupo !== padraoAntigo) {
            return rawGrupo === 'A' ? 'G23' : 'G45';
          }
          // Era o padrão antigo automático: deixa cair na correspondência por série (ex.: 1º ano -> G1)
        }
      } else {
        const tok = tokenParaGrupo(rawGrupo);
        if (tok && ids.has(tok)) return tok;
      }
    }
  }

  // 3. Automático pela série (anosSugeridos -> legado -> primeiro perfil)
  return perfilPorAno(perfis, turma.year).id;
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
  grupo: string;
  nome: string;
  intervalo: { inicio: string; fim: string; duracaoMin: number; rotulo: string };
  complementar?: { inicio: string; fim: string; duracaoMin: number; rotulo: string };
  refeicaoFinal?: { inicio: string; fim: string; duracaoMin: number; rotulo: string };
  aulas: { ordem: number; nome: string; inicio: string; fim: string; duracaoMin: number }[];
}

function montar(cfg: SinoGrupoCfg, grupo: string, nome: string): HorarioTurma {
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
  const turno: 'manha' | 'tarde' = ehVespertino(turma.shift) ? 'tarde' : 'manha';
  const perfis = perfisDoTurno(config, turma.schoolId, turno);
  const pid = resolverPerfilIdTurma(config, turma, dia);
  const perfil = perfis.find((p) => p.id === pid) || perfis[0];
  return montar(perfil.cfg, perfil.id, perfil.nome);
}

/** Linhas de rótulo de cada aula do turno: um horário só, ou um por perfil quando diferem. */
export function rotulosDasAulas(
  config: SinoConfig | undefined | null,
  schoolId: string | undefined,
  turno: 'manha' | 'tarde'
): { ordem: number; linhas: string[] }[] {
  const perfis = perfisDoTurno(config, schoolId, turno);
  return ['1', '2', '3', '4', '5'].map((o) => {
    const porHorario = new Map<string, string[]>();
    perfis.forEach((p) => {
      const t = faixaTxt(p.cfg.aulas[o]);
      porHorario.set(t, [...(porHorario.get(t) || []), p.curto]);
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

/** Recreio de cada perfil do turno na escola. */
export function intervalosTurno(
  config: SinoConfig | undefined | null,
  schoolId: string | undefined,
  turno: 'manha' | 'tarde'
): { id: string; curto: string; nome: string; intervalo: FaixaHora; cfg: SinoGrupoCfg }[] {
  return perfisDoTurno(config, schoolId, turno).map((p) => ({
    id: p.id,
    curto: p.curto,
    nome: p.nome,
    intervalo: p.cfg.intervalo,
    cfg: p.cfg
  }));
}

/** Recreio de cada perfil (matutino) na escola, para exibir em avisos. */
export function intervalosMatutino(
  config: SinoConfig | undefined | null,
  schoolId?: string
): { id: string; curto: string; nome: string; intervalo: FaixaHora; cfg: SinoGrupoCfg }[] {
  return intervalosTurno(config, schoolId, 'manha');
}

/** Duração padrão da aula em minutos no turno informado para a escola. */
export function duracaoAulaMinutos(
  config: SinoConfig | undefined | null,
  schoolId: string | undefined,
  turno: 'manha' | 'tarde'
): number {
  const perfis = perfisDoTurno(config, schoolId, turno);
  const grupo = perfis[0]?.cfg;
  const d = grupo ? dur(grupo.aulas['1']) : 50;
  return d > 0 ? d : 50;
}

/** Horário inicial e final do turno considerando aulas e refeição final da escola. */
export function faixaTurno(
  config: SinoConfig | undefined | null,
  schoolId: string | undefined,
  turno: 'manha' | 'tarde'
): { inicio: string; fim: string; rotulo: string } {
  const grupos = perfisDoTurno(config, schoolId, turno).map((p) => p.cfg);
  let minIni = Infinity;
  let maxFim = -Infinity;
  let inicioStr = turno === 'tarde' ? '12:30' : '07:00';
  let fimStr = turno === 'tarde' ? '17:00' : '12:00';

  grupos.forEach((g) => {
    Object.values(g.aulas).forEach((a) => {
      const i = minutosDe(a.inicio);
      const fi = minutosDe(a.fim);
      if (i !== null && i < minIni) {
        minIni = i;
        inicioStr = a.inicio;
      }
      if (fi !== null && fi > maxFim) {
        maxFim = fi;
        fimStr = a.fim;
      }
    });
    if (g.refeicaoFinal) {
      const fi = minutosDe(g.refeicaoFinal.fim);
      if (fi !== null && fi > maxFim) {
        maxFim = fi;
        fimStr = g.refeicaoFinal.fim;
      }
    }
  });

  return { inicio: inicioStr, fim: fimStr, rotulo: `${inicioStr} às ${fimStr}` };
}

/** Posição do divisor de intervalo na tabela de 5 aulas (entre 1 e 4, padrão 3). */
export function posicaoIntervaloTurno(
  config: SinoConfig | undefined | null,
  schoolId: string | undefined,
  turno: 'manha' | 'tarde'
): number {
  const grupos = perfisDoTurno(config, schoolId, turno).map((p) => p.cfg);
  const posicoes = grupos.map((g) => {
    const ini = minutosDe(g.intervalo.inicio) ?? 0;
    return ['1', '2', '3', '4', '5'].filter((o) => (minutosDe(g.aulas[o].fim) ?? 0) <= ini).length;
  });
  const maior = Math.max(...posicoes);
  return Math.max(1, Math.min(4, maior || 3));
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
  if (cfg.nome !== undefined && !cfg.nome.trim()) {
    out.push({ nivel: 'erro', mensagem: 'Informe um nome para o perfil de horário.' });
  }
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
