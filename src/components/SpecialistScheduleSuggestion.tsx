import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  ClassRoom,
  School,
  Teacher,
  SubjectItem,
  ModalConfig,
  DiaSemana,
  GRADE_DIAS_SEMANA,
  getTurnoCanonical,
  getSlotTimeRange,
  getHorariosTurma,
  HoraAtividade,
  normalizarDiasDisponiveis,
  resolverDiasDisponiveisDocente,
  obterDiasFolga,
  formatarDiasFolgaResumo
} from '../types';
import {
  SinoConfig,
  definirSinoConfig,
  getSinoConfigAtiva,
  sinoEfetivo,
  rotulosDasAulas,
  intervalosMatutino,
  aulasAntesDoIntervalo
} from '../lib/sino';
import {
  rtdb,
  ref,
  get,
  set,
  update,
  remove,
  auth,
  cleanFirebaseData,
  getServerTimestamp,
  verificarIsAdmin,
  getCurrentAuthUid
} from '../lib/firebase';
import { formatFriendlyError } from '../lib/errorHandler';
import {
  gerarSugestaoHorariosEspecialistasAsync,
  exportarSugestaoHorariosExcel,
  exportarSugestaoHorariosPDF,
  validarMovimentoAulaSugerida,
  aplicarMovimentoAulaSugerida,
  empilharAulaNoSwap,
  validarEncaixeDeSwap,
  aplicarEncaixeDeSwap,
  serializarSimulacaoBase62,
  desserializarSimulacaoBase62,
  restaurarResultadoDeSnapshot,
  calcularAssinaturaSnapshot,
  obterAssinaturaRascunho,
  EspecialistaConfig,
  TurmaPlanejamento,
  ResultadoSugestaoHorarios,
  FormatoAulasEspecialista,
  TurnoFiltroPlanejamento,
  OcupacaoExternaProfessor,
  ProgressoSugestao,
  ContextoValidacaoHorarios,
  ResultadoValidacaoMovimento,
  ResultadoValidacaoSwap,
  SwapItemAula,
  SnapshotSimulacaoEspecialistas,
  RascunhoSimulacaoNuvem,
  OrigemRascunhoSimulacao
} from '../lib/sugestaoHorariosEspecialistas';
import {
  Sparkles,
  Calendar,
  Clock,
  CheckCircle2,
  AlertTriangle,
  FileSpreadsheet,
  FileText,
  Printer,
  Users,
  Building2,
  BookOpen,
  ShieldCheck,
  Check,
  X,
  RefreshCw,
  Info,
  Coffee,
  CheckSquare,
  Square,
  Save,
  StopCircle,
  GripVertical,
  Undo2,
  RotateCcw,
  ArrowLeftRight,
  Move,
  Award,
  Lock,
  Plus,
  Cloud,
  Copy,
  KeyRound,
  Upload,
  Download,
  Trash2,
  Layers,
  ArrowDownToLine,
  History,
  Edit3
} from 'lucide-react';

interface SpecialistScheduleSuggestionProps {
  currentYear: string;
  setModal: (config: ModalConfig) => void;
  onApplied?: () => void;
  onClose?: () => void;
  onTeacherFolgaUpdated?: (teacherId: string, diasDisponiveis: number[]) => void;
}

