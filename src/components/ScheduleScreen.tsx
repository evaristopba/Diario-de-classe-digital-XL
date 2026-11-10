import React, { useState, useEffect, useMemo } from 'react';
import {
  ClassRoom,
  School,
  Teacher,
  SubjectItem,
  ModalConfig,
  ScreenType,
  HorarioSlot,
  DiaSemana,
  GRADE_DIAS_SEMANA,
  getHorariosTurma,
  getTurnoCanonical,
  getSlotTimeRange
} from '../types';
import {
  rtdb,
  ref,
  get,
  update,
  carregarMinhasTurmas,
  verificarIsAdmin,
  getCurrentAuthUid
} from '../lib/firebase';
import { formatFriendlyError } from '../lib/errorHandler';
import { definirAula, removerAula, trocarAulas } from '../lib/gradeHoraria';
import {
  Calendar,
  Clock,
  Printer,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Users,
  GraduationCap,
  BookOpen,
  Coffee,
  X,
  Edit2,
  Trash2,
  ShieldAlert,
  ArrowRight,
  Info,
  Layers,
  ChevronDown,
  Building2,
  UserCheck,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  RefreshCw
} from 'lucide-react';

interface ScheduleScreenProps {
  currentYear: string;
  setModal: (config: ModalConfig) => void;
  onNavigate?: (screen: ScreenType) => void;
  initialClassId?: string;
}

type ScheduleViewMode = 'class' | 'specialist' | 'overview';

