import * as XLSX from 'xlsx';
import {
  ClassRoom,
  School,
  Student,
  getTurnoCanonical,
  normalizarIntervaloGrupoPorDia
} from '../types';
import { normalizarNome, saoRAsIguais } from './identidadeAluno';
import { SinoConfig, perfisDoTurno, perfilPorAno } from './sino';

export interface AlunoVirada {
  name: string;
  ra: string;
  rm: string;
  birthdate: string; // YYYY-MM-DD
  observacao?: string;
}

export interface TurmaVirada {
  schoolId?: string;
  schoolName: string;
  year: string; // '1'..'5' (já promovida)
  serieOrigem?: string;
  letter: string;
  shift: string;
  anoLetivo: string;
  intervaloGrupo?: string;
  intervaloGrupoPorDia?: Record<string, string>;
  alunos: AlunoVirada[];
}

export interface PacoteViradaAno {
  tipo: 'virada-ano-letivo';
  versao: 1;
  geradoEm: string;
  anoOrigem: string;
  anoDestino: string;
  turmas: TurmaVirada[];
}

export interface OpcoesGeracaoVirada {
  anoOrigem: string;
  anoDestino: string;
  schoolIdFiltro?: string; // '' = todas
  seriesOrigem: string[]; // ex: ['1', '2', '3', '4']
  incluirConcluintes5Ano?: boolean;
  apenasAlunosAtivos?: boolean;
  ordenarAlfabeticamente?: boolean;
}

export interface PreviaTurmaVirada {
  chave: string;
  acao: 'criar' | 'reaproveitar';
  existingClassId?: string;
  schoolId: string;
  schoolName: string;
  year: string;
  letter: string;
  shift: string;
  anoLetivo: string;
  intervaloGrupo?: string;
  intervaloGrupoPorDia?: Record<string, string>;
  alunosNovos: AlunoVirada[];
  alunosDuplicados: AlunoVirada[];
  startNumber: number;
}

export interface PreviaViradaAno {
  anoDestino: string;
  turmasNovas: number;
  turmasReaproveitadas: number;
  alunosNovos: number;
  alunosDuplicados: number;
  avisos: string[];
  itens: PreviaTurmaVirada[];
}

export function normalizarSerieNumero(raw?: string | number | null): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const m = s.match(/(\d+)/);
  return m ? m[1] : s;
}

export function promoverSerie(yearRaw?: string, incluirConcluintes5Ano = false): string | null {
  const num = Number(normalizarSerieNumero(yearRaw));
  if (!Number.isFinite(num) || num <= 0) return null;
  if (num >= 1 && num <= 4) return String(num + 1);
  if (num === 5) return incluirConcluintes5Ano ? '5' : null;
  return String(num);
}

export function normalizarTurnoVirada(shift?: string | null): string {
  const raw = String(shift ?? '').trim();
  if (!raw) return 'Manhã';
  const c = getTurnoCanonical(raw);
  if (c === 'manha') return 'Manhã';
  if (c === 'tarde') return 'Tarde';
  if (c === 'noite') return 'Noite';
  const low = raw.toLowerCase();
  if (low.includes('integral')) return 'Integral';
  return raw;
}

export function normalizarDataNascimento(raw: unknown): string {
  if (raw === null || raw === undefined || raw === '') return '';

  // Serial numérico do Excel (sistema 1900)
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 1000 && raw < 100000) {
    const parsed = XLSX.SSF.parse_date_code(raw);
    if (parsed && parsed.y && parsed.m && parsed.d) {
      const y = String(parsed.y).padStart(4, '0');
      const m = String(parsed.m).padStart(2, '0');
      const d = String(parsed.d).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  }

  if (raw instanceof Date && !isNaN(raw.getTime())) {
    const y = raw.getUTCFullYear();
    const m = String(raw.getUTCMonth() + 1).padStart(2, '0');
    const d = String(raw.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  const s = String(raw).trim();
  if (!s) return '';

  // YYYY-MM-DD ou YYYY/MM/DD
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) {
    return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  }

  // DD/MM/YYYY ou DD-MM-YYYY
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) {
    return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }

  return s;
}