export const SpecialistScheduleSuggestion: React.FC<SpecialistScheduleSuggestionProps> = ({
  currentYear,
  setModal,
  onApplied,
  onClose,
  onTeacherFolgaUpdated
}) => {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [applying, setApplying] = useState(false);
  const [savingSuplementares, setSavingSuplementares] = useState(false);

  // Controle de cancelamento e progresso da geração
  const abortControllerRef = useRef<AbortController | null>(null);
  const [progressoGeracao, setProgressoGeracao] = useState<ProgressoSugestao | null>(null);
  const [statusMensagem, setStatusMensagem] = useState<string | null>(null);

  // Ano Letivo e Turno Planejados
  const [planejamentoAno, setPlanejamentoAno] = useState<string>(currentYear);
  const [selectedTurno, setSelectedTurno] = useState<TurnoFiltroPlanejamento>('todos');

  // Escola Selecionada (O planejamento é feito por escola e opcionalmente por turno!)
  const [selectedSchoolId, setSelectedSchoolId] = useState<string>('');

  // Dados carregados do banco
  const [schools, setSchools] = useState<Record<string, School>>({});
  const [classes, setClasses] = useState<{ id: string; val: ClassRoom }[]>([]);
  const [teachers, setTeachers] = useState<{ id: string; val: Teacher }[]>([]);
  const [subjects, setSubjects] = useState<SubjectItem[]>([]);
  const [assignments, setAssignments] = useState<Record<string, Record<string, boolean>>>({});

  // Mapa local de turmas suplementares: teacherId -> { [classId]: boolean (true = suplementar, false/undefined = regular) }
  const [suplementaresMap, setSuplementaresMap] = useState<Record<string, Record<string, boolean>>>({});

  // Mapa local de H.A. (Horas-Atividade) por especialista: teacherId -> ["manha_1_2", ...]
  const [haEspecialistasMap, setHaEspecialistasMap] = useState<Record<string, string[]>>({});

  // Configuração dos Especialistas para geração (folgas e dias)
  const [especialistasConfig, setEspecialistasConfig] = useState<
    Record<string, { folgaDia: number | null; diasDisponiveis: number[] }>
  >({});

  // Opções do gerador
  const [aulasPorTurma, setAulasPorTurma] = useState<number>(2);
  const [formatoAulas, setFormatoAulas] = useState<FormatoAulasEspecialista>('misto');
  const [maxEspecialistasDia] = useState<number>(2);
  const [preservarNaoEspecialistas, setPreservarNaoEspecialistas] = useState<boolean>(false);
  const [respeitarOutrasEscolas, setRespeitarOutrasEscolas] = useState<boolean>(true);

  // Resultado da geração + contexto para validação em tempo real e histórico de ajustes (Desfazer)
  const [resultado, setResultado] = useState<ResultadoSugestaoHorarios | null>(null);
  const [resultadoOriginal, setResultadoOriginal] = useState<ResultadoSugestaoHorarios | null>(null);
  const [contextoGeracao, setContextoGeracao] = useState<ContextoValidacaoHorarios | null>(null);
  const [historicoEdicoes, setHistoricoEdicoes] = useState<
    { resultado: ResultadoSugestaoHorarios; swapItems: SwapItemAula[] }[]
  >([]);
  // Área de Swap (Bandeja Temporária): aulas estacionadas para troca em cadeia sem conflitos
  const [swapItems, setSwapItems] = useState<SwapItemAula[]>([]);
  const [swapItemsOriginal, setSwapItemsOriginal] = useState<SwapItemAula[]>([]);
  const [swapEmEncaixeId, setSwapEmEncaixeId] = useState<string | null>(null);

  // Estado de Arrastar e Soltar / Mover por Clique
  const [aulaEmMovimento, setAulaEmMovimento] = useState<{
    classId: string;
    fromDia: DiaSemana;
    fromOrdem: number;
    teacherId: string;
    teacherName: string;
    disciplinaNome: string;
    turmaLabel: string;
    turno: 'manha' | 'tarde' | 'noite' | 'outro';
    mode: 'drag' | 'click';
  } | null>(null);
  const [hoveredDropTarget, setHoveredDropTarget] = useState<{
    dia: DiaSemana;
    ordem: number;
    turno?: 'manha' | 'tarde' | 'noite' | 'outro';
  } | null>(null);
  const [feedbackMovimento, setFeedbackMovimento] = useState<{
    tipo: 'sucesso' | 'erro';
    mensagem: string;
  } | null>(null);

  // Navegação da visualização da proposta e controle de impressão
  const [previewTab, setPreviewTab] = useState<'turmas' | 'especialistas' | 'resumo'>('turmas');
  const [previewClassId, setPreviewClassId] = useState<string>('');
  const [previewTeacherId, setPreviewTeacherId] = useState<string>('');
  const [previewEspTurno, setPreviewEspTurno] = useState<'todos' | 'manha' | 'tarde' | 'noite'>('todos');
  const [modoImpressao, setModoImpressao] = useState<'atual' | 'todos_especialistas'>('todos_especialistas');

  // Turmas selecionadas para aplicação
  const [selectedClassesToApply, setSelectedClassesToApply] = useState<Record<string, boolean>>({});

  // Persistência Multi-Dispositivo (Nuvem Firebase + Código Portátil Base62; sem armazenamento local do navegador)
  const [rascunhosNuvem, setRascunhosNuvem] = useState<Record<string, RascunhoSimulacaoNuvem>>({});
  const [rascunhoAtivoChave, setRascunhoAtivoChave] = useState<string | null>(null);
  const [savingCloudDraft, setSavingCloudDraft] = useState(false);
  const [avisosRestauracao, setAvisosRestauracao] = useState<string[]>([]);
  const [codigoModal, setCodigoModal] = useState<{
    aberto: boolean;
    modo: 'exportar' | 'importar';
    codigo: string;
    erro?: string;
    copiado?: boolean;
  }>({
    aberto: false,
    modo: 'importar',
    codigo: ''
  });
  const [versaoPromptModal, setVersaoPromptModal] = useState<{
    acao:
      | { tipo: 'salvar_manual' }
      | { tipo: 'excel'; especialistaIdUnico?: string }
      | { tipo: 'pdf'; especialistaIdUnico?: string }
      | { tipo: 'imprimir'; modo: 'atual' | 'todos_especialistas' }
      | { tipo: 'base62' }
      | { tipo: 'pos_importacao'; mensagem: string; temConflitos: boolean };
    origem: OrigemRascunhoSimulacao;
    rotulo: string;
    podeSobrescreverAtiva: boolean;
  } | null>(null);
  const [renomearDraftModal, setRenomearDraftModal] = useState<{
    draft: RascunhoSimulacaoNuvem;
    rotulo: string;
  } | null>(null);
  const pendingRestoreSnapshotRef = useRef<SnapshotSimulacaoEspecialistas | null>(null);
  const pendingImportOriginRef = useRef<'nuvem' | 'base62' | null>(null);
  const pendingDraftKeyRef = useRef<string | null>(null);
  const [restoreTick, setRestoreTick] = useState(0);

  useEffect(() => {
    const uid = getCurrentAuthUid();
    verificarIsAdmin(uid)
      .then((admin) => setIsAdmin(admin))
      .catch(() => setIsAdmin(false));
    carregarDados();
  }, [planejamentoAno]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!aulaEmMovimento && !swapEmEncaixeId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAulaEmMovimento(null);
        setSwapEmEncaixeId(null);
        setHoveredDropTarget(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [aulaEmMovimento, swapEmEncaixeId]);

  const carregarDados = async () => {
    setLoading(true);
    try {
      const [schoolsSnap, classesSnap, teachersSnap, subjectsSnap, atribsSnap, draftsSnap, sinoSnap] = await Promise.all([
        get(ref(rtdb, 'diario-classe/escolas')),
        get(ref(rtdb, 'diario-classe/turmas')),
        get(ref(rtdb, 'diario-classe/professores')),
        get(ref(rtdb, 'diario-classe/disciplinas')),
        get(ref(rtdb, 'diario-classe/atribuicoes')),
        get(ref(rtdb, 'diario-classe/config/simulacoesHorarios')).catch(() => null),
        get(ref(rtdb, 'diario-classe/config/sino')).catch(() => null)
      ]);

      const rawSino = sinoSnap?.exists() ? (sinoSnap.val() as SinoConfig) : undefined;
      definirSinoConfig(rawSino);

      const loadedDrafts = (draftsSnap?.exists() ? draftsSnap.val() : {}) as Record<string, RascunhoSimulacaoNuvem>;
      setRascunhosNuvem(loadedDrafts || {});

      const loadedSchools = (schoolsSnap.exists() ? schoolsSnap.val() : {}) as Record<string, School>;
      setSchools(loadedSchools);

      const schoolIds = Object.keys(loadedSchools);
      if (schoolIds.length > 0 && (!selectedSchoolId || !loadedSchools[selectedSchoolId])) {
        setSelectedSchoolId(schoolIds[0]);
      }

      // Carregar turmas estritamente do ano letivo selecionado
      const rawClasses = classesSnap.exists() ? classesSnap.val() : {};
      const classList: { id: string; val: ClassRoom }[] = [];
      Object.keys(rawClasses).forEach((id) => {
        const c = rawClasses[id];
        if (c && (!c.anoLetivo || String(c.anoLetivo) === String(planejamentoAno))) {
          classList.push({ id, val: c });
        }
      });
      classList.sort((a, b) => {
        const yA = Number(a.val.year) || 0;
        const yB = Number(b.val.year) || 0;
        if (yA !== yB) return yA - yB;
        return (a.val.letter || '').localeCompare(b.val.letter || '');
      });
      setClasses(classList);

      // Professores ativos
      const rawTeachers = teachersSnap.exists() ? teachersSnap.val() : {};
      const teacherList: { id: string; val: Teacher }[] = [];
      const supMap: Record<string, Record<string, boolean>> = {};
      const haMap: Record<string, string[]> = {};

      Object.keys(rawTeachers).forEach((id) => {
        const t = rawTeachers[id];
        if (t && t.status !== 'inactive') {
          teacherList.push({ id, val: t });
          if (t.turmasSuplementares) {
            supMap[id] = { ...t.turmasSuplementares };
          }
          haMap[id] = Array.isArray(t.haHorariosFixos)
            ? Array.from(new Set(t.haHorariosFixos.filter((v: any) => typeof v === 'string' && v.trim())))
            : [];
        }
      });
      teacherList.sort((a, b) => (a.val.name || '').localeCompare(b.val.name || ''));
      setTeachers(teacherList);
      setSuplementaresMap(supMap);
      setHaEspecialistasMap(haMap);

      // Disciplinas
      let subList: SubjectItem[] = [];
      if (subjectsSnap.exists()) {
        const subsVal = subjectsSnap.val();
        subList = Object.keys(subsVal).map((k) => ({ id: k, ...subsVal[k] }));
        setSubjects(subList);
      }

      // Atribuições
      const rawAtribs = (atribsSnap.exists() ? atribsSnap.val() : {}) as Record<string, Record<string, boolean>>;
      setAssignments(rawAtribs);

      // Inicializa folgas dos especialistas (normaliza RTDB e consolida aliases por authUid/e-mail)
      const initialConfigs: Record<string, { folgaDia: number | null; diasDisponiveis: number[] }> = {};
      teacherList.forEach((t) => {
        const dias = resolverDiasDisponiveisDocente(t, teacherList);
        const folgas = obterDiasFolga(dias);
        const folga: number | null = folgas.length === 1 ? folgas[0] : null;

        initialConfigs[t.id] = {
          folgaDia: folga,
          diasDisponiveis: dias
        };
      });
      setEspecialistasConfig(initialConfigs);
    } catch (err: any) {
      console.error('Erro ao carregar dados para o assistente de horários:', err);
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro ao Carregar Dados',
        message: formatFriendlyError(err, 'Não foi possível carregar os dados de turmas e especialistas'),
        icon: '⚠️'
      });
    } finally {
      setLoading(false);
    }
  };

  const normText = (v?: string): string =>
    (v || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();

  // Identifica se um professor atua como especialista (considera tipoDocente + disciplina)
  const isSpecialist = (t: Teacher): boolean => {
    if (t.tipoDocente === 'regente') return false;
    const subStr = normText(t.subject);
    if (subStr.includes('biblioteca') || subStr.includes('leitura')) {
      return false;
    }
    if (t.tipoDocente === 'especialista') return true;
    if (!subStr) return false;
    if (
      subStr.includes('polivalente') ||
      subStr.includes('regente') ||
      subStr.includes('geral') ||
      subStr.includes('pedagog') ||
      subStr.includes('classe')
    ) {
      return false;
    }
    const matched = subjects.find((s) => {
      const sName = normText(s.name);
      const sId = normText(s.id);
      const sShort = normText(s.shortName);
      return (
        sName === subStr ||
        sId === subStr ||
        (sShort && sShort === subStr) ||
        (sName && subStr.includes(sName))
      );
    });
    if (matched) return matched.category === 'diversificada';
    return true;
  };

  // 1. Todas as turmas da Escola Selecionada no Ano Letivo
  const turmasDaEscola = useMemo(() => {
    if (!selectedSchoolId) return [];
    return classes.filter(
      (c) =>
        c.val.schoolId === selectedSchoolId &&
        (!c.val.anoLetivo || String(c.val.anoLetivo).trim() === String(planejamentoAno).trim())
    );
  }, [classes, selectedSchoolId, planejamentoAno]);

  // Turnos presentes na escola (para exibir contagens no filtro)
  const turnosDisponiveisNaEscola = useMemo(() => {
    const counts: Record<'manha' | 'tarde' | 'noite', number> = { manha: 0, tarde: 0, noite: 0 };
    turmasDaEscola.forEach((c) => {
      const tr = getTurnoCanonical(c.val.shift);
      if (tr === 'manha' || tr === 'tarde' || tr === 'noite') {
        counts[tr]++;
      }
    });
    return counts;
  }, [turmasDaEscola]);

  // 2. Turmas filtradas pelo Turno selecionado (escopo efetivo da geração)
  const turmasDoEscopo = useMemo(() => {
    if (selectedTurno === 'todos') return turmasDaEscola;
    return turmasDaEscola.filter((c) => getTurnoCanonical(c.val.shift) === selectedTurno);
  }, [turmasDaEscola, selectedTurno]);

  // Mapa rápido de turmas por id
  const mapaTurmas = useMemo(() => {
    const map = new Map<string, ClassRoom>();
    classes.forEach((c) => map.set(c.id, c.val));
    return map;
  }, [classes]);

  // Coleta transitiva de todas as chaves possíveis do professor (id, authUid e outros cadastros com mesmo e-mail)
  const getTeacherAllKeys = (t: { id: string; val: Teacher }): Set<string> => {
    const keys = new Set<string>([t.id]);
    if (t.val.authUid) keys.add(t.val.authUid);
    const emails = new Set<string>();
    const addEmail = (v?: string) => {
      const m = normText(v);
      if (m) emails.add(m);
    };
    addEmail(t.val.email);
    addEmail((t.val as any).authEmail);

    let expanded = true;
    while (expanded) {
      expanded = false;
      teachers.forEach((other) => {
        const oEmail = normText(other.val.email);
        const oAuthEmail = normText((other.val as any).authEmail);
        const match =
          keys.has(other.id) ||
          (other.val.authUid ? keys.has(other.val.authUid) : false) ||
          (oEmail ? emails.has(oEmail) : false) ||
          (oAuthEmail ? emails.has(oAuthEmail) : false);
        if (match) {
          if (!keys.has(other.id)) {
            keys.add(other.id);
            expanded = true;
          }
          if (other.val.authUid && !keys.has(other.val.authUid)) {
            keys.add(other.val.authUid);
            expanded = true;
          }
          if (oEmail && !emails.has(oEmail)) {
            emails.add(oEmail);
            expanded = true;
          }
          if (oAuthEmail && !emails.has(oAuthEmail)) {
            emails.add(oAuthEmail);
            expanded = true;
          }
        }
      });
    }
    return keys;
  };

  // Helper para coletar atribuições por id, authUid e aliases por e-mail
  const getTurmasAtribuidasDoProfessor = (t: { id: string; val: Teacher }): Record<string, boolean> => {
    const merged: Record<string, boolean> = {};
    const keys = getTeacherAllKeys(t);
    keys.forEach((key) => {
      const map = assignments[key];
      if (map) {
        Object.entries(map).forEach(([cid, val]) => {
          if (val) merged[cid] = true;
        });
      }
    });
    return merged;
  };

  // Helper para verificar se uma turma está marcada como suplementar em qualquer alias do docente
  const isTurmaSuplementarParaDocente = (
    keys: Set<string>,
    classId: string
  ): boolean => {
    for (const k of keys) {
      if (suplementaresMap[k]?.[classId] === true) return true;
    }
    return false;
  };

  // 3. Especialistas que possuem turmas atribuídas NO ESCOPO (Escola + Ano + Turno), deduplicados por docente real
  const especialistasDaEscola = useMemo(() => {
    if (!selectedSchoolId) return [];
    const turmaIdsEscopo = new Set(turmasDoEscopo.map((t) => t.id));

    // Agrupa possíveis registros espelho do mesmo especialista para evitar duplicidade na geração
    const registrosEspecialistas = teachers.filter((t) => isSpecialist(t.val));
    const grupos: Array<{ canonico: { id: string; val: Teacher }; todosRegistros: Array<{ id: string; val: Teacher }>; allKeys: Set<string> }> = [];
    const chaveJaAgrupada = new Set<string>();

    registrosEspecialistas.forEach((t) => {
      const allKeys = getTeacherAllKeys(t);
      const jaTemGrupo = Array.from(allKeys).some((k) => chaveJaAgrupada.has(k));
      if (jaTemGrupo) return;

      const grupoRegs = registrosEspecialistas.filter((cand) => allKeys.has(cand.id));
      allKeys.forEach((k) => chaveJaAgrupada.add(k));

      // Escolhe o registro canônico mais representativo (preferindo quem tem atribuições diretas, authUid ou 28 chars)
      const ordenado = [...grupoRegs].sort((a, b) => {
        const aAtrib = assignments[a.id] && Object.values(assignments[a.id]).some(Boolean) ? 1 : 0;
        const bAtrib = assignments[b.id] && Object.values(assignments[b.id]).some(Boolean) ? 1 : 0;
        if (bAtrib !== aAtrib) return bAtrib - aAtrib;
        const aUid = a.id.length === 28 ? 1 : 0;
        const bUid = b.id.length === 28 ? 1 : 0;
        if (bUid !== aUid) return bUid - aUid;
        return Number(b.val.updatedAt || 0) - Number(a.val.updatedAt || 0);
      });

      grupos.push({
        canonico: ordenado[0] || t,
        todosRegistros: grupoRegs,
        allKeys
      });
    });

    return grupos
      .map(({ canonico: t, allKeys }) => {
        const profAtribs = getTurmasAtribuidasDoProfessor(t);
        const turmasNoEscopo = Object.keys(profAtribs).filter(
          (cId) => profAtribs[cId] === true && turmaIdsEscopo.has(cId)
        );

        const turmasSuplementares = turmasNoEscopo.filter((cId) =>
          isTurmaSuplementarParaDocente(allKeys, cId)
        );
        const turmasRegulares = turmasNoEscopo.filter(
          (cId) => !isTurmaSuplementarParaDocente(allKeys, cId)
        );

        // Verifica atuação e aulas já oficializadas em OUTRAS escolas (ou turmas fora do escopo)
        const turmasOutrasEscolas: string[] = [];
        const ocupacoesExternas: OcupacaoExternaProfessor[] = [];

        classes.forEach((c) => {
          if (turmaIdsEscopo.has(c.id)) return;
          if (c.val.anoLetivo && String(c.val.anoLetivo).trim() !== String(planejamentoAno).trim()) {
            return;
          }
          if (profAtribs[c.id] === true && c.val.schoolId !== selectedSchoolId) {
            turmasOutrasEscolas.push(c.id);
          }
          const grade = c.val.gradeHoraria;
          if (!grade) return;
          const cTurno = getTurnoCanonical(c.val.shift);
          GRADE_DIAS_SEMANA.forEach((d) => {
            for (let o = 1; o <= 5; o++) {
              const slot = grade[`${d.id}_${o}`];
              if (slot?.teacherId && allKeys.has(slot.teacherId)) {
                const range = getSlotTimeRange(
                  c.val,
                  o,
                  slot.horarioCustomInicio,
                  slot.horarioCustomFim,
                  d.id
                );
                ocupacoesExternas.push({
                  schoolId: c.val.schoolId,
                  schoolName: schools[c.val.schoolId]?.name || c.val.schoolName || 'Outra Escola',
                  classId: c.id,
                  className: `${c.val.year}º ${c.val.letter} (${c.val.shift})`,
                  dia: d.id,
                  ordem: o,
                  turno: cTurno,
                  startMin: range.startMin,
                  endMin: range.endMin
                });
              }
            }
          });
        });

        const escolasExternasNomes = Array.from(
          new Set(
            turmasOutrasEscolas
              .map((cId) => {
                const cl = mapaTurmas.get(cId);
                return cl ? schools[cl.schoolId]?.name || cl.schoolName : '';
              })
              .filter(Boolean)
          )
        );

        return {
          id: t.id,
          teacher: t.val,
          allKeys,
          turmasNaEscola: turmasNoEscopo,
          turmasRegulares,
          turmasSuplementares,
          turmasOutrasEscolas,
          escolasExternasNomes,
          ocupacoesExternas
        };
      })
      .filter((item) => item.turmasNaEscola.length > 0);
  }, [
    teachers,
    subjects,
    assignments,
    turmasDoEscopo,
    selectedSchoolId,
    suplementaresMap,
    classes,
    schools,
    planejamentoAno
  ]);

  // Turmas do escopo que efetivamente possuem ao menos 1 especialista Regular atribuído
  const turmasComEspecialistasRegulares = useMemo(() => {
    const idsComEsp = new Set<string>();
    especialistasDaEscola.forEach((e) => {
      e.turmasRegulares.forEach((cId) => idsComEsp.add(cId));
    });
    return turmasDoEscopo.filter((c) => idsComEsp.has(c.id));
  }, [turmasDoEscopo, especialistasDaEscola]);

  // Alterna uma turma do especialista entre Regular e Carga Suplementar
  const handleToggleNaturezaTurma = (teacherId: string, classId: string) => {
    const esp = especialistasDaEscola.find((e) => e.id === teacherId);
    const isAtualSuplementar = esp
      ? isTurmaSuplementarParaDocente(esp.allKeys, classId)
      : suplementaresMap[teacherId]?.[classId] === true;
    const novoValor = !isAtualSuplementar;

    setSuplementaresMap((prev) => {
      const next = { ...prev };
      const keys = esp ? Array.from(esp.allKeys) : [teacherId];
      keys.forEach((k) => {
        next[k] = {
          ...(next[k] || {}),
          [classId]: novoValor
        };
      });
      return next;
    });
  };

  // Salvar a classificação de Carga Suplementar no banco de dados
  const handleSalvarCargaSuplementar = async () => {
    if (!isAdmin) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Acesso Restrito',
        message: 'Apenas a administração/coordenação pode salvar a definição de turmas suplementares.',
        icon: '🔒'
      });
      return;
    }

    setSavingSuplementares(true);
    try {
      const updates: Record<string, any> = {};

      especialistasDaEscola.forEach((item) => {
        const supDocente: Record<string, boolean> = {};
        item.allKeys.forEach((k) => {
          Object.assign(supDocente, suplementaresMap[k] || {});
        });
        teachers.forEach((tReg) => {
          if (item.allKeys.has(tReg.id) && tReg.val?.name) {
            updates[`diario-classe/professores/${tReg.id}/turmasSuplementares`] = supDocente;
          }
        });
      });

      await update(ref(rtdb), updates);

      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Classificação Salva!',
        message: 'A definição de turmas regulares e turmas suplementares foi gravada com sucesso.',
        icon: '✅'
      });
    } catch (err: any) {
      console.error('Erro ao salvar turmas suplementares:', err);
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro ao Salvar',
        message: formatFriendlyError(err, 'Não foi possível gravar a classificação de carga suplementar'),
        icon: '❌'
      });
    } finally {
      setSavingSuplementares(false);
    }
  };

  // Retorna todos os dias de folga/indisponibilidade configurados para um especialista
  const getDiasFolgaEspecialista = (teacherId: string): number[] => {
    const conf = especialistasConfig[teacherId];
    if (conf) return obterDiasFolga(conf.diasDisponiveis, conf.folgaDia);
    const doc = teachers.find((t) => t.id === teacherId);
    if (doc) return obterDiasFolga(resolverDiasDisponiveisDocente(doc, teachers));
    return [];
  };

  // Atualiza folga de um especialista e sincroniza com o banco quando administrador
  const handleFolgaChange = (teacherId: string, folgaStr: string) => {
    if (folgaStr === 'custom') return;
    const folgaVal = folgaStr === 'none' ? null : Number(folgaStr);
    const novosDias = folgaVal === null ? [1, 2, 3, 4, 5] : [1, 2, 3, 4, 5].filter((d) => d !== folgaVal);

    const docAlvo = teachers.find((t) => t.id === teacherId);
    const allAliasIds = docAlvo ? getTeacherAllKeys(docAlvo) : new Set([teacherId]);
    const now = Date.now();

    setEspecialistasConfig((prev) => {
      const next = { ...prev };
      allAliasIds.forEach((aid) => {
        next[aid] = {
          folgaDia: folgaVal,
          diasDisponiveis: novosDias
        };
      });
      return next;
    });

    setTeachers((prev) =>
      prev.map((t) =>
        allAliasIds.has(t.id)
          ? {
              ...t,
              val: {
                ...t.val,
                diasDisponiveis: novosDias,
                diasDisponiveisUpdatedAt: now,
                updatedAt: now
              }
            }
          : t
      )
    );
    onTeacherFolgaUpdated?.(teacherId, novosDias);

    if (isAdmin && docAlvo?.val?.name) {
      const rtdbUpdates: Record<string, any> = {};
      teachers.forEach((other) => {
        if (allAliasIds.has(other.id) && other.val?.name) {
          rtdbUpdates[`diario-classe/professores/${other.id}/diasDisponiveis`] = novosDias;
          rtdbUpdates[`diario-classe/professores/${other.id}/diasDisponiveisUpdatedAt`] = now;
          rtdbUpdates[`diario-classe/professores/${other.id}/updatedAt`] = now;
        }
      });
      if (Object.keys(rtdbUpdates).length > 0) {
        update(ref(rtdb), rtdbUpdates).catch((err) => {
          console.warn('Não foi possível sincronizar folga automaticamente no banco:', err);
        });
      }
    }
  };

  // Cancelar geração em andamento
  const handleCancelarGeracao = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setStatusMensagem('Cancelando geração...');
    }
  };

  // Executa o gerador assíncrono de sugestão para a escola e turno selecionados
  const handleGerarSugestao = async () => {
    if (!selectedSchoolId) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Selecione uma Escola',
        message: 'Por favor, selecione uma escola para realizar o planejamento de horários.',
        icon: '🏫'
      });
      return;
    }

    if (turmasDoEscopo.length === 0) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Nenhuma Turma no Turno Selecionado',
        message: 'Não há turmas cadastradas nesta escola para o turno e ano letivo selecionados.',
        icon: '⚠️'
      });
      return;
    }

    // Considera somente turmas do escopo que tenham ao menos 1 especialista Regular atribuído
    const turmasParaGerar: TurmaPlanejamento[] = turmasComEspecialistasRegulares.map((c) => {
      const espRegulares = especialistasDaEscola
        .filter((e) => e.turmasRegulares.includes(c.id))
        .map((e) => e.id);

      return {
        id: c.id,
        name: `${c.val.year}º ${c.val.letter} - ${c.val.shift}`,
        year: c.val.year,
        letter: c.val.letter,
        shift: c.val.shift,
        intervaloGrupo: c.val.intervaloGrupo,
        intervaloGrupoPorDia: c.val.intervaloGrupoPorDia,
        schoolId: c.val.schoolId,
        schoolName: c.val.schoolName,
        anoLetivo: c.val.anoLetivo || planejamentoAno,
        especialistasIds: espRegulares,
        gradeHorariaExistente: c.val.gradeHoraria
      };
    });

    // Prepara especialistas com pelo menos 1 turma Regular no escopo (escola + turno)
    const resolverConfigEfetiva = (e: (typeof especialistasDaEscola)[number]) => {
      const conf = especialistasConfig[e.id];
      if (conf) return conf;
      const diasRes = resolverDiasDisponiveisDocente({ id: e.id, val: e.teacher }, teachers);
      const folgasRes = obterDiasFolga(diasRes);
      return {
        folgaDia: folgasRes.length === 1 ? folgasRes[0] : null,
        diasDisponiveis: diasRes
      };
    };

    const especialistasParaGerar: EspecialistaConfig[] = especialistasDaEscola
      .filter((e) => e.turmasRegulares.length > 0)
      .map((e) => {
        const conf = resolverConfigEfetiva(e);
        return {
          id: e.id,
          aliasIds: Array.from(e.allKeys),
          name: e.teacher.name,
          subject: e.teacher.subject || 'Especialista',
          diasDisponiveis: conf.diasDisponiveis,
          folgaDia: conf.folgaDia,
          turmasIds: e.turmasRegulares,
          totalAulasNecessarias: e.turmasRegulares.length * aulasPorTurma
        };
      });

    if (especialistasParaGerar.length === 0 || turmasParaGerar.length === 0) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Nenhuma Carga Regular para Agendar',
        message:
          'Todos os especialistas neste escopo possuem apenas Carga Suplementar ou não têm turmas regulares atribuídas neste turno. Verifique a tela de Atribuição de Turmas ou alterne para "Regular".',
        icon: 'ℹ️'
      });
      return;
    }

    // Mapeia ocupações externas (outras escolas / turnos fora do escopo) para evitar choques e respeitar deslocamento no intervalo
    const ocupacoesExternasPorProfessor: Record<string, OcupacaoExternaProfessor[]> = {};
    if (respeitarOutrasEscolas) {
      especialistasDaEscola
        .filter((e) => e.turmasRegulares.length > 0)
        .forEach((e) => {
          if (e.ocupacoesExternas.length > 0) {
            ocupacoesExternasPorProfessor[e.id] = e.ocupacoesExternas;
          }
        });
    }

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setGenerating(true);
    setStatusMensagem('Analisando atribuições, turnos, folgas e horários externos...');
    setProgressoGeracao(null);

    try {
      const res = await gerarSugestaoHorariosEspecialistasAsync(
        turmasParaGerar,
        especialistasParaGerar,
        {
          anoLetivo: planejamentoAno,
          aulasPorTurma,
          formatoAulas,
          maxEspecialistasPorTurmaDia: maxEspecialistasDia,
          preservarOutrosProfessores: preservarNaoEspecialistas,
          escolasIds: [selectedSchoolId],
          turnoFiltro: selectedTurno,
          ocupacoesExternasPorProfessor,
          respeitarIntervaloEntreEscolas: respeitarOutrasEscolas
        },
        {
          signal: controller.signal,
          maxPassos: 12000,
          maxTempoMs: 2500,
          onProgress: (prog) => {
            setProgressoGeracao(prog);
            setStatusMensagem(
              `${prog.etapa} (${prog.aulasAlocadas}/${prog.totalAulas} aulas • ${prog.tempoDecorridoMs}ms)`
            );
          }
        }
      );

      if (res.cancelado) {
        setStatusMensagem('Geração cancelada pelo usuário.');
        return;
      }

      setResultado(res);
      setResultadoOriginal(res);
      setContextoGeracao({
        turmas: turmasParaGerar,
        especialistas: especialistasParaGerar,
        maxEspecialistasPorTurmaDia: maxEspecialistasDia,
        ocupacoesExternasPorProfessor,
        respeitarIntervaloEntreEscolas: respeitarOutrasEscolas,
        totalAulasEsperadas: res.estatisticas.totalAulasEsperadas,
        tempoCalculoMs: res.estatisticas.tempoCalculoMs
      });
      setHistoricoEdicoes([]);
      setSwapItems([]);
      setSwapItemsOriginal([]);
      setSwapEmEncaixeId(null);
      setAvisosRestauracao([]);
      setRascunhoAtivoChave(null);
      setAulaEmMovimento(null);
      setHoveredDropTarget(null);
      setFeedbackMovimento(null);
      setStatusMensagem(null);

      // Seleciona apenas as turmas do escopo que receberam aulas sugeridas
      const toApply: Record<string, boolean> = {};
      turmasComEspecialistasRegulares.forEach((c) => {
        if (res.gradesPorTurma[c.id] && Object.keys(res.gradesPorTurma[c.id]).length > 0) {
          toApply[c.id] = true;
        }
      });
      setSelectedClassesToApply(toApply);

      if (turmasComEspecialistasRegulares.length > 0) {
        setPreviewClassId(turmasComEspecialistasRegulares[0].id);
      }
      if (especialistasParaGerar.length > 0) {
        setPreviewTeacherId(especialistasParaGerar[0].id);
      }

      if (res.sucesso) {
        setModal({
          isOpen: true,
          type: 'alert',
          title: 'Sugestão Gerada com Sucesso!',
          message: `${res.mensagem}`,
          icon: '✨'
        });
      } else {
        setModal({
          isOpen: true,
          type: 'alert',
          title: 'Geração Parcial Concluída',
          message:
            res.mensagem +
            (res.avisos.length > 0 ? `\n\n${res.avisos[0]}` : ''),
          icon: '⚠️'
        });
      }
    } catch (err: any) {
      console.error('Erro ao gerar horários:', err);
      setStatusMensagem(null);
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro no Cálculo de Horários',
        message: err.message || 'Houve uma falha ao resolver a distribuição de horários da escola.',
        icon: '❌'
      });
    } finally {
      setGenerating(false);
      setProgressoGeracao(null);
      abortControllerRef.current = null;
    }
  };

  // Handlers de Arrastar e Soltar / Mover com conferência em tempo real + Área de Swap
  const activeSwapItem = useMemo(
    () => (swapEmEncaixeId ? swapItems.find((i) => i.id === swapEmEncaixeId) || null : null),
    [swapEmEncaixeId, swapItems]
  );

  const limparEstadoMovimento = () => {
    setAulaEmMovimento(null);
    setSwapEmEncaixeId(null);
    setHoveredDropTarget(null);
  };

  // Helpers de H.A. (Horas-Atividade) dos Especialistas nas lacunas
  const parseHASlotKey = (key: string): { turno?: string; dia: number; ordem: number } | null => {
    const parts = (key || '').split('_');
    if (parts.length === 3) {
      const [turno, dStr, oStr] = parts;
      const dia = Number(dStr);
      const ordem = Number(oStr);
      if (dia >= 1 && dia <= 5 && ordem >= 1 && ordem <= 5) {
        return { turno, dia, ordem };
      }
    } else if (parts.length === 2) {
      const [dStr, oStr] = parts;
      const dia = Number(dStr);
      const ordem = Number(oStr);
      if (dia >= 1 && dia <= 5 && ordem >= 1 && ordem <= 5) {
        return { dia, ordem };
      }
    }
    return null;
  };

  const isHAEmSlot = (
    haList: string[] | undefined,
    turno: 'manha' | 'tarde' | 'noite',
    dia: number,
    ordem: number
  ): boolean => {
    if (!haList || haList.length === 0) return false;
    return haList.includes(`${turno}_${dia}_${ordem}`) || haList.includes(`${dia}_${ordem}`);
  };

  const sanitizarHAListaEspecialista = (
    teacherId: string,
    listaRaw: string[] | undefined,
    resAlvo: ResultadoSugestaoHorarios | null
  ): string[] => {
    if (!listaRaw || listaRaw.length === 0) return [];
    const folgasDocente = getDiasFolgaEspecialista(teacherId);
    const espInfo = especialistasDaEscola.find((e) => e.id === teacherId);
    const slotsSugeridos = resAlvo?.gradesPorEspecialistaLista?.[teacherId] || [];
    const externas = respeitarOutrasEscolas ? espInfo?.ocupacoesExternas || [] : [];

    const vistos = new Set<string>();
    const resultadoSanitizado: string[] = [];

    listaRaw.forEach((key) => {
      const parsed = parseHASlotKey(key);
      if (!parsed) return;
      if (folgasDocente.includes(parsed.dia)) return;

      const chocaSugerido = slotsSugeridos.some(
        (s) =>
          s.dia === parsed.dia &&
          s.ordem === parsed.ordem &&
          (!parsed.turno || s.turno === parsed.turno)
      );
      if (chocaSugerido) return;

      const chocaExterno = externas.some(
        (ext) =>
          ext.dia === parsed.dia &&
          ext.ordem === parsed.ordem &&
          (!parsed.turno || ext.turno === parsed.turno)
      );
      if (chocaExterno) return;

      if (!vistos.has(key)) {
        vistos.add(key);
        resultadoSanitizado.push(key);
      }
    });

    return resultadoSanitizado;
  };

  const formatHASlotLabel = (key: string): string => {
    const parsed = parseHASlotKey(key);
    if (!parsed) return key;
    const diaCurto = GRADE_DIAS_SEMANA.find((d) => d.id === parsed.dia)?.curto || `D${parsed.dia}`;
    const turnoTxt =
      parsed.turno === 'manha'
        ? 'Manhã'
        : parsed.turno === 'tarde'
        ? 'Tarde'
        : parsed.turno === 'noite'
        ? 'Noite'
        : '';
    return `${diaCurto} ${parsed.ordem}ª${turnoTxt ? ` (${turnoTxt})` : ''}`;
  };

  const handleToggleHAEspecialista = (
    teacherId: string,
    turno: 'manha' | 'tarde' | 'noite',
    dia: DiaSemana,
    ordem: number
  ) => {
    if (!teacherId || !resultado) return;
    const folgasDocente = getDiasFolgaEspecialista(teacherId);
    if (folgasDocente.includes(dia)) {
      setFeedbackMovimento({
        tipo: 'erro',
        mensagem: 'Não é permitido inserir H.A. no dia de folga semanal do especialista.'
      });
      return;
    }

    const espInfo = especialistasDaEscola.find((e) => e.id === teacherId);
    const slotsSugeridos = resultado.gradesPorEspecialistaLista?.[teacherId] || [];
    const externas = respeitarOutrasEscolas ? espInfo?.ocupacoesExternas || [] : [];

    const ocupadoSugestao = slotsSugeridos.some(
      (s) => s.turno === turno && s.dia === dia && s.ordem === ordem
    );
    const ocupadoExterno = externas.some(
      (ext) => ext.turno === turno && ext.dia === dia && ext.ordem === ordem
    );
    if (ocupadoSugestao || ocupadoExterno) {
      setFeedbackMovimento({
        tipo: 'erro',
        mensagem: 'Só é possível inserir H.A. em lacunas livres (sem aula atribuída).'
      });
      return;
    }

    const canonical = `${turno}_${dia}_${ordem}`;
    const legacy = `${dia}_${ordem}`;

    setHaEspecialistasMap((prev) => {
      const current = prev[teacherId] || [];
      const jaTem = current.includes(canonical) || current.includes(legacy);
      const next = jaTem
        ? current.filter((k) => k !== canonical && k !== legacy)
        : Array.from(new Set([...current, canonical]));
      return {
        ...prev,
        [teacherId]: next
      };
    });
  };

  const handleLimparHAEspecialista = (teacherId: string) => {
    if (!teacherId) return;
    setHaEspecialistasMap((prev) => ({
      ...prev,
      [teacherId]: []
    }));
    setFeedbackMovimento({
      tipo: 'sucesso',
      mensagem: 'Horários de H.A. limpos para este especialista.'
    });
  };

  const handleEmpilharParaSwap = (classId: string, dia: DiaSemana, ordem: number) => {
    if (!resultado || !contextoGeracao) return;
    const emp = empilharAulaNoSwap(resultado, classId, dia, ordem, contextoGeracao);
    if (!emp.sucesso || !emp.resultado || !emp.swapItem) {
      setFeedbackMovimento({
        tipo: 'erro',
        mensagem: emp.motivoErro || 'Não foi possível estacionar esta aula na Bandeja de Swap.'
      });
      return;
    }

    setHistoricoEdicoes((prev) => [...prev.slice(-29), { resultado, swapItems }]);
    setResultado(emp.resultado);
    setSwapItems((prev) => [...prev, emp.swapItem!]);
    setSwapEmEncaixeId(emp.swapItem.id);
    setAulaEmMovimento(null);
    setHoveredDropTarget(null);
    setFeedbackMovimento({
      tipo: 'sucesso',
      mensagem:
        emp.acaoDescricao ||
        'Aula movida para a Bandeja de Swap. Navegue até o horário desejado para reencaixá-la.'
    });
  };

  const handleExecutarEncaixeSwap = (
    toDia: DiaSemana,
    toOrdem: number,
    turnoAlvo?: 'manha' | 'tarde' | 'noite' | 'outro',
    swapIdOverride?: string
  ) => {
    if (!resultado || !contextoGeracao) return;
    const targetSwap = swapIdOverride
      ? swapItems.find((i) => i.id === swapIdOverride)
      : activeSwapItem;
    if (!targetSwap) return;

    const app = aplicarEncaixeDeSwap(resultado, targetSwap, toDia, toOrdem, contextoGeracao, turnoAlvo);
    if (!app.sucesso || !app.resultado) {
      setFeedbackMovimento({
        tipo: 'erro',
        mensagem: app.motivoErro || 'Não foi possível encaixar a aula neste horário.'
      });
      return;
    }

    // Limpa eventual H.A. conflitante no novo horário ocupado
    const teacherAlvoId = targetSwap.slot.teacherId;
    const turnoSlot = targetSwap.turno;
    let removeuHA = false;
    if (teacherAlvoId) {
      setHaEspecialistasMap((prev) => {
        const list = prev[teacherAlvoId];
        if (!list || list.length === 0) return prev;
        const cKey = `${turnoSlot}_${toDia}_${toOrdem}`;
        const lKey = `${toDia}_${toOrdem}`;
        if (!list.includes(cKey) && !list.includes(lKey)) return prev;
        removeuHA = true;
        return {
          ...prev,
          [teacherAlvoId]: list.filter((k) => k !== cKey && k !== lKey)
        };
      });
    }

    setHistoricoEdicoes((prev) => [...prev.slice(-29), { resultado, swapItems }]);
    setResultado(app.resultado);

    const remaining = swapItems.filter((i) => i.id !== targetSwap.id);
    const nextSwapList = app.novoSwapItem ? [...remaining, app.novoSwapItem] : remaining;
    setSwapItems(nextSwapList);
    setSwapEmEncaixeId(app.novoSwapItem ? app.novoSwapItem.id : null);
    setHoveredDropTarget(null);
    setAulaEmMovimento(null);

    setFeedbackMovimento({
      tipo: 'sucesso',
      mensagem: `${app.acaoDescricao || 'Aula encaixada com sucesso.'}${
        removeuHA ? ' (H.A. que ocupava este horário foi removida automaticamente.)' : ''
      }`
    });
  };

  const handleExecutarMovimento = (
    origemClassId: string,
    fromDia: DiaSemana,
    fromOrdem: number,
    toDia: DiaSemana,
    toOrdem: number,
    turnoAlvo?: 'manha' | 'tarde' | 'noite' | 'outro',
    turnoOrigem?: 'manha' | 'tarde' | 'noite' | 'outro',
    targetClassId?: string
  ) => {
    if (!resultado || !contextoGeracao) return;

    const isCrossClass = Boolean(targetClassId && targetClassId !== origemClassId);
    if (
      !isCrossClass &&
      fromDia === toDia &&
      fromOrdem === toOrdem &&
      (!turnoAlvo || turnoAlvo === turnoOrigem)
    ) {
      limparEstadoMovimento();
      return;
    }

    if (turnoAlvo && turnoOrigem && turnoAlvo !== turnoOrigem) {
      setFeedbackMovimento({
        tipo: 'erro',
        mensagem: 'Movimento bloqueado: não é permitido movimentar uma aula de um turno para outro.'
      });
      limparEstadoMovimento();
      return;
    }

    const aplicacao = aplicarMovimentoAulaSugerida(
      resultado,
      { classId: origemClassId, fromDia, fromOrdem },
      { toDia, toOrdem, turnoDestino: turnoAlvo, targetClassId: isCrossClass ? targetClassId : undefined },
      contextoGeracao
    );

    if (!aplicacao.sucesso || !aplicacao.resultado) {
      setFeedbackMovimento({
        tipo: 'erro',
        mensagem: aplicacao.motivoErro || 'Movimento bloqueado pelas regras de horário.'
      });
      limparEstadoMovimento();
      return;
    }

    // Se algum especialista tinha H.A. marcada exatamente na lacuna ocupada pelo movimento, remove a colisão automaticamente
    const turmaMov = contextoGeracao.turmas.find((t) => t.id === origemClassId);
    const turnoMov = turmaMov ? getTurnoCanonical(turmaMov.shift) : turnoAlvo || 'manha';
    const slotNoDestino = aplicacao.resultado.gradesPorTurma[origemClassId]?.[`${toDia}_${toOrdem}`];
    const slotNaOrigem = isCrossClass
      ? aplicacao.resultado.gradesPorTurma[targetClassId!]?.[`${fromDia}_${fromOrdem}`]
      : aplicacao.resultado.gradesPorTurma[origemClassId]?.[`${fromDia}_${fromOrdem}`];

    let removeuHA = false;
    setHaEspecialistasMap((prev) => {
      let changed = false;
      const next = { ...prev };

      const limparSlotHA = (tId: string | undefined, diaSlot: number, ordemSlot: number) => {
        if (!tId || !next[tId] || next[tId].length === 0) return;
        const cKey = `${turnoMov}_${diaSlot}_${ordemSlot}`;
        const lKey = `${diaSlot}_${ordemSlot}`;
        if (next[tId].includes(cKey) || next[tId].includes(lKey)) {
          next[tId] = next[tId].filter((k) => k !== cKey && k !== lKey);
          changed = true;
          removeuHA = true;
        }
      };

      limparSlotHA(slotNoDestino?.teacherId, toDia, toOrdem);
      if (aplicacao.tipo === 'permutar' || aplicacao.tipo === 'permutar_turmas') {
        limparSlotHA(slotNaOrigem?.teacherId, fromDia, fromOrdem);
      }

      return changed ? next : prev;
    });

    setHistoricoEdicoes((prev) => [...prev.slice(-29), { resultado, swapItems }]);
    setResultado(aplicacao.resultado);
    setFeedbackMovimento({
      tipo: 'sucesso',
      mensagem: `${aplicacao.acaoDescricao || 'Horário ajustado sem conflitos.'}${
        removeuHA ? ' (H.A. que ocupava o novo horário foi removida automaticamente.)' : ''
      }`
    });
    limparEstadoMovimento();
  };

  const handleDesfazerMovimento = () => {
    if (historicoEdicoes.length === 0) return;
    const anterior = historicoEdicoes[historicoEdicoes.length - 1];
    setHistoricoEdicoes((prev) => prev.slice(0, -1));
    setResultado(anterior.resultado);
    setSwapItems(anterior.swapItems);
    limparEstadoMovimento();
    setFeedbackMovimento({
      tipo: 'sucesso',
      mensagem: 'Última alteração desfeita.'
    });
  };

  const handleRestaurarOriginal = () => {
    if (!resultadoOriginal || historicoEdicoes.length === 0) return;
    setResultado(resultadoOriginal);
    setSwapItems(swapItemsOriginal);
    setSwapEmEncaixeId(swapItemsOriginal[0]?.id || null);
    setHistoricoEdicoes([]);
    setAulaEmMovimento(null);
    setHoveredDropTarget(null);
    setFeedbackMovimento({
      tipo: 'sucesso',
      mensagem:
        swapItemsOriginal.length > 0
          ? `Grade restaurada ao estado inicial (${swapItemsOriginal.length} aula(s) no Swap preservada(s)).`
          : 'Grade restaurada para a sugestão automática original.'
    });
  };

  // Prepara pacotes normalizados para exportação (Excel e PDF espelhando a aba "Por Especialista")
  const prepararDadosExportacao = () => {
    const turmasParaExport: TurmaPlanejamento[] = turmasComEspecialistasRegulares.map((c) => ({
      id: c.id,
      name: `${c.val.year}º ${c.val.letter}`,
      year: c.val.year,
      letter: c.val.letter,
      shift: c.val.shift,
      intervaloGrupo: c.val.intervaloGrupo,
      intervaloGrupoPorDia: c.val.intervaloGrupoPorDia,
      schoolId: c.val.schoolId,
      schoolName: c.val.schoolName,
      anoLetivo: c.val.anoLetivo || planejamentoAno,
      especialistasIds: []
    }));

    const haSanitizado: Record<string, string[]> = {};
    const ocupacoesExternasExport: Record<string, OcupacaoExternaProfessor[]> = {};

    const especialistasParaExport: EspecialistaConfig[] = especialistasDaEscola
      .filter((e) => e.turmasRegulares.length > 0)
      .map((e) => {
        const diasFallback = resolverDiasDisponiveisDocente({ id: e.id, val: e.teacher }, teachers);
        const folgasFallback = obterDiasFolga(diasFallback);
        const conf = especialistasConfig[e.id] || {
          folgaDia: folgasFallback.length === 1 ? folgasFallback[0] : null,
          diasDisponiveis: diasFallback
        };
        haSanitizado[e.id] = sanitizarHAListaEspecialista(e.id, haEspecialistasMap[e.id], resultado);
        if (respeitarOutrasEscolas && e.ocupacoesExternas.length > 0) {
          ocupacoesExternasExport[e.id] = e.ocupacoesExternas;
        }
        return {
          id: e.id,
          aliasIds: Array.from(e.allKeys),
          name: e.teacher.name,
          subject: e.teacher.subject || 'Especialista',
          diasDisponiveis: conf.diasDisponiveis,
          folgaDia: conf.folgaDia,
          turmasIds: e.turmasRegulares,
          totalAulasNecessarias: e.turmasRegulares.length * aulasPorTurma,
          metaHA: e.teacher.metaHA || 0
        };
      });

    return {
      turmasParaExport,
      especialistasParaExport,
      haSanitizado,
      ocupacoesExternasExport
    };
  };

  // ============================================================================
  // Salvamento & Restauração Multi-Dispositivo (Nuvem Firebase + Código Base62)
  // ============================================================================

  const construirSnapshotAtual = (): SnapshotSimulacaoEspecialistas | null => {
    if (!resultado || !selectedSchoolId) return null;

    const espConfigsSnapshot = especialistasDaEscola
      .filter((e) => e.turmasRegulares.length > 0)
      .map((e) => {
        const diasFallback = resolverDiasDisponiveisDocente({ id: e.id, val: e.teacher }, teachers);
        const folgasFallback = obterDiasFolga(diasFallback);
        const conf = especialistasConfig[e.id] || {
          folgaDia: folgasFallback.length === 1 ? folgasFallback[0] : null,
          diasDisponiveis: diasFallback
        };
        const haSanitizada = sanitizarHAListaEspecialista(e.id, haEspecialistasMap[e.id], resultado);
        return {
          id: e.id,
          name: e.teacher.name,
          subject: e.teacher.subject || 'Especialista',
          folgaDia: conf.folgaDia,
          diasDisponiveis: conf.diasDisponiveis,
          haHorarios: haSanitizada,
          turmasRegulares: e.turmasRegulares,
          turmasSuplementares: e.turmasSuplementares
        };
      });

    const selectedIds = Object.keys(selectedClassesToApply).filter((id) => selectedClassesToApply[id]);

    return {
      versao: 1,
      salvoEm: getServerTimestamp(),
      schoolId: selectedSchoolId,
      schoolName: schools[selectedSchoolId]?.name || 'Unidade Escolar',
      anoLetivo: planejamentoAno,
      turnoFiltro: selectedTurno,
      opcoes: {
        aulasPorTurma,
        formatoAulas,
        preservarOutrosProfessores: preservarNaoEspecialistas,
        respeitarIntervaloEntreEscolas: respeitarOutrasEscolas
      },
      especialistas: espConfigsSnapshot,
      gradesPorTurma: resultado.gradesPorTurma,
      selectedClassesToApply: selectedIds,
      swapItems: swapItems.length > 0 ? swapItems : undefined
    };
  };

  // Indexa assinaturas dos rascunhos na nuvem e identifica alterações não salvas no escopo atual
  const assinaturasRascunhosNuvem = useMemo(() => {
    const mapa: Record<string, string> = {};
    Object.values(rascunhosNuvem).forEach((draft) => {
      if (draft?.chave && draft?.codigoBase62) {
        mapa[draft.chave] = obterAssinaturaRascunho(draft);
      }
    });
    return mapa;
  }, [rascunhosNuvem]);

  const rascunhosDoEscopo = useMemo(() => {
    return Object.values(rascunhosNuvem)
      .filter(
        (r) =>
          r &&
          r.schoolId === selectedSchoolId &&
          String(r.anoLetivo) === String(planejamentoAno) &&
          r.turnoFiltro === selectedTurno
      )
      .sort((a, b) => (b.salvoEm || 0) - (a.salvoEm || 0));
  }, [rascunhosNuvem, selectedSchoolId, planejamentoAno, selectedTurno]);

  const proximoNumeroVersao = useMemo(() => {
    if (rascunhosDoEscopo.length === 0) return 1;
    const maxNum = rascunhosDoEscopo.reduce((acc, r, idx) => {
      const n = r.versaoNumero || rascunhosDoEscopo.length - idx;
      return Math.max(acc, n);
    }, 0);
    return maxNum + 1;
  }, [rascunhosDoEscopo]);

  const assinaturaSimulacaoAtual = useMemo(() => {
    const snap = construirSnapshotAtual();
    if (!snap) return null;
    try {
      return calcularAssinaturaSnapshot(snap);
    } catch {
      return null;
    }
  }, [
    resultado,
    selectedSchoolId,
    planejamentoAno,
    selectedTurno,
    aulasPorTurma,
    formatoAulas,
    preservarNaoEspecialistas,
    respeitarOutrasEscolas,
    especialistasConfig,
    haEspecialistasMap,
    selectedClassesToApply,
    swapItems,
    especialistasDaEscola,
    teachers,
    schools
  ]);

  const rascunhoCorrespondenteAtual = useMemo(() => {
    if (!assinaturaSimulacaoAtual) return null;
    if (
      rascunhoAtivoChave &&
      rascunhosNuvem[rascunhoAtivoChave] &&
      assinaturasRascunhosNuvem[rascunhoAtivoChave] === assinaturaSimulacaoAtual
    ) {
      return rascunhosNuvem[rascunhoAtivoChave];
    }
    return (
      rascunhosDoEscopo.find((d) => assinaturasRascunhosNuvem[d.chave] === assinaturaSimulacaoAtual) ||
      null
    );
  }, [assinaturaSimulacaoAtual, rascunhoAtivoChave, rascunhosNuvem, assinaturasRascunhosNuvem, rascunhosDoEscopo]);

  const temAlteracoesNaoSalvas = Boolean(resultado && assinaturaSimulacaoAtual && !rascunhoCorrespondenteAtual);

  const formatarEtiquetaVersao = (draft?: RascunhoSimulacaoNuvem | null, fallbackDate?: number): {
    versaoInfo: string;
    versaoSufixoArquivo?: string;
  } => {
    if (draft) {
      const idxDesc = rascunhosDoEscopo.findIndex((d) => d.chave === draft.chave);
      const num =
        draft.versaoNumero ||
        (idxDesc >= 0 ? rascunhosDoEscopo.length - idxDesc : 1);
      const rotuloTxt = draft.rotulo ? ` (${draft.rotulo})` : '';
      const dataStr = new Date(draft.salvoEm).toLocaleString('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short'
      });
      return {
        versaoInfo: `Versão v${num}${rotuloTxt} • ${dataStr}`,
        versaoSufixoArquivo: `v${num}`
      };
    }
    const dataStr = new Date(fallbackDate || getServerTimestamp()).toLocaleString('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short'
    });
    return {
      versaoInfo: `Simulação não salva • ${dataStr}`
    };
  };

  const labelOrigemRascunho = (origem?: OrigemRascunhoSimulacao): string => {
    switch (origem) {
      case 'importacao_base62':
        return 'Importado Base62';
      case 'exportacao_excel':
        return 'Exportação Excel';
      case 'exportacao_pdf':
        return 'Exportação PDF';
      case 'impressao':
        return 'Impressão';
      case 'manual':
      default:
        return 'Salvo Manualmente';
    }
  };

  const executarAcaoComVersao = async (
    acao:
      | { tipo: 'excel'; especialistaIdUnico?: string }
      | { tipo: 'pdf'; especialistaIdUnico?: string }
      | { tipo: 'imprimir'; modo: 'atual' | 'todos_especialistas' }
      | { tipo: 'base62' },
    draftRef?: RascunhoSimulacaoNuvem | null
  ) => {
    const draftParaEtiqueta = draftRef !== undefined ? draftRef : rascunhoCorrespondenteAtual;
    const { versaoInfo, versaoSufixoArquivo } = formatarEtiquetaVersao(draftParaEtiqueta);

    if (acao.tipo === 'excel') {
      if (!resultado) return;
      try {
        const {
          turmasParaExport,
          especialistasParaExport,
          haSanitizado,
          ocupacoesExternasExport
        } = prepararDadosExportacao();

        await exportarSugestaoHorariosExcel(
          resultado,
          turmasParaExport,
          especialistasParaExport,
          planejamentoAno,
          {
            haPorEspecialista: haSanitizado,
            ocupacoesExternasPorProfessor: ocupacoesExternasExport,
            escolaNome: escolaAtual?.name || 'Unidade Escolar',
            especialistaIdUnico: acao.especialistaIdUnico,
            versaoInfo,
            versaoSufixoArquivo
          }
        );
      } catch (err: any) {
        setModal({
          isOpen: true,
          type: 'alert',
          title: 'Erro ao Exportar Excel',
          message: err.message || 'Não foi possível gerar a planilha de sugestão de horários.',
          icon: '❌'
        });
      }
      return;
    }

    if (acao.tipo === 'pdf') {
      if (!resultado) return;
      try {
        const {
          especialistasParaExport,
          haSanitizado,
          ocupacoesExternasExport
        } = prepararDadosExportacao();

        exportarSugestaoHorariosPDF(resultado, especialistasParaExport, planejamentoAno, {
          haPorEspecialista: haSanitizado,
          ocupacoesExternasPorProfessor: ocupacoesExternasExport,
          escolaNome: escolaAtual?.name || 'Unidade Escolar',
          especialistaIdUnico: acao.especialistaIdUnico,
          versaoInfo,
          versaoSufixoArquivo
        });
      } catch (err: any) {
        setModal({
          isOpen: true,
          type: 'alert',
          title: 'Erro ao Gerar PDF',
          message: err.message || 'Não foi possível gerar o PDF individual dos especialistas.',
          icon: '❌'
        });
      }
      return;
    }

    if (acao.tipo === 'imprimir') {
      setModoImpressao(acao.modo);
      setTimeout(() => {
        window.print();
      }, 120);
      return;
    }

    if (acao.tipo === 'base62') {
      const snap = construirSnapshotAtual();
      if (!snap) return;
      try {
        const codigo = serializarSimulacaoBase62(snap);
        setCodigoModal({
          aberto: true,
          modo: 'exportar',
          codigo,
          copiado: false
        });
      } catch (err: any) {
        setModal({
          isOpen: true,
          type: 'alert',
          title: 'Erro ao Gerar Código Base62',
          message: err.message || 'Não foi possível codificar esta simulação.',
          icon: '❌'
        });
      }
    }
  };

  const solicitarConfirmacaoOuExecutar = (
    acao:
      | { tipo: 'excel'; especialistaIdUnico?: string }
      | { tipo: 'pdf'; especialistaIdUnico?: string }
      | { tipo: 'imprimir'; modo: 'atual' | 'todos_especialistas' }
      | { tipo: 'base62' },
    origemPadrao: OrigemRascunhoSimulacao
  ) => {
    if (!resultado) return;
    if (isAdmin && temAlteracoesNaoSalvas) {
      setVersaoPromptModal({
        acao,
        origem: origemPadrao,
        rotulo: '',
        podeSobrescreverAtiva: Boolean(rascunhoAtivoChave && rascunhosNuvem[rascunhoAtivoChave])
      });
      return;
    }
    void executarAcaoComVersao(acao);
  };

  const handleAbrirExportarBase62 = () => {
    solicitarConfirmacaoOuExecutar({ tipo: 'base62' }, 'manual');
  };

  const handleAbrirImportarBase62 = () => {
    setCodigoModal({
      aberto: true,
      modo: 'importar',
      codigo: '',
      erro: undefined
    });
  };

  const handleCopiarCodigoBase62 = async () => {
    if (!codigoModal.codigo) return;
    try {
      await navigator.clipboard.writeText(codigoModal.codigo);
      setCodigoModal((prev) => ({ ...prev, copiado: true }));
      setTimeout(() => {
        setCodigoModal((prev) => ({ ...prev, copiado: false }));
      }, 2500);
    } catch {
      setCodigoModal((prev) => ({
        ...prev,
        erro: 'Não foi possível copiar automaticamente. Selecione o texto acima e copie (Ctrl+C).'
      }));
    }
  };

  const handleBaixarArquivoBase62 = () => {
    if (!codigoModal.codigo) return;
    const slugEscola = (escolaAtual?.name || 'escola')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .toLowerCase();
    const { versaoSufixoArquivo } = formatarEtiquetaVersao(rascunhoCorrespondenteAtual);
    const sufixoVer = versaoSufixoArquivo ? `-${versaoSufixoArquivo}` : '';
    const blob = new Blob([codigoModal.codigo], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `simulacao-horarios-${slugEscola}-${planejamentoAno}-${selectedTurno}${sufixoVer}.hor.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const gravarVersaoRascunhoNuvem = async (opcoes?: {
    origem?: OrigemRascunhoSimulacao;
    rotulo?: string;
    sobrescreverChave?: string | null;
    silencioso?: boolean;
  }): Promise<RascunhoSimulacaoNuvem | null> => {
    if (!isAdmin) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Acesso Restrito',
        message: 'Apenas administradores podem gravar rascunhos compartilhados na nuvem.',
        icon: '🔒'
      });
      return null;
    }
    const snap = construirSnapshotAtual();
    if (!snap || !resultado) return null;

    setSavingCloudDraft(true);
    try {
      const codigoBase62 = serializarSimulacaoBase62(snap);
      const assinaturaConteudo = calcularAssinaturaSnapshot(snap);
      const rascunhoAlvo =
        opcoes?.sobrescreverChave && rascunhosNuvem[opcoes.sobrescreverChave]
          ? rascunhosNuvem[opcoes.sobrescreverChave]
          : null;

      const versaoNumero = rascunhoAlvo
        ? rascunhoAlvo.versaoNumero || proximoNumeroVersao
        : proximoNumeroVersao;

      const chave = rascunhoAlvo
        ? rascunhoAlvo.chave
        : `${selectedSchoolId}_${planejamentoAno}_${selectedTurno}_v${versaoNumero}_${Date.now()}`.replace(
            /[.#$\[\]/]/g,
            '_'
          );

      const totalHAs = snap.especialistas.reduce((acc, e) => acc + e.haHorarios.length, 0);
      const salvoPor = auth.currentUser?.displayName || auth.currentUser?.email || 'Coordenação';
      const rotuloLimpo = (opcoes?.rotulo ?? (rascunhoAlvo?.rotulo || '')).trim();

      const rascunhoPayload: RascunhoSimulacaoNuvem = {
        chave,
        schoolId: selectedSchoolId,
        schoolName: snap.schoolName,
        anoLetivo: planejamentoAno,
        turnoFiltro: selectedTurno,
        salvoEm: snap.salvoEm,
        salvoPor,
        versaoNumero,
        rotulo: rotuloLimpo || undefined,
        origem: opcoes?.origem || 'manual',
        assinaturaConteudo,
        totalAulasAlocadas: resultado.estatisticas.totalAulasAlocadas,
        totalAulasEsperadas: resultado.estatisticas.totalAulasEsperadas,
        totalHAs,
        totalSwap: swapItems.length,
        codigoBase62
      };

      await set(
        ref(rtdb, `diario-classe/config/simulacoesHorarios/${chave}`),
        cleanFirebaseData(rascunhoPayload)
      );

      setRascunhosNuvem((prev) => ({
        ...prev,
        [chave]: rascunhoPayload
      }));
      setRascunhoAtivoChave(chave);

      if (!opcoes?.silencioso) {
        setModal({
          isOpen: true,
          type: 'alert',
          title: rascunhoAlvo ? `Versão v${versaoNumero} Atualizada!` : `Versão v${versaoNumero} Salva na Nuvem!`,
          message: `A simulação de "${snap.schoolName}" (${resultado.estatisticas.totalAulasAlocadas} aula(s), ${totalHAs} H.A.${
            swapItems.length > 0 ? ` e ${swapItems.length} aula(s) na Área de Swap` : ''
          }) foi salva como Versão v${versaoNumero}${rotuloLimpo ? ` ("${rotuloLimpo}")` : ''}.`,
          icon: '☁️'
        });
      }
      return rascunhoPayload;
    } catch (err: any) {
      console.error('Erro ao salvar rascunho na nuvem:', err);
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro ao Salvar Rascunho',
        message: formatFriendlyError(err, 'Não foi possível salvar o rascunho na nuvem'),
        icon: '❌'
      });
      return null;
    } finally {
      setSavingCloudDraft(false);
    }
  };

  const handleSalvarRascunhoNuvem = () => {
    if (!isAdmin) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Acesso Restrito',
        message: 'Apenas administradores podem gravar rascunhos compartilhados na nuvem.',
        icon: '🔒'
      });
      return;
    }
    if (!resultado) return;

    if (!temAlteracoesNaoSalvas && rascunhoCorrespondenteAtual) {
      const { versaoInfo } = formatarEtiquetaVersao(rascunhoCorrespondenteAtual);
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Nenhuma Alteração Detectada',
        message: `A simulação atual já está salva e idêntica à ${versaoInfo}. Não é necessário salvar uma nova versão enquanto não houver modificações.`,
        icon: '✅'
      });
      return;
    }

    setVersaoPromptModal({
      acao: { tipo: 'salvar_manual' },
      origem: 'manual',
      rotulo: '',
      podeSobrescreverAtiva: Boolean(rascunhoAtivoChave && rascunhosNuvem[rascunhoAtivoChave])
    });
  };

  const handleConfirmarRenomearDraft = async () => {
    if (!renomearDraftModal || !isAdmin) return;
    const { draft, rotulo } = renomearDraftModal;
    const novoRotulo = rotulo.trim();
    try {
      const atualizado: RascunhoSimulacaoNuvem = {
        ...draft,
        rotulo: novoRotulo || undefined
      };
      await set(
        ref(rtdb, `diario-classe/config/simulacoesHorarios/${draft.chave}`),
        cleanFirebaseData(atualizado)
      );
      setRascunhosNuvem((prev) => ({
        ...prev,
        [draft.chave]: atualizado
      }));
      setRenomearDraftModal(null);
    } catch (err: any) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro ao Renomear Versão',
        message: formatFriendlyError(err, 'Não foi possível atualizar o rótulo desta versão'),
        icon: '❌'
      });
    }
  };

  const handleExportarExcel = (especialistaIdUnico?: string) => {
    solicitarConfirmacaoOuExecutar({ tipo: 'excel', especialistaIdUnico }, 'exportacao_excel');
  };

  const handleExportarPDF = (especialistaIdUnico?: string) => {
    solicitarConfirmacaoOuExecutar({ tipo: 'pdf', especialistaIdUnico }, 'exportacao_pdf');
  };

  const handleImprimir = (modo: 'atual' | 'todos_especialistas') => {
    solicitarConfirmacaoOuExecutar({ tipo: 'imprimir', modo }, 'impressao');
  };

  const handleExcluirRascunhoNuvem = (draft: RascunhoSimulacaoNuvem) => {
    if (!isAdmin) return;
    const { versaoInfo } = formatarEtiquetaVersao(draft);
    setModal({
      isOpen: true,
      type: 'confirm',
      title: 'Excluir Versão do Rascunho',
      message: `Deseja remover a ${versaoInfo} de "${draft.schoolName}"? Isso não afeta as demais versões nem o Quadro Oficial.`,
      icon: '🗑️',
      confirmText: 'Excluir Versão',
      cancelText: 'Cancelar',
      onConfirm: async () => {
        try {
          await remove(ref(rtdb, `diario-classe/config/simulacoesHorarios/${draft.chave}`));
          setRascunhosNuvem((prev) => {
            const next = { ...prev };
            delete next[draft.chave];
            return next;
          });
          if (rascunhoAtivoChave === draft.chave) {
            setRascunhoAtivoChave(null);
          }
        } catch (err: any) {
          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Erro ao Excluir',
            message: formatFriendlyError(err, 'Não foi possível excluir o rascunho'),
            icon: '❌'
          });
        }
      }
    });
  };

  const iniciarRestauracaoSnapshot = (snap: SnapshotSimulacaoEspecialistas) => {
    if (snap.schoolId && !schools[snap.schoolId]) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Escola Não Encontrada',
        message: `A escola "${snap.schoolName}" deste código não está cadastrada neste banco de dados.`,
        icon: '⚠️'
      });
      return;
    }

    pendingRestoreSnapshotRef.current = snap;
    setAulasPorTurma(snap.opcoes.aulasPorTurma);
    setFormatoAulas(snap.opcoes.formatoAulas);
    setPreservarNaoEspecialistas(snap.opcoes.preservarOutrosProfessores);
    setRespeitarOutrasEscolas(snap.opcoes.respeitarIntervaloEntreEscolas);

    if (snap.schoolId && snap.schoolId !== selectedSchoolId) {
      setSelectedSchoolId(snap.schoolId);
    }
    if (snap.turnoFiltro && snap.turnoFiltro !== selectedTurno) {
      setSelectedTurno(snap.turnoFiltro);
    }
    if (snap.anoLetivo && snap.anoLetivo !== planejamentoAno) {
      setPlanejamentoAno(snap.anoLetivo);
    }

    setRestoreTick((n) => n + 1);
  };

  const handleConfirmarImportarBase62 = () => {
    try {
      const snap = desserializarSimulacaoBase62(codigoModal.codigo);
      setCodigoModal({ aberto: false, modo: 'importar', codigo: '' });
      pendingImportOriginRef.current = 'base62';
      pendingDraftKeyRef.current = null;
      iniciarRestauracaoSnapshot(snap);
    } catch (err: any) {
      setCodigoModal((prev) => ({
        ...prev,
        erro: err.message || 'Código Base62 inválido.'
      }));
    }
  };

  const handleRestaurarDaNuvem = (draft: RascunhoSimulacaoNuvem) => {
    try {
      const snap = desserializarSimulacaoBase62(draft.codigoBase62);
      pendingImportOriginRef.current = 'nuvem';
      pendingDraftKeyRef.current = draft.chave;
      iniciarRestauracaoSnapshot(snap);
    } catch (err: any) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Rascunho Incompatível',
        message: err.message || 'Não foi possível ler os dados deste rascunho.',
        icon: '❌'
      });
    }
  };

  // Consome snapshot pendente após atualização de escopo (escola / turno / ano letivo) e revalida contra o banco atual
  useEffect(() => {
    const snap = pendingRestoreSnapshotRef.current;
    if (loading || !snap) return;
    if (snap.anoLetivo && snap.anoLetivo !== planejamentoAno) return;
    if (snap.schoolId && schools[snap.schoolId] && snap.schoolId !== selectedSchoolId) return;
    if (snap.turnoFiltro && snap.turnoFiltro !== selectedTurno) return;

    pendingRestoreSnapshotRef.current = null;

    const turmasParaRestaurar: TurmaPlanejamento[] = turmasComEspecialistasRegulares.map((c) => {
      const espRegulares = especialistasDaEscola
        .filter((e) => e.turmasRegulares.includes(c.id))
        .map((e) => e.id);
      return {
        id: c.id,
        name: `${c.val.year}º ${c.val.letter} - ${c.val.shift}`,
        year: c.val.year,
        letter: c.val.letter,
        shift: c.val.shift,
        intervaloGrupo: c.val.intervaloGrupo,
        intervaloGrupoPorDia: c.val.intervaloGrupoPorDia,
        schoolId: c.val.schoolId,
        schoolName: c.val.schoolName,
        anoLetivo: c.val.anoLetivo || planejamentoAno,
        especialistasIds: espRegulares,
        gradeHorariaExistente: c.val.gradeHoraria
      };
    });

    const classUpdatedAtMap: Record<string, number> = {};
    turmasComEspecialistasRegulares.forEach((c) => {
      const uAt = (c.val as any)?.updatedAt;
      if (typeof uAt === 'number') classUpdatedAtMap[c.id] = uAt;
    });

    const especialistasParaRestaurar: EspecialistaConfig[] = especialistasDaEscola
      .filter((e) => e.turmasRegulares.length > 0)
      .map((e) => {
        const diasCadastro = resolverDiasDisponiveisDocente({ id: e.id, val: e.teacher }, teachers);
        const folgasCadastro = obterDiasFolga(diasCadastro);
        const conf = especialistasConfig[e.id] || {
          folgaDia: folgasCadastro.length === 1 ? folgasCadastro[0] : null,
          diasDisponiveis: diasCadastro
        };
        return {
          id: e.id,
          aliasIds: Array.from(e.allKeys),
          name: e.teacher.name,
          subject: e.teacher.subject || 'Especialista',
          diasDisponiveis: conf.diasDisponiveis,
          folgaDia: conf.folgaDia,
          turmasIds: e.turmasRegulares,
          totalAulasNecessarias: e.turmasRegulares.length * snap.opcoes.aulasPorTurma
        };
      });

    const ocupacoesExternasAtual: Record<string, OcupacaoExternaProfessor[]> = {};
    if (snap.opcoes.respeitarIntervaloEntreEscolas) {
      especialistasDaEscola
        .filter((e) => e.turmasRegulares.length > 0)
        .forEach((e) => {
          if (e.ocupacoesExternas.length > 0) {
            ocupacoesExternasAtual[e.id] = e.ocupacoesExternas;
          }
        });
    }

    const restaurado = restaurarResultadoDeSnapshot(snap, turmasParaRestaurar, especialistasParaRestaurar, {
      ocupacoesExternasPorProfessor: ocupacoesExternasAtual,
      respeitarIntervaloEntreEscolas: snap.opcoes.respeitarIntervaloEntreEscolas,
      aulasPorTurma: snap.opcoes.aulasPorTurma,
      maxEspecialistasPorTurmaDia: maxEspecialistasDia,
      classUpdatedAtMap
    });

    setEspecialistasConfig((prev) => ({
      ...prev,
      ...restaurado.especialistasConfigRestaurados
    }));
    setHaEspecialistasMap((prev) => ({
      ...prev,
      ...restaurado.haMapRestaurado
    }));
    setSelectedClassesToApply(restaurado.selectedClassesRestauradas);
    setResultado(restaurado.resultado);
    setResultadoOriginal(restaurado.resultado);
    setContextoGeracao({
      turmas: turmasParaRestaurar,
      especialistas: especialistasParaRestaurar.map((e) => ({
        ...e,
        ...(restaurado.especialistasConfigRestaurados[e.id] || {})
      })),
      maxEspecialistasPorTurmaDia: maxEspecialistasDia,
      ocupacoesExternasPorProfessor: ocupacoesExternasAtual,
      respeitarIntervaloEntreEscolas: snap.opcoes.respeitarIntervaloEntreEscolas,
      totalAulasEsperadas: restaurado.resultado.estatisticas.totalAulasEsperadas,
      tempoCalculoMs: 0
    });
    setHistoricoEdicoes([]);
    setSwapItemsOriginal(restaurado.swapItemsRestaurados);
    setSwapItems(restaurado.swapItemsRestaurados);
    setSwapEmEncaixeId(restaurado.swapItemsRestaurados[0]?.id || null);
    setAvisosRestauracao(restaurado.avisosRestauracao);
    setAulaEmMovimento(null);
    setHoveredDropTarget(null);
    setFeedbackMovimento(null);
    setStatusMensagem(null);

    if (turmasComEspecialistasRegulares.length > 0) {
      setPreviewClassId(turmasComEspecialistasRegulares[0].id);
    }
    if (especialistasParaRestaurar.length > 0) {
      setPreviewTeacherId(especialistasParaRestaurar[0].id);
    }

    const origin = pendingImportOriginRef.current;
    const requestedDraftKey = pendingDraftKeyRef.current;
    pendingImportOriginRef.current = null;
    pendingDraftKeyRef.current = null;

    // Calcula assinatura exata do estado recém-restaurado para verificar se difere das versões já salvas
    let assinaturaRestaurada: string | null = null;
    try {
      const espSnapRestaurados = especialistasParaRestaurar.map((e) => {
        const confRest = restaurado.especialistasConfigRestaurados[e.id] || {
          folgaDia: e.folgaDia,
          diasDisponiveis: e.diasDisponiveis
        };
        const haSanit = sanitizarHAListaEspecialista(
          e.id,
          restaurado.haMapRestaurado[e.id] || [],
          restaurado.resultado
        );
        const espObj = especialistasDaEscola.find((x) => x.id === e.id);
        return {
          id: e.id,
          name: e.name,
          subject: e.subject,
          folgaDia: confRest.folgaDia,
          diasDisponiveis: confRest.diasDisponiveis,
          haHorarios: haSanit,
          turmasRegulares: espObj ? espObj.turmasRegulares : e.turmasIds,
          turmasSuplementares: espObj ? espObj.turmasSuplementares : []
        };
      });
      const selIds = Object.keys(restaurado.selectedClassesRestauradas).filter(
        (cid) => restaurado.selectedClassesRestauradas[cid]
      );
      assinaturaRestaurada = calcularAssinaturaSnapshot({
        versao: 1,
        salvoEm: 0,
        schoolId: selectedSchoolId,
        schoolName: escolaAtual?.name || snap.schoolName,
        anoLetivo: planejamentoAno,
        turnoFiltro: selectedTurno,
        opcoes: snap.opcoes,
        especialistas: espSnapRestaurados,
        gradesPorTurma: restaurado.resultado.gradesPorTurma,
        selectedClassesToApply: selIds,
        swapItems: restaurado.swapItemsRestaurados.length > 0 ? restaurado.swapItemsRestaurados : undefined
      });
    } catch {
      assinaturaRestaurada = null;
    }

    const draftCorrespondente = assinaturaRestaurada
      ? rascunhosDoEscopo.find((d) => assinaturasRascunhosNuvem[d.chave] === assinaturaRestaurada) || null
      : null;

    const totalConflitos = restaurado.resultado.conflitos.length;
    const totalSwapRest = restaurado.swapItemsRestaurados.length;
    const mensagemResumo =
      totalConflitos > 0
        ? `Rascunho de ${new Date(snap.salvoEm).toLocaleString(
            'pt-BR'
          )} carregado, porém foram identificados ${totalConflitos} conflito(s) novo(s) ao conferir com os horários atuais de outras escolas.${
            totalSwapRest > 0 ? ` (${totalSwapRest} aula(s) na Área de Swap restaurada(s).)` : ''
          } Veja os alertas na tela para ajustar sem recalcular tudo.`
        : `Rascunho de "${snap.schoolName}" (${new Date(snap.salvoEm).toLocaleString(
            'pt-BR'
          )}) restaurado e revalidado contra as atribuições e escolas atuais (${restaurado.resultado.estatisticas.totalAulasAlocadas} aula(s) na grade${
            totalSwapRest > 0 ? ` + ${totalSwapRest} na Área de Swap` : ''
          }).`;

    if (origin === 'base62' && isAdmin && !draftCorrespondente) {
      setRascunhoAtivoChave(null);
      setVersaoPromptModal({
        acao: {
          tipo: 'pos_importacao',
          mensagem: mensagemResumo,
          temConflitos: totalConflitos > 0
        },
        origem: 'importacao_base62',
        rotulo: '',
        podeSobrescreverAtiva: false
      });
    } else {
      setRascunhoAtivoChave(draftCorrespondente?.chave || requestedDraftKey || null);
      setModal({
        isOpen: true,
        type: 'alert',
        title: totalConflitos > 0 ? 'Simulação Restaurada com Alertas' : 'Simulação Restaurada com Sucesso!',
        message: mensagemResumo,
        icon: totalConflitos > 0 ? '⚠️' : '✅'
      });
    }
  }, [
    loading,
    restoreTick,
    selectedSchoolId,
    selectedTurno,
    planejamentoAno,
    schools,
    turmasComEspecialistasRegulares,
    especialistasDaEscola
  ]);

  // Aplicar sugestão ao quadro oficial da escola (incluindo H.A. dos especialistas)
  const handleAplicarQuadroOficial = () => {
    if (!resultado) return;
    if (!isAdmin) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Acesso Restrito',
        message: 'Apenas a coordenação / administração tem permissão para atualizar o quadro de horários oficial.',
        icon: '🔒'
      });
      return;
    }

    if (swapItems.length > 0) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Existem Aulas na Bandeja de Swap',
        message: `Você ainda possui ${swapItems.length} aula(s) estacionada(s) na Bandeja de Swap aguardando reencaixe. Encaixe todas as aulas na grade (ou use Desfazer) antes de gravar no Quadro Oficial.`,
        icon: '📥'
      });
      return;
    }

    const turmasIds = Object.keys(selectedClassesToApply).filter((id) => selectedClassesToApply[id]);
    if (turmasIds.length === 0) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Nenhuma turma selecionada',
        message: 'Selecione pelo menos uma turma na lista para aplicar a sugestão.',
        icon: '⚠️'
      });
      return;
    }

    const escolaNome = schools[selectedSchoolId]?.name || 'Escola Selecionada';
    const especialistasEscopo = especialistasDaEscola.filter((e) => e.turmasRegulares.length > 0);
    const haSanitizadaPorProf: Record<string, string[]> = {};
    let totalHAsPlanejadas = 0;

    especialistasEscopo.forEach((e) => {
      const limpa = sanitizarHAListaEspecialista(e.id, haEspecialistasMap[e.id], resultado);
      haSanitizadaPorProf[e.id] = limpa;
      totalHAsPlanejadas += limpa.length;
    });

    setModal({
      isOpen: true,
      type: 'confirm',
      title: 'Aprovar e Aplicar Horários da Escola',
      message: `Deseja gravar a sugestão de horários de especialistas em ${turmasIds.length} turma(s) da unidade "${escolaNome}"${
        totalHAsPlanejadas > 0
          ? ` juntamente com ${totalHAsPlanejadas} horário(s) de H.A. dos especialistas`
          : ''
      } no Quadro de Horários Oficial do Ano Letivo ${planejamentoAno}?`,
      icon: '🏫',
      confirmText: 'Sim, aplicar ao quadro oficial',
      cancelText: 'Cancelar',
      onConfirm: async () => {
        setApplying(true);
        try {
          const updates: Record<string, any> = {};

          turmasIds.forEach((classId) => {
            const gradeSugerida = resultado.gradesPorTurma[classId];
            if (!gradeSugerida) return;

            Object.keys(gradeSugerida).forEach((slotKey) => {
              const slot = gradeSugerida[slotKey];
              if (slot) {
                updates[`diario-classe/turmas/${classId}/gradeHoraria/${slotKey}`] = slot;
              }
            });
          });

          const now = Date.now();
          let professoresHACount = 0;
          especialistasEscopo.forEach((e) => {
            const novasHAs = haSanitizadaPorProf[e.id] || [];
            const antigasHAs = Array.isArray(e.teacher.haHorariosFixos) ? e.teacher.haHorariosFixos : [];
            const mudou =
              novasHAs.length !== antigasHAs.length ||
              novasHAs.some((k, idx) => antigasHAs[idx] !== k);

            if (mudou || novasHAs.length > 0) {
              updates[`diario-classe/professores/${e.id}/haHorariosFixos`] = novasHAs;
              updates[`diario-classe/professores/${e.id}/updatedAt`] = now;
              if (novasHAs.length > 0) professoresHACount++;

              // Sincroniza também os blocos estruturados sob diario-classe/config/horaAtividade (sem exigir novas regras do Firebase)
              const blocosEstruturados: Record<string, HoraAtividade> = {};
              novasHAs.forEach((hKey) => {
                const parsed = parseHASlotKey(hKey);
                if (!parsed) return;
                const turnoCanon = parsed.turno === 'tarde' ? 'vespertino' : 'matutino';
                const bellSlot = getHorariosTurma(turnoCanon, 'A', '1', selectedSchoolId).aulas.find(
                  (a) => a.ordem === parsed.ordem
                );
                const inicio = bellSlot?.inicio || (turnoCanon === 'vespertino' ? '12:30' : '07:00');
                const fim = bellSlot?.fim || (turnoCanon === 'vespertino' ? '13:20' : '07:50');
                const slotCode = `${parsed.dia}_${inicio.replace(':', '')}`;
                blocosEstruturados[slotCode] = {
                  dia: parsed.dia,
                  inicio,
                  fim,
                  tipo: 'planejamento',
                  ...(selectedSchoolId ? { schoolId: selectedSchoolId } : {}),
                  updatedAt: now
                };
              });
              updates[`diario-classe/config/horaAtividade/${e.id}`] =
                Object.keys(blocosEstruturados).length > 0 ? blocosEstruturados : null;
            }
          });

          await update(ref(rtdb), updates);

          setHaEspecialistasMap((prev) => ({
            ...prev,
            ...haSanitizadaPorProf
          }));
          setTeachers((prev) =>
            prev.map((t) =>
              haSanitizadaPorProf[t.id] !== undefined
                ? { ...t, val: { ...t.val, haHorariosFixos: haSanitizadaPorProf[t.id], updatedAt: now } }
                : t
            )
          );

          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Horários Gravados com Sucesso!',
            message: `A sugestão de horários dos especialistas foi oficializada para a escola "${escolaNome}"${
              totalHAsPlanejadas > 0
                ? `, incluindo ${totalHAsPlanejadas} H.A.(s) distribuída(s) entre ${professoresHACount} especialista(s).`
                : '.'
            }`,
            icon: '🎉'
          });

          if (onApplied) onApplied();
        } catch (err: any) {
          console.error('Erro ao aplicar horários:', err);
          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Erro ao Aplicar Horários',
            message: formatFriendlyError(err, 'Não foi possível salvar os horários no banco de dados'),
            icon: '❌'
          });
        } finally {
          setApplying(false);
        }
      }
    });
  };

  const toggleClassToApply = (classId: string) => {
    setSelectedClassesToApply((prev) => ({
      ...prev,
      [classId]: !prev[classId]
    }));
  };

  const toggleSelectAllClasses = () => {
    const allSelected = turmasComEspecialistasRegulares.every((c) => selectedClassesToApply[c.id]);
    const next: Record<string, boolean> = {};
    turmasComEspecialistasRegulares.forEach((c) => {
      next[c.id] = !allSelected;
    });
    setSelectedClassesToApply(next);
  };

  if (loading) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-12 text-center">
        <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
        <p className="text-slate-600 font-medium">Carregando especialistas, turmas e atribuições da escola...</p>
      </div>
    );
  }

  const escolaAtual = schools[selectedSchoolId];
  const slotsDoEspecialistaPreview = previewTeacherId
    ? resultado?.gradesPorEspecialistaLista?.[previewTeacherId] || []
    : [];

  return (
    <div className="space-y-6">
      {/* 1. Header & Apresentação */}
      <div className="bg-gradient-to-r from-indigo-900 via-indigo-800 to-slate-900 rounded-2xl p-6 sm:p-8 text-white shadow-lg relative overflow-hidden print:hidden">
        <div className="absolute right-0 top-0 translate-x-12 -translate-y-8 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none"></div>
        <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-indigo-500/30 border border-indigo-400/40 rounded-full text-xs font-semibold text-indigo-200">
              <Sparkles className="w-3.5 h-3.5 text-amber-300" />
              Planejamento por Escola • Gestão de Especialistas
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              Sugestão de Horários por Escola
            </h2>
            <p className="text-slate-300 text-sm leading-relaxed">
              Otimizador de grade semanal por unidade escolar. Define quais turmas são <strong>Regular</strong> e
              quais são <strong>Carga Suplementar (desconsideradas)</strong>, garantindo o limite de <strong>no máximo 2 especialistas/dia</strong> e
              o respeito integral à <strong>folga semanal</strong> de cada docente.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <div className="bg-white/10 backdrop-blur-md px-4 py-2.5 rounded-xl border border-white/20 text-center">
              <span className="block text-xs uppercase tracking-wider text-indigo-200 font-medium">Ano Letivo Alvo</span>
              <span className="text-xl font-bold text-white">{planejamentoAno}</span>
            </div>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 bg-slate-800/80 hover:bg-slate-700 text-white rounded-xl text-sm font-semibold border border-slate-600 transition flex items-center justify-center gap-2 cursor-pointer"
              >
                <X className="w-4 h-4" />
                Fechar
              </button>
            )}
          </div>
        </div>

        <div className="mt-5 pt-4 border-t border-indigo-700/50 flex flex-col sm:flex-row items-start sm:items-center gap-3 text-xs text-indigo-200">
          <Info className="w-4 h-4 text-amber-400 shrink-0" />
          <span>
            <strong>Escopo por Escola:</strong> Professores especialistas sem turmas atribuídas na escola selecionada
            são automaticamente excluídos da geração. Turmas marcadas como <em>Carga Suplementar</em> não entram na grade regular.
          </span>
        </div>
      </div>

      {/* 2. Seletor de Escola, Turno & Parâmetros */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-6 print:hidden">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 pb-4 border-b border-slate-100">
          <div className="flex items-center gap-3 flex-1">
            <div className="w-11 h-11 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold shrink-0">
              <Building2 className="w-6 h-6" />
            </div>
            <div className="flex-1">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">
                Unidade Escolar para Planejamento
              </label>
              <select
                value={selectedSchoolId}
                onChange={(e) => {
                  setSelectedSchoolId(e.target.value);
                  setResultado(null);
                  setResultadoOriginal(null);
                  setContextoGeracao(null);
                  setHistoricoEdicoes([]);
                  setSwapItems([]);
                  setSwapItemsOriginal([]);
                  setSwapEmEncaixeId(null);
                  setRascunhoAtivoChave(null);
                  setAulaEmMovimento(null);
                  setFeedbackMovimento(null);
                  setStatusMensagem(null);
                }}
                className="mt-0.5 w-full max-w-md px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm font-bold text-slate-800 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              >
                {Object.keys(schools).map((id) => (
                  <option key={id} value={id}>
                    {schools[id].name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-0.5">
                Turno de Planejamento
              </label>
              <select
                value={selectedTurno}
                onChange={(e) => {
                  setSelectedTurno(e.target.value as TurnoFiltroPlanejamento);
                  setResultado(null);
                  setResultadoOriginal(null);
                  setContextoGeracao(null);
                  setHistoricoEdicoes([]);
                  setSwapItems([]);
                  setSwapItemsOriginal([]);
                  setSwapEmEncaixeId(null);
                  setRascunhoAtivoChave(null);
                  setAulaEmMovimento(null);
                  setFeedbackMovimento(null);
                  setStatusMensagem(null);
                }}
                className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm font-bold text-slate-800 focus:ring-2 focus:ring-indigo-500"
              >
                <option value="todos">Todos os Turnos ({turmasDaEscola.length} turmas)</option>
                <option value="manha">☀️ Manhã / Matutino ({turnosDisponiveisNaEscola.manha})</option>
                <option value="tarde">🌤️ Tarde / Vespertino ({turnosDisponiveisNaEscola.tarde})</option>
                {turnosDisponiveisNaEscola.noite > 0 && (
                  <option value="noite">🌙 Noite / Noturno ({turnosDisponiveisNaEscola.noite})</option>
                )}
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-0.5">Ano Letivo:</label>
              <input
                type="number"
                value={planejamentoAno}
                onChange={(e) => {
                  setPlanejamentoAno(e.target.value);
                  setResultado(null);
                  setResultadoOriginal(null);
                  setContextoGeracao(null);
                  setHistoricoEdicoes([]);
                  setSwapItems([]);
                  setSwapItemsOriginal([]);
                  setSwapEmEncaixeId(null);
                  setRascunhoAtivoChave(null);
                  setAulaEmMovimento(null);
                  setFeedbackMovimento(null);
                  setStatusMensagem(null);
                }}
                className="w-24 px-3 py-2 border border-slate-300 rounded-xl text-sm font-bold text-slate-800 text-center focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
        </div>

        {/* Parâmetros de Alocação */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200/80 space-y-1.5">
            <label className="text-xs font-bold text-slate-700 flex items-center gap-2">
              <Clock className="w-4 h-4 text-indigo-600" />
              Aulas por Turma na Semana
            </label>
            <select
              value={aulasPorTurma}
              onChange={(e) => setAulasPorTurma(Number(e.target.value))}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-800 font-medium focus:ring-2 focus:ring-indigo-500"
            >
              <option value={2}>2 aulas por semana (Padrão)</option>
              <option value={1}>1 aula por semana</option>
              <option value={3}>3 aulas por semana</option>
            </select>
          </div>

          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200/80 space-y-1.5">
            <label className="text-xs font-bold text-slate-700 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-teal-600" />
              Formato das Aulas
            </label>
            <select
              value={formatoAulas}
              onChange={(e) => setFormatoAulas(e.target.value as FormatoAulasEspecialista)}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-800 font-medium focus:ring-2 focus:ring-indigo-500"
            >
              <option value="misto">Misto Inteligente (prioriza dobrada, aceita separada)</option>
              <option value="dobrada">Bloco Dobrado Estrito (2 aulas seguidas)</option>
              <option value="separada">Dias Separados (1 aula em 2 dias distintos)</option>
            </select>
          </div>

          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200/80 space-y-2">
            <label className="text-xs font-bold text-slate-700 flex items-center gap-2">
              <Building2 className="w-4 h-4 text-amber-600" />
              Outras Escolas no Turno
            </label>
            <label className="flex items-start gap-2 cursor-pointer text-xs text-slate-700">
              <input
                type="checkbox"
                checked={respeitarOutrasEscolas}
                onChange={(e) => setRespeitarOutrasEscolas(e.target.checked)}
                className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span>
                Bloquear choques com aulas já oficializadas em outras escolas e exigir intervalo (≥ 15 min) para deslocamento
              </span>
            </label>
          </div>

          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200/80 space-y-2">
            <label className="text-xs font-bold text-slate-700 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              Grade Existente da Turma
            </label>
            <label className="flex items-start gap-2 cursor-pointer text-xs text-slate-700">
              <input
                type="checkbox"
                checked={preservarNaoEspecialistas}
                onChange={(e) => setPreservarNaoEspecialistas(e.target.checked)}
                className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span>
                Evitar horários já ocupados por regentes no quadro atual (desmarque para planejamento livre do zero)
              </span>
            </label>
          </div>
        </div>

        {/* Resumo do Escopo */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200/80">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block">Turmas no Escopo</span>
            <div className="mt-1 text-2xl font-black text-slate-800">
              {turmasComEspecialistasRegulares.length} de {turmasDoEscopo.length} turma(s)
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Com especialista regular atribuído •{' '}
              {selectedTurno === 'todos'
                ? 'Todos os turnos'
                : selectedTurno === 'manha'
                ? 'Manhã'
                : selectedTurno === 'tarde'
                ? 'Tarde'
                : 'Noite'}
            </p>
          </div>

          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200/80">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block">Especialistas com Turmas</span>
            <div className="mt-1 text-2xl font-black text-indigo-700">{especialistasDaEscola.length} docente(s)</div>
            <p className="text-xs text-slate-500 mt-1">Atribuídos a este turno/unidade ({planejamentoAno})</p>
          </div>

          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200/80">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block">Regra de Carga</span>
            <div className="mt-1 text-2xl font-black text-emerald-700">{aulasPorTurma} aulas / turma</div>
            <p className="text-xs text-slate-500 mt-1">Máx. 2 especialistas/dia • Folga dia todo</p>
          </div>
        </div>

        {/* 3. Tabela de Especialistas da Escola: Folga e Carga Regular vs Suplementar */}
        <div className="space-y-4 pt-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                <Users className="w-5 h-5 text-indigo-600" />
                Especialistas Atribuídos em "{escolaAtual?.name || 'Escola'}" ({especialistasDaEscola.length})
              </h3>
              <p className="text-xs text-slate-500">
                Defina a <strong>folga semanal</strong> e marque se cada turma é <strong>Regular</strong> ou <strong>Carga Suplementar</strong>.
              </p>
            </div>

            {isAdmin && especialistasDaEscola.length > 0 && (
              <button
                type="button"
                disabled={savingSuplementares}
                onClick={handleSalvarCargaSuplementar}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition self-start sm:self-auto cursor-pointer"
                title="Salva a classificação das turmas suplementares no banco de dados"
              >
                {savingSuplementares ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5 text-indigo-600" />
                )}
                Salvar Classificação de Carga Suplementar
              </button>
            )}
          </div>

          {especialistasDaEscola.length === 0 ? (
            <div className="p-8 bg-amber-50 border border-amber-200 rounded-2xl text-center space-y-2">
              <AlertTriangle className="w-8 h-8 text-amber-600 mx-auto" />
              <h4 className="text-base font-bold text-amber-900">
                Nenhum especialista possui turmas atribuídas nesta escola ({escolaAtual?.name})
              </h4>
              <p className="text-xs text-amber-700 max-w-lg mx-auto">
                Para que um especialista entre na sugestão de horários desta escola, ele precisa ter pelo menos uma turma
                desta unidade atribuída a ele na tela de <strong>Atribuição de Turmas</strong> no Ano Letivo {planejamentoAno}.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {especialistasDaEscola.map((item) => {
                const diasFallback = resolverDiasDisponiveisDocente({ id: item.id, val: item.teacher }, teachers);
                const folgasFallback = obterDiasFolga(diasFallback);
                const conf = especialistasConfig[item.id] || {
                  folgaDia: folgasFallback.length === 1 ? folgasFallback[0] : null,
                  diasDisponiveis: diasFallback
                };
                const temApenasSuplementar = item.turmasRegulares.length === 0;

                return (
                  <div
                    key={item.id}
                    className={`p-4 rounded-2xl border transition ${
                      temApenasSuplementar
                        ? 'bg-amber-50/50 border-amber-200 text-slate-700'
                        : 'bg-white border-slate-200 shadow-xs'
                    }`}
                  >
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-3 border-b border-slate-100">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="text-base font-bold text-slate-800">{item.teacher.name}</h4>
                          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                            {item.teacher.subject || 'Especialista'}
                          </span>
                          {temApenasSuplementar && (
                            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-200 text-amber-900">
                              ⚠️ Apenas Carga Suplementar (Desconsiderado na grade regular)
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Total de turmas neste escopo: <strong>{item.turmasNaEscola.length}</strong> (
                          <span className="text-emerald-700 font-semibold">{item.turmasRegulares.length} regulares</span>,{' '}
                          <span className="text-amber-700 font-semibold">{item.turmasSuplementares.length} suplementares</span>)
                        </p>
                        {(item.turmasOutrasEscolas.length > 0 || item.ocupacoesExternas.length > 0) && (
                          <p className="text-[11px] text-indigo-700 mt-1 flex items-center gap-1 flex-wrap">
                            <Building2 className="w-3 h-3 shrink-0" />
                            <span>
                              Também atua em <strong>{item.turmasOutrasEscolas.length}</strong> turma(s) fora deste escopo
                              {item.escolasExternasNomes.length > 0 ? ` (${item.escolasExternasNomes.join(', ')})` : ''}
                              {item.ocupacoesExternas.length > 0
                                ? ` • ${item.ocupacoesExternas.length} aula(s) oficial(is) reservada(s)`
                                : ' • ainda sem grade oficial salva lá'}
                            </span>
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <label className="text-xs font-bold text-slate-600 flex items-center gap-1">
                          <Coffee className="w-3.5 h-3.5 text-amber-600" /> Folga (dia todo):
                        </label>
                        {(() => {
                          const diasFolgaConf = obterDiasFolga(conf.diasDisponiveis, conf.folgaDia);
                          const selectVal =
                            diasFolgaConf.length === 0
                              ? 'none'
                              : diasFolgaConf.length === 1
                              ? String(diasFolgaConf[0])
                              : 'custom';
                          return (
                            <select
                              value={selectVal}
                              onChange={(e) => handleFolgaChange(item.id, e.target.value)}
                              className="px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-semibold text-slate-800 focus:ring-2 focus:ring-indigo-500"
                            >
                              {diasFolgaConf.length > 1 && (
                                <option value="custom">
                                  Escala do Cadastro: {formatarDiasFolgaResumo(conf.diasDisponiveis, conf.folgaDia, true)}
                                </option>
                              )}
                              <option value="none">Sem folga fixa (Seg a Sex)</option>
                              <option value="1">Segunda-feira (Folga)</option>
                              <option value="2">Terça-feira (Folga)</option>
                              <option value="3">Quarta-feira (Folga)</option>
                              <option value="4">Quinta-feira (Folga)</option>
                              <option value="5">Sexta-feira (Folga)</option>
                            </select>
                          );
                        })()}
                      </div>
                    </div>

                    <div className="pt-3">
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2">
                        Turmas Atribuídas nesta Escola (Clique para alternar Regular vs Suplementar):
                      </span>
                      <div className="flex flex-wrap gap-2">
                        {item.turmasNaEscola.map((cId) => {
                          const turma = mapaTurmas.get(cId);
                          const isSuplementar = isTurmaSuplementarParaDocente(item.allKeys, cId);

                          return (
                            <button
                              key={cId}
                              type="button"
                              onClick={() => handleToggleNaturezaTurma(item.id, cId)}
                              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-2 border cursor-pointer ${
                                isSuplementar
                                  ? 'bg-amber-100/90 text-amber-900 border-amber-300 hover:bg-amber-200'
                                  : 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100'
                              }`}
                              title={
                                isSuplementar
                                  ? 'Carga Suplementar: Desconsiderada na sugestão de horários. Clique para tornar Regular.'
                                  : `Carga Regular: Entra na sugestão de horários (${aulasPorTurma} aulas/semana). Clique para marcar como Suplementar.`
                              }
                            >
                              <span>
                                {turma?.year}º {turma?.letter} ({turma?.shift})
                              </span>
                              <span
                                className={`px-1.5 py-0.2 rounded text-[10px] uppercase font-extrabold ${
                                  isSuplementar ? 'bg-amber-600 text-white' : 'bg-emerald-600 text-white'
                                }`}
                              >
                                {isSuplementar ? '➕ Suplementar' : '🎓 Regular'}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Histórico de Versões Salvas na Nuvem para esta Escola & Importação Portátil Base62 */}
        {(() => {
          const rascunhosDaEscola = Object.values(rascunhosNuvem)
            .filter(
              (r) =>
                r &&
                r.schoolId === selectedSchoolId &&
                String(r.anoLetivo) === String(planejamentoAno)
            )
            .sort((a, b) => (b.salvoEm || 0) - (a.salvoEm || 0));

          const numPorChave: Record<string, number> = {};
          const contPorTurno: Record<string, number> = {};
          [...rascunhosDaEscola]
            .sort((a, b) => (a.salvoEm || 0) - (b.salvoEm || 0))
            .forEach((d) => {
              const tKey = d.turnoFiltro || 'todos';
              contPorTurno[tKey] = (contPorTurno[tKey] || 0) + 1;
              numPorChave[d.chave] = d.versaoNumero || contPorTurno[tKey];
            });

          return (
            <div className="rounded-2xl border border-teal-200/80 bg-teal-50/40 p-4 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <History className="w-5 h-5 text-teal-700 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-xs font-extrabold uppercase tracking-wider text-teal-900 flex items-center gap-2 flex-wrap">
                      <span>Histórico de Versões na Nuvem & Código Base62</span>
                      {rascunhosDaEscola.length > 0 && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-teal-100 text-teal-800 border border-teal-300">
                          {rascunhosDaEscola.length} versão(ões)
                        </span>
                      )}
                    </h4>
                    <p className="text-[11px] text-teal-800/90">
                      Guarde múltiplas versões com data/hora e rótulo ou restaure um <strong>Código Base62</strong>. O sistema detecta alterações automaticamente antes de exportar, imprimir ou importar.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleAbrirImportarBase62}
                  className="px-3.5 py-2 bg-white hover:bg-teal-50 text-teal-800 border border-teal-300 rounded-xl text-xs font-bold shadow-2xs transition inline-flex items-center justify-center gap-1.5 shrink-0 cursor-pointer"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  Restaurar via Código Base62
                </button>
              </div>

              {rascunhosDaEscola.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-1 max-h-80 overflow-y-auto pr-0.5">
                  {rascunhosDaEscola.map((draft) => {
                    const turnoLabel =
                      draft.turnoFiltro === 'todos'
                        ? 'Todos os Turnos'
                        : draft.turnoFiltro === 'manha'
                        ? 'Manhã'
                        : draft.turnoFiltro === 'tarde'
                        ? 'Tarde'
                        : 'Noite';
                    const vNum = numPorChave[draft.chave] || 1;
                    const isEmUso = Boolean(
                      resultado &&
                        assinaturaSimulacaoAtual &&
                        draft.turnoFiltro === selectedTurno &&
                        assinaturasRascunhosNuvem[draft.chave] === assinaturaSimulacaoAtual &&
                        (rascunhoCorrespondenteAtual?.chave === draft.chave || !rascunhoCorrespondenteAtual)
                    );
                    return (
                      <div
                        key={draft.chave}
                        className={`bg-white rounded-xl border p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 shadow-2xs transition ${
                          isEmUso ? 'border-teal-500 ring-1 ring-teal-400/50 bg-teal-50/30' : 'border-teal-200'
                        }`}
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-indigo-100 text-indigo-800 border border-indigo-200">
                              v{vNum}
                            </span>
                            <span className="text-xs font-bold text-slate-800 truncate">
                              {draft.rotulo || `${turnoLabel} (${draft.anoLetivo})`}
                            </span>
                            {isEmUso && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                                ● Em uso
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                              {turnoLabel} • {labelOrigemRascunho(draft.origem)}
                            </span>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-teal-50 text-teal-800 border border-teal-200">
                              {draft.totalAulasAlocadas}/{draft.totalAulasEsperadas} aulas • ⭐ {draft.totalHAs} H.A.
                              {(draft.totalSwap || 0) > 0 ? ` • ⇄ ${draft.totalSwap} Swap` : ''}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500 truncate">
                            {new Date(draft.salvoEm).toLocaleString('pt-BR')}
                            {draft.salvoPor ? ` • por ${draft.salvoPor}` : ''}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleRestaurarDaNuvem(draft)}
                            className="px-2.5 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-[11px] font-bold transition cursor-pointer"
                          >
                            Restaurar
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setCodigoModal({
                                aberto: true,
                                modo: 'exportar',
                                codigo: draft.codigoBase62,
                                copiado: false
                              })
                            }
                            className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[11px] font-bold transition cursor-pointer"
                            title="Ver/copiar Código Base62 desta versão"
                          >
                            <KeyRound className="w-3.5 h-3.5" />
                          </button>
                          {isAdmin && (
                            <>
                              <button
                                type="button"
                                onClick={() =>
                                  setRenomearDraftModal({ draft, rotulo: draft.rotulo || '' })
                                }
                                className="p-1.5 bg-sky-50 hover:bg-sky-100 text-sky-700 rounded-lg transition cursor-pointer"
                                title="Editar nome/rótulo desta versão"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleExcluirRascunhoNuvem(draft)}
                                className="p-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg transition cursor-pointer"
                                title="Excluir esta versão da nuvem"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}

        {/* Barra de Progresso e Botão de Ação / Cancelamento */}
        {especialistasDaEscola.length > 0 && (
          <div className="pt-4 space-y-3 border-t border-slate-100">
            {(generating || statusMensagem) && (
              <div
                className={`p-3.5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                  generating
                    ? 'bg-indigo-50 border-indigo-200 text-indigo-900'
                    : 'bg-slate-50 border-slate-200 text-slate-700'
                }`}
              >
                <div className="flex items-center gap-2.5 text-xs font-semibold">
                  {generating ? (
                    <RefreshCw className="w-4 h-4 animate-spin text-indigo-600 shrink-0" />
                  ) : (
                    <Info className="w-4 h-4 text-slate-500 shrink-0" />
                  )}
                  <span>{statusMensagem || 'Calculando horários...'}</span>
                </div>

                {generating && (
                  <div className="flex items-center gap-3">
                    {progressoGeracao && (
                      <div className="w-28 h-2 bg-indigo-200 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-indigo-600 transition-all"
                          style={{
                            width: `${Math.min(
                              100,
                              Math.round((progressoGeracao.aulasAlocadas / Math.max(1, progressoGeracao.totalAulas)) * 100)
                            )}%`
                          }}
                        />
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={handleCancelarGeracao}
                      className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
                    >
                      <StopCircle className="w-3.5 h-3.5" />
                      Cancelar
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="text-xs text-slate-500">
                Planejamento focado na unidade <strong>{escolaAtual?.name}</strong> •{' '}
                {especialistasDaEscola.filter((e) => e.turmasRegulares.length > 0).length} especialista(s) com carga regular
                ativa.
              </div>

              <div className="flex items-center gap-3 w-full sm:w-auto">
                {generating && (
                  <button
                    type="button"
                    onClick={handleCancelarGeracao}
                    className="px-4 py-3 bg-red-100 hover:bg-red-200 text-red-800 border border-red-300 rounded-xl font-bold text-sm transition flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <StopCircle className="w-4 h-4" />
                    Cancelar
                  </button>
                )}

                <button
                  type="button"
                  disabled={generating || especialistasDaEscola.length === 0}
                  onClick={handleGerarSugestao}
                  className="flex-1 sm:flex-none px-6 py-3 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 text-white rounded-xl font-bold text-sm shadow-md hover:shadow-lg transition flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {generating ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Calculando Horários da Escola...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 text-amber-300" />
                      Gerar Sugestão — {escolaAtual?.name || 'Escola'}{' '}
                      {selectedTurno === 'todos'
                        ? '(Todos os Turnos)'
                        : selectedTurno === 'manha'
                        ? '(Manhã)'
                        : selectedTurno === 'tarde'
                        ? '(Tarde)'
                        : '(Noite)'}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 4. Exibição da Sugestão Gerada */}
      {resultado && (
        <div className="space-y-6">
          {/* Alerta de Conflitos detectados (ex.: após restaurar rascunho quando outra escola mudou) */}
          {resultado.conflitos.length > 0 && (
            <div className="bg-rose-50 border border-rose-300 rounded-2xl p-5 space-y-2.5 print:hidden">
              <div className="flex items-center gap-2 text-rose-900 font-bold text-sm">
                <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
                <span>
                  Conflitos Detectados na Revalidação ({resultado.conflitos.length})
                </span>
              </div>
              <div className="space-y-1">
                {resultado.conflitos.map((conf, idx) => (
                  <p key={idx} className="text-xs text-rose-900 font-medium leading-relaxed">
                    • {conf}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* Avisos e Pendências (caso haja geração parcial, revalidação pós-restauração ou alerta de capacidade) */}
          {(avisosRestauracao.length > 0 || resultado.avisos.length > 0 || resultado.demandasNaoAlocadas.length > 0) && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 space-y-3 print:hidden">
              <div className="flex items-center gap-2 text-amber-900 font-bold text-sm">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
                <span>Observações e Pendências do Cálculo ({resultado.estatisticas.tempoCalculoMs}ms)</span>
              </div>
              {resultado.avisos.map((av, idx) => (
                <p key={idx} className="text-xs text-amber-900 leading-relaxed">
                  • {av}
                </p>
              ))}
              {resultado.demandasNaoAlocadas.length > 0 && (
                <div className="pt-2 border-t border-amber-200/80 space-y-1.5">
                  <span className="text-xs font-bold text-amber-950 block">
                    Turmas/Especialistas sem encaixe ({resultado.demandasNaoAlocadas.length}):
                  </span>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {resultado.demandasNaoAlocadas.map((pend, idx) => (
                      <div key={idx} className="bg-white/80 p-2.5 rounded-xl border border-amber-200 text-xs">
                        <div className="font-bold text-slate-800">
                          {pend.className} — {pend.teacherName} ({pend.disciplina})
                        </div>
                        <div className="text-[11px] text-amber-800 mt-0.5">{pend.motivo}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Cards de Métricas e Conformidade */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 print:hidden">
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
              <span className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Aulas Regulares</span>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-black text-slate-800">{resultado.estatisticas.totalAulasAlocadas}</span>
                <span className="text-xs text-slate-500">de {resultado.estatisticas.totalAulasEsperadas}</span>
              </div>
              <div className="mt-2 text-xs font-bold text-emerald-600 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {resultado.estatisticas.percentualConcluido}% alocado ({resultado.estatisticas.tempoCalculoMs}ms)
              </div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
              <span className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Máx. 2 Esp/Dia</span>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-black text-emerald-700">{resultado.estatisticas.turmasComMaxEspecialistasRespeitado}</span>
                <span className="text-xs text-slate-500">de {resultado.estatisticas.totalTurmas} turmas</span>
              </div>
              <div className="mt-2 text-xs font-bold text-emerald-600 flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" /> Regra 100% cumprida
              </div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
              <span className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Folgas Respeitadas</span>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-black text-indigo-700">{resultado.estatisticas.folgasRespeitadas}</span>
                <span className="text-xs text-slate-500">especialistas</span>
              </div>
              <div className="mt-2 text-xs font-bold text-indigo-600 flex items-center gap-1">
                <Coffee className="w-3.5 h-3.5" /> Zero aulas em dias de folga
              </div>
            </div>

            <div
              className={`p-4 rounded-xl border shadow-xs ${
                resultado.conflitos.length > 0
                  ? 'bg-rose-50 border-rose-300'
                  : 'bg-white border-slate-200'
              }`}
            >
              <span className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Choques de Horário
              </span>
              <div className="mt-1 flex items-baseline gap-2">
                <span
                  className={`text-2xl font-black ${
                    resultado.conflitos.length > 0 ? 'text-rose-700' : 'text-emerald-700'
                  }`}
                >
                  {resultado.conflitos.length}
                </span>
                <span className="text-xs text-slate-500">conflitos</span>
              </div>
              <div
                className={`mt-2 text-xs font-bold flex items-center gap-1 ${
                  resultado.conflitos.length > 0 ? 'text-rose-700' : 'text-emerald-600'
                }`}
              >
                {resultado.conflitos.length > 0 ? (
                  <>
                    <AlertTriangle className="w-3.5 h-3.5" /> Ajuste os horários em conflito
                  </>
                ) : (
                  <>
                    <Check className="w-3.5 h-3.5" /> Grade limpa e viável
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Barra de Ações */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 flex flex-col lg:flex-row items-center justify-between gap-4 print:hidden">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Visualizar Proposta:</span>
              <div className="flex p-1 bg-slate-100 rounded-xl text-xs font-bold">
                <button
                  type="button"
                  onClick={() => setPreviewTab('turmas')}
                  className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                    previewTab === 'turmas' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Por Turma
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewTab('especialistas')}
                  className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                    previewTab === 'especialistas' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Por Especialista
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewTab('resumo')}
                  className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                    previewTab === 'resumo' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Aplicar ao Quadro Oficial
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap w-full lg:w-auto justify-end">
              {rascunhoCorrespondenteAtual ? (
                <span
                  className="px-2.5 py-1.5 rounded-xl text-[11px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 inline-flex items-center gap-1.5"
                  title="Esta simulação coincide exatamente com uma versão salva na nuvem"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  {formatarEtiquetaVersao(rascunhoCorrespondenteAtual).versaoInfo}
                </span>
              ) : (
                <span
                  className="px-2.5 py-1.5 rounded-xl text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-300 inline-flex items-center gap-1.5"
                  title="Existem alterações ainda não salvas na nuvem"
                >
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                  Alterações não salvas
                </span>
              )}

              {isAdmin && (
                <button
                  type="button"
                  disabled={savingCloudDraft}
                  onClick={handleSalvarRascunhoNuvem}
                  className={`px-3 py-2 disabled:opacity-60 text-white rounded-xl text-xs font-bold shadow-xs transition flex items-center justify-center gap-1.5 cursor-pointer ${
                    temAlteracoesNaoSalvas
                      ? 'bg-sky-600 hover:bg-sky-700'
                      : 'bg-slate-500 hover:bg-slate-600'
                  }`}
                  title={
                    temAlteracoesNaoSalvas
                      ? 'Salvar nova versão deste rascunho na nuvem (ou atualizar versão ativa)'
                      : 'Simulação já sincronizada com a versão salva na nuvem'
                  }
                >
                  {savingCloudDraft ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Cloud className="w-3.5 h-3.5" />}
                  {temAlteracoesNaoSalvas ? `Salvar Versão (v${proximoNumeroVersao})` : 'Versão Salva'}
                </button>
              )}

              <button
                type="button"
                onClick={handleAbrirExportarBase62}
                className="px-3 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold shadow-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
                title="Gera Código Base62 portátil desta simulação para copiar, guardar ou abrir em outro dispositivo"
              >
                <KeyRound className="w-3.5 h-3.5 text-amber-300" />
                Código Base62
              </button>

              <button
                type="button"
                onClick={() => handleExportarExcel()}
                className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
                title="Exporta Excel (.xlsx) com uma aba individual por especialista espelhando a tela Por Especialista"
              >
                <FileSpreadsheet className="w-4 h-4" />
                Exportar Excel (.xlsx)
              </button>

              <button
                type="button"
                onClick={() => handleExportarPDF()}
                className="px-3.5 py-2 bg-teal-700 hover:bg-teal-800 text-white rounded-xl text-xs font-bold shadow-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
                title="Gera PDF com 1 página individual por especialista no formato da tela Por Especialista"
              >
                <FileText className="w-4 h-4" />
                PDF Individuais
              </button>

              <button
                type="button"
                onClick={() =>
                  handleImprimir(previewTab === 'turmas' ? 'atual' : 'todos_especialistas')
                }
                className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer"
                title={
                  previewTab === 'turmas'
                    ? 'Imprimir o quadro da turma selecionada'
                    : 'Imprimir os quadros individuais de todos os especialistas (1 folha por especialista)'
                }
              >
                <Printer className="w-4 h-4" />
                {previewTab === 'turmas' ? 'Imprimir Turma' : 'Imprimir Individuais'}
              </button>

              {isAdmin && (
                <button
                  type="button"
                  disabled={applying}
                  onClick={handleAplicarQuadroOficial}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  {applying ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckSquare className="w-4 h-4" />}
                  Aprovar & Gravar no Quadro Oficial
                </button>
              )}
            </div>
          </div>

          {/* Barra de Ajuste Fino (Arrastar e Soltar + Área de Swap com Conferência em Tempo Real) */}
          {previewTab !== 'resumo' && contextoGeracao && (
            <div className="space-y-2 print:hidden">
              <div
                className={`rounded-2xl border px-3.5 py-2.5 min-h-[68px] flex flex-col lg:flex-row lg:items-center justify-between gap-3 transition-colors duration-75 ${
                  aulaEmMovimento
                    ? 'bg-indigo-50 border-indigo-300 shadow-xs'
                    : activeSwapItem
                    ? 'bg-amber-50 border-amber-300 shadow-xs'
                    : 'bg-slate-50 border-slate-200'
                }`}
              >
                <div className="flex items-center gap-2.5 text-xs min-w-0 flex-1">
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors duration-75 ${
                      aulaEmMovimento
                        ? 'bg-indigo-600 text-white'
                        : activeSwapItem
                        ? 'bg-amber-600 text-white'
                        : 'bg-white border border-slate-200 text-indigo-600'
                    }`}
                  >
                    {activeSwapItem && !aulaEmMovimento ? (
                      <Layers className="w-4 h-4" />
                    ) : (
                      <Move className="w-4 h-4" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    {aulaEmMovimento ? (() => {
                      let previewVal: ResultadoValidacaoMovimento | null = null;
                      if (hoveredDropTarget) {
                        const targetClassIdHover =
                          previewTab === 'especialistas' && hoveredDropTarget.turno
                            ? (resultado.gradesPorEspecialistaLista?.[aulaEmMovimento.teacherId] || []).find(
                                (s) =>
                                  s.turno === hoveredDropTarget.turno &&
                                  s.dia === hoveredDropTarget.dia &&
                                  s.ordem === hoveredDropTarget.ordem
                              )?.classId
                            : undefined;

                        previewVal = validarMovimentoAulaSugerida(
                          resultado.gradesPorTurma,
                          {
                            classId: aulaEmMovimento.classId,
                            fromDia: aulaEmMovimento.fromDia,
                            fromOrdem: aulaEmMovimento.fromOrdem
                          },
                          {
                            toDia: hoveredDropTarget.dia,
                            toOrdem: hoveredDropTarget.ordem,
                            turnoDestino: hoveredDropTarget.turno,
                            targetClassId: targetClassIdHover
                          },
                          contextoGeracao
                        );
                      }

                      const textoStatus = previewVal
                        ? previewVal.valido
                          ? `${
                              previewVal.tipo === 'permutar' || previewVal.tipo === 'permutar_turmas'
                                ? '⇄ '
                                : '✅ '
                            }${previewVal.detalhes}`
                          : previewVal.tipo === 'mesmo_slot'
                          ? 'Solte em outro horário ou dia para mover.'
                          : `⛔ ${previewVal.motivo}`
                        : aulaEmMovimento.mode === 'click'
                        ? 'Clique em uma célula verde (livre) ou azul (permuta / troca entre turmas) para mover. ESC cancela.'
                        : 'Passe sobre os horários: verde = livre, azul = permuta ou troca entre turmas, vermelho = conflito.';

                      return (
                        <>
                          <div className="font-bold text-indigo-950 flex items-center gap-1.5 min-w-0">
                            <span className="truncate">
                              Movendo: {aulaEmMovimento.disciplinaNome} ({aulaEmMovimento.teacherName}) •{' '}
                              {aulaEmMovimento.turmaLabel}
                            </span>
                            <span className="px-2 py-0.5 rounded-full text-[10px] bg-indigo-200 text-indigo-900 shrink-0">
                              {GRADE_DIAS_SEMANA.find((d) => d.id === aulaEmMovimento.fromDia)?.curto} •{' '}
                              {aulaEmMovimento.fromOrdem}ª aula
                            </span>
                          </div>
                          <div
                            className={`text-[11px] font-medium truncate ${
                              previewVal
                                ? previewVal.valido
                                  ? 'text-emerald-700 font-bold'
                                  : previewVal.tipo === 'mesmo_slot'
                                  ? 'text-slate-600'
                                  : 'text-rose-700 font-bold'
                                : 'text-indigo-800'
                            }`}
                            title={textoStatus}
                          >
                            {textoStatus}
                          </div>
                        </>
                      );
                    })() : activeSwapItem ? (() => {
                      let previewSwapVal: ResultadoValidacaoSwap | null = null;
                      if (hoveredDropTarget) {
                        previewSwapVal = validarEncaixeDeSwap(
                          resultado.gradesPorTurma,
                          activeSwapItem,
                          hoveredDropTarget.dia,
                          hoveredDropTarget.ordem,
                          contextoGeracao,
                          hoveredDropTarget.turno
                        );
                      }

                      const textoSwapStatus = previewSwapVal
                        ? previewSwapVal.valido
                          ? `${previewSwapVal.tipo === 'trocar_swap' ? '⇄ ' : '✅ '}${previewSwapVal.detalhes}`
                          : `⛔ ${previewSwapVal.motivo}`
                        : 'Clique ou arraste para um horário verde (livre) ou azul (encaixar aqui enviando a aula atual ao Swap). ESC cancela.';

                      return (
                        <>
                          <div className="font-bold text-amber-950 flex items-center gap-1.5 min-w-0">
                            <span className="truncate">
                              Reencaixando do Swap: {activeSwapItem.slot.disciplinaNome} ({activeSwapItem.slot.teacherNome}) •{' '}
                              {activeSwapItem.turmaLabel}
                            </span>
                            <span className="px-2 py-0.5 rounded-full text-[10px] bg-amber-200 text-amber-900 shrink-0">
                              Origem: {GRADE_DIAS_SEMANA.find((d) => d.id === activeSwapItem.origemDia)?.curto} •{' '}
                              {activeSwapItem.origemOrdem}ª
                            </span>
                          </div>
                          <div
                            className={`text-[11px] font-medium truncate ${
                              previewSwapVal
                                ? previewSwapVal.valido
                                  ? previewSwapVal.tipo === 'trocar_swap'
                                    ? 'text-sky-700 font-bold'
                                    : 'text-emerald-700 font-bold'
                                  : 'text-rose-700 font-bold'
                                : 'text-amber-900'
                            }`}
                            title={textoSwapStatus}
                          >
                            {textoSwapStatus}
                          </div>
                        </>
                      );
                    })() : (
                      <>
                        <div className="font-bold text-slate-800 truncate">
                          Ajuste Fino, Troca Entre Turmas e Área de Swap (Conferência em Tempo Real)
                        </div>
                        <div className="text-[11px] text-slate-600 truncate">
                          Arraste (⋮⋮) para mover, permutar ou trocar turmas entre dias — ou clique em 📥 Swap para estacionar aulas em trocas em cadeia.
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {(aulaEmMovimento?.mode === 'click' || activeSwapItem) && (
                    <button
                      type="button"
                      onClick={limparEstadoMovimento}
                      className="px-2.5 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-lg text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                      Cancelar
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={historicoEdicoes.length === 0}
                    onClick={handleDesfazerMovimento}
                    className="px-3 py-1.5 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed text-slate-700 border border-slate-300 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                    title="Desfazer a última movimentação manual"
                  >
                    <Undo2 className="w-3.5 h-3.5 text-indigo-600" />
                    Desfazer{historicoEdicoes.length > 0 ? ` (${historicoEdicoes.length})` : ''}
                  </button>

                  {historicoEdicoes.length > 0 && (
                    <button
                      type="button"
                      onClick={handleRestaurarOriginal}
                      className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                      title="Descartar ajustes manuais e voltar à grade gerada"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Restaurar Original
                    </button>
                  )}
                </div>
              </div>

              {/* Bandeja Temporária / Área de Swap (Empilhar e Desempilhar aulas em grade cheia) */}
              <div
                onDragOver={(e) => {
                  if (!aulaEmMovimento) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const payload = e.dataTransfer.getData('text/plain');
                  if (payload.startsWith('swap:')) return;
                  if (payload.includes(':')) {
                    const [cId, dStr, oStr] = payload.split(':');
                    const dNum = Number(dStr) as DiaSemana;
                    const oNum = Number(oStr);
                    if (cId && dNum >= 1 && dNum <= 5 && oNum >= 1 && oNum <= 5) {
                      handleEmpilharParaSwap(cId, dNum, oNum);
                      return;
                    }
                  }
                  if (aulaEmMovimento) {
                    handleEmpilharParaSwap(
                      aulaEmMovimento.classId,
                      aulaEmMovimento.fromDia,
                      aulaEmMovimento.fromOrdem
                    );
                  }
                }}
                onClick={() => {
                  if (aulaEmMovimento?.mode === 'click') {
                    handleEmpilharParaSwap(
                      aulaEmMovimento.classId,
                      aulaEmMovimento.fromDia,
                      aulaEmMovimento.fromOrdem
                    );
                  }
                }}
                className={`rounded-2xl border px-4 py-2.5 shadow-xs space-y-2 transition-colors ${
                  aulaEmMovimento
                    ? 'border-2 border-dashed border-amber-500 bg-amber-100/80 cursor-pointer'
                    : swapItems.length > 0
                    ? 'border-amber-300 bg-gradient-to-r from-amber-50 to-orange-50/60'
                    : 'border-dashed border-amber-300/90 bg-amber-50/40'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs flex-wrap">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-600 text-white font-extrabold text-[11px] shrink-0">
                      <Layers className="w-3.5 h-3.5" />
                      Área de Swap ({swapItems.length})
                    </span>
                    <span className="font-semibold text-amber-950">
                      {aulaEmMovimento
                        ? `Solte ou clique aqui para estacionar "${aulaEmMovimento.turmaLabel} (${aulaEmMovimento.disciplinaNome})" no Swap.`
                        : swapItems.length > 0
                        ? 'Navegue entre especialistas e turmas — clique no cartão ou arraste para reencaixar sem conflitos.'
                        : 'Arraste uma aula (⋮⋮) para cá — ou clique em "Swap" no cartão — para estacionar aulas ao trocar horários em grade cheia.'}
                    </span>
                  </div>
                  {swapItems.length > 0 && (
                    <span className="text-[11px] font-bold text-amber-800 shrink-0">
                      ⚠️ Reencaixe antes de gravar no Oficial
                    </span>
                  )}
                </div>

                {swapItems.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {swapItems.map((item) => {
                      const isActiveSwap = swapEmEncaixeId === item.id;
                      const diaCurto = GRADE_DIAS_SEMANA.find((d) => d.id === item.origemDia)?.curto || `D${item.origemDia}`;
                      return (
                        <div
                          key={item.id}
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.effectAllowed = 'move';
                            e.dataTransfer.setData('text/plain', `swap:${item.id}`);
                            setSwapEmEncaixeId(item.id);
                            setAulaEmMovimento(null);
                          }}
                          onDragEnd={() => {
                            setHoveredDropTarget(null);
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSwapEmEncaixeId((prev) => (prev === item.id ? null : item.id));
                            setAulaEmMovimento(null);
                          }}
                          className={`rounded-xl border px-3 py-2 flex flex-col sm:flex-row sm:items-center gap-2 text-xs cursor-grab active:cursor-grabbing transition shadow-2xs ${
                            isActiveSwap
                              ? 'bg-amber-100 border-amber-500 ring-2 ring-amber-400/70'
                              : 'bg-white border-amber-200 hover:border-amber-400'
                          }`}
                          title="Clique para selecionar ou arraste para encaixar no horário desejado"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <GripVertical className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                            <div className="min-w-0">
                              <div className="font-extrabold text-slate-900 truncate flex items-center gap-1.5">
                                <span>{item.turmaLabel}</span>
                                <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-teal-100 text-teal-900">
                                  {item.slot.disciplinaNome}
                                </span>
                              </div>
                              <div className="text-[10px] text-slate-600 truncate">
                                {item.slot.teacherNome} • {item.turno === 'manha' ? 'Manhã' : item.turno === 'tarde' ? 'Tarde' : 'Noite'} • Saiu de {diaCurto} {item.origemOrdem}ª
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={() => {
                                setPreviewTab('turmas');
                                setPreviewClassId(item.classId);
                                setSwapEmEncaixeId(item.id);
                                setAulaEmMovimento(null);
                                setHoveredDropTarget(null);
                              }}
                              className="px-2 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 text-[10px] font-bold cursor-pointer"
                              title={`Abrir grade da turma ${item.turmaLabel} para encaixar`}
                            >
                              🏫 Turma
                            </button>
                            {item.slot.teacherId && (
                              <button
                                type="button"
                                onClick={() => {
                                  setPreviewTab('especialistas');
                                  setPreviewTeacherId(item.slot.teacherId!);
                                  setSwapEmEncaixeId(item.id);
                                  setAulaEmMovimento(null);
                                  setHoveredDropTarget(null);
                                }}
                                className="px-2 py-1 rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-200 text-[10px] font-bold cursor-pointer"
                                title={`Abrir grade de ${item.slot.teacherNome} para encaixar`}
                              >
                                🎨 Espec.
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                handleExecutarEncaixeSwap(item.origemDia, item.origemOrdem, item.turno, item.id)
                              }
                              className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 text-[10px] font-bold cursor-pointer"
                              title="Tentar devolver esta aula para o horário original (ou trocar pelo ocupante atual)"
                            >
                              ↩️ Origem
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {feedbackMovimento && (
                <div
                  className={`px-3.5 py-2 rounded-xl border text-xs font-semibold flex items-center justify-between gap-2 ${
                    feedbackMovimento.tipo === 'sucesso'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                      : 'bg-rose-50 border-rose-200 text-rose-900'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {feedbackMovimento.tipo === 'sucesso' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                    )}
                    <span>{feedbackMovimento.mensagem}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFeedbackMovimento(null)}
                    className="p-0.5 rounded hover:bg-black/5 cursor-pointer"
                    aria-label="Fechar aviso"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Visualização: Aba por Turma */}
          {previewTab === 'turmas' && (() => {
            const previewTurmaObj = turmasComEspecialistasRegulares.find((c) => c.id === previewClassId);
            const bellTurma = previewTurmaObj
              ? getHorariosTurma(
                  previewTurmaObj.val.shift,
                  previewTurmaObj.val.intervaloGrupo,
                  previewTurmaObj.val.year,
                  previewTurmaObj.val.schoolId
                )
              : null;
            const bellPorDia = previewTurmaObj
              ? Object.fromEntries(
                  GRADE_DIAS_SEMANA.map((d) => [
                    d.id,
                    getHorariosTurma(
                      previewTurmaObj.val.shift,
                      previewTurmaObj.val.intervaloGrupo,
                      previewTurmaObj.val.year,
                      previewTurmaObj.val.schoolId,
                      d.id,
                      previewTurmaObj.val.intervaloGrupoPorDia
                    )
                  ])
                )
              : null;
            const gruposUnicosBell = bellPorDia
              ? new Set(GRADE_DIAS_SEMANA.map((d) => bellPorDia[d.id]?.grupo))
              : new Set();
            const temSinoVariavelPorDia = gruposUnicosBell.size > 1;
            const turnoTurma = previewTurmaObj ? getTurnoCanonical(previewTurmaObj.val.shift) : 'manha';
            const isPrimeiroAnoManha =
              turnoTurma === 'manha' &&
              (previewTurmaObj?.val.intervaloGrupo === '1' ||
                previewTurmaObj?.val.intervaloGrupo === 'ano1' ||
                (previewTurmaObj?.val.year || '').trim() === '1');
            const intervaloAposOrdem = bellTurma ? aulasAntesDoIntervalo(bellTurma) : isPrimeiroAnoManha ? 2 : 3;

            const turmasManha = turmasComEspecialistasRegulares.filter(
              (c) => getTurnoCanonical(c.val.shift) === 'manha'
            );
            const turmasTarde = turmasComEspecialistasRegulares.filter(
              (c) => getTurnoCanonical(c.val.shift) === 'tarde'
            );
            const turmasOutros = turmasComEspecialistasRegulares.filter((c) => {
              const tr = getTurnoCanonical(c.val.shift);
              return tr !== 'manha' && tr !== 'tarde';
            });

            return (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-4 print:border-0 print:shadow-none print:p-0">
                {/* Cabeçalho exclusivo de impressão para Por Turma */}
                {previewTurmaObj && (
                  <div className="hidden print:flex items-center justify-between border-b-2 border-slate-800 pb-2 mb-3">
                    <div>
                      <div className="text-xs font-bold uppercase text-slate-600">
                        {escolaAtual?.name} • Ano Letivo {planejamentoAno}
                      </div>
                      <h3 className="text-lg font-black text-slate-900">
                        Quadro de Horários — {previewTurmaObj.val.year}º {previewTurmaObj.val.letter} ({previewTurmaObj.val.shift})
                      </h3>
                    </div>
                    <div className="text-right text-xs text-slate-600 font-semibold">
                      <div>Especialistas Regulares</div>
                      <div className="text-[10px] text-slate-500">
                        {formatarEtiquetaVersao(rascunhoCorrespondenteAtual).versaoInfo}
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-slate-100 print:hidden">
                  <div className="flex items-center gap-3 flex-wrap">
                    <BookOpen className="w-5 h-5 text-indigo-600" />
                    <label className="text-sm font-bold text-slate-800">Selecione a Turma da Escola:</label>
                    <select
                      value={previewClassId}
                      onChange={(e) => {
                        setPreviewClassId(e.target.value);
                        setAulaEmMovimento(null);
                        setHoveredDropTarget(null);
                      }}
                      className="px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-sm font-bold text-slate-800 focus:ring-2 focus:ring-indigo-500"
                    >
                      {turmasManha.length > 0 && (
                        <optgroup label="☀️ Turno Matutino (Manhã)">
                          {turmasManha.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.val.year}º {c.val.letter} ({c.val.shift})
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {turmasTarde.length > 0 && (
                        <optgroup label="🌤️ Turno Vespertino (Tarde)">
                          {turmasTarde.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.val.year}º {c.val.letter} ({c.val.shift})
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {turmasOutros.length > 0 && (
                        <optgroup label="🌙 Outros Turnos">
                          {turmasOutros.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.val.year}º {c.val.letter} ({c.val.shift})
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                  </div>

                  {previewClassId && resultado.analisePorDiaTurma[previewClassId] && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-slate-500 font-semibold">Especialistas no dia:</span>
                      {GRADE_DIAS_SEMANA.map((d) => {
                        const infoDia = resultado.analisePorDiaTurma[previewClassId]?.[d.id];
                        const qtd = infoDia?.especialistas?.length || 0;
                        const nomes = (infoDia?.especialistas || []).map((e) => e.disciplina).join(', ');
                        return (
                          <span
                            key={d.id}
                            className={`text-xs px-2 py-0.5 rounded-md font-semibold border ${
                              qtd === 0
                                ? 'bg-slate-100 text-slate-600 border-slate-200'
                                : qtd <= 2
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : 'bg-red-50 text-red-700 border-red-200'
                            }`}
                            title={nomes || 'Apenas professor regente'}
                          >
                            {d.curto}: {qtd} esp {qtd <= 2 ? '✅' : '⚠️'}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>

                {previewClassId && (
                  <div className="border border-slate-200 rounded-xl overflow-hidden shadow-xs">
                    <table
                      className="w-full table-fixed text-center text-sm"
                      onDragLeave={(e) => {
                        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                          setHoveredDropTarget(null);
                        }
                      }}
                    >
                      <thead className="bg-slate-800 text-white font-bold text-xs uppercase tracking-wider">
                        <tr>
                          <th className="py-2.5 px-3 w-32 text-left bg-slate-900">Aula / Horário</th>
                          {GRADE_DIAS_SEMANA.map((d) => (
                            <th key={d.id} className="py-2.5 px-3 border-l border-slate-700">
                              {d.nome}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {[1, 2, 3, 4, 5].map((ordem) => {
                          const aulaBell = bellTurma?.aulas.find((a) => a.ordem === ordem);
                          const faixasPorDia = bellPorDia
                            ? GRADE_DIAS_SEMANA.map((d) => {
                                const ab = bellPorDia[d.id]?.aulas.find((a) => a.ordem === ordem);
                                return ab ? `${ab.inicio}–${ab.fim}` : '';
                              })
                            : [];
                          const faixasUnicas = Array.from(new Set(faixasPorDia.filter(Boolean)));
                          return (
                            <React.Fragment key={ordem}>
                              <tr className="hover:bg-slate-50/50">
                                <td className="py-2 px-3 font-bold text-xs text-slate-700 text-left bg-slate-50/80 border-r border-slate-200">
                                  <div>{ordem}ª Aula</div>
                                  {temSinoVariavelPorDia && faixasUnicas.length > 1 ? (
                                    <div className="text-[10px] font-medium text-indigo-600 leading-tight">
                                      {faixasUnicas.join(' / ')}
                                    </div>
                                  ) : aulaBell ? (
                                    <div className="text-[10px] font-medium text-indigo-600">
                                      {aulaBell.inicio} – {aulaBell.fim}
                                    </div>
                                  ) : null}
                                </td>
                                {GRADE_DIAS_SEMANA.map((d) => {
                                  const slot = resultado.gradesPorTurma[previewClassId]?.[`${d.id}_${ordem}`];
                                  const isSpecialistSlot =
                                    slot && especialistasDaEscola.some((e) => e.id === slot.teacherId);

                                  const emMovimentoNestaTurma =
                                    aulaEmMovimento &&
                                    aulaEmMovimento.classId === previewClassId &&
                                    contextoGeracao;

                                  const emEncaixeSwapNestaTurma =
                                    !emMovimentoNestaTurma &&
                                    activeSwapItem &&
                                    activeSwapItem.classId === previewClassId &&
                                    contextoGeracao;

                                  const isSourceCell =
                                    emMovimentoNestaTurma &&
                                    aulaEmMovimento.fromDia === d.id &&
                                    aulaEmMovimento.fromOrdem === ordem;

                                  const validacaoCell: ResultadoValidacaoMovimento | null =
                                    emMovimentoNestaTurma && !isSourceCell
                                      ? validarMovimentoAulaSugerida(
                                          resultado.gradesPorTurma,
                                          {
                                            classId: aulaEmMovimento.classId,
                                            fromDia: aulaEmMovimento.fromDia,
                                            fromOrdem: aulaEmMovimento.fromOrdem
                                          },
                                          { toDia: d.id, toOrdem: ordem },
                                          contextoGeracao
                                        )
                                      : null;

                                  const validacaoSwapCell: ResultadoValidacaoSwap | null =
                                    emEncaixeSwapNestaTurma && activeSwapItem
                                      ? validarEncaixeDeSwap(
                                          resultado.gradesPorTurma,
                                          activeSwapItem,
                                          d.id,
                                          ordem,
                                          contextoGeracao,
                                          turnoTurma
                                        )
                                      : null;

                                  const isHovered =
                                    hoveredDropTarget?.dia === d.id && hoveredDropTarget?.ordem === ordem;

                                  const ativoTipo = validacaoCell?.tipo || validacaoSwapCell?.tipo;
                                  const ativoValido = validacaoCell ? validacaoCell.valido : validacaoSwapCell?.valido;

                                  const tdStateClass = isSourceCell
                                    ? 'bg-indigo-100/80 ring-2 ring-inset ring-indigo-500'
                                    : ativoTipo === 'mover'
                                    ? `bg-emerald-50/90 ${
                                        isHovered
                                          ? 'ring-2 ring-inset ring-emerald-500 bg-emerald-100/80'
                                          : 'ring-1 ring-inset ring-emerald-300'
                                      }`
                                    : ativoTipo === 'permutar' || ativoTipo === 'trocar_swap'
                                    ? `bg-sky-50/90 ${
                                        isHovered
                                          ? 'ring-2 ring-inset ring-sky-500 bg-sky-100/80'
                                          : 'ring-1 ring-inset ring-sky-300'
                                      }`
                                    : ativoTipo === 'bloqueado'
                                    ? `bg-rose-50/75 ${
                                        isHovered
                                          ? 'ring-2 ring-inset ring-rose-500 bg-rose-100/75'
                                          : 'ring-1 ring-inset ring-rose-200'
                                      }`
                                    : isSpecialistSlot
                                    ? 'bg-indigo-50/70 border-indigo-200'
                                    : slot
                                    ? 'bg-slate-50/40 text-slate-600'
                                    : 'text-slate-400 italic';

                                  const startMoveCard = (mode: 'drag' | 'click') => {
                                    if (!slot?.teacherId || !previewTurmaObj || !contextoGeracao) return;
                                    setSwapEmEncaixeId(null);
                                    setAulaEmMovimento({
                                      classId: previewClassId,
                                      fromDia: d.id,
                                      fromOrdem: ordem,
                                      teacherId: slot.teacherId,
                                      teacherName: slot.teacherNome || 'Especialista',
                                      disciplinaNome: slot.disciplinaNome || 'Especialista',
                                      turmaLabel: `${previewTurmaObj.val.year}º ${previewTurmaObj.val.letter}`,
                                      turno: turnoTurma,
                                      mode
                                    });
                                  };

                                  return (
                                    <td
                                      key={d.id}
                                      title={
                                        validacaoCell?.motivo ||
                                        validacaoCell?.detalhes ||
                                        validacaoSwapCell?.motivo ||
                                        validacaoSwapCell?.detalhes
                                      }
                                      onDragOver={(e) => {
                                        if (!emMovimentoNestaTurma && !emEncaixeSwapNestaTurma) return;
                                        e.preventDefault();
                                        e.dataTransfer.dropEffect = ativoValido ? 'move' : 'none';
                                        if (
                                          hoveredDropTarget?.dia !== d.id ||
                                          hoveredDropTarget?.ordem !== ordem
                                        ) {
                                          setHoveredDropTarget({ dia: d.id, ordem, turno: turnoTurma });
                                        }
                                      }}
                                      onDrop={(e) => {
                                        e.preventDefault();
                                        const payload = e.dataTransfer.getData('text/plain');
                                        if (payload.startsWith('swap:')) {
                                          handleExecutarEncaixeSwap(d.id, ordem, turnoTurma, payload.slice(5));
                                          return;
                                        }
                                        if (emEncaixeSwapNestaTurma && activeSwapItem) {
                                          handleExecutarEncaixeSwap(d.id, ordem, turnoTurma, activeSwapItem.id);
                                          return;
                                        }
                                        if (!emMovimentoNestaTurma) return;
                                        handleExecutarMovimento(
                                          aulaEmMovimento.classId,
                                          aulaEmMovimento.fromDia,
                                          aulaEmMovimento.fromOrdem,
                                          d.id,
                                          ordem
                                        );
                                      }}
                                      onClick={() => {
                                        if (emMovimentoNestaTurma && aulaEmMovimento.mode === 'click') {
                                          handleExecutarMovimento(
                                            aulaEmMovimento.classId,
                                            aulaEmMovimento.fromDia,
                                            aulaEmMovimento.fromOrdem,
                                            d.id,
                                            ordem
                                          );
                                        } else if (emEncaixeSwapNestaTurma && activeSwapItem) {
                                          handleExecutarEncaixeSwap(d.id, ordem, turnoTurma, activeSwapItem.id);
                                        }
                                      }}
                                      className={`py-1.5 px-2 border-l border-slate-100 text-xs align-middle transition-colors duration-75 ${tdStateClass} ${
                                        (emMovimentoNestaTurma && aulaEmMovimento.mode === 'click') ||
                                        emEncaixeSwapNestaTurma
                                          ? 'cursor-pointer'
                                          : ''
                                      }`}
                                    >
                                      <div className="relative min-h-[68px] flex flex-col items-center justify-center">
                                        {((validacaoCell && validacaoCell.tipo !== 'mesmo_slot') || validacaoSwapCell) && slot && (
                                          <span
                                            className={`pointer-events-none absolute -top-0.5 right-0 z-10 text-[9px] font-extrabold px-1.5 py-0.5 rounded shadow-xs ${
                                              ativoTipo === 'permutar' || ativoTipo === 'trocar_swap'
                                                ? 'bg-sky-600 text-white'
                                                : 'bg-rose-600 text-white'
                                            }`}
                                          >
                                            {ativoTipo === 'permutar'
                                              ? '⇄ Permutar'
                                              : ativoTipo === 'trocar_swap'
                                              ? '⇄ Trocar p/ Swap'
                                              : '✕ Conflito'}
                                          </span>
                                        )}

                                        {slot ? (
                                          <div
                                            draggable={Boolean(isSpecialistSlot && contextoGeracao)}
                                            onDragStart={(e) => {
                                              if (!isSpecialistSlot || !contextoGeracao) {
                                                e.preventDefault();
                                                return;
                                              }
                                              e.dataTransfer.effectAllowed = 'move';
                                              e.dataTransfer.setData(
                                                'text/plain',
                                                `${previewClassId}:${d.id}:${ordem}`
                                              );
                                              startMoveCard('drag');
                                            }}
                                            onDragEnd={() => {
                                              setAulaEmMovimento((prev) =>
                                                prev?.mode === 'drag' ? null : prev
                                              );
                                              setHoveredDropTarget(null);
                                            }}
                                            className={`w-full space-y-0.5 rounded-lg p-1.5 transition-colors duration-75 ${
                                              isSpecialistSlot && contextoGeracao
                                                ? `bg-white/90 border border-indigo-200/80 shadow-2xs cursor-grab active:cursor-grabbing hover:border-indigo-400 ${
                                                    isSourceCell ? 'opacity-50' : ''
                                                  }`
                                                : ''
                                            }`}
                                          >
                                            <div className="flex items-center justify-center gap-1">
                                              {isSpecialistSlot && contextoGeracao && (
                                                <GripVertical className="w-3 h-3 text-indigo-400 shrink-0 print:hidden" />
                                              )}
                                              <div
                                                className={`font-bold truncate ${
                                                  isSpecialistSlot ? 'text-indigo-900' : 'text-slate-800'
                                                }`}
                                              >
                                                {slot.disciplinaNome || 'Aula'}
                                              </div>
                                            </div>
                                            <div className="text-[11px] text-slate-600 truncate max-w-[140px] mx-auto">
                                              {slot.teacherNome || 'Docente'}
                                            </div>
                                            {isSpecialistSlot && (
                                              <div className="flex items-center justify-center gap-1 pt-0.5">
                                                <span className="inline-block text-[10px] font-semibold bg-indigo-600 text-white px-1.5 py-0.2 rounded-full">
                                                  Especialista Regular
                                                </span>
                                                {contextoGeracao && (
                                                  <>
                                                    <button
                                                      type="button"
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        startMoveCard('click');
                                                      }}
                                                      className={`p-0.5 text-indigo-600 hover:bg-indigo-100 rounded print:hidden cursor-pointer ${
                                                        emMovimentoNestaTurma ? 'invisible pointer-events-none' : ''
                                                      }`}
                                                      title="Mover ou permutar aula por clique"
                                                    >
                                                      <Move className="w-3 h-3" />
                                                    </button>
                                                    <button
                                                      type="button"
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleEmpilharParaSwap(previewClassId, d.id, ordem);
                                                      }}
                                                      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100 rounded text-[9px] font-bold print:hidden cursor-pointer ${
                                                        emMovimentoNestaTurma ? 'invisible pointer-events-none' : ''
                                                      }`}
                                                      title="Enviar aula para a Área de Swap (liberar horário p/ trocas)"
                                                    >
                                                      <ArrowDownToLine className="w-2.5 h-2.5" />
                                                      <span>Swap</span>
                                                    </button>
                                                  </>
                                                )}
                                              </div>
                                            )}
                                          </div>
                                        ) : validacaoCell || validacaoSwapCell ? (
                                          <div
                                            className={`pointer-events-none w-full py-1 px-1.5 rounded-lg text-[10px] font-extrabold border border-dashed truncate ${
                                              ativoValido
                                                ? 'border-emerald-400 text-emerald-800 bg-emerald-100/70'
                                                : 'border-rose-300 text-rose-700 bg-rose-100/70'
                                            }`}
                                          >
                                            {ativoValido
                                              ? validacaoSwapCell
                                                ? '✓ Encaixar Swap'
                                                : '✓ Soltar aqui'
                                              : '✕ Bloqueado'}
                                          </div>
                                        ) : (
                                          <span className="text-slate-300">-</span>
                                        )}
                                      </div>
                                    </td>
                                  );
                                })}
                              </tr>
                              {ordem === intervaloAposOrdem && bellTurma?.intervalo && (
                                <tr className="bg-amber-50/70 border-y border-amber-200 text-amber-900 text-[11px] font-semibold">
                                  <td className="py-1.5 px-3 text-left font-bold bg-amber-100/70 border-r border-amber-200">
                                    ☕ Intervalo
                                  </td>
                                  {temSinoVariavelPorDia && bellPorDia ? (
                                    GRADE_DIAS_SEMANA.map((d) => {
                                      const bDia = bellPorDia[d.id];
                                      return (
                                        <td key={d.id} className="py-1.5 px-2 text-center border-l border-amber-200 text-[10px]">
                                          {bDia?.intervalo ? `${bDia.intervalo.inicio}–${bDia.intervalo.fim}` : bellTurma.intervalo.rotulo}
                                        </td>
                                      );
                                    })
                                  ) : (
                                    <td colSpan={5} className="py-1.5 px-3 text-center">
                                      {bellTurma.intervalo.rotulo}
                                    </td>
                                  )}
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Visualização: Aba por Especialista (grades separadas por turno na mesma folha + H.A. nas lacunas) */}
          {(previewTab === 'especialistas' || (previewTab === 'resumo' && modoImpressao === 'todos_especialistas')) && (() => {
            const renderBlocoEspecialista = (
              teacherIdAlvo: string,
              readOnlyPrint: boolean
            ) => {
              const espAlvo = especialistasDaEscola.find((e) => e.id === teacherIdAlvo);
              if (!espAlvo) return null;

              const folgasEsp = getDiasFolgaEspecialista(teacherIdAlvo);
              const folgaResumoEsp = formatarDiasFolgaResumo(
                especialistasConfig[teacherIdAlvo]?.diasDisponiveis ?? resolverDiasDisponiveisDocente({ id: teacherIdAlvo, val: espAlvo.teacher }, teachers),
                especialistasConfig[teacherIdAlvo]?.folgaDia
              );
              const slotsEsp = resultado.gradesPorEspecialistaLista?.[teacherIdAlvo] || [];
              const ocupacoesExternasVisiveis = respeitarOutrasEscolas
                ? espAlvo.ocupacoesExternas || []
                : [];
              const haValidasEsp = sanitizarHAListaEspecialista(
                teacherIdAlvo,
                haEspecialistasMap[teacherIdAlvo],
                resultado
              );
              const metaHAEsp = espAlvo.teacher.metaHA || 0;

              const turnosSet = new Set<'manha' | 'tarde' | 'noite'>();
              slotsEsp.forEach((s) => {
                if (s.turno === 'manha' || s.turno === 'tarde' || s.turno === 'noite') {
                  turnosSet.add(s.turno);
                }
              });
              ocupacoesExternasVisiveis.forEach((ext) => {
                if (ext.turno === 'manha' || ext.turno === 'tarde' || ext.turno === 'noite') {
                  turnosSet.add(ext.turno);
                }
              });
              haValidasEsp.forEach((hk) => {
                if (hk.startsWith('manha_')) turnosSet.add('manha');
                else if (hk.startsWith('tarde_')) turnosSet.add('tarde');
                else if (hk.startsWith('noite_')) turnosSet.add('noite');
              });

              if (turnosSet.size === 0) {
                turnosSet.add(selectedTurno === 'tarde' ? 'tarde' : selectedTurno === 'noite' ? 'noite' : 'manha');
              }

              const ordemTurnos: ('manha' | 'tarde' | 'noite')[] = ['manha', 'tarde', 'noite'];
              const turnosPresentes = ordemTurnos.filter((t) => turnosSet.has(t));
              const turnosExibidos =
                readOnlyPrint || previewEspTurno === 'todos'
                  ? turnosPresentes
                  : turnosPresentes.includes(previewEspTurno)
                  ? [previewEspTurno]
                  : turnosPresentes;

              const renderTabelaTurnoEspecialista = (turnoKey: 'manha' | 'tarde' | 'noite') => {
                const isManha = turnoKey === 'manha';
                const isTarde = turnoKey === 'tarde';
                const tituloTurno = isManha
                  ? 'Turno Matutino (Manhã)'
                  : isTarde
                  ? 'Turno Vespertino (Tarde)'
                  : 'Turno Noturno (Noite)';
                const horarioTurno = isManha ? '07:00 às 12:00' : isTarde ? '12:30 às 17:00' : '19:00 às 22:30';
                const badgeTurno = isManha ? '☀️ Manhã' : isTarde ? '🌤️ Tarde' : '🌙 Noite';
                const headerColors = isManha
                  ? 'bg-amber-50 border-amber-200 text-amber-950'
                  : isTarde
                  ? 'bg-indigo-50 border-indigo-200 text-indigo-950'
                  : 'bg-slate-100 border-slate-300 text-slate-900';

                const sinoAtivo = getSinoConfigAtiva();
                const sinoEsc = sinoEfetivo(sinoAtivo, selectedSchoolId);
                const aulasTurnoLabel: Record<number, { faixa: string; detalhe?: string }> = {};
                if (isManha || isTarde) {
                  const rots = rotulosDasAulas(sinoAtivo, selectedSchoolId, isManha ? 'manha' : 'tarde');
                  rots.forEach((r) => {
                    aulasTurnoLabel[r.ordem] = {
                      faixa: r.linhas[0] || '',
                      detalhe: r.linhas.length > 1 ? r.linhas.slice(1).join(' | ') : undefined
                    };
                  });
                } else {
                  Object.assign(aulasTurnoLabel, {
                    1: { faixa: '19:00 – 19:45' },
                    2: { faixa: '19:45 – 20:30' },
                    3: { faixa: '20:30 – 21:15' },
                    4: { faixa: '21:30 – 22:15' },
                    5: { faixa: '22:15 – 23:00' }
                  });
                }

                const slotsTurno = slotsEsp.filter((s) => s.turno === turnoKey);
                const externosTurno = ocupacoesExternasVisiveis.filter((ext) => ext.turno === turnoKey);

                let haTurnoCount = 0;
                [1, 2, 3, 4, 5].forEach((ord) => {
                  GRADE_DIAS_SEMANA.forEach((dd) => {
                    if (folgasEsp.includes(dd.id)) return;
                    const ocupado =
                      slotsTurno.some((s) => s.dia === dd.id && s.ordem === ord) ||
                      externosTurno.some((ex) => ex.dia === dd.id && ex.ordem === ord);
                    if (!ocupado && isHAEmSlot(haEspecialistasMap[teacherIdAlvo], turnoKey, dd.id, ord)) {
                      haTurnoCount++;
                    }
                  });
                });

                const emMovimentoNesteDocente = Boolean(
                  !readOnlyPrint &&
                    aulaEmMovimento &&
                    aulaEmMovimento.teacherId === teacherIdAlvo &&
                    contextoGeracao
                );
                const isOutroTurnoBloqueado = Boolean(
                  emMovimentoNesteDocente && aulaEmMovimento && aulaEmMovimento.turno !== turnoKey
                );
                const emEncaixeSwapNesteDocente = Boolean(
                  !readOnlyPrint &&
                    !emMovimentoNesteDocente &&
                    activeSwapItem &&
                    activeSwapItem.slot.teacherId === teacherIdAlvo &&
                    contextoGeracao
                );
                const isOutroTurnoSwapBloqueado = Boolean(
                  emEncaixeSwapNesteDocente && activeSwapItem && activeSwapItem.turno !== turnoKey
                );
                const turnoBloqueadoAtivo = isOutroTurnoBloqueado || isOutroTurnoSwapBloqueado;

                return (
                  <div
                    key={turnoKey}
                    className={`border rounded-xl overflow-hidden shadow-xs break-inside-avoid print:rounded-lg transition-opacity duration-75 ${
                      turnoBloqueadoAtivo
                        ? 'border-rose-200 opacity-60'
                        : 'border-slate-200'
                    }`}
                  >
                    {/* Cabeçalho do Turno */}
                    <div className={`px-3.5 py-2 border-b flex items-center justify-between gap-2 ${headerColors}`}>
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-extrabold bg-white/90 border border-current/20 shrink-0">
                          {badgeTurno}
                        </span>
                        <h4 className="text-xs sm:text-sm font-bold truncate">{tituloTurno}</h4>
                        <span className="text-[11px] opacity-80 hidden sm:inline print:inline shrink-0">• {horarioTurno}</span>
                      </div>
                      <div className="text-[11px] font-semibold flex items-center gap-2 shrink-0">
                        {turnoBloqueadoAtivo ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-300 font-bold text-[10px]">
                            <Lock className="w-3 h-3" />
                            Turno bloqueado (use o mesmo turno)
                          </span>
                        ) : (
                          <>
                            <span>{slotsTurno.length} aula(s) sugerida(s)</span>
                            {haTurnoCount > 0 && (
                              <span className="px-1.5 py-0.5 rounded bg-amber-100/90 text-amber-900 border border-amber-300 font-bold text-[10px]">
                                ⭐ {haTurnoCount} H.A.
                              </span>
                            )}
                            {externosTurno.length > 0 && (
                              <span>• {externosTurno.length} oficial(is) outra escola</span>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    <table
                      className="w-full table-fixed text-center text-xs"
                      onDragLeave={(e) => {
                        if (!readOnlyPrint && !e.currentTarget.contains(e.relatedTarget as Node)) {
                          setHoveredDropTarget(null);
                        }
                      }}
                    >
                      <thead className="bg-teal-800 text-white font-bold text-[11px] uppercase tracking-wider">
                        <tr>
                          <th className="py-2 px-2.5 w-28 text-left bg-teal-900 print:py-1">Aula / Horário</th>
                          {GRADE_DIAS_SEMANA.map((d) => (
                            <th key={d.id} className="py-2 px-2 border-l border-teal-700 print:py-1">
                              {d.nome}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {[1, 2, 3, 4, 5].map((ordem) => (
                          <React.Fragment key={ordem}>
                            <tr className="hover:bg-slate-50/50">
                              <td className="py-1.5 px-2.5 font-bold text-[11px] text-slate-700 text-left bg-slate-50/80 border-r border-slate-200 print:py-1">
                                <div>{ordem}ª Aula</div>
                                <div className="text-[10px] font-normal text-slate-500">
                                  {aulasTurnoLabel[ordem]?.faixa}
                                </div>
                                {aulasTurnoLabel[ordem]?.detalhe && (
                                  <div className="text-[9px] font-medium text-indigo-600 leading-tight">
                                    {aulasTurnoLabel[ordem].detalhe}
                                  </div>
                                )}
                              </td>
                              {GRADE_DIAS_SEMANA.map((d) => {
                                const isFolga = folgasEsp.includes(d.id);
                                const slotsCelula = slotsTurno.filter(
                                  (s) => s.dia === d.id && s.ordem === ordem
                                );
                                const externosCelula = externosTurno.filter(
                                  (ext) => ext.dia === d.id && ext.ordem === ordem
                                );

                                const temAlgo = slotsCelula.length > 0 || externosCelula.length > 0;
                                const isHASlot =
                                  !isFolga &&
                                  !temAlgo &&
                                  isHAEmSlot(haEspecialistasMap[teacherIdAlvo], turnoKey, d.id, ordem);

                                const isSourceCellEsp = Boolean(
                                  emMovimentoNesteDocente &&
                                    aulaEmMovimento &&
                                    aulaEmMovimento.turno === turnoKey &&
                                    aulaEmMovimento.fromDia === d.id &&
                                    aulaEmMovimento.fromOrdem === ordem
                                );

                                const targetClassIdEsp =
                                  slotsCelula.length === 1 ? slotsCelula[0].classId : undefined;

                                const validacaoCellEsp: ResultadoValidacaoMovimento | null = (() => {
                                  if (!emMovimentoNesteDocente || !aulaEmMovimento || !contextoGeracao || isSourceCellEsp) {
                                    return null;
                                  }
                                  return validarMovimentoAulaSugerida(
                                    resultado.gradesPorTurma,
                                    {
                                      classId: aulaEmMovimento.classId,
                                      fromDia: aulaEmMovimento.fromDia,
                                      fromOrdem: aulaEmMovimento.fromOrdem
                                    },
                                    {
                                      toDia: d.id,
                                      toOrdem: ordem,
                                      turnoDestino: turnoKey,
                                      targetClassId: targetClassIdEsp
                                    },
                                    contextoGeracao
                                  );
                                })();

                                const validacaoSwapCellEsp: ResultadoValidacaoSwap | null = (() => {
                                  if (!emEncaixeSwapNesteDocente || !activeSwapItem || !contextoGeracao) {
                                    return null;
                                  }
                                  return validarEncaixeDeSwap(
                                    resultado.gradesPorTurma,
                                    activeSwapItem,
                                    d.id,
                                    ordem,
                                    contextoGeracao,
                                    turnoKey
                                  );
                                })();

                                const isHoveredEsp =
                                  !readOnlyPrint &&
                                  hoveredDropTarget?.dia === d.id &&
                                  hoveredDropTarget?.ordem === ordem &&
                                  hoveredDropTarget?.turno === turnoKey;

                                const ativoTipoEsp = validacaoCellEsp?.tipo || validacaoSwapCellEsp?.tipo;
                                const ativoValidoEsp = validacaoCellEsp
                                  ? validacaoCellEsp.valido
                                  : validacaoSwapCellEsp?.valido;

                                const tdEspStateClass = isSourceCellEsp
                                  ? 'bg-teal-100/80 ring-2 ring-inset ring-teal-500'
                                  : turnoBloqueadoAtivo
                                  ? 'bg-slate-100/70 text-slate-400 cursor-not-allowed'
                                  : ativoTipoEsp === 'mover'
                                  ? `bg-emerald-50/90 ${
                                      isHoveredEsp
                                        ? 'ring-2 ring-inset ring-emerald-500 bg-emerald-100/80'
                                        : 'ring-1 ring-inset ring-emerald-300'
                                    }`
                                  : ativoTipoEsp === 'permutar' ||
                                    ativoTipoEsp === 'permutar_turmas' ||
                                    ativoTipoEsp === 'trocar_swap'
                                  ? `bg-sky-50/90 ${
                                      isHoveredEsp
                                        ? 'ring-2 ring-inset ring-sky-500 bg-sky-100/80'
                                        : 'ring-1 ring-inset ring-sky-300'
                                    }`
                                  : ativoTipoEsp === 'bloqueado'
                                  ? `bg-rose-50/80 ${
                                      isHoveredEsp
                                        ? 'ring-2 ring-inset ring-rose-500 bg-rose-100/80'
                                        : 'ring-1 ring-inset ring-rose-200'
                                    }`
                                  : isFolga
                                  ? 'bg-amber-50/60 text-amber-800 font-semibold'
                                  : slotsCelula.length > 0
                                  ? 'bg-teal-50/60 border-teal-200'
                                  : externosCelula.length > 0
                                  ? 'bg-amber-50/40 border-amber-200'
                                  : isHASlot
                                  ? 'bg-amber-50/85 border-amber-200'
                                  : 'text-slate-300';

                                return (
                                  <td
                                    key={d.id}
                                    title={
                                      readOnlyPrint
                                        ? undefined
                                        : turnoBloqueadoAtivo
                                        ? 'Bloqueado: não é permitido movimentar aulas para outro turno.'
                                        : validacaoCellEsp?.motivo ||
                                          validacaoCellEsp?.detalhes ||
                                          validacaoSwapCellEsp?.motivo ||
                                          validacaoSwapCellEsp?.detalhes
                                    }
                                    onDragOver={(e) => {
                                      if (
                                        readOnlyPrint ||
                                        (!emMovimentoNesteDocente && !emEncaixeSwapNesteDocente) ||
                                        turnoBloqueadoAtivo
                                      ) {
                                        return;
                                      }
                                      e.preventDefault();
                                      e.dataTransfer.dropEffect = ativoValidoEsp ? 'move' : 'none';
                                      if (
                                        hoveredDropTarget?.dia !== d.id ||
                                        hoveredDropTarget?.ordem !== ordem ||
                                        hoveredDropTarget?.turno !== turnoKey
                                      ) {
                                        setHoveredDropTarget({ dia: d.id, ordem, turno: turnoKey });
                                      }
                                    }}
                                    onDrop={(e) => {
                                      if (readOnlyPrint) return;
                                      e.preventDefault();
                                      const payload = e.dataTransfer.getData('text/plain');
                                      if (payload.startsWith('swap:')) {
                                        handleExecutarEncaixeSwap(d.id, ordem, turnoKey, payload.slice(5));
                                        return;
                                      }
                                      if (emEncaixeSwapNesteDocente && activeSwapItem) {
                                        handleExecutarEncaixeSwap(d.id, ordem, turnoKey, activeSwapItem.id);
                                        return;
                                      }
                                      if (!emMovimentoNesteDocente || !aulaEmMovimento) return;
                                      handleExecutarMovimento(
                                        aulaEmMovimento.classId,
                                        aulaEmMovimento.fromDia,
                                        aulaEmMovimento.fromOrdem,
                                        d.id,
                                        ordem,
                                        turnoKey,
                                        aulaEmMovimento.turno,
                                        targetClassIdEsp
                                      );
                                    }}
                                    onClick={() => {
                                      if (readOnlyPrint || turnoBloqueadoAtivo) return;
                                      if (emMovimentoNesteDocente && aulaEmMovimento?.mode === 'click') {
                                        handleExecutarMovimento(
                                          aulaEmMovimento.classId,
                                          aulaEmMovimento.fromDia,
                                          aulaEmMovimento.fromOrdem,
                                          d.id,
                                          ordem,
                                          turnoKey,
                                          aulaEmMovimento.turno,
                                          targetClassIdEsp
                                        );
                                      } else if (emEncaixeSwapNesteDocente && activeSwapItem) {
                                        handleExecutarEncaixeSwap(d.id, ordem, turnoKey, activeSwapItem.id);
                                      }
                                    }}
                                    className={`py-1.5 px-2 border-l border-slate-100 text-[11px] print:py-1 transition-colors duration-75 ${tdEspStateClass} ${
                                      !readOnlyPrint &&
                                      ((emMovimentoNesteDocente && aulaEmMovimento?.mode === 'click') ||
                                        emEncaixeSwapNesteDocente) &&
                                      !turnoBloqueadoAtivo
                                        ? 'cursor-pointer'
                                        : ''
                                    }`}
                                  >
                                    <div className="relative min-h-[44px] flex flex-col justify-center">
                                      {(validacaoCellEsp || validacaoSwapCellEsp) &&
                                        !turnoBloqueadoAtivo &&
                                        (isFolga || temAlgo) && (
                                          <span
                                            className={`pointer-events-none absolute -top-0.5 right-0 z-10 text-[9px] font-extrabold px-1 py-0.5 rounded shadow-xs ${
                                              ativoValidoEsp
                                                ? 'bg-sky-600 text-white'
                                                : 'bg-rose-600 text-white'
                                            }`}
                                          >
                                            {isFolga
                                              ? '✕ Folga'
                                              : validacaoCellEsp?.tipo === 'permutar_turmas'
                                              ? `⇄ Trocar ${validacaoCellEsp.turmaDestinoNome || 'Turma'}`
                                              : validacaoCellEsp?.tipo === 'permutar'
                                              ? `⇄ ${validacaoCellEsp.disciplinaDestinoNome || 'Permutar'}`
                                              : validacaoSwapCellEsp?.tipo === 'trocar_swap'
                                              ? '⇄ Trocar p/ Swap'
                                              : '✕ Conflito'}
                                          </span>
                                        )}

                                      {isFolga ? (
                                        <div className="flex items-center justify-center gap-1">
                                          <Coffee className="w-3 h-3 text-amber-600" />
                                          <span>Folga Livre</span>
                                        </div>
                                      ) : temAlgo ? (
                                        <div className="space-y-1">
                                          {slotsCelula.map((slot, sIdx) => {
                                            const turmaCurta = slot.className.replace(
                                              /\s*-\s*(Manhã|Tarde|Matutino|Vespertino|Noturno)$/i,
                                              ''
                                            );
                                            const startMoveEsp = (mode: 'drag' | 'click') => {
                                              if (readOnlyPrint || !contextoGeracao) return;
                                              setSwapEmEncaixeId(null);
                                              setAulaEmMovimento({
                                                classId: slot.classId,
                                                fromDia: slot.dia,
                                                fromOrdem: slot.ordem,
                                                teacherId: slot.teacherId,
                                                teacherName: slot.teacherName,
                                                disciplinaNome: slot.disciplinaNome,
                                                turmaLabel: turmaCurta,
                                                turno: slot.turno,
                                                mode
                                              });
                                            };

                                            return (
                                              <div
                                                key={`${slot.classId}-${sIdx}`}
                                                draggable={Boolean(!readOnlyPrint && contextoGeracao)}
                                                onDragStart={(e) => {
                                                  if (readOnlyPrint || !contextoGeracao) {
                                                    e.preventDefault();
                                                    return;
                                                  }
                                                  e.dataTransfer.effectAllowed = 'move';
                                                  e.dataTransfer.setData(
                                                    'text/plain',
                                                    `${slot.classId}:${slot.dia}:${slot.ordem}`
                                                  );
                                                  startMoveEsp('drag');
                                                }}
                                                onDragEnd={() => {
                                                  if (readOnlyPrint) return;
                                                  setAulaEmMovimento((prev) =>
                                                    prev?.mode === 'drag' ? null : prev
                                                  );
                                                  setHoveredDropTarget(null);
                                                }}
                                                className={`bg-white/95 rounded-md px-2 py-1 border border-teal-200 shadow-2xs transition-colors duration-75 ${
                                                  !readOnlyPrint && contextoGeracao
                                                    ? 'cursor-grab active:cursor-grabbing hover:border-teal-500'
                                                    : ''
                                                } ${isSourceCellEsp ? 'opacity-50' : ''}`}
                                              >
                                                <div className="flex items-center justify-center gap-1">
                                                  {!readOnlyPrint && contextoGeracao && (
                                                    <GripVertical className="w-3 h-3 text-teal-400 shrink-0 print:hidden" />
                                                  )}
                                                  <span className="font-bold text-teal-950 truncate">
                                                    {turmaCurta}
                                                  </span>
                                                  {!readOnlyPrint && contextoGeracao && (
                                                    <>
                                                      <button
                                                        type="button"
                                                        onClick={(e) => {
                                                          e.stopPropagation();
                                                          startMoveEsp('click');
                                                        }}
                                                        className={`p-0.5 text-teal-600 hover:bg-teal-100 rounded print:hidden cursor-pointer shrink-0 ${
                                                          emMovimentoNesteDocente ? 'invisible pointer-events-none' : ''
                                                        }`}
                                                        title="Mover, permutar ou trocar entre turmas por clique"
                                                      >
                                                        <Move className="w-2.5 h-2.5" />
                                                      </button>
                                                      <button
                                                        type="button"
                                                        onClick={(e) => {
                                                          e.stopPropagation();
                                                          handleEmpilharParaSwap(slot.classId, slot.dia, slot.ordem);
                                                        }}
                                                        className={`inline-flex items-center gap-0.5 px-1 py-0.5 bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100 rounded text-[9px] font-bold print:hidden cursor-pointer shrink-0 ${
                                                          emMovimentoNesteDocente ? 'invisible pointer-events-none' : ''
                                                        }`}
                                                        title="Enviar esta aula para a Área de Swap (empilhar)"
                                                      >
                                                        <ArrowDownToLine className="w-2.5 h-2.5" />
                                                        <span>Swap</span>
                                                      </button>
                                                    </>
                                                  )}
                                                </div>
                                                <div className="text-[10px] text-teal-700">
                                                  {slot.inicioStr} – {slot.fimStr}
                                                </div>
                                              </div>
                                            );
                                          })}
                                          {externosCelula.map((ext, eIdx) => (
                                            <div
                                              key={`ext-${ext.classId}-${eIdx}`}
                                              className="bg-amber-50 rounded-md px-2 py-1 border border-amber-200 text-amber-900"
                                              title={`Aula já oficializada em ${ext.schoolName} (somente leitura)`}
                                            >
                                              <div className="font-bold truncate text-[10px]">
                                                🏫 {ext.schoolName}
                                              </div>
                                              <div className="text-[10px] text-amber-800 truncate">
                                                {ext.className.replace(/\s*\(.*?\)/g, '')} • Oficial
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      ) : (validacaoCellEsp || validacaoSwapCellEsp) && !turnoBloqueadoAtivo ? (
                                        <div
                                          className={`pointer-events-none py-1 px-1.5 rounded text-[10px] font-extrabold border border-dashed truncate ${
                                            ativoTipoEsp === 'mover'
                                              ? 'border-emerald-400 bg-emerald-100/70 text-emerald-800'
                                              : ativoTipoEsp === 'permutar' ||
                                                ativoTipoEsp === 'permutar_turmas' ||
                                                ativoTipoEsp === 'trocar_swap'
                                              ? 'border-sky-400 bg-sky-100/70 text-sky-800'
                                              : 'border-rose-300 bg-rose-100/70 text-rose-700'
                                          }`}
                                        >
                                          {ativoTipoEsp === 'mover' ? (
                                            validacaoSwapCellEsp
                                              ? `✓ Encaixar (${activeSwapItem?.turmaLabel})`
                                              : `✓ Soltar (${aulaEmMovimento?.turmaLabel})`
                                          ) : ativoTipoEsp === 'permutar' ? (
                                            <span className="inline-flex items-center gap-0.5 truncate">
                                              <ArrowLeftRight className="w-2.5 h-2.5 shrink-0" />
                                              {validacaoCellEsp?.disciplinaDestinoNome || aulaEmMovimento?.turmaLabel}
                                            </span>
                                          ) : ativoTipoEsp === 'trocar_swap' ? (
                                            `⇄ Encaixar Swap`
                                          ) : (
                                            '✕ Conflito'
                                          )}
                                        </div>
                                      ) : isHASlot ? (
                                        readOnlyPrint || turnoBloqueadoAtivo ? (
                                          <div className="w-full min-h-[40px] rounded-md px-1.5 py-1 bg-gradient-to-br from-amber-50 to-amber-100/90 border border-amber-300 text-amber-950 flex flex-col items-center justify-center">
                                            <div className="flex items-center justify-center gap-1 font-extrabold text-[11px] text-amber-900">
                                              <Award className="w-3 h-3 text-amber-600 shrink-0" />
                                              <span>⭐ H.A.</span>
                                            </div>
                                            <div className="text-[10px] font-medium text-amber-700">
                                              Planejamento
                                            </div>
                                          </div>
                                        ) : (
                                          <div
                                            role="button"
                                            tabIndex={0}
                                            onClick={(e) => {
                                              if (
                                                (emMovimentoNesteDocente && aulaEmMovimento?.mode === 'click') ||
                                                emEncaixeSwapNesteDocente
                                              ) {
                                                return;
                                              }
                                              e.stopPropagation();
                                              handleToggleHAEspecialista(teacherIdAlvo, turnoKey, d.id, ordem);
                                            }}
                                            onKeyDown={(e) => {
                                              if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                handleToggleHAEspecialista(teacherIdAlvo, turnoKey, d.id, ordem);
                                              }
                                            }}
                                            className="w-full min-h-[40px] rounded-md px-1.5 py-1 bg-gradient-to-br from-amber-50 to-amber-100/90 border border-amber-300 hover:border-rose-300 hover:from-amber-100 hover:to-rose-50 text-amber-950 shadow-2xs transition-colors duration-75 cursor-pointer group flex flex-col items-center justify-center"
                                            title="H.A. inserida nesta lacuna. Clique para remover."
                                          >
                                            <div className="flex items-center justify-center gap-1 font-extrabold text-[11px] text-amber-900">
                                              <Award className="w-3 h-3 text-amber-600 shrink-0" />
                                              <span>⭐ H.A.</span>
                                            </div>
                                            <div className="text-[10px] font-medium text-amber-700 group-hover:text-rose-700 truncate max-w-full">
                                              <span className="group-hover:hidden print:inline">Planejamento</span>
                                              <span className="hidden group-hover:inline print:hidden">Remover H.A.</span>
                                            </div>
                                          </div>
                                        )
                                      ) : readOnlyPrint || turnoBloqueadoAtivo ? (
                                        <span className="text-slate-300">-</span>
                                      ) : (
                                        <div
                                          role="button"
                                          tabIndex={0}
                                          onClick={(e) => {
                                            if (
                                              (emMovimentoNesteDocente && aulaEmMovimento?.mode === 'click') ||
                                              emEncaixeSwapNesteDocente
                                            ) {
                                              return;
                                            }
                                            e.stopPropagation();
                                            handleToggleHAEspecialista(teacherIdAlvo, turnoKey, d.id, ordem);
                                          }}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                              e.preventDefault();
                                              handleToggleHAEspecialista(teacherIdAlvo, turnoKey, d.id, ordem);
                                            }
                                          }}
                                          className="w-full min-h-[40px] rounded-md border border-dashed border-transparent hover:border-amber-300 hover:bg-amber-50/70 text-slate-300 hover:text-amber-800 transition-colors duration-75 cursor-pointer group flex items-center justify-center print:border-0"
                                          title={`Inserir H.A. na ${ordem}ª aula de ${GRADE_DIAS_SEMANA.find((x) => x.id === d.id)?.nome}`}
                                        >
                                          <span className="group-hover:hidden print:inline">-</span>
                                          <span className="hidden group-hover:inline-flex items-center gap-1 text-[10px] font-bold text-amber-800 print:hidden">
                                            <Plus className="w-3 h-3" />
                                            H.A.
                                          </span>
                                        </div>
                                      )}
                                    </div>
                                  </td>
                                );
                              })}
                            </tr>
                            {ordem === 3 && (
                              <tr className="bg-amber-50/60 border-y border-amber-200 text-amber-900 text-[10px] font-semibold">
                                <td className="py-1 px-2.5 text-left font-bold bg-amber-100/70 border-r border-amber-200">
                                  ☕ Intervalo
                                </td>
                                <td colSpan={5} className="py-1 px-2 text-center">
                                  {isManha
                                    ? `${intervalosMatutino(sinoAtivo, selectedSchoolId)
                                        .map((iv) => `${iv.nome}: ${iv.intervalo.inicio}–${iv.intervalo.fim}`)
                                        .join(' • ')} (deslocamento entre escolas)`
                                    : isTarde
                                    ? `Recreio Vespertino: ${sinoEsc.vespertino.intervalo.inicio} às ${sinoEsc.vespertino.intervalo.fim} (deslocamento entre escolas)`
                                    : 'Intervalo Noturno: 21:15 às 21:30'}
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              };

              return (
                <>
                  {/* Cabeçalho oficial individual exibido apenas na impressão */}
                  <div className="hidden print:flex items-center justify-between border-b-2 border-teal-800 pb-2 mb-3">
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-wider text-teal-800">
                        {escolaAtual?.name} • Ano Letivo {planejamentoAno}
                      </div>
                      <h3 className="text-lg font-black text-slate-900">
                        {espAlvo.teacher.name} — {espAlvo.teacher.subject || 'Especialista'}
                      </h3>
                    </div>
                    <div className="text-right text-xs text-slate-700 space-y-0.5">
                      <div>
                        Folga:{' '}
                        <strong className="text-amber-800">
                          {folgaResumoEsp}
                        </strong>
                      </div>
                      <div>
                        Aulas na escola: <strong>{slotsEsp.length}</strong> • ⭐ H.A.:{' '}
                        <strong>
                          {haValidasEsp.length}
                          {metaHAEsp > 0 ? ` / ${metaHAEsp}` : ''}
                        </strong>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4 print:space-y-3">
                    {turnosExibidos.map((tKey) => renderTabelaTurnoEspecialista(tKey))}
                  </div>

                  <div className="hidden print:flex items-center justify-between pt-3 mt-3 border-t border-slate-300 text-[10px] text-slate-500">
                    <span>
                      Diário de Classe Digital • {espAlvo.teacher.name} • {formatarEtiquetaVersao(rascunhoCorrespondenteAtual).versaoInfo}
                    </span>
                    <span>Ciência do(a) Docente: _______________________________________</span>
                  </div>
                </>
              );
            };

            const espAtivo = especialistasDaEscola.find((e) => e.id === previewTeacherId);
            const folgaResumoPreview = previewTeacherId
              ? formatarDiasFolgaResumo(
                  especialistasConfig[previewTeacherId]?.diasDisponiveis ?? (espAtivo ? resolverDiasDisponiveisDocente({ id: previewTeacherId, val: espAtivo.teacher }, teachers) : undefined),
                  especialistasConfig[previewTeacherId]?.folgaDia
                )
              : 'Sem folga fixa';
            const ocupacoesExternasVisiveis = respeitarOutrasEscolas
              ? espAtivo?.ocupacoesExternas || []
              : [];
            const haValidasPreview = previewTeacherId
              ? sanitizarHAListaEspecialista(previewTeacherId, haEspecialistasMap[previewTeacherId], resultado)
              : [];
            const metaHAEsp = espAtivo?.teacher.metaHA || 0;

            const turnosSet = new Set<'manha' | 'tarde' | 'noite'>();
            slotsDoEspecialistaPreview.forEach((s) => {
              if (s.turno === 'manha' || s.turno === 'tarde' || s.turno === 'noite') turnosSet.add(s.turno);
            });
            ocupacoesExternasVisiveis.forEach((ext) => {
              if (ext.turno === 'manha' || ext.turno === 'tarde' || ext.turno === 'noite') turnosSet.add(ext.turno);
            });
            haValidasPreview.forEach((hk) => {
              if (hk.startsWith('manha_')) turnosSet.add('manha');
              else if (hk.startsWith('tarde_')) turnosSet.add('tarde');
              else if (hk.startsWith('noite_')) turnosSet.add('noite');
            });
            if (turnosSet.size === 0) {
              turnosSet.add(selectedTurno === 'tarde' ? 'tarde' : selectedTurno === 'noite' ? 'noite' : 'manha');
            }
            const ordemTurnos: ('manha' | 'tarde' | 'noite')[] = ['manha', 'tarde', 'noite'];
            const turnosPresentes = ordemTurnos.filter((t) => turnosSet.has(t));

            const especialistasParaImprimirTodos = especialistasDaEscola
              .filter((e) => e.turmasRegulares.length > 0)
              .sort((a, b) => a.teacher.name.localeCompare(b.teacher.name));

            return (
              <>
                {previewTab === 'especialistas' && (
                  <div
                    className={`bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-4 print:border-0 print:shadow-none print:p-0 ${
                      modoImpressao === 'todos_especialistas' ? 'print:hidden' : ''
                    }`}
                  >
                    <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 pb-3 border-b border-slate-100 print:hidden">
                      <div className="flex items-center gap-3 flex-wrap">
                        <Users className="w-5 h-5 text-teal-600" />
                        <label className="text-sm font-bold text-slate-800">Especialista:</label>
                        <select
                          value={previewTeacherId}
                          onChange={(e) => {
                            setPreviewTeacherId(e.target.value);
                            setAulaEmMovimento(null);
                            setHoveredDropTarget(null);
                          }}
                          className="px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-sm font-bold text-slate-800 focus:ring-2 focus:ring-teal-500"
                        >
                          {especialistasDaEscola
                            .filter((e) => e.turmasRegulares.length > 0)
                            .map((e) => (
                              <option key={e.id} value={e.id}>
                                {e.teacher.name} ({e.teacher.subject || 'Especialista'})
                              </option>
                            ))}
                        </select>

                        {previewTeacherId && (
                          <div className="flex items-center gap-2 flex-wrap text-xs text-slate-600 font-medium">
                            <span>
                              Folga:{' '}
                              <strong className="text-amber-700">
                                {folgaResumoPreview}
                              </strong>
                            </span>

                            <span
                              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${
                                metaHAEsp > 0 && haValidasPreview.length >= metaHAEsp
                                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                  : haValidasPreview.length > 0
                                  ? 'bg-amber-50 text-amber-900 border-amber-300'
                                  : 'bg-slate-100 text-slate-600 border-slate-200'
                              }`}
                              title="Horas-Atividade inseridas nas lacunas livres deste especialista"
                            >
                              <Award className="w-3 h-3 text-amber-600" />
                              H.A.: {haValidasPreview.length}
                              {metaHAEsp > 0 ? ` / ${metaHAEsp}` : ''}
                            </span>

                            {haValidasPreview.length > 0 && (
                              <button
                                type="button"
                                onClick={() => handleLimparHAEspecialista(previewTeacherId)}
                                className="text-[11px] font-bold text-rose-600 hover:text-rose-800 hover:underline cursor-pointer print:hidden"
                                title="Limpar todas as H.A. deste especialista"
                              >
                                Limpar H.A.
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2 flex-wrap">
                        {previewTeacherId && (
                          <div className="flex items-center gap-1 px-2 py-1 bg-slate-50 border border-slate-200 rounded-xl print:hidden">
                            <span className="text-[10px] font-bold text-slate-500 uppercase mr-1">
                              Este docente:
                            </span>
                            <button
                              type="button"
                              onClick={() => handleExportarPDF(previewTeacherId)}
                              className="px-2 py-1 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                              title="Baixar PDF individual apenas deste especialista"
                            >
                              <FileText className="w-3 h-3" />
                              PDF
                            </button>
                            <button
                              type="button"
                              onClick={() => handleExportarExcel(previewTeacherId)}
                              className="px-2 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                              title="Baixar Excel individual apenas deste especialista"
                            >
                              <FileSpreadsheet className="w-3 h-3" />
                              Excel
                            </button>
                            <button
                              type="button"
                              onClick={() => handleImprimir('atual')}
                              className="px-2 py-1 rounded-lg bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                              title="Imprimir apenas a folha deste especialista"
                            >
                              <Printer className="w-3 h-3" />
                              Imprimir
                            </button>
                          </div>
                        )}

                        <span className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-lg font-medium print:hidden">
                          💡 Clique nas lacunas livres (<strong>-</strong>) para inserir ou remover <strong>⭐ H.A.</strong>
                        </span>

                        {/* Filtro visual de folha por turno */}
                        {turnosPresentes.length > 1 && (
                          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl text-xs font-bold print:hidden">
                            <button
                              type="button"
                              onClick={() => setPreviewEspTurno('todos')}
                              className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                                previewEspTurno === 'todos'
                                  ? 'bg-white text-teal-700 shadow-2xs'
                                  : 'text-slate-600 hover:text-slate-900'
                              }`}
                            >
                              Todos na mesma folha ({turnosPresentes.length})
                            </button>
                            {turnosPresentes.map((tKey) => (
                              <button
                                key={tKey}
                                type="button"
                                onClick={() => setPreviewEspTurno(tKey)}
                                className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                                  previewEspTurno === tKey
                                    ? 'bg-white text-teal-700 shadow-2xs'
                                    : 'text-slate-600 hover:text-slate-900'
                                }`}
                              >
                                {tKey === 'manha' ? '☀️ Manhã' : tKey === 'tarde' ? '🌤️ Tarde' : '🌙 Noite'}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {previewTeacherId && renderBlocoEspecialista(previewTeacherId, false)}
                  </div>
                )}

                {/* Folhas individuais de todos os especialistas para impressão direta (1 folha por especialista) */}
                {modoImpressao === 'todos_especialistas' && (
                  <div className="hidden print:block">
                    {especialistasParaImprimirTodos.map((e) => (
                      <div key={e.id} className="break-after-page last:break-after-auto py-1">
                        {renderBlocoEspecialista(e.id, true)}
                      </div>
                    ))}
                  </div>
                )}
              </>
            );
          })()}

          {/* Visualização: Aba de Resumo e Seleção de Aplicação */}
          {previewTab === 'resumo' && (() => {
            const especialistasResumo = especialistasDaEscola.filter((e) => e.turmasRegulares.length > 0);
            const resumoHA = especialistasResumo.map((e) => {
              const lista = sanitizarHAListaEspecialista(e.id, haEspecialistasMap[e.id], resultado);
              return {
                esp: e,
                haLista: lista,
                metaHA: e.teacher.metaHA || 0
              };
            });
            const totalHAsResumo = resumoHA.reduce((acc, item) => acc + item.haLista.length, 0);

            return (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-6 print:hidden">
                {swapItems.length > 0 && (
                  <div className="p-4 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-start gap-2.5 text-xs">
                      <Layers className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-extrabold text-sm">
                          Existem {swapItems.length} aula(s) estacionada(s) na Área de Swap
                        </div>
                        <div className="text-amber-900">
                          Reencaixe todas as aulas da Área de Swap nas abas <strong>Por Turma</strong> ou{' '}
                          <strong>Por Especialista</strong> antes de aprovar e gravar no Quadro Oficial.
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPreviewTab('especialistas')}
                      className="px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold shrink-0 cursor-pointer"
                    >
                      Voltar e Reencaixar
                    </button>
                  </div>
                )}

                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-slate-100">
                    <div>
                      <h4 className="text-sm font-bold text-slate-800">
                        Selecione as Turmas de "{escolaAtual?.name}" para Gravar
                      </h4>
                      <p className="text-xs text-slate-500">
                        Apenas os slots das turmas selecionadas serão gravados no Quadro de Horários Oficial.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={toggleSelectAllClasses}
                      className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition cursor-pointer"
                    >
                      {turmasComEspecialistasRegulares.every((c) => selectedClassesToApply[c.id])
                        ? 'Desmarcar Todas'
                        : 'Selecionar Todas'}
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                    {turmasComEspecialistasRegulares.map((c) => {
                      const isChecked = !!selectedClassesToApply[c.id];

                      return (
                        <div
                          key={c.id}
                          onClick={() => toggleClassToApply(c.id)}
                          className={`p-3.5 rounded-xl border cursor-pointer transition flex items-start gap-3 ${
                            isChecked
                              ? 'bg-indigo-50/70 border-indigo-300 text-indigo-950 shadow-xs'
                              : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          <div className="mt-0.5">
                            {isChecked ? (
                              <CheckSquare className="w-4 h-4 text-indigo-600" />
                            ) : (
                              <Square className="w-4 h-4 text-slate-400" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-bold text-sm">
                              {c.val.year}º {c.val.letter} — {c.val.shift}
                            </div>
                            <div className="text-xs text-slate-500 truncate">{c.val.schoolName}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Resumo das Horas-Atividade (H.A.) dos Especialistas */}
                <div className="pt-4 border-t border-slate-100 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <h4 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                        <Award className="w-4 h-4 text-amber-600" />
                        Horas-Atividade (H.A.) dos Especialistas ({totalHAsResumo} horário(s))
                      </h4>
                      <p className="text-xs text-slate-500">
                        As H.A. inseridas nas lacunas na aba "Por Especialista" também serão gravadas automaticamente no cadastro oficial ao aprovar.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {resumoHA.map(({ esp, haLista, metaHA }) => (
                      <div
                        key={esp.id}
                        className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-bold text-sm text-slate-800 truncate">
                              {esp.teacher.name}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {esp.teacher.subject || 'Especialista'}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[11px] font-bold border ${
                                metaHA > 0 && haLista.length >= metaHA
                                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                  : haLista.length > 0
                                  ? 'bg-amber-50 text-amber-900 border-amber-300'
                                  : 'bg-white text-slate-500 border-slate-200'
                              }`}
                            >
                              ⭐ {haLista.length}
                              {metaHA > 0 ? ` / ${metaHA}` : ''} H.A.
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setPreviewTeacherId(esp.id);
                                setPreviewTab('especialistas');
                                limparEstadoMovimento();
                              }}
                              className="text-[11px] font-bold text-teal-700 hover:text-teal-900 hover:underline cursor-pointer"
                            >
                              Editar H.A.
                            </button>
                          </div>
                        </div>

                        {haLista.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {haLista.map((hk) => (
                              <span
                                key={hk}
                                className="px-2 py-0.5 rounded bg-amber-100/80 text-amber-900 border border-amber-200 text-[10px] font-semibold"
                              >
                                ⭐ {formatHASlotLabel(hk)}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <div className="text-[11px] text-slate-400 italic">
                            Nenhuma H.A. inserida nas lacunas até o momento.
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {isAdmin && (
                  <div className="pt-4 border-t border-slate-100 flex justify-end">
                    <button
                      type="button"
                      disabled={applying}
                      onClick={handleAplicarQuadroOficial}
                      className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold shadow-md hover:shadow-lg transition flex items-center gap-2 cursor-pointer"
                    >
                      {applying ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckSquare className="w-4 h-4" />}
                      Confirmar e Gravar no Quadro Oficial da Escola
                    </button>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* Modal de Exportação / Restauração por Código Base62 (Multi-Dispositivo) */}
      {codigoModal.aberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 print:hidden">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-2xl w-full p-6 space-y-4">
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-slate-900 text-amber-300 flex items-center justify-center shrink-0">
                  <KeyRound className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900">
                    {codigoModal.modo === 'exportar'
                      ? 'Código Portátil da Simulação (Base62)'
                      : 'Restaurar Simulação via Código Base62'}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {codigoModal.modo === 'exportar'
                      ? 'Guarde este código alfanumérico ou baixe como arquivo para retomar esta simulação em qualquer outro computador sem recalcular.'
                      : 'Cole o código Base62 (iniciado por DC1...) ou carregue um arquivo .hor.txt salvo anteriormente.'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCodigoModal((prev) => ({ ...prev, aberto: false }))}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
                aria-label="Fechar modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {codigoModal.modo === 'exportar' ? (
              <>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] font-bold text-slate-600">
                    <span>Código Base62 ({codigoModal.codigo.length} caracteres)</span>
                    <span className="text-teal-700">Inclui grades, folgas, ajustes manuais e H.A.</span>
                  </div>
                  <textarea
                    readOnly
                    value={codigoModal.codigo}
                    rows={6}
                    onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                    className="w-full p-3 bg-slate-50 border border-slate-300 rounded-xl font-mono text-[11px] text-slate-800 break-all focus:ring-2 focus:ring-teal-500"
                  />
                </div>

                {codigoModal.erro && (
                  <p className="text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                    {codigoModal.erro}
                  </p>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() =>
                      setCodigoModal({ aberto: true, modo: 'importar', codigo: '', erro: undefined })
                    }
                    className="text-xs font-bold text-indigo-700 hover:underline cursor-pointer"
                  >
                    Trocar para Restaurar Código
                  </button>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleBaixarArquivoBase62}
                      className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Baixar .txt
                    </button>
                    <button
                      type="button"
                      onClick={handleCopiarCodigoBase62}
                      className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      {codigoModal.copiado ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      {codigoModal.copiado ? 'Copiado!' : 'Copiar Código'}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs font-bold text-slate-700">Cole aqui o código Base62 (DC1...):</label>
                    <label className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer">
                      <Upload className="w-3 h-3" />
                      Carregar arquivo .txt
                      <input
                        type="file"
                        accept=".txt,.hor,.b62"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const reader = new FileReader();
                          reader.onload = () => {
                            setCodigoModal((prev) => ({
                              ...prev,
                              codigo: String(reader.result || ''),
                              erro: undefined
                            }));
                          };
                          reader.readAsText(file);
                        }}
                      />
                    </label>
                  </div>
                  <textarea
                    value={codigoModal.codigo}
                    onChange={(e) =>
                      setCodigoModal((prev) => ({ ...prev, codigo: e.target.value, erro: undefined }))
                    }
                    placeholder="DC1..."
                    rows={6}
                    className="w-full p-3 bg-white border border-slate-300 rounded-xl font-mono text-[11px] text-slate-800 break-all focus:ring-2 focus:ring-teal-500"
                  />
                </div>

                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-[11px] text-amber-900">
                  <strong>Revalidação automática:</strong> ao restaurar, o sistema confere este rascunho com as atribuições atuais e com aulas oficializadas recentemente em outras escolas, alertando caso algum horário precise de ajuste.
                </div>

                {codigoModal.erro && (
                  <p className="text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                    {codigoModal.erro}
                  </p>
                )}

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setCodigoModal((prev) => ({ ...prev, aberto: false }))}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    disabled={!codigoModal.codigo.trim()}
                    onClick={handleConfirmarImportarBase62}
                    className="px-5 py-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Restaurar e Conferir
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Modal de Confirmação para Salvar Versão do Rascunho */}
      {versaoPromptModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 print:hidden">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2.5 rounded-xl bg-sky-100 text-sky-700">
                  <History className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">
                    {versaoPromptModal.acao.tipo === 'salvar_manual'
                      ? `Salvar Versão do Rascunho (v${proximoNumeroVersao})`
                      : versaoPromptModal.acao.tipo === 'pos_importacao'
                      ? versaoPromptModal.acao.temConflitos
                        ? 'Simulação Importada com Alertas'
                        : 'Simulação Importada com Sucesso!'
                      : 'Alterações Não Salvas no Rascunho'}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {versaoPromptModal.acao.tipo === 'salvar_manual'
                      ? 'Defina um rótulo opcional para identificar esta versão no histórico.'
                      : versaoPromptModal.acao.tipo === 'pos_importacao'
                      ? 'Esta simulação importada difere das versões salvas na nuvem. Deseja gravá-la como uma nova versão?'
                      : `Há modificações ainda não salvas antes de ${
                          versaoPromptModal.acao.tipo === 'excel'
                            ? 'exportar o Excel (.xlsx)'
                            : versaoPromptModal.acao.tipo === 'pdf'
                            ? 'gerar o PDF'
                            : versaoPromptModal.acao.tipo === 'imprimir'
                            ? 'imprimir'
                            : 'gerar o Código Base62'
                        }. Deseja salvar esta versão na nuvem?`}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setVersaoPromptModal(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
                aria-label="Fechar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {versaoPromptModal.acao.tipo === 'pos_importacao' && (
              <div
                className={`rounded-xl p-3 text-xs border ${
                  versaoPromptModal.acao.temConflitos
                    ? 'bg-amber-50 border-amber-200 text-amber-900'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-900'
                }`}
              >
                {versaoPromptModal.acao.mensagem}
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 block">
                Nome / Rótulo da Versão v{proximoNumeroVersao} (opcional):
              </label>
              <input
                type="text"
                value={versaoPromptModal.rotulo}
                onChange={(e) =>
                  setVersaoPromptModal((prev) => (prev ? { ...prev, rotulo: e.target.value } : null))
                }
                placeholder={
                  versaoPromptModal.origem === 'importacao_base62'
                    ? 'Ex.: Recebido via Base62'
                    : versaoPromptModal.origem === 'exportacao_excel'
                    ? 'Ex.: Planilha para Direção'
                    : versaoPromptModal.origem === 'exportacao_pdf'
                    ? 'Ex.: PDF para Especialistas'
                    : versaoPromptModal.origem === 'impressao'
                    ? 'Ex.: Impressão Mural'
                    : 'Ex.: Ajuste pós-reunião'
                }
                maxLength={80}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-medium text-slate-800 focus:ring-2 focus:ring-sky-500"
              />
              <div className="text-[11px] text-slate-500 flex items-center justify-between">
                <span>Origem: {labelOrigemRascunho(versaoPromptModal.origem)}</span>
                <span>Data/Hora: {new Date().toLocaleString('pt-BR')}</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-100">
              {versaoPromptModal.acao.tipo === 'salvar_manual' ? (
                <>
                  <button
                    type="button"
                    onClick={() => setVersaoPromptModal(null)}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold cursor-pointer"
                  >
                    Cancelar
                  </button>
                  {versaoPromptModal.podeSobrescreverAtiva && rascunhoAtivoChave && (
                    <button
                      type="button"
                      disabled={savingCloudDraft}
                      onClick={async () => {
                        const rot = versaoPromptModal.rotulo;
                        const orig = versaoPromptModal.origem;
                        setVersaoPromptModal(null);
                        await gravarVersaoRascunhoNuvem({
                          origem: orig,
                          rotulo: rot || undefined,
                          sobrescreverChave: rascunhoAtivoChave
                        });
                      }}
                      className="px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold cursor-pointer"
                    >
                      Atualizar Versão Anterior
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={savingCloudDraft}
                    onClick={async () => {
                      const rot = versaoPromptModal.rotulo;
                      const orig = versaoPromptModal.origem;
                      setVersaoPromptModal(null);
                      await gravarVersaoRascunhoNuvem({
                        origem: orig,
                        rotulo: rot || undefined
                      });
                    }}
                    className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Cloud className="w-3.5 h-3.5" />
                    Salvar Nova Versão (v{proximoNumeroVersao})
                  </button>
                </>
              ) : versaoPromptModal.acao.tipo === 'pos_importacao' ? (
                <>
                  <button
                    type="button"
                    onClick={() => setVersaoPromptModal(null)}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold cursor-pointer"
                  >
                    Não Salvar Agora
                  </button>
                  <button
                    type="button"
                    disabled={savingCloudDraft}
                    onClick={async () => {
                      const rot = versaoPromptModal.rotulo;
                      setVersaoPromptModal(null);
                      await gravarVersaoRascunhoNuvem({
                        origem: 'importacao_base62',
                        rotulo: rot || undefined
                      });
                    }}
                    className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Cloud className="w-3.5 h-3.5" />
                    Salvar Nova Versão (v{proximoNumeroVersao})
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setVersaoPromptModal(null)}
                    className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const acao = versaoPromptModal.acao as
                        | { tipo: 'excel'; especialistaIdUnico?: string }
                        | { tipo: 'pdf'; especialistaIdUnico?: string }
                        | { tipo: 'imprimir'; modo: 'atual' | 'todos_especialistas' }
                        | { tipo: 'base62' };
                      setVersaoPromptModal(null);
                      void executarAcaoComVersao(acao, null);
                    }}
                    className="px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-xl text-xs font-bold cursor-pointer"
                  >
                    Continuar sem Salvar
                  </button>
                  <button
                    type="button"
                    disabled={savingCloudDraft}
                    onClick={async () => {
                      const acao = versaoPromptModal.acao as
                        | { tipo: 'excel'; especialistaIdUnico?: string }
                        | { tipo: 'pdf'; especialistaIdUnico?: string }
                        | { tipo: 'imprimir'; modo: 'atual' | 'todos_especialistas' }
                        | { tipo: 'base62' };
                      const orig = versaoPromptModal.origem;
                      const rot = versaoPromptModal.rotulo;
                      setVersaoPromptModal(null);
                      const salvo = await gravarVersaoRascunhoNuvem({
                        origem: orig,
                        rotulo: rot || undefined,
                        silencioso: true
                      });
                      await executarAcaoComVersao(acao, salvo);
                    }}
                    className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Cloud className="w-3.5 h-3.5" />
                    Salvar v{proximoNumeroVersao} e Continuar
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal de Renomear Versão Salva */}
      {renomearDraftModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 print:hidden">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-sky-600" />
                Renomear Versão v{renomearDraftModal.draft.versaoNumero || '?'}
              </h3>
              <button
                type="button"
                onClick={() => setRenomearDraftModal(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 block">Rótulo da Versão:</label>
              <input
                type="text"
                value={renomearDraftModal.rotulo}
                onChange={(e) =>
                  setRenomearDraftModal((prev) => (prev ? { ...prev, rotulo: e.target.value } : null))
                }
                placeholder="Ex.: Aprovado pela Direção"
                maxLength={80}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-medium text-slate-800 focus:ring-2 focus:ring-sky-500"
              />
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setRenomearDraftModal(null)}
                className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmarRenomearDraft}
                className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-bold cursor-pointer"
              >
                Salvar Rótulo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