export const ScheduleScreen: React.FC<ScheduleScreenProps> = ({
  currentYear,
  setModal,
  onNavigate,
  initialClassId
}) => {
  const [isAdmin, setIsAdmin] = useState(false);
  const [currentUid, setCurrentUid] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Dados carregados
  const [schools, setSchools] = useState<Record<string, School>>({});
  const [classes, setClasses] = useState<{ id: string; val: ClassRoom }[]>([]);
  const [teachers, setTeachers] = useState<{ id: string; val: Teacher }[]>([]);
  const [subjects, setSubjects] = useState<SubjectItem[]>([]);

  // Filtros e seleção
  const [selectedSchoolId, setSelectedSchoolId] = useState<string>('all');
  const [selectedClassId, setSelectedClassId] = useState<string>('');
  const [selectedSpecialistId, setSelectedSpecialistId] = useState<string>('');
  const [viewMode, setViewMode] = useState<ScheduleViewMode>('class');
  const [specialistShiftTab, setSpecialistShiftTab] = useState<'todos' | 'manha' | 'tarde'>('todos');

  // Modal de edição de slot
  const [slotEditorOpen, setSlotEditorOpen] = useState(false);
  const [activeSlotDia, setActiveSlotDia] = useState<DiaSemana>(1);
  const [activeSlotOrdem, setActiveSlotOrdem] = useState<number>(1);
  const [slotSubjectId, setSlotSubjectId] = useState<string>('');
  const [slotTeacherId, setSlotTeacherId] = useState<string>('');
  const [applyDoubled, setApplyDoubled] = useState<boolean>(false); // Desmarcado por padrão (aulas avulsas)

  // Estados de ajuste pontual de horário e observação (intercalação de turmas A/B)
  const [horarioCustomInicio, setHorarioCustomInicio] = useState<string>('');
  const [horarioCustomFim, setHorarioCustomFim] = useState<string>('');
  const [slotObservacao, setSlotObservacao] = useState<string>('');
  const [isCustomHorarioOpen, setIsCustomHorarioOpen] = useState(false);

  useEffect(() => {
    const uid = getCurrentAuthUid();
    setCurrentUid(uid);
    verificarIsAdmin(uid)
      .then((admin) => setIsAdmin(admin))
      .catch(() => setIsAdmin(false));
    loadAllData();
  }, [currentYear]);

  const loadAllData = async () => {
    setLoading(true);
    try {
      const [schoolsSnap, classesSnap, teachersSnap, subjectsSnap] = await Promise.all([
        get(ref(rtdb, 'diario-classe/escolas')),
        get(ref(rtdb, 'diario-classe/turmas')),
        get(ref(rtdb, 'diario-classe/professores')),
        get(ref(rtdb, 'diario-classe/disciplinas'))
      ]);

      const loadedSchools = (schoolsSnap.exists() ? schoolsSnap.val() : {}) as Record<string, School>;
      setSchools(loadedSchools);

      const rawClasses = classesSnap.exists() ? classesSnap.val() : {};
      const classList: { id: string; val: ClassRoom }[] = [];
      Object.keys(rawClasses).forEach((id) => {
        const c = rawClasses[id];
        if (c && (!c.anoLetivo || String(c.anoLetivo) === String(currentYear))) {
          classList.push({ id, val: c });
        }
      });
      // Ordena turmas por ano, letra e turno
      classList.sort((a, b) => {
        const yA = Number(a.val.year) || 0;
        const yB = Number(b.val.year) || 0;
        if (yA !== yB) return yA - yB;
        return (a.val.letter || '').localeCompare(b.val.letter || '');
      });
      setClasses(classList);

      const rawTeachers = teachersSnap.exists() ? teachersSnap.val() : {};
      const teacherList: { id: string; val: Teacher }[] = [];
      Object.keys(rawTeachers).forEach((id) => {
        const t = rawTeachers[id];
        if (t && t.status !== 'inactive') {
          teacherList.push({ id, val: t });
        }
      });
      teacherList.sort((a, b) => (a.val.name || '').localeCompare(b.val.name || ''));
      setTeachers(teacherList);

      if (subjectsSnap.exists()) {
        const subsVal = subjectsSnap.val();
        const subList: SubjectItem[] = Object.keys(subsVal).map((k) => ({ id: k, ...subsVal[k] }));
        setSubjects(subList);
      }

      // Define turma inicial
      if (initialClassId && classList.some((c) => c.id === initialClassId)) {
        setSelectedClassId(initialClassId);
      } else if (classList.length > 0) {
        setSelectedClassId(classList[0].id);
      }

      // Se for especialista logado, seleciona a si mesmo por padrão; senão, o primeiro especialista real
      const activeUid = getCurrentAuthUid();
      const myTeacher = teacherList.find((t) => t.val.authUid === activeUid || t.id === activeUid);
      if (myTeacher) {
        setSelectedSpecialistId(myTeacher.id);
      } else {
        const firstSpec = teacherList.find((t) => isSpecialistTeacher(t.val));
        if (firstSpec) {
          setSelectedSpecialistId(firstSpec.id);
        } else if (teacherList.length > 0) {
          setSelectedSpecialistId(teacherList[0].id);
        }
      }
    } catch (err: any) {
      console.error('Erro ao carregar dados do horário:', err);
    } finally {
      setLoading(false);
    }
  };

  // Turma atualmente selecionada
  const selectedClass = useMemo(() => {
    return classes.find((c) => c.id === selectedClassId)?.val || null;
  }, [classes, selectedClassId]);

  // Permissão de edição: somente administradores montam e ajustam os horários.
  // Professores (regentes e especialistas) consultam e imprimem. As regras do banco também
  // restringem a escrita em `turmas` a administradores.
  const canEditClass = useMemo(() => isAdmin, [isAdmin]);

  // Lista filtrada de turmas por escola
  const filteredClasses = useMemo(() => {
    if (selectedSchoolId === 'all') return classes;
    return classes.filter((c) => c.val.schoolId === selectedSchoolId);
  }, [classes, selectedSchoolId]);

  // Horários e sinos da turma atual
  const bellSchedule = useMemo(() => {
    if (!selectedClass) return getHorariosTurma('matutino', 'A', '1');
    return getHorariosTurma(selectedClass.shift, selectedClass.intervaloGrupo, selectedClass.year);
  }, [selectedClass]);

  // Identifica se um docente atua como especialista com base nas disciplinas cadastradas no banco
  const isSpecialistTeacher = (teacherVal?: Teacher | null): boolean => {
    if (!teacherVal?.subject) return false;
    const subStr = teacherVal.subject.trim().toLowerCase();
    // Docentes regentes polivalentes/gerais NÃO são especialistas de grade diversificada:
    if (
      subStr.includes('polivalente') ||
      subStr.includes('regente') ||
      subStr.includes('geral') ||
      subStr.includes('pedagog') ||
      subStr.includes('classe')
    ) {
      return false;
    }
    // Gestão de biblioteca / sala de leitura é suporte/apoio extraclasse:
    if (subStr.includes('biblioteca') || subStr.includes('leitura')) {
      return false;
    }
    // Se a matéria coincidir com disciplina da base diversificada cadastrada no banco:
    const matched = subjects.find(
      (s) =>
        (s.name || '').trim().toLowerCase() === subStr ||
        (s.id || '').trim().toLowerCase() === subStr ||
        subStr.includes((s.name || '').trim().toLowerCase()) ||
        (s.name || '').trim().toLowerCase().includes(subStr)
    );
    if (matched) return matched.category === 'diversificada';
    // Se tem matéria informada que não é regente polivalente geral:
    return true;
  };

  // Professores especialistas da escola
  const specialistTeachers = useMemo(() => {
    return teachers.filter((t) => isSpecialistTeacher(t.val));
  }, [teachers, subjects]);

  // Professor regente da turma atual (se houver)
  const regenteTeacher = useMemo(() => {
    if (!selectedClass?.teacherId) return null;
    return teachers.find((t) => t.id === selectedClass.teacherId)?.val || null;
  }, [selectedClass, teachers]);

  // Checa se um professor tem folga / dia livre no dia informado
  const checkTeacherAvailability = (teacher: Teacher | null | undefined, dia: DiaSemana): {
    available: boolean;
    reason?: string;
  } => {
    if (!teacher) return { available: true };
    const dias = Array.isArray(teacher.diasDisponiveis) && teacher.diasDisponiveis.length > 0
      ? teacher.diasDisponiveis
      : [1, 2, 3, 4, 5]; // Padrão: todos disponíveis
    const isAvail = dias.includes(dia);
    if (!isAvail) {
      const diaObj = GRADE_DIAS_SEMANA.find((d) => d.id === dia);
      return {
        available: false,
        reason: `${teacher.name} tem folga ou não atua na escola às ${diaObj?.nome || 'neste dia'}`
      };
    }
    return { available: true };
  };

  // Checa se um professor já está ocupado em outra turma no mesmo dia e em horário conflitante
  const checkTeacherConflict = (
    teacherId: string,
    dia: DiaSemana,
    ordem: number,
    excludeClassId: string,
    customInicio?: string,
    customFim?: string
  ): { hasConflict: boolean; conflictingClassDesc?: string } => {
    if (!teacherId || !selectedClass) return { hasConflict: false };

    // Horário da aula sendo alocada/editada
    const targetRange = getSlotTimeRange(selectedClass, ordem, customInicio, customFim);
    const targetTurno = getTurnoCanonical(selectedClass.shift);

    for (const c of classes) {
      if (c.id === excludeClassId) continue;
      const cGrade = c.val.gradeHoraria;
      if (!cGrade) continue;

      const cTurno = getTurnoCanonical(c.val.shift);
      // Se turnos canônicos são diferentes e nenhum tem horário fora do padrão:
      // Manhã (07h-12h) e Tarde (12h30-17h) nunca se sobrepõem.
      if (targetTurno !== 'outro' && cTurno !== 'outro' && targetTurno !== cTurno) {
        if (targetRange.endMin <= 12 * 60 && cTurno === 'tarde') continue;
        if (targetRange.startMin >= 12 * 60 && cTurno === 'manha') continue;
      }

      // Checa todas as aulas que o professor tem nessa turma no mesmo dia da semana
      for (let o = 1; o <= 5; o++) {
        const slotKey = `${dia}_${o}`;
        const slot = cGrade[slotKey];
        if (slot && slot.teacherId === teacherId) {
          const cRange = getSlotTimeRange(c.val, o, slot.horarioCustomInicio, slot.horarioCustomFim);
          // Há sobreposição se: startA < endB && startB < endA
          const hasOverlap = targetRange.startMin < cRange.endMin && cRange.startMin < targetRange.endMin;
          if (hasOverlap) {
            const school = schools[c.val.schoolId]?.name || c.val.schoolName || '';
            return {
              hasConflict: true,
              conflictingClassDesc: `${c.val.year}º ${c.val.letter} (${c.val.shift}) às ${cRange.inicioStr}–${cRange.fimStr} - ${school}`
            };
          }
        }
      }
    }
    return { hasConflict: false };
  };

  // Abrir editor de slot
  const handleOpenSlotEditor = (dia: DiaSemana, ordem: number) => {
    if (!canEditClass) return;
    setActiveSlotDia(dia);
    setActiveSlotOrdem(ordem);
    const currentSlot = selectedClass?.gradeHoraria?.[`${dia}_${ordem}`];
    if (currentSlot) {
      setSlotSubjectId(currentSlot.disciplinaId || '');
      setSlotTeacherId(currentSlot.teacherId || '');
      setHorarioCustomInicio(currentSlot.horarioCustomInicio || '');
      setHorarioCustomFim(currentSlot.horarioCustomFim || '');
      setSlotObservacao(currentSlot.observacao || '');
      setIsCustomHorarioOpen(Boolean(currentSlot.horarioCustomInicio || currentSlot.observacao));
    } else {
      setSlotSubjectId('');
      setSlotTeacherId('');
      setHorarioCustomInicio('');
      setHorarioCustomFim('');
      setSlotObservacao('');
      setIsCustomHorarioOpen(false);
    }
    setApplyDoubled(false);
    setSlotEditorOpen(true);
  };

  // Salvar slot(s) de aula na grade horária da turma
  const handleSaveSlot = async () => {
    if (!selectedClassId || !selectedClass) return;
    if (!slotSubjectId) {
      return setModal({
        isOpen: true,
        type: 'alert',
        title: 'Selecione uma Disciplina',
        message: 'Por favor, selecione uma das disciplinas já cadastradas no banco de dados.',
        icon: '⚠️'
      });
    }
    setSaving(true);
    try {
      const grade = { ...(selectedClass.gradeHoraria || {}) };
      const subObj = subjects.find((s) => s.id === slotSubjectId);
      const subNome = subObj ? subObj.name : slotSubjectId;
      const subSigla = subObj?.shortName || subNome.substring(0, 4).toUpperCase();
      const isEspecialista = subObj?.category === 'diversificada';

      const tNome = slotTeacherId
        ? teachers.find((t) => t.id === slotTeacherId)?.val.name || ''
        : '';

      const newSlot: HorarioSlot = {
        disciplinaId: slotSubjectId,
        disciplinaNome: subNome,
        disciplinaSigla: subSigla,
        teacherId: slotTeacherId,
        teacherNome: tNome,
        isEspecialista: isEspecialista,
        horarioCustomInicio: horarioCustomInicio.trim() || undefined,
        horarioCustomFim: horarioCustomFim.trim() || undefined,
        observacao: slotObservacao.trim() || undefined
      };

      // Grava SOMENTE os horários alterados (gradeHoraria/{dia}_{ordem}), sem reenviar a grade inteira.
      // Campos vazios (ajuste de horário/observação não preenchidos) são removidos: o banco rejeita `undefined`.
      // Bloco dobrado: a aula também vale na seguinte (ou anterior, se for a 5ª).
      const { updates, novaGrade } = definirAula(grade, activeSlotDia, activeSlotOrdem, newSlot, applyDoubled);

      await update(ref(rtdb, `diario-classe/turmas/${selectedClassId}`), updates);

      // Atualiza estado local
      setClasses((prev) =>
        prev.map((c) =>
          c.id === selectedClassId
            ? { ...c, val: { ...c.val, gradeHoraria: novaGrade } }
            : c
        )
      );

      setSlotEditorOpen(false);
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Horário Atualizado',
        message: applyDoubled
          ? `Bloco dobrado de 2 aulas de ${subNome} salvo com sucesso para ${tNome || 'o professor'}!`
          : `Aula de ${subNome} atualizada com sucesso!`,
        icon: '✅'
      });
    } catch (err: any) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro ao Salvar Horário',
        message: formatFriendlyError(err, 'Não foi possível salvar o horário da turma.'),
        icon: '❌'
      });
    } finally {
      setSaving(false);
    }
  };

  // Subir aula (↑) ou Descer aula (↓) com permuta automática
  const handleMoveOrdem = async (dia: DiaSemana, currentOrdem: number, direction: 'up' | 'down') => {
    if (!canEditClass || !selectedClassId || !selectedClass) return;
    const targetOrdem = direction === 'up' ? currentOrdem - 1 : currentOrdem + 1;
    if (targetOrdem < 1 || targetOrdem > 5) return;

    setSaving(true);
    try {
      const grade = { ...(selectedClass.gradeHoraria || {}) };
      // Troca as duas aulas gravando só esses dois horários, numa única operação
      const resultado = trocarAulas(grade, dia, currentOrdem, targetOrdem, direction);
      if (!resultado) return;
      const currentSlot = grade[`${dia}_${currentOrdem}`];
      const targetSlot = resultado.alvo;

      await update(ref(rtdb, `diario-classe/turmas/${selectedClassId}`), resultado.updates);

      setClasses((prev) =>
        prev.map((c) =>
          c.id === selectedClassId
            ? { ...c, val: { ...c.val, gradeHoraria: resultado.novaGrade } }
            : c
        )
      );

      setModal({
        isOpen: true,
        type: 'alert',
        title: direction === 'up' ? 'Aula Subida com Sucesso' : 'Aula Remanejada',
        message: targetSlot
          ? `A aula de ${currentSlot.disciplinaNome} foi movida para a ${targetOrdem}ª aula e permutada com ${targetSlot.disciplinaNome}!`
          : `A aula de ${currentSlot.disciplinaNome} foi movida para a ${targetOrdem}ª aula!`,
        icon: '✅'
      });
    } catch (err: any) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro ao Mover Aula',
        message: formatFriendlyError(err, 'Não foi possível mover a aula.'),
        icon: '❌'
      });
    } finally {
      setSaving(false);
    }
  };

  // Limpar slot individual
  const handleClearSlot = async (dia: DiaSemana, ordem: number) => {
    if (!canEditClass || !selectedClassId || !selectedClass) return;
    try {
      const { updates, novaGrade: grade } = removerAula(selectedClass.gradeHoraria || {}, dia, ordem);

      await update(ref(rtdb, `diario-classe/turmas/${selectedClassId}`), updates);

      setClasses((prev) =>
        prev.map((c) =>
          c.id === selectedClassId
            ? { ...c, val: { ...c.val, gradeHoraria: grade } }
            : c
        )
      );
    } catch (err: any) {
      console.error('Erro ao limpar slot:', err);
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro ao Limpar Horário',
        message: formatFriendlyError(err, 'Não foi possível limpar o horário.'),
        icon: '❌'
      });
    }
  };

  // Alternar grupo de intervalo da turma (Grupo A: 09:30 vs Grupo B: 10:00)
  const handleToggleIntervaloGrupo = async (novoGrupo: 'A' | 'B') => {
    if (!canEditClass || !selectedClassId || !selectedClass) return;
    try {
      await update(ref(rtdb, `diario-classe/turmas/${selectedClassId}`), {
        intervaloGrupo: novoGrupo
      });
      setClasses((prev) =>
        prev.map((c) =>
          c.id === selectedClassId
            ? { ...c, val: { ...c.val, intervaloGrupo: novoGrupo } }
            : c
        )
      );
    } catch (err: any) {
      console.error('Erro ao atualizar grupo de intervalo:', err);
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro ao Alterar o Intervalo',
        message: formatFriendlyError(err, 'Não foi possível alterar o grupo de intervalo da turma.'),
        icon: '❌'
      });
    }
  };

  // Estatísticas de aulas da turma atual
  const classScheduleStats = useMemo(() => {
    if (!selectedClass?.gradeHoraria) {
      return { total: 0, regente: 0, especialista: 0, porMateria: {} as Record<string, number> };
    }
    const grade = selectedClass.gradeHoraria;
    let total = 0;
    let regente = 0;
    let especialista = 0;
    const porMateria: Record<string, number> = {};

    Object.values(grade).forEach((slot) => {
      total++;
      if (slot.isEspecialista) {
        especialista++;
        porMateria[slot.disciplinaNome] = (porMateria[slot.disciplinaNome] || 0) + 1;
      } else {
        regente++;
      }
    });

    return { total, regente, especialista, porMateria };
  }, [selectedClass]);

  // Especialista selecionado para visão do professor
  const activeSpecialist = useMemo(() => {
    return teachers.find((t) => t.id === selectedSpecialistId) || null;
  }, [teachers, selectedSpecialistId]);

  // Grade semanal consolidada do especialista indexada por turno + slotKey (`${turno}_${dia}_${ordem}`)
  const specialistWeeklyGrid = useMemo(() => {
    if (!selectedSpecialistId) return {};
    const grid: Record<
      string,
      { turma: ClassRoom; turmaId: string; slot: HorarioSlot; turno: 'manha' | 'tarde' | 'noite' | 'outro' }
    > = {};
    classes.forEach((c) => {
      const grade = c.val.gradeHoraria || {};
      const turno = getTurnoCanonical(c.val.shift);
      Object.keys(grade).forEach((slotKey) => {
        const slot = grade[slotKey];
        if (slot && slot.teacherId === selectedSpecialistId) {
          grid[`${turno}_${slotKey}`] = { turma: c.val, turmaId: c.id, slot, turno };
        }
      });
    });
    return grid;
  }, [classes, selectedSpecialistId]);

  // Total de aulas do especialista na semana
  const totalAulasEspecialista = useMemo(() => {
    return Object.keys(specialistWeeklyGrid).length;
  }, [specialistWeeklyGrid]);

  // Turnos em que o docente possui aulas registradas
  const specialistActiveTurnos = useMemo(() => {
    const s = new Set<'manha' | 'tarde' | 'noite' | 'outro'>();
    Object.values(specialistWeeklyGrid).forEach((item) => s.add(item.turno));
    return s;
  }, [specialistWeeklyGrid]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Cabeçalho Principal */}
      <div className="bg-white rounded-2xl shadow-xs border border-indigo-100 p-5 sm:p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="p-3 bg-gradient-to-br from-indigo-500 to-indigo-700 text-white rounded-xl shadow-md">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl font-bold text-slate-800 tracking-tight">
                Quadro de Horários & Grade Semanal
              </h2>
              <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                Ano Letivo {currentYear}
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">
              Organização das 5 aulas diárias de 50 minutos, alocação dos especialistas e escala de recreio.
            </p>
          </div>
        </div>

        {/* Alternância de Modo de Visão */}
        <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-xl border border-slate-200 self-stretch sm:self-auto justify-center">
          <button
            onClick={() => setViewMode('class')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              viewMode === 'class'
                ? 'bg-white text-indigo-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            🏫 Grade da Turma
          </button>
          <button
            onClick={() => setViewMode('specialist')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              viewMode === 'specialist'
                ? 'bg-white text-indigo-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            🎨 Agenda do Especialista
          </button>
          <button
            onClick={() => setViewMode('overview')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              viewMode === 'overview'
                ? 'bg-white text-indigo-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            📊 Escala Semanal
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* MODO 1: VISÃO DA TURMA                                                    */}
      {/* ========================================================================= */}
      {viewMode === 'class' && (
        <div className="space-y-5">
          {/* Barra de Filtros da Turma */}
          <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-4 flex flex-col sm:flex-row items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 w-full sm:w-auto flex-wrap">
              {/* Filtro Escola */}
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                  Escola
                </label>
                <select
                  value={selectedSchoolId}
                  onChange={(e) => setSelectedSchoolId(e.target.value)}
                  className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-medium bg-white outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="all">Todas as Escolas</option>
                  {Object.keys(schools).map((sId) => (
                    <option key={sId} value={sId}>
                      {schools[sId].name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Seletor de Turma */}
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                  Turma
                </label>
                <select
                  value={selectedClassId}
                  onChange={(e) => setSelectedClassId(e.target.value)}
                  className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-bold bg-white outline-none focus:ring-2 focus:ring-indigo-500 text-indigo-900"
                >
                  {filteredClasses.length === 0 ? (
                    <option value="">Nenhuma turma encontrada</option>
                  ) : (
                    filteredClasses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.val.year}º {c.val.letter} ({c.val.shift}) - {schools[c.val.schoolId]?.name || c.val.schoolName}
                      </option>
                    ))
                  )}
                </select>
              </div>
            </div>

            {/* Alternador de Grupo de Intervalo (apenas para Matutino / Manhã) */}
            {selectedClass && getTurnoCanonical(selectedClass.shift) === 'manha' && (
              <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl">
                <span className="text-xs font-semibold text-slate-600">Intervalo Matutino:</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleToggleIntervaloGrupo('A')}
                    disabled={!canEditClass}
                    className={`px-2.5 py-1 text-xs font-bold rounded-md transition cursor-pointer ${
                      (selectedClass.intervaloGrupo || 'A') === 'A'
                        ? 'bg-amber-500 text-white shadow-2xs'
                        : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                    }`}
                    title="Grupo A: Recreio das 09:30 às 09:50 (Infantil / 1º ao 3º Ano)"
                  >
                    Grupo A (09:30)
                  </button>
                  <button
                    onClick={() => handleToggleIntervaloGrupo('B')}
                    disabled={!canEditClass}
                    className={`px-2.5 py-1 text-xs font-bold rounded-md transition cursor-pointer ${
                      selectedClass.intervaloGrupo === 'B'
                        ? 'bg-indigo-600 text-white shadow-2xs'
                        : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                    }`}
                    title="Grupo B: Recreio das 10:00 às 10:20 (4º e 5º Anos)"
                  >
                    Grupo B (10:00)
                  </button>
                </div>
              </div>
            )}

            {/* Indicador Informativo de Recreio para Vespertino / Tarde */}
            {selectedClass && getTurnoCanonical(selectedClass.shift) === 'tarde' && (
              <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-xl">
                <span className="text-xs font-semibold text-amber-900">Intervalo Vespertino:</span>
                <span className="text-xs font-bold text-amber-800 bg-white px-2.5 py-1 rounded-md border border-amber-200 shadow-2xs">
                  15:00 às 15:20 (Recreio Único)
                </span>
              </div>
            )}

            {/* Botão Imprimir */}
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold rounded-lg shadow-2xs transition cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Imprimir Grade</span>
            </button>
          </div>

          {/* Resumo da Turma e Carga Horária */}
          {selectedClass && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-white p-3.5 rounded-xl border border-slate-200 flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold uppercase text-slate-400">Professor(a) Regente</span>
                  <p className="text-sm font-bold text-slate-800 truncate max-w-[200px]">
                    {regenteTeacher?.name || 'Não atribuído'}
                  </p>
                </div>
                <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
                  <UserCheck className="w-5 h-5" />
                </div>
              </div>

              <div className="bg-white p-3.5 rounded-xl border border-slate-200 flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold uppercase text-slate-400">Regência vs. Especialistas</span>
                  <p className="text-sm font-bold text-indigo-700">
                    {classScheduleStats.regente} aulas Regente / {classScheduleStats.especialista} Especialistas
                  </p>
                </div>
                <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                  <Layers className="w-5 h-5" />
                </div>
              </div>

              <div className="bg-white p-3.5 rounded-xl border border-slate-200 flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold uppercase text-slate-400">Hora-Atividade do Regente</span>
                  <p className="text-sm font-bold text-emerald-700">
                    {classScheduleStats.especialista * 50} min ({classScheduleStats.especialista} aulas livres)
                  </p>
                </div>
                <div className="p-2 bg-purple-50 text-purple-600 rounded-lg">
                  <BookOpen className="w-5 h-5" />
                </div>
              </div>
            </div>
          )}

          {/* Tabela Interativa da Grade Semanal */}
          {selectedClass ? (
            <div className="bg-white rounded-2xl shadow-xs border border-slate-200 overflow-hidden">
              <div className="p-4 bg-slate-50/80 border-b border-slate-200 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-800">
                    Grade Semanal — {selectedClass.year}º Ano {selectedClass.letter} ({selectedClass.shift})
                  </h3>
                  <p className="text-xs text-slate-500">
                    {bellSchedule.nome} • Início: {bellSchedule.aulas[0]?.inicio} • Término: {bellSchedule.aulas[4]?.fim}
                  </p>
                </div>
                {isAdmin && (
                  <span className="text-[11px] font-semibold text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-md border border-indigo-200">
                    💡 Clique em qualquer aula para editar ou alocar especialista
                  </span>
                )}
                {!isAdmin && (
                  <span className="text-[11px] font-semibold text-slate-600 bg-slate-50 px-2.5 py-1 rounded-md border border-slate-200">
                    👁️ Somente consulta: apenas administradores alteram os horários
                  </span>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[700px]">
                  <thead>
                    <tr className="bg-slate-100 text-slate-700 text-xs font-bold border-b border-slate-200">
                      <th className="py-3 px-3 w-32 text-center border-r border-slate-200">Horário / Aula</th>
                      {GRADE_DIAS_SEMANA.map((dia) => (
                        <th key={dia.id} className="py-3 px-3 text-center border-r border-slate-200 last:border-r-0">
                          <span className="block text-sm">{dia.nome}</span>
                          <span className="text-[10px] font-normal text-slate-500">50 minutos</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {/* Aulas 1 a 3 */}
                    {[1, 2, 3].map((ordem) => {
                      const aulaDef = bellSchedule.aulas.find((a) => a.ordem === ordem);
                      return (
                        <tr key={ordem} className="hover:bg-slate-50/60 transition">
                          <td className="py-3 px-2 text-center bg-slate-50/50 font-bold border-r border-slate-200">
                            <span className="block text-slate-800">{aulaDef?.nome}</span>
                            <span className="text-[11px] font-normal text-indigo-600">
                              {aulaDef?.inicio} – {aulaDef?.fim}
                            </span>
                          </td>
                          {GRADE_DIAS_SEMANA.map((dia) => {
                            const slotKey = `${dia.id}_${ordem}`;
                            const slot = selectedClass.gradeHoraria?.[slotKey];
                            return (
                              <td
                                key={dia.id}
                                onClick={() => handleOpenSlotEditor(dia.id, ordem)}
                                className={`p-2 border-r border-slate-100 last:border-r-0 align-top transition ${
                                  canEditClass ? 'cursor-pointer hover:bg-indigo-50/40' : ''
                                }`}
                              >
                                {slot ? (
                                  <div
                                    className={`p-2.5 rounded-xl border text-xs relative group ${
                                      slot.isEspecialista
                                        ? 'bg-indigo-50/80 border-indigo-200 text-indigo-900 shadow-2xs'
                                        : 'bg-emerald-50/60 border-emerald-200 text-emerald-900'
                                    }`}
                                  >
                                    <div className="flex items-center justify-between gap-1 mb-1">
                                      <span className="font-extrabold text-[11px] uppercase tracking-wide">
                                        {slot.disciplinaNome}
                                      </span>
                                      {slot.isEspecialista && (
                                        <span className="text-[9px] font-bold px-1.5 py-0.2 rounded-full bg-indigo-600 text-white">
                                          Especialista
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-[11px] text-slate-600 truncate font-medium">
                                      {slot.teacherNome || 'Docente'}
                                    </p>
                                    {slot.horarioCustomInicio && (
                                      <span className="block text-[10px] text-amber-800 bg-amber-100 font-bold px-1.5 py-0.2 rounded mt-1 truncate">
                                        ⏱️ {slot.horarioCustomInicio}–{slot.horarioCustomFim}
                                      </span>
                                    )}
                                    {slot.observacao && (
                                      <span className="block text-[10px] text-slate-500 bg-slate-100/90 px-1 py-0.2 rounded mt-0.5 truncate" title={slot.observacao}>
                                        📌 {slot.observacao}
                                      </span>
                                    )}
                                    {canEditClass && (
                                      <div className="absolute top-1 right-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition bg-white/95 rounded-md shadow-xs p-0.5 border border-slate-200">
                                        {ordem > 1 && (
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleMoveOrdem(dia.id, ordem, 'up');
                                            }}
                                            className="p-1 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded transition"
                                            title="Subir aula para o horário anterior (permuta)"
                                          >
                                            <ArrowUp className="w-3 h-3" />
                                          </button>
                                        )}
                                        {ordem < 5 && (
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleMoveOrdem(dia.id, ordem, 'down');
                                            }}
                                            className="p-1 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded transition"
                                            title="Descer aula para o próximo horário (permuta)"
                                          >
                                            <ArrowDown className="w-3 h-3" />
                                          </button>
                                        )}
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleClearSlot(dia.id, ordem);
                                          }}
                                          className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition"
                                          title="Remover aula deste horário"
                                        >
                                          <Trash2 className="w-3 h-3" />
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <div className="h-16 rounded-xl border border-dashed border-slate-200 flex items-center justify-center text-slate-400 text-[11px] hover:border-indigo-300">
                                    {canEditClass ? '+ Definir' : 'Livre'}
                                  </div>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}

                    {/* Linha do Intervalo / Recreio Escalonado */}
                    <tr className="bg-amber-50/70 border-y-2 border-amber-200 font-bold text-amber-900">
                      <td className="py-2.5 px-3 text-center border-r border-amber-200">
                        <div className="flex items-center justify-center gap-1">
                          <Coffee className="w-3.5 h-3.5 text-amber-700" />
                          <span className="text-[11px]">INTERVALO</span>
                        </div>
                        <span className="text-[10px] text-amber-700 block font-normal">
                          {bellSchedule.intervalo.inicio} – {bellSchedule.intervalo.fim} (20 min)
                        </span>
                      </td>
                      <td colSpan={5} className="py-2.5 px-4 text-center text-xs tracking-wide">
                        🍎 {bellSchedule.intervalo.rotulo}
                      </td>
                    </tr>

                    {/* Aulas 4 e 5 */}
                    {[4, 5].map((ordem) => {
                      const aulaDef = bellSchedule.aulas.find((a) => a.ordem === ordem);
                      return (
                        <tr key={ordem} className="hover:bg-slate-50/60 transition">
                          <td className="py-3 px-2 text-center bg-slate-50/50 font-bold border-r border-slate-200">
                            <span className="block text-slate-800">{aulaDef?.nome}</span>
                            <span className="text-[11px] font-normal text-indigo-600">
                              {aulaDef?.inicio} – {aulaDef?.fim}
                            </span>
                          </td>
                          {GRADE_DIAS_SEMANA.map((dia) => {
                            const slotKey = `${dia.id}_${ordem}`;
                            const slot = selectedClass.gradeHoraria?.[slotKey];
                            return (
                              <td
                                key={dia.id}
                                onClick={() => handleOpenSlotEditor(dia.id, ordem)}
                                className={`p-2 border-r border-slate-100 last:border-r-0 align-top transition ${
                                  canEditClass ? 'cursor-pointer hover:bg-indigo-50/40' : ''
                                }`}
                              >
                                {slot ? (
                                  <div
                                    className={`p-2.5 rounded-xl border text-xs relative group ${
                                      slot.isEspecialista
                                        ? 'bg-indigo-50/80 border-indigo-200 text-indigo-900 shadow-2xs'
                                        : 'bg-emerald-50/60 border-emerald-200 text-emerald-900'
                                    }`}
                                  >
                                    <div className="flex items-center justify-between gap-1 mb-1">
                                      <span className="font-extrabold text-[11px] uppercase tracking-wide">
                                        {slot.disciplinaNome}
                                      </span>
                                      {slot.isEspecialista && (
                                        <span className="text-[9px] font-bold px-1.5 py-0.2 rounded-full bg-indigo-600 text-white">
                                          Especialista
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-[11px] text-slate-600 truncate font-medium">
                                      {slot.teacherNome || 'Docente'}
                                    </p>
                                    {slot.horarioCustomInicio && (
                                      <span className="block text-[10px] text-amber-800 bg-amber-100 font-bold px-1.5 py-0.2 rounded mt-1 truncate">
                                        ⏱️ {slot.horarioCustomInicio}–{slot.horarioCustomFim}
                                      </span>
                                    )}
                                    {slot.observacao && (
                                      <span className="block text-[10px] text-slate-500 bg-slate-100/90 px-1 py-0.2 rounded mt-0.5 truncate" title={slot.observacao}>
                                        📌 {slot.observacao}
                                      </span>
                                    )}
                                    {canEditClass && (
                                      <div className="absolute top-1 right-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition bg-white/95 rounded-md shadow-xs p-0.5 border border-slate-200">
                                        {ordem > 1 && (
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleMoveOrdem(dia.id, ordem, 'up');
                                            }}
                                            className="p-1 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded transition"
                                            title="Subir aula para o horário anterior (permuta)"
                                          >
                                            <ArrowUp className="w-3 h-3" />
                                          </button>
                                        )}
                                        {ordem < 5 && (
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleMoveOrdem(dia.id, ordem, 'down');
                                            }}
                                            className="p-1 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded transition"
                                            title="Descer aula para o próximo horário (permuta)"
                                          >
                                            <ArrowDown className="w-3 h-3" />
                                          </button>
                                        )}
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleClearSlot(dia.id, ordem);
                                          }}
                                          className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition"
                                          title="Remover aula deste horário"
                                        >
                                          <Trash2 className="w-3 h-3" />
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <div className="h-16 rounded-xl border border-dashed border-slate-200 flex items-center justify-center text-slate-400 text-[11px] hover:border-indigo-300">
                                    {canEditClass ? '+ Definir' : 'Livre'}
                                  </div>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-2xl p-10 text-center border border-slate-200 text-slate-500">
              <Users className="w-10 h-10 mx-auto text-slate-300 mb-2" />
              <p className="text-sm font-semibold">Nenhuma turma selecionada.</p>
              <p className="text-xs text-slate-400">Cadastre ou selecione uma turma para gerenciar seu horário.</p>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODO 2: VISÃO DO ESPECIALISTA (AGENDA SEMANAL DOCENTE)                    */}
      {/* ========================================================================= */}
      {viewMode === 'specialist' && (
        <div className="space-y-5">
          {/* Barra de Seleção do Especialista */}
          <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-3 w-full sm:w-auto">
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                  Professor(a) Especialista
                </label>
                <select
                  value={selectedSpecialistId}
                  onChange={(e) => setSelectedSpecialistId(e.target.value)}
                  className="px-3.5 py-2 border border-slate-300 rounded-xl text-sm font-bold bg-white text-indigo-900 outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {specialistTeachers.length > 0 ? (
                    <>
                      <optgroup label="Professores Especialistas">
                        {specialistTeachers.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.val.name} — {t.val.subject}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="Demais Docentes (Regentes)">
                        {teachers
                          .filter((t) => !isSpecialistTeacher(t.val))
                          .map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.val.name} — {t.val.subject || 'Polivalente'}
                            </option>
                          ))}
                      </optgroup>
                    </>
                  ) : (
                    teachers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.val.name} — {t.val.subject || 'Polivalente'}
                      </option>
                    ))
                  )}
                </select>
              </div>
            </div>

            {/* Painel de Dias de Atendimento e Folgas */}
            {activeSpecialist && (
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <span className="font-bold text-slate-600">Dias de Atuação na Escola:</span>
                {GRADE_DIAS_SEMANA.map((dia) => {
                  const dias = Array.isArray(activeSpecialist.val.diasDisponiveis) && activeSpecialist.val.diasDisponiveis.length > 0
                    ? activeSpecialist.val.diasDisponiveis
                    : [1, 2, 3, 4, 5];
                  const atua = dias.includes(dia.id);
                  return (
                    <span
                      key={dia.id}
                      className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                        atua
                          ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                          : 'bg-rose-100 text-rose-800 border border-rose-200 line-through'
                      }`}
                      title={atua ? `Atende na ${dia.nome}` : `Folga / Fora da escola na ${dia.nome}`}
                    >
                      {dia.curto}
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          {/* Cartões de Carga Horária do Especialista */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-white p-4 rounded-xl border border-slate-200 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold uppercase text-slate-400">Total de Aulas Semanais</span>
                <p className="text-xl font-extrabold text-indigo-700">{totalAulasEspecialista} aulas</p>
                <span className="text-[11px] text-slate-500 font-medium">
                  {Math.round((totalAulasEspecialista * 50) / 60)}h {(totalAulasEspecialista * 50) % 60}min de regência
                </span>
              </div>
              <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl">
                <GraduationCap className="w-6 h-6" />
              </div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold uppercase text-slate-400">Turmas Atendidas</span>
                <p className="text-xl font-extrabold text-slate-800">
                  {new Set(Object.values(specialistWeeklyGrid).map((item) => item.turmaId)).size} turmas
                </p>
                <span className="text-[11px] text-slate-500 font-medium">Blocos de 2 aulas por turma</span>
              </div>
              <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-xl">
                <Users className="w-6 h-6" />
              </div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold uppercase text-slate-400">Disciplina Principal</span>
                <p className="text-base font-bold text-slate-800 truncate">
                  {activeSpecialist?.val.subject || 'Especialista'}
                </p>
                <span className="text-[11px] text-slate-500 font-medium">Base Nacional Comum Curricular</span>
              </div>
              <div className="p-2.5 bg-amber-50 text-amber-600 rounded-xl">
                <Sparkles className="w-6 h-6" />
              </div>
            </div>
          </div>

          {/* Grade Semanal do Especialista com Divisão por Turno */}
          <div className="space-y-4">
            <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-800">
                  Itinerário Semanal de Aulas — {activeSpecialist?.val.name}
                </h3>
                <p className="text-xs text-slate-500">
                  Visualização organizada por turno sem sobreposição de horários
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* Seletor de Turno para Especialista */}
                <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl text-xs font-bold">
                  <button
                    type="button"
                    onClick={() => setSpecialistShiftTab('todos')}
                    className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                      specialistShiftTab === 'todos'
                        ? 'bg-white text-indigo-700 shadow-2xs font-extrabold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Todos ({totalAulasEspecialista})
                  </button>
                  <button
                    type="button"
                    onClick={() => setSpecialistShiftTab('manha')}
                    className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                      specialistShiftTab === 'manha'
                        ? 'bg-white text-indigo-700 shadow-2xs font-extrabold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    ☀️ Manhã
                  </button>
                  <button
                    type="button"
                    onClick={() => setSpecialistShiftTab('tarde')}
                    className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                      specialistShiftTab === 'tarde'
                        ? 'bg-white text-indigo-700 shadow-2xs font-extrabold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    🌤️ Tarde
                  </button>
                </div>

                <button
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold rounded-lg shadow-2xs transition cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Imprimir Folha</span>
                </button>
              </div>
            </div>

            {/* Tabelas de Turno */}
            {(() => {
              const renderShiftTable = (turnoKey: 'manha' | 'tarde') => {
                const isManha = turnoKey === 'manha';
                const turnoNome = isManha ? 'Turno Matutino' : 'Turno Vespertino (Tarde)';
                const turnoHorario = isManha ? '07:00 às 12:00' : '12:30 às 17:00';
                const badgeColor = isManha
                  ? 'bg-amber-100 text-amber-900 border-amber-300'
                  : 'bg-indigo-100 text-indigo-900 border-indigo-300';

                const aulasDef = isManha
                  ? [
                      { ordem: 1, label: '07:00 – 07:50' },
                      { ordem: 2, label: '07:50 – 08:40' },
                      { ordem: 3, label: '08:40 – 09:30' },
                      { ordem: 4, label: '09:50 / 10:20' },
                      { ordem: 5, label: '10:40 / 11:10' }
                    ]
                  : [
                      { ordem: 1, label: '12:30 – 13:20' },
                      { ordem: 2, label: '13:20 – 14:10' },
                      { ordem: 3, label: '14:10 – 15:00' },
                      { ordem: 4, label: '15:20 – 16:10' },
                      { ordem: 5, label: '16:10 – 17:00' }
                    ];

                return (
                  <div
                    key={turnoKey}
                    className="bg-white rounded-2xl shadow-xs border border-slate-200 overflow-hidden"
                  >
                    <div className="p-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${badgeColor}`}>
                          {isManha ? '☀️ Manhã' : '🌤️ Tarde'}
                        </span>
                        <h4 className="text-sm font-bold text-slate-800">
                          {turnoNome} • {turnoHorario}
                        </h4>
                      </div>
                      <span className="text-[11px] text-slate-500 font-medium">50 minutos por aula</span>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse min-w-[700px]">
                        <thead>
                          <tr className="bg-slate-100 text-slate-700 text-xs font-bold border-b border-slate-200">
                            <th className="py-3 px-3 w-32 text-center border-r border-slate-200">Aula / Período</th>
                            {GRADE_DIAS_SEMANA.map((dia) => {
                              const dias =
                                Array.isArray(activeSpecialist?.val.diasDisponiveis) &&
                                activeSpecialist!.val.diasDisponiveis!.length > 0
                                  ? activeSpecialist!.val.diasDisponiveis!
                                  : [1, 2, 3, 4, 5];
                              const folga = !dias.includes(dia.id);
                              return (
                                <th
                                  key={dia.id}
                                  className={`py-3 px-3 text-center border-r border-slate-200 last:border-r-0 ${
                                    folga ? 'bg-rose-50/70 text-rose-800' : ''
                                  }`}
                                >
                                  <span className="block text-sm">{dia.nome}</span>
                                  {folga ? (
                                    <span className="text-[10px] font-bold text-rose-600">🏖️ Folga</span>
                                  ) : (
                                    <span className="text-[10px] font-normal text-slate-500">Aulas</span>
                                  )}
                                </th>
                              );
                            })}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-xs">
                          {/* Aulas 1 a 3 */}
                          {[1, 2, 3].map((ordem) => {
                            const def = aulasDef.find((a) => a.ordem === ordem);
                            return (
                              <tr key={ordem} className="hover:bg-slate-50/60 transition">
                                <td className="py-3 px-2 text-center bg-slate-50/50 font-bold border-r border-slate-200 text-slate-800">
                                  {ordem}ª Aula
                                  <span className="block text-[10px] text-slate-400 font-normal">{def?.label}</span>
                                </td>
                                {GRADE_DIAS_SEMANA.map((dia) => {
                                  const dias =
                                    Array.isArray(activeSpecialist?.val.diasDisponiveis) &&
                                    activeSpecialist!.val.diasDisponiveis!.length > 0
                                      ? activeSpecialist!.val.diasDisponiveis!
                                      : [1, 2, 3, 4, 5];
                                  const folga = !dias.includes(dia.id);
                                  const slotKey = `${turnoKey}_${dia.id}_${ordem}`;
                                  const item = specialistWeeklyGrid[slotKey];

                                  if (folga) {
                                    return (
                                      <td
                                        key={dia.id}
                                        className="p-2 border-r border-slate-100 last:border-r-0 bg-rose-50/30 text-center"
                                      >
                                        <span className="text-[11px] text-rose-400 italic">Dia Livre</span>
                                      </td>
                                    );
                                  }

                                  return (
                                    <td key={dia.id} className="p-2 border-r border-slate-100 last:border-r-0 align-top">
                                      {item ? (
                                        <div className="p-2.5 rounded-xl border bg-gradient-to-br from-indigo-50 to-indigo-100/70 border-indigo-200 text-indigo-950 shadow-2xs">
                                          <div className="flex items-center justify-between mb-1">
                                            <span className="font-extrabold text-xs text-indigo-900">
                                              {item.turma.year}º {item.turma.letter}
                                            </span>
                                            <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-indigo-200/80 text-indigo-800">
                                              {item.turma.shift}
                                            </span>
                                          </div>
                                          <p className="text-[11px] font-semibold text-slate-700 truncate">
                                            {item.slot.disciplinaNome}
                                          </p>
                                          {item.slot.horarioCustomInicio ? (
                                            <span className="text-[10px] text-amber-700 font-bold block mt-0.5">
                                              ⏱️ {item.slot.horarioCustomInicio} – {item.slot.horarioCustomFim}
                                            </span>
                                          ) : null}
                                          {item.slot.observacao ? (
                                            <span
                                              className="text-[10px] text-indigo-700 italic block mt-0.5 truncate"
                                              title={item.slot.observacao}
                                            >
                                              📝 {item.slot.observacao}
                                            </span>
                                          ) : null}
                                          <p className="text-[10px] text-slate-500 truncate mt-0.5">
                                            {schools[item.turma.schoolId]?.name || item.turma.schoolName}
                                          </p>
                                        </div>
                                      ) : (
                                        <div className="h-14 rounded-xl border border-dashed border-slate-200 flex items-center justify-center text-slate-300 text-[11px]">
                                          —
                                        </div>
                                      )}
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}

                          {/* Linha de Intervalo */}
                          <tr className="bg-amber-50/50 border-y border-amber-200 text-amber-900 font-semibold text-[11px]">
                            <td className="py-2 px-2 text-center border-r border-amber-200 font-bold bg-amber-100/50">
                              <Coffee className="w-3.5 h-3.5 mx-auto mb-0.5 text-amber-700" />
                              Intervalo
                            </td>
                            <td colSpan={5} className="py-2 px-4 text-center">
                              {isManha ? (
                                <span>
                                  🥪 Recreio Matutino: <strong>Grupo A (09:30 – 09:50)</strong> •{' '}
                                  <strong>Grupo B (10:00 – 10:20)</strong>
                                </span>
                              ) : (
                                <span>
                                  🥪 Recreio Vespertino: <strong>15:00 às 15:20 (20 min)</strong>
                                </span>
                              )}
                            </td>
                          </tr>

                          {/* Aulas 4 e 5 */}
                          {[4, 5].map((ordem) => {
                            const def = aulasDef.find((a) => a.ordem === ordem);
                            return (
                              <tr key={ordem} className="hover:bg-slate-50/60 transition">
                                <td className="py-3 px-2 text-center bg-slate-50/50 font-bold border-r border-slate-200 text-slate-800">
                                  {ordem}ª Aula
                                  <span className="block text-[10px] text-slate-400 font-normal">{def?.label}</span>
                                </td>
                                {GRADE_DIAS_SEMANA.map((dia) => {
                                  const dias =
                                    Array.isArray(activeSpecialist?.val.diasDisponiveis) &&
                                    activeSpecialist!.val.diasDisponiveis!.length > 0
                                      ? activeSpecialist!.val.diasDisponiveis!
                                      : [1, 2, 3, 4, 5];
                                  const folga = !dias.includes(dia.id);
                                  const slotKey = `${turnoKey}_${dia.id}_${ordem}`;
                                  const item = specialistWeeklyGrid[slotKey];

                                  if (folga) {
                                    return (
                                      <td
                                        key={dia.id}
                                        className="p-2 border-r border-slate-100 last:border-r-0 bg-rose-50/30 text-center"
                                      >
                                        <span className="text-[11px] text-rose-400 italic">Dia Livre</span>
                                      </td>
                                    );
                                  }

                                  return (
                                    <td key={dia.id} className="p-2 border-r border-slate-100 last:border-r-0 align-top">
                                      {item ? (
                                        <div className="p-2.5 rounded-xl border bg-gradient-to-br from-indigo-50 to-indigo-100/70 border-indigo-200 text-indigo-950 shadow-2xs">
                                          <div className="flex items-center justify-between mb-1">
                                            <span className="font-extrabold text-xs text-indigo-900">
                                              {item.turma.year}º {item.turma.letter}
                                            </span>
                                            <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-indigo-200/80 text-indigo-800">
                                              {item.turma.shift}
                                            </span>
                                          </div>
                                          <p className="text-[11px] font-semibold text-slate-700 truncate">
                                            {item.slot.disciplinaNome}
                                          </p>
                                          {item.slot.horarioCustomInicio ? (
                                            <span className="text-[10px] text-amber-700 font-bold block mt-0.5">
                                              ⏱️ {item.slot.horarioCustomInicio} – {item.slot.horarioCustomFim}
                                            </span>
                                          ) : null}
                                          {item.slot.observacao ? (
                                            <span
                                              className="text-[10px] text-indigo-700 italic block mt-0.5 truncate"
                                              title={item.slot.observacao}
                                            >
                                              📝 {item.slot.observacao}
                                            </span>
                                          ) : null}
                                          <p className="text-[10px] text-slate-500 truncate mt-0.5">
                                            {schools[item.turma.schoolId]?.name || item.turma.schoolName}
                                          </p>
                                        </div>
                                      ) : (
                                        <div className="h-14 rounded-xl border border-dashed border-slate-200 flex items-center justify-center text-slate-300 text-[11px]">
                                          —
                                        </div>
                                      )}
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              };

              // Determina quais tabelas exibir conforme aba selecionada e aulas ativas
              const showManha =
                specialistShiftTab === 'manha' ||
                (specialistShiftTab === 'todos' &&
                  (specialistActiveTurnos.has('manha') || !specialistActiveTurnos.has('tarde')));

              const showTarde =
                specialistShiftTab === 'tarde' ||
                (specialistShiftTab === 'todos' &&
                  (specialistActiveTurnos.has('tarde') || specialistActiveTurnos.size === 0));

              return (
                <div className="space-y-6">
                  {showManha && renderShiftTable('manha')}
                  {showTarde && renderShiftTable('tarde')}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODO 3: ESCALA GERAL DA ESCOLA (VISÃO DA COORDENAÇÃO)                     */}
      {/* ========================================================================= */}
      {viewMode === 'overview' && (
        <div className="space-y-5">
          <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-5">
            <h3 className="text-base font-bold text-slate-800 mb-2">
              Escala Semanal de Especialistas por Dia da Semana
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Visão consolidada para coordenação pedagógica acompanhar a presença de cada especialista na escola.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              {GRADE_DIAS_SEMANA.map((dia) => {
                const presentes = teachers.filter((t) => {
                  if (!isSpecialistTeacher(t.val)) return false;
                  const dias = Array.isArray(t.val.diasDisponiveis) && t.val.diasDisponiveis.length > 0 ? t.val.diasDisponiveis : [1, 2, 3, 4, 5];
                  return dias.includes(dia.id);
                });

                const folgas = teachers.filter((t) => {
                  if (!isSpecialistTeacher(t.val)) return false;
                  const dias = Array.isArray(t.val.diasDisponiveis) && t.val.diasDisponiveis.length > 0 ? t.val.diasDisponiveis : [1, 2, 3, 4, 5];
                  return !dias.includes(dia.id);
                });

                return (
                  <div key={dia.id} className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-3">
                    <div className="border-b border-slate-200 pb-2">
                      <h4 className="font-extrabold text-sm text-slate-800">{dia.nome}</h4>
                      <span className="text-[10px] font-semibold text-emerald-600">
                        {presentes.length} especialista(s) presente(s)
                      </span>
                    </div>

                    <div className="space-y-1.5">
                      <span className="text-[10px] font-bold uppercase text-slate-400 block">Atuando:</span>
                      {presentes.length === 0 ? (
                        <p className="text-[11px] text-slate-400 italic">Nenhum especialista</p>
                      ) : (
                        presentes.map((p) => (
                          <div key={p.id} className="text-xs font-semibold text-slate-700 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                            <span className="truncate" title={p.val.name}>{p.val.name}</span>
                            <span className="text-[10px] text-slate-400 font-normal">({p.val.subject})</span>
                          </div>
                        ))
                      )}
                    </div>

                    {folgas.length > 0 && (
                      <div className="space-y-1 pt-2 border-t border-slate-200">
                        <span className="text-[10px] font-bold uppercase text-rose-500 block">Folga / Ausente:</span>
                        {folgas.map((f) => (
                          <div key={f.id} className="text-xs text-rose-700 flex items-center gap-1 line-through opacity-75">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-400"></span>
                            <span className="truncate">{f.val.name}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: EDITOR DE HORÁRIO / ALOCAÇÃO DE ESPECIALISTA                       */}
      {/* ========================================================================= */}
      {slotEditorOpen && selectedClass && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-4 bg-gradient-to-r from-indigo-600 to-indigo-700 text-white flex items-center justify-between">
              <div>
                <h3 className="font-bold text-base">Alocar Aula / Especialista</h3>
                <p className="text-xs text-indigo-100">
                  {GRADE_DIAS_SEMANA.find((d) => d.id === activeSlotDia)?.nome} • {activeSlotOrdem}ª Aula
                  {' '}({bellSchedule.aulas.find((a) => a.ordem === activeSlotOrdem)?.inicio} às {bellSchedule.aulas.find((a) => a.ordem === activeSlotOrdem)?.fim})
                </p>
              </div>
              <button
                onClick={() => setSlotEditorOpen(false)}
                className="p-1 rounded-lg text-indigo-100 hover:text-white hover:bg-white/10 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Escolha da Disciplina Estritamente Cadastrada no Banco */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Aula / Disciplina (Cadastradas no Banco):
                </label>
                {subjects.length === 0 ? (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
                    ⚠️ Nenhuma disciplina encontrada no banco de dados. Cadastre as disciplinas da sua escola em <strong>Disciplinas & Matérias</strong>.
                  </div>
                ) : (
                  <select
                    value={slotSubjectId}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSlotSubjectId(val);
                      const subSelected = subjects.find((s) => s.id === val);
                      if (subSelected) {
                        const match = teachers.find(
                          (t) => (t.val.subject || '').trim().toLowerCase() === (subSelected.name || '').trim().toLowerCase()
                        );
                        if (match) {
                          setSlotTeacherId(match.id);
                        } else if (subSelected.category === 'regente' && selectedClass.teacherId) {
                          setSlotTeacherId(selectedClass.teacherId);
                        }
                      }
                    }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-semibold text-slate-800 bg-white outline-none focus:ring-2 focus:ring-indigo-500"
                    required
                  >
                    <option value="">Selecione uma disciplina cadastrada no banco...</option>
                    {subjects.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} {s.shortName ? `(${s.shortName})` : ''} {s.category === 'diversificada' ? '— Especialista' : ''}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Seletor de Professor */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Professor(a) Responsável:
                </label>
                <select
                  value={slotTeacherId}
                  onChange={(e) => setSlotTeacherId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-medium text-slate-800 bg-white outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">Selecione o professor...</option>
                  {teachers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.val.name} ({t.val.subject || 'Polivalente'})
                    </option>
                  ))}
                </select>
              </div>

              {/* Verificação em tempo real de Folga e Choque (Flexível / Não Bloqueante) */}
              {slotTeacherId && (() => {
                const selectedTeacherObj = teachers.find((t) => t.id === slotTeacherId)?.val;
                const avail = checkTeacherAvailability(selectedTeacherObj, activeSlotDia);
                const conflict = checkTeacherConflict(
                  slotTeacherId,
                  activeSlotDia,
                  activeSlotOrdem,
                  selectedClassId,
                  horarioCustomInicio,
                  horarioCustomFim
                );

                return (
                  <div className="space-y-2">
                    {!avail.available && (
                      <div className="p-3 bg-amber-50 border border-amber-300 rounded-xl flex items-start gap-2.5 text-amber-900 text-xs">
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                        <div>
                          <strong>Aviso de Folga / Dia Livre:</strong>
                          <p className="mt-0.5">{avail.reason}.</p>
                        </div>
                      </div>
                    )}

                    {conflict.hasConflict && (
                      <div className="p-3 bg-amber-50 border border-amber-300 rounded-xl flex items-start gap-2.5 text-amber-950 text-xs">
                        <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                        <div>
                          <strong>Aviso de Alocação Paralela / Intercalação:</strong>
                          <p className="mt-0.5">
                            Este professor já possui horário registrado em <strong>{conflict.conflictingClassDesc}</strong>. Se for um remanejamento ou intercalação entre grupos, você pode salvar normalmente como ajuste pontual.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Ajuste Pontual de Horário e Observação (Intercalação de Turmas) */}
              <div className="border border-slate-200 rounded-xl p-3 bg-slate-50/70 space-y-2">
                <button
                  type="button"
                  onClick={() => setIsCustomHorarioOpen(!isCustomHorarioOpen)}
                  className="flex items-center justify-between w-full text-xs font-bold text-slate-700 cursor-pointer"
                >
                  <span className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-indigo-600" />
                    Ajuste Pontual de Horário / Observação
                  </span>
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isCustomHorarioOpen ? 'rotate-180' : ''}`} />
                </button>

                {isCustomHorarioOpen && (
                  <div className="pt-2 space-y-2.5 border-t border-slate-200">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">
                          Início Pontual (opcional):
                        </label>
                        <input
                          type="time"
                          value={horarioCustomInicio}
                          onChange={(e) => setHorarioCustomInicio(e.target.value)}
                          className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">
                          Término Pontual (opcional):
                        </label>
                        <input
                          type="time"
                          value={horarioCustomFim}
                          onChange={(e) => setHorarioCustomFim(e.target.value)}
                          className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">
                        Observação / Motivo (ex.: Subir aula pontual, Intercalação com 1ºB):
                      </label>
                      <input
                        type="text"
                        value={slotObservacao}
                        onChange={(e) => setSlotObservacao(e.target.value)}
                        placeholder="Ex.: Aula adiantada pontualmente"
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Ações de Remanejamento Rápido no Modal */}
              <div className="border border-indigo-100 rounded-xl p-3 bg-indigo-50/50 space-y-2">
                <span className="text-xs font-bold text-indigo-950 block">
                  Remanejamento de Posição da Aula:
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  {activeSlotOrdem > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        handleMoveOrdem(activeSlotDia, activeSlotOrdem, 'up');
                        setSlotEditorOpen(false);
                      }}
                      className="inline-flex items-center gap-1 px-3 py-1.5 bg-white border border-indigo-200 text-indigo-700 rounded-lg text-xs font-bold hover:bg-indigo-50 transition shadow-2xs cursor-pointer"
                      title="Subir aula para a aula anterior com permuta automática"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                      Subir Aula ({activeSlotOrdem}ª ➔ {activeSlotOrdem - 1}ª)
                    </button>
                  )}
                  {activeSlotOrdem < 5 && (
                    <button
                      type="button"
                      onClick={() => {
                        handleMoveOrdem(activeSlotDia, activeSlotOrdem, 'down');
                        setSlotEditorOpen(false);
                      }}
                      className="inline-flex items-center gap-1 px-3 py-1.5 bg-white border border-indigo-200 text-indigo-700 rounded-lg text-xs font-bold hover:bg-indigo-50 transition shadow-2xs cursor-pointer"
                      title="Descer aula para a aula seguinte com permuta automática"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                      Descer Aula ({activeSlotOrdem}ª ➔ {activeSlotOrdem + 1}ª)
                    </button>
                  )}
                </div>
              </div>

              {/* Opção de Bloco Dobrado (2 Aulas Geminadas) */}
              <div className="p-3 bg-indigo-50/70 border border-indigo-200 rounded-xl flex items-start gap-3">
                <input
                  id="chk-apply-doubled"
                  type="checkbox"
                  checked={applyDoubled}
                  onChange={(e) => setApplyDoubled(e.target.checked)}
                  className="mt-0.5 w-4 h-4 text-indigo-600 rounded border-indigo-300 focus:ring-indigo-500 cursor-pointer"
                />
                <div>
                  <label htmlFor="chk-apply-doubled" className="text-xs font-bold text-indigo-900 cursor-pointer">
                    Alocar também na aula consecutiva (bloco de 2 aulas)
                  </label>
                  <p className="text-[11px] text-indigo-700 leading-snug mt-0.5">
                    Opcional: replica a mesma aula no horário adjacente. Deixe desmarcado para aulas avulsas de 50 minutos.
                  </p>
                </div>
              </div>
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setSlotEditorOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200 rounded-xl transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveSlot}
                disabled={saving}
                className="px-5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-xs transition cursor-pointer flex items-center gap-1.5"
              >
                {saving ? 'Gravando...' : 'Confirmar Horário'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