export function formatarDataNascimentoBR(iso?: string): string {
  const norm = normalizarDataNascimento(iso);
  if (!norm) return '';
  const m = norm.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return norm;
}

function isSituacaoInativaExcel(situacao?: string): boolean {
  const s = normalizarNome(situacao);
  if (!s) return false;
  return (
    s.includes('expedida') ||
    s.includes('transferid') ||
    s.includes('desistente') ||
    s.includes('evadido') ||
    s.includes('inativo') ||
    s.includes('excluir') ||
    s.includes('remover') ||
    s === 'nao' ||
    s === 'sair'
  );
}

/**
 * Monta o pacote limpo de transição (sem IDs antigos, sem grade horária, sem notas/chamadas).
 */
export function construirPacoteVirada(
  allClasses: { id: string; val: ClassRoom }[],
  schools: School[],
  opcoes: OpcoesGeracaoVirada
): PacoteViradaAno {
  const {
    anoOrigem,
    anoDestino,
    schoolIdFiltro = '',
    seriesOrigem,
    incluirConcluintes5Ano = false,
    apenasAlunosAtivos = true,
    ordenarAlfabeticamente = true
  } = opcoes;

  const seriesSet = new Set(seriesOrigem.map((s) => normalizarSerieNumero(s)));
  const agrupado = new Map<string, TurmaVirada>();

  allClasses.forEach(({ val }) => {
    const cAno = String(val.anoLetivo || '').trim();
    if (cAno && cAno !== String(anoOrigem).trim()) return;
    if (schoolIdFiltro && val.schoolId !== schoolIdFiltro) return;

    const serieOrig = normalizarSerieNumero(val.year);
    if (!seriesSet.has(serieOrig)) return;

    const serieDest = promoverSerie(serieOrig, incluirConcluintes5Ano);
    if (!serieDest) return;

    const schoolObj = schools.find((s) => s.id === val.schoolId);
    const schoolName = schoolObj?.name || val.schoolName || 'Escola';
    const letter = String(val.letter || 'A').trim().toUpperCase();
    const shift = normalizarTurnoVirada(val.shift);

    const alunosOrigem = val.alunos ? Object.values(val.alunos) : [];
    const alunosFiltrados: AlunoVirada[] = alunosOrigem
      .filter((st) => {
        if (!st || !st.name) return false;
        if (apenasAlunosAtivos && st.status === 'expedida') return false;
        return true;
      })
      .map((st) => ({
        name: String(st.name || '').trim(),
        ra: String(st.ra || '').trim(),
        rm: String(st.rm || '').trim(),
        birthdate: normalizarDataNascimento(st.birthdate)
      }));

    const key = `${val.schoolId || normalizarNome(schoolName)}|${serieDest}|${letter}|${normalizarTurnoVirada(shift)}`;
    const existente = agrupado.get(key);
    if (existente) {
      existente.alunos.push(...alunosFiltrados);
    } else {
      const porDiaNorm = normalizarIntervaloGrupoPorDia(val.intervaloGrupoPorDia);
      const porDiaClean: Record<string, string> = {};
      Object.entries(porDiaNorm).forEach(([d, g]) => {
        if (g) porDiaClean[`d${d}`] = g;
      });
      agrupado.set(key, {
        schoolId: val.schoolId,
        schoolName,
        year: serieDest,
        serieOrigem: serieOrig,
        letter,
        shift,
        anoLetivo: String(anoDestino).trim(),
        intervaloGrupo: serieOrig === serieDest ? val.intervaloGrupo : undefined,
        intervaloGrupoPorDia: Object.keys(porDiaClean).length > 0 ? porDiaClean : undefined,
        alunos: alunosFiltrados
      });
    }
  });

  const turmas = Array.from(agrupado.values()).map((t) => {
    const dedupAlunos: AlunoVirada[] = [];
    t.alunos.forEach((al) => {
      const dup = dedupAlunos.some(
        (x) =>
          saoRAsIguais(x.ra, al.ra) ||
          (normalizarNome(x.name) === normalizarNome(al.name) &&
            (!x.birthdate || !al.birthdate || x.birthdate === al.birthdate))
      );
      if (!dup) dedupAlunos.push(al);
    });
    if (ordenarAlfabeticamente) {
      dedupAlunos.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    }
    return { ...t, alunos: dedupAlunos };
  });

  turmas.sort((a, b) => {
    const esc = a.schoolName.localeCompare(b.schoolName, 'pt-BR');
    if (esc !== 0) return esc;
    const yr = Number(a.year) - Number(b.year);
    if (yr !== 0) return yr;
    const lt = a.letter.localeCompare(b.letter, 'pt-BR');
    if (lt !== 0) return lt;
    return a.shift.localeCompare(b.shift, 'pt-BR');
  });

  return {
    tipo: 'virada-ano-letivo',
    versao: 1,
    geradoEm: new Date().toISOString(),
    anoOrigem: String(anoOrigem).trim(),
    anoDestino: String(anoDestino).trim(),
    turmas
  };
}

/**
 * Exporta o pacote de virada como arquivo Excel (.xlsx) editável pela secretaria.
 */
export function exportarViradaExcel(pacote: PacoteViradaAno): string {
  const rows: Record<string, string>[] = [];

  pacote.turmas.forEach((t) => {
    const serieDestLabel = /^\d+$/.test(t.year) ? `${t.year}º Ano` : t.year;
    const serieOrigLabel = t.serieOrigem
      ? /^\d+$/.test(t.serieOrigem)
        ? `${t.serieOrigem}º Ano`
        : t.serieOrigem
      : '';

    if (t.alunos.length === 0) {
      rows.push({
        Escola: t.schoolName,
        Ano_Letivo_Destino: t.anoLetivo,
        Serie_Destino: serieDestLabel,
        Turma_Letra: t.letter,
        Turno: t.shift,
        Nome_Aluno: '',
        RA: '',
        RM: '',
        Data_Nascimento: '',
        Situacao: 'Ativo',
        Serie_Origem: serieOrigLabel,
        Observacao: 'Turma sem alunos (manter estrutura)'
      });
      return;
    }

    t.alunos.forEach((al) => {
      rows.push({
        Escola: t.schoolName,
        Ano_Letivo_Destino: t.anoLetivo,
        Serie_Destino: serieDestLabel,
        Turma_Letra: t.letter,
        Turno: t.shift,
        Nome_Aluno: al.name,
        RA: al.ra,
        RM: al.rm,
        Data_Nascimento: formatarDataNascimentoBR(al.birthdate),
        Situacao: 'Ativo',
        Serie_Origem: serieOrigLabel,
        Observacao: ''
      });
    });
  });

  const wsMain = XLSX.utils.json_to_sheet(rows, {
    header: [
      'Escola',
      'Ano_Letivo_Destino',
      'Serie_Destino',
      'Turma_Letra',
      'Turno',
      'Nome_Aluno',
      'RA',
      'RM',
      'Data_Nascimento',
      'Situacao',
      'Serie_Origem',
      'Observacao'
    ]
  });

  wsMain['!cols'] = [
    { wch: 28 },
    { wch: 18 },
    { wch: 14 },
    { wch: 13 },
    { wch: 12 },
    { wch: 36 },
    { wch: 16 },
    { wch: 14 },
    { wch: 16 },
    { wch: 12 },
    { wch: 14 },
    { wch: 28 }
  ];

  const instrucoes = [
    { Campo: 'Como usar esta planilha na virada do ano', Descricao: 'Edite os dados abaixo no Excel/LibreOffice/Google Sheets e salve em .xlsx antes de importar de volta em Turmas -> Virada de Ano.' },
    { Campo: 'Escola', Descricao: 'Nome exato da escola cadastrada no sistema.' },
    { Campo: 'Ano_Letivo_Destino', Descricao: `Ano letivo de destino (ex.: ${pacote.anoDestino}).` },
    { Campo: 'Serie_Destino', Descricao: 'Série promovida para o novo ano (ex.: 2º Ano, 3º Ano, 4º Ano, 5º Ano ou apenas o número 2, 3, 4, 5).' },
    { Campo: 'Turma_Letra e Turno', Descricao: 'Para remanejar um aluno de sala ou turno, basta alterar Turma_Letra (ex.: A -> B) ou Turno (Manhã/Tarde/Integral/Noite).' },
    { Campo: 'Excluir aluno que saiu', Descricao: 'Apague a linha inteira no Excel OU altere a coluna Situacao para "Transferido" ou "Inativo".' },
    { Campo: 'Adicionar aluno novo', Descricao: 'Insira uma nova linha com Escola, Ano_Letivo_Destino, Serie_Destino, Turma_Letra, Turno, Nome_Aluno, RA e Data_Nascimento (DD/MM/AAAA).' },
    { Campo: 'Manter turma vazia', Descricao: 'Deixe uma linha da turma com Nome_Aluno em branco para criar a turma mesmo antes de matricular alunos.' }
  ];
  const wsHelp = XLSX.utils.json_to_sheet(instrucoes);
  wsHelp['!cols'] = [{ wch: 28 }, { wch: 95 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsMain, 'Turmas_e_Alunos');
  XLSX.utils.book_append_sheet(wb, wsHelp, 'Instrucoes');

  const filename = `virada_turmas_${pacote.anoOrigem}_para_${pacote.anoDestino}.xlsx`;
  XLSX.writeFile(wb, filename);
  return filename;
}

/**
 * Exporta o pacote de virada em JSON limpo (pronto para reimportação em novo ano).
 */
export function exportarViradaJSON(pacote: PacoteViradaAno): string {
  const filename = `virada_turmas_${pacote.anoOrigem}_para_${pacote.anoDestino}.json`;
  const json = JSON.stringify(pacote, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return filename;
}

function getCol(row: Record<string, any>, candidates: string[]): unknown {
  const entries = Object.entries(row);
  for (const cand of candidates) {
    const normCand = normalizarNome(cand);
    for (const [k, v] of entries) {
      if (normalizarNome(k) === normCand) return v;
    }
  }
  return undefined;
}

/**
 * Lê arquivo .xlsx, .xls, .csv ou .json e converte para PacoteViradaAno normalizado.
 */
export async function parseArquivoVirada(
  file: File,
  defaultAnoDestino: string
): Promise<PacoteViradaAno> {
  const nameLower = file.name.toLowerCase();

  if (nameLower.endsWith('.json')) {
    const text = await file.text();
    const parsed = JSON.parse(text);

    // Formato oficial de virada
    if (parsed && parsed.tipo === 'virada-ano-letivo' && Array.isArray(parsed.turmas)) {
      return {
        tipo: 'virada-ano-letivo',
        versao: 1,
        geradoEm: parsed.geradoEm || new Date().toISOString(),
        anoOrigem: String(parsed.anoOrigem || ''),
        anoDestino: String(parsed.anoDestino || defaultAnoDestino),
        turmas: parsed.turmas.map((t: any) => ({
          schoolId: t.schoolId,
          schoolName: String(t.schoolName || '').trim(),
          year: normalizarSerieNumero(t.year),
          serieOrigem: t.serieOrigem,
          letter: String(t.letter || 'A').trim().toUpperCase(),
          shift: normalizarTurnoVirada(t.shift),
          anoLetivo: String(t.anoLetivo || defaultAnoDestino).trim(),
          intervaloGrupo: t.intervaloGrupo,
          intervaloGrupoPorDia: t.intervaloGrupoPorDia,
          alunos: Array.isArray(t.alunos)
            ? t.alunos
                .filter((a: any) => a && String(a.name || '').trim())
                .map((a: any) => ({
                  name: String(a.name || '').trim(),
                  ra: String(a.ra || '').trim(),
                  rm: String(a.rm || '').trim(),
                  birthdate: normalizarDataNascimento(a.birthdate)
                }))
            : []
        }))
      };
    }

    // Fallback: JSON legado exportado diretamente de diario-classe/turmas ({ [id]: ClassRoom })
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const turmasLegacy: TurmaVirada[] = [];
      Object.values(parsed).forEach((raw: any) => {
        if (!raw || typeof raw !== 'object' || !raw.year || !raw.schoolName) return;
        const alunosRaw = raw.alunos ? Object.values(raw.alunos) : [];
        turmasLegacy.push({
          schoolId: raw.schoolId,
          schoolName: String(raw.schoolName || '').trim(),
          year: normalizarSerieNumero(raw.year),
          letter: String(raw.letter || 'A').trim().toUpperCase(),
          shift: normalizarTurnoVirada(raw.shift),
          anoLetivo: String(defaultAnoDestino).trim(),
          intervaloGrupo: raw.intervaloGrupo,
          intervaloGrupoPorDia: raw.intervaloGrupoPorDia,
          alunos: (alunosRaw as any[])
            .filter((a) => a && a.name && a.status !== 'expedida')
            .map((a) => ({
              name: String(a.name || '').trim(),
              ra: String(a.ra || '').trim(),
              rm: String(a.rm || '').trim(),
              birthdate: normalizarDataNascimento(a.birthdate)
            }))
        });
      });
      if (turmasLegacy.length > 0) {
        return {
          tipo: 'virada-ano-letivo',
          versao: 1,
          geradoEm: new Date().toISOString(),
          anoOrigem: '',
          anoDestino: String(defaultAnoDestino),
          turmas: turmasLegacy
        };
      }
    }

    throw new Error('O arquivo JSON não contém uma estrutura válida de turmas.');
  }

  // Excel (.xlsx / .xls) ou CSV
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array', cellDates: false });
  const sheetName =
    wb.SheetNames.find((n) => normalizarNome(n).includes('turmas')) || wb.SheetNames[0];
  if (!sheetName) {
    throw new Error('Nenhuma aba encontrada na planilha.');
  }

  const sheet = wb.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: '' });
  if (rawRows.length === 0) {
    throw new Error('A planilha está vazia.');
  }

  const agrupado = new Map<string, TurmaVirada>();

  rawRows.forEach((row) => {
    const schoolName = String(
      getCol(row, ['Escola', 'Unidade Escolar', 'schoolName']) ?? ''
    ).trim();
    const anoDestinoRow = String(
      getCol(row, ['Ano_Letivo_Destino', 'Ano Letivo Destino', 'Ano Letivo', 'Ano_Letivo', 'anoLetivo']) ??
        defaultAnoDestino
    ).trim();
    const serieRaw = getCol(row, ['Serie_Destino', 'Serie Destino', 'Serie', 'Ano', 'year']);
    const year = normalizarSerieNumero(serieRaw as any);
    const letter = String(
      getCol(row, ['Turma_Letra', 'Turma Letra', 'Letra', 'Turma', 'letter']) ?? 'A'
    )
      .trim()
      .toUpperCase();
    const shift = normalizarTurnoVirada(
      String(getCol(row, ['Turno', 'Periodo', 'shift']) ?? 'Manhã')
    );

    if (!schoolName || !year) return;

    const situacao = String(getCol(row, ['Situacao', 'Status']) ?? 'Ativo').trim();
    const nomeAluno = String(
      getCol(row, ['Nome_Aluno', 'Nome Aluno', 'Aluno', 'Nome', 'name']) ?? ''
    ).trim();
    const ra = String(getCol(row, ['RA', 'ra']) ?? '').trim();
    const rm = String(getCol(row, ['RM', 'rm']) ?? '').trim();
    const birthRaw = getCol(row, [
      'Data_Nascimento',
      'Data Nascimento',
      'Nascimento',
      'birthdate',
      'Data de Nascimento'
    ]);
    const birthdate = normalizarDataNascimento(birthRaw);

    const key = `${normalizarNome(schoolName)}|${year}|${letter}|${shift}|${anoDestinoRow}`;
    if (!agrupado.has(key)) {
      agrupado.set(key, {
        schoolName,
        year,
        letter,
        shift,
        anoLetivo: anoDestinoRow || defaultAnoDestino,
        alunos: []
      });
    }

    if (nomeAluno && !isSituacaoInativaExcel(situacao)) {
      agrupado.get(key)!.alunos.push({
        name: nomeAluno,
        ra,
        rm,
        birthdate
      });
    }
  });

  const turmas = Array.from(agrupado.values());
  if (turmas.length === 0) {
    throw new Error(
      'Nenhuma turma válida foi identificada na planilha. Verifique as colunas Escola e Serie_Destino.'
    );
  }

  return {
    tipo: 'virada-ano-letivo',
    versao: 1,
    geradoEm: new Date().toISOString(),
    anoOrigem: '',
    anoDestino: String(defaultAnoDestino),
    turmas
  };
}

/**
 * Gera a prévia comparando o pacote com escolas e turmas já existentes no ano destino.
 */
export function gerarPreviaImportacaoVirada(
  pacote: PacoteViradaAno,
  schools: School[],
  existingClassesAllYears: { id: string; val: ClassRoom }[],
  sinoConfig: SinoConfig | undefined,
  anoDestinoOverride?: string
): PreviaViradaAno {
  const anoDestino = String(anoDestinoOverride || pacote.anoDestino || '').trim();
  const avisos: string[] = [];
  const itens: PreviaTurmaVirada[] = [];

  const existingInDestino = existingClassesAllYears.filter(
    (c) => String(c.val.anoLetivo || '').trim() === anoDestino
  );

  let turmasNovas = 0;
  let turmasReaproveitadas = 0;
  let alunosNovos = 0;
  let alunosDuplicados = 0;

  pacote.turmas.forEach((t) => {
    // Resolver escola por ID ou nome normalizado
    let schoolMatch = t.schoolId ? schools.find((s) => s.id === t.schoolId) : undefined;
    if (!schoolMatch) {
      const normName = normalizarNome(t.schoolName);
      schoolMatch =
        schools.find((s) => normalizarNome(s.name) === normName) ||
        schools.find((s) => normalizarNome(s.name).includes(normName) || normName.includes(normalizarNome(s.name)));
    }

    if (!schoolMatch || !schoolMatch.id) {
      avisos.push(
        `Escola não encontrada para "${t.year}º ${t.letter} (${t.shift})": "${t.schoolName}". Cadastre/corrija o nome da escola antes de importar.`
      );
      return;
    }

    const yearNorm = normalizarSerieNumero(t.year) || t.year;
    const letterNorm = String(t.letter || 'A').trim().toUpperCase();
    const shiftNorm = normalizarTurnoVirada(t.shift);
    const chave = `${schoolMatch.id}|${yearNorm}|${letterNorm}|${shiftNorm}|${anoDestino}`;

    // Verifica se já existe no banco ou na própria prévia
    let itemPrevio = itens.find((it) => it.chave === chave);
    const existingClass = existingInDestino.find(
      (c) =>
        c.val.schoolId === schoolMatch!.id &&
        normalizarSerieNumero(c.val.year) === yearNorm &&
        String(c.val.letter || '').trim().toUpperCase() === letterNorm &&
        normalizarTurnoVirada(c.val.shift) === shiftNorm
    );

    if (!itemPrevio) {
      const turnoCanon = getTurnoCanonical(shiftNorm);
      const suportaSino = turnoCanon === 'manha' || turnoCanon === 'tarde';
      const perfis = suportaSino ? perfisDoTurno(sinoConfig, schoolMatch.id, turnoCanon) : [];
      const perfilSugerido = suportaSino ? perfilPorAno(perfis, yearNorm).id : undefined;
      const intervaloGrupo =
        t.intervaloGrupo && perfis.some((p) => p.id === t.intervaloGrupo)
          ? t.intervaloGrupo
          : suportaSino && (turnoCanon === 'manha' || perfis.length > 1)
          ? perfilSugerido
          : undefined;

      const existingStudents = existingClass?.val.alunos
        ? Object.values(existingClass.val.alunos)
        : [];
      const maxNumber = existingStudents.reduce(
        (acc, st) => Math.max(acc, Number(st?.number) || 0),
        0
      );

      itemPrevio = {
        chave,
        acao: existingClass ? 'reaproveitar' : 'criar',
        existingClassId: existingClass?.id,
        schoolId: schoolMatch.id,
        schoolName: schoolMatch.name,
        year: yearNorm,
        letter: letterNorm,
        shift: shiftNorm,
        anoLetivo: anoDestino,
        intervaloGrupo,
        intervaloGrupoPorDia: t.intervaloGrupoPorDia,
        alunosNovos: [],
        alunosDuplicados: [],
        startNumber: maxNumber + 1
      };
      itens.push(itemPrevio);
      if (existingClass) turmasReaproveitadas++;
      else turmasNovas++;
    }

    const existingStudentsInClass = existingClass?.val.alunos
      ? Object.values(existingClass.val.alunos)
      : [];

    t.alunos.forEach((al) => {
      if (!al.name.trim()) return;
      const jaNoBanco = existingStudentsInClass.some(
        (ex) =>
          ex &&
          (saoRAsIguais(ex.ra, al.ra) ||
            (normalizarNome(ex.name) === normalizarNome(al.name) &&
              (!ex.birthdate || !al.birthdate || normalizarDataNascimento(ex.birthdate) === al.birthdate)))
      );
      const jaNoLote = itemPrevio!.alunosNovos.some(
        (ex) =>
          saoRAsIguais(ex.ra, al.ra) ||
          (normalizarNome(ex.name) === normalizarNome(al.name) &&
            (!ex.birthdate || !al.birthdate || ex.birthdate === al.birthdate))
      );

      if (jaNoBanco || jaNoLote) {
        itemPrevio!.alunosDuplicados.push(al);
        alunosDuplicados++;
      } else {
        itemPrevio!.alunosNovos.push(al);
        alunosNovos++;
      }
    });
  });

  return {
    anoDestino,
    turmasNovas,
    turmasReaproveitadas,
    alunosNovos,
    alunosDuplicados,
    avisos,
    itens
  };
}

export function montarUpdatesVirada(
  previa: PreviaViradaAno,
  uid: string,
  createPushKey: (path: string) => string
): Record<string, any> {
  const updates: Record<string, any> = {};
  const now = Date.now();

  previa.itens.forEach((item) => {
    const targetClassId =
      item.acao === 'reaproveitar' && item.existingClassId
        ? item.existingClassId
        : createPushKey('diario-classe/turmas');

    if (item.acao === 'criar') {
      const classPayload: Record<string, any> = {
        schoolId: item.schoolId,
        schoolName: item.schoolName,
        year: item.year,
        letter: item.letter,
        shift: item.shift,
        anoLetivo: item.anoLetivo,
        createdAt: now,
        criadoPor: uid
      };
      if (item.intervaloGrupo) {
        classPayload.intervaloGrupo = item.intervaloGrupo;
      }
      if (item.intervaloGrupoPorDia && Object.keys(item.intervaloGrupoPorDia).length > 0) {
        classPayload.intervaloGrupoPorDia = item.intervaloGrupoPorDia;
      }
      updates[`diario-classe/turmas/${targetClassId}`] = classPayload;
      updates[`diario-classe/atribuicoes/${uid}/${targetClassId}`] = true;
    }

    let nextNumber = item.startNumber;
    item.alunosNovos.forEach((al) => {
      const studentId = createPushKey(`diario-classe/turmas/${targetClassId}/alunos`);
      const studentPayload: Omit<Student, 'id'> = {
        classId: targetClassId,
        number: nextNumber++,
        name: al.name.trim(),
        ra: al.ra.trim(),
        rm: al.rm.trim(),
        birthdate: al.birthdate,
        status: 'ativo',
        anoLetivo: item.anoLetivo,
        createdAt: now
      };
      updates[`diario-classe/turmas/${targetClassId}/alunos/${studentId}`] = studentPayload;
    });
  });

  return updates;
}
