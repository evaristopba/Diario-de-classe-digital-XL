import React, { useState, useEffect, useMemo } from 'react';
import { EventOccurrence, EventType, ClassRoom, Student, ModalConfig, ScreenType } from '../types';
import {
  get,
  ref,
  push,
  update,
  remove,
  rtdb,
  dc,
  carregarMinhasTurmas,
  getTodayDateString
} from '../lib/firebase';
import { formatFriendlyError } from '../lib/errorHandler';
import { formatDate } from '../lib/reports';
import {
  AlertCircle,
  Plus,
  Edit2,
  Trash2,
  X,
  Filter,
  CheckSquare,
  Square,
  RotateCcw,
  Search,
  Users,
  Check,
  Sparkles,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  CalendarCheck,
  CalendarX,
  Clock
} from 'lucide-react';

interface EventsScreenProps {
  currentTeacher: string;
  currentYear: string;
  setModal: (config: ModalConfig) => void;
  onNavigate?: (screen: ScreenType) => void;
}

export const EventsScreen: React.FC<EventsScreenProps> = ({
  currentTeacher,
  currentYear,
  setModal,
  onNavigate
}) => {
  const [classes, setClasses] = useState<{ id: string; val: ClassRoom }[]>([]);
  const [eventTypes, setEventTypes] = useState<{ id: string; val: EventType }[]>([]);
  const [students, setStudents] = useState<{ id: string; val: Student }[]>([]);

  const [selectedClassId, setSelectedClassId] = useState('');
  const [selectedBimester, setSelectedBimester] = useState('1');
  const [selectedDate, setSelectedDate] = useState<string>(() => getTodayDateString());
  const [typeId, setTypeId] = useState('');
  const [studentId, setStudentId] = useState(''); // Usado no modo de edição individual
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]); // Usado para lançamento em lote
  const [studentSearch, setStudentSearch] = useState('');
  const [description, setDescription] = useState('');

  // Estado da chamada na data e turma selecionadas
  const [attendanceStatusMap, setAttendanceStatusMap] = useState<Record<string, string>>({});
  const [isAttendanceDone, setIsAttendanceDone] = useState<boolean | null>(null); // null = carregando, true = realizada, false = pendente
  const [loadingAttendance, setLoadingAttendance] = useState(false);

  // Filtros da listagem de ocorrências registradas
  const [filterClassId, setFilterClassId] = useState('');
  const [filterBimester, setFilterBimester] = useState('');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [filterSearch, setFilterSearch] = useState('');

  // Seleção de ocorrências no histórico para exclusão em lote
  const [selectedEventIdsForDeletion, setSelectedEventIdsForDeletion] = useState<string[]>([]);

  const [events, setEvents] = useState<{ id: string; val: EventOccurrence }[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadInitialData = async () => {
    try {
      const turmas = await carregarMinhasTurmas();
      const filtered = turmas.filter(
        (r) => !r.val.anoLetivo || !currentYear || String(r.val.anoLetivo).trim() === String(currentYear).trim()
      );
      setClasses(filtered);
      if (filtered.length > 0 && !selectedClassId) {
        setSelectedClassId(filtered[0].id);
      }

      const typesSnap = await get(ref(rtdb, 'diario-classe/tipos-evento'));
      const typesVal = typesSnap.val() || {};
      const tArr: { id: string; val: EventType }[] = [];
      Object.keys(typesVal).forEach((k) => tArr.push({ id: k, val: typesVal[k] }));
      setEventTypes(tArr);
    } catch (err) {
      console.error(err);
    }
  };

  const loadStudentsForClass = async (classId: string) => {
    if (!classId) return setStudents([]);
    try {
      const snap = await get(ref(rtdb, `diario-classe/turmas/${classId}/alunos`));
      const val = snap.val() || {};
      const list: { id: string; val: Student }[] = [];
      Object.keys(val).forEach((k) => {
        const s = val[k];
        if (!s.anoLetivo || s.anoLetivo === currentYear) {
          list.push({ id: k, val: s });
        }
      });
      list.sort((a, b) => (a.val.number || 0) - (b.val.number || 0));
      setStudents(list);
    } catch (err) {
      console.error(err);
    }
  };

  const checkAttendanceForClassAndDate = async (classId: string, bimester: string, date: string) => {
    if (!classId || !bimester || !date) {
      setIsAttendanceDone(null);
      setAttendanceStatusMap({});
      return;
    }
    try {
      setLoadingAttendance(true);
      const snap = await get(ref(rtdb, dc('chamada')));
      const val = snap.val() || {};
      const map: Record<string, string> = {};
      let totalFound = 0;

      Object.keys(val).forEach((k) => {
        const rec = val[k];
        if (
          rec.classId === classId &&
          rec.date === date &&
          (!rec.anoLetivo || rec.anoLetivo === currentYear) &&
          String(rec.bimester) === String(bimester)
        ) {
          map[rec.studentId] = rec.status;
          totalFound++;
        }
      });

      setAttendanceStatusMap(map);
      setIsAttendanceDone(totalFound > 0);
    } catch (err) {
      console.error('Erro ao verificar lista de presença:', err);
      setIsAttendanceDone(false);
    } finally {
      setLoadingAttendance(false);
    }
  };

  const loadEvents = async () => {
    try {
      setLoading(true);
      const snap = await get(ref(rtdb, dc('eventos')));
      const val = snap.val() || {};
      const list: { id: string; val: EventOccurrence }[] = [];
      Object.keys(val).forEach((k) => {
        const ev = val[k];
        if (!ev.anoLetivo || ev.anoLetivo === currentYear) {
          if (!filterClassId || ev.classId === filterClassId) {
            if (!filterBimester || String(ev.bimester) === String(filterBimester)) {
              list.push({ id: k, val: ev });
            }
          }
        }
      });
      list.sort((a, b) => (b.val.date || '').localeCompare(a.val.date || ''));
      setEvents(list);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInitialData();
  }, [currentYear]);

  useEffect(() => {
    if (selectedClassId) {
      loadStudentsForClass(selectedClassId);
      if (!editingId) {
        setSelectedStudentIds([]);
      }
      setStudentSearch('');
    }
  }, [selectedClassId, currentYear]);

  // Checa a presença na chamada sempre que a turma, bimestre ou data mudarem
  useEffect(() => {
    if (selectedClassId && selectedBimester && selectedDate) {
      checkAttendanceForClassAndDate(selectedClassId, selectedBimester, selectedDate);
      if (!editingId) {
        setSelectedStudentIds([]);
      }
    } else {
      setIsAttendanceDone(null);
      setAttendanceStatusMap({});
    }
  }, [selectedClassId, selectedBimester, selectedDate, currentYear]);

  useEffect(() => {
    loadEvents();
  }, [filterClassId, filterBimester, currentYear]);

  // Mantém a data escolhida pelo usuário sem sobreposição acidental de timers ou eventos de foco
  useEffect(() => {
    if (!editingId) {
      setSelectedDate((prev) => prev || getTodayDateString());
    }
  }, [editingId]);

  // Alunos elegíveis para ocorrências (exclui transferências expedidas)
  const eligibleStudents = useMemo(() => {
    return students.filter((s) => s.val.status !== 'expedida');
  }, [students]);

  // Alunos PRESENTES na data selecionada (status === 'P' na chamada)
  const presentStudents = useMemo(() => {
    if (!isAttendanceDone) return [];
    return eligibleStudents.filter((s) => attendanceStatusMap[s.id] === 'P');
  }, [eligibleStudents, isAttendanceDone, attendanceStatusMap]);

  // Alunos AUSENTES na data selecionada (faltas ou pendências)
  const absentStudents = useMemo(() => {
    if (!isAttendanceDone) return [];
    return eligibleStudents.filter((s) => attendanceStatusMap[s.id] !== 'P');
  }, [eligibleStudents, isAttendanceDone, attendanceStatusMap]);

  // Alunos filtrados pela busca local no formulário
  const filteredFormStudents = useMemo(() => {
    if (!studentSearch.trim()) return students;
    const q = studentSearch.toLowerCase().trim();
    return students.filter((s) => {
      const nameMatch = (s.val.name || '').toLowerCase().includes(q);
      const numMatch = String(s.val.number || '').includes(q);
      return nameMatch || numMatch;
    });
  }, [students, studentSearch]);

  // Alunos filtrados que são elegíveis E ESTAVAM PRESENTES
  const filteredPresentStudents = useMemo(() => {
    return filteredFormStudents.filter(
      (s) => s.val.status !== 'expedida' && attendanceStatusMap[s.id] === 'P'
    );
  }, [filteredFormStudents, attendanceStatusMap]);

  // Manipuladores de seleção de alunos (em lote ou pontual)
  const handleToggleStudent = (sId: string) => {
    const targetStudent = students.find((s) => s.id === sId)?.val;
    if (targetStudent?.status === 'expedida') return;

    // Se a chamada ainda não foi realizada nesta data, bloqueia seleção
    if (!isAttendanceDone) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Chamada Obrigatória',
        message: `⛔ A chamada do dia ${formatDate(selectedDate)} ainda não foi realizada nesta turma. Realize e salve a chamada antes de lançar ocorrências.`,
        icon: '⚠️'
      });
      return;
    }

    // Se o aluno não estava presente na data da chamada:
    if (attendanceStatusMap[sId] !== 'P') {
      // Se já estava selecionado, desmarca diretamente
      if (selectedStudentIds.includes(sId)) {
        setSelectedStudentIds((prev) => prev.filter((id) => id !== sId));
        return;
      }

      // Se ainda não estava selecionado, solicita confirmação para inclusão pontual consciente
      const attStatus = attendanceStatusMap[sId];
      const motivo = attStatus === 'FJ' ? 'Falta Justificada' : 'Falta (Não Justificada)';
      setModal({
        isOpen: true,
        type: 'confirm',
        title: 'Lançamento Pontual para Aluno Ausente',
        message: `O(A) estudante ${targetStudent?.name || ''} constava com ${motivo} na chamada do dia ${formatDate(selectedDate)}.\n\nDeseja incluir este aluno nesta ocorrência específica?\n(Ex: falta em avaliação ou trabalho, entrega de atestado médico, justificativa de ausência ou comunicação aos responsáveis)`,
        icon: '⚠️',
        onConfirm: () => {
          setSelectedStudentIds((prev) => [...prev, sId]);
        }
      });
      return;
    }

    // Aluno presente: marca/desmarca normalmente
    setSelectedStudentIds((prev) =>
      prev.includes(sId) ? prev.filter((id) => id !== sId) : [...prev, sId]
    );
  };

  const handleSelectAll = () => {
    if (!isAttendanceDone) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Chamada Obrigatória',
        message: `⛔ Realize a chamada do dia ${formatDate(selectedDate)} antes de selecionar alunos para ocorrência.`,
        icon: '⚠️'
      });
      return;
    }

    // Seleciona APENAS quem esteve presente!
    setSelectedStudentIds(presentStudents.map((s) => s.id));
  };

  const handleDeselectAll = () => {
    setSelectedStudentIds([]);
  };

  const handleInvertSelection = () => {
    if (!isAttendanceDone) return;
    // Inverte a seleção apenas entre os alunos que estavam presentes!
    const presentIds = presentStudents.map((s) => s.id);
    setSelectedStudentIds((prev) => presentIds.filter((id) => !prev.includes(id)));
  };

  const handleSelectFiltered = () => {
    if (!isAttendanceDone) return;
    const filteredPresentIds = filteredPresentStudents.map((s) => s.id);
    setSelectedStudentIds((prev) => Array.from(new Set([...prev, ...filteredPresentIds])));
  };

  const handleDeselectFiltered = () => {
    const filteredSet = new Set(filteredFormStudents.map((s) => s.id));
    setSelectedStudentIds((prev) => prev.filter((id) => !filteredSet.has(id)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedClassId || !selectedBimester || !selectedDate || !typeId || !description.trim()) {
      return setModal({
        isOpen: true,
        type: 'alert',
        title: 'Atenção',
        message: 'Preencha todos os campos obrigatórios (Turma, Bimestre, Data, Tipo e Descrição)!',
        icon: '⚠️'
      });
    }

    // Validação estrita de chamada realizada (Caminho 1 - Bloqueio Pedagógico)
    if (!isAttendanceDone) {
      return setModal({
        isOpen: true,
        type: 'alert',
        title: 'Chamada Não Realizada',
        message: `⛔ A chamada da turma no dia ${formatDate(selectedDate)} (${selectedBimester}º Bimestre) ainda não foi realizada.\n\nPara garantir a coerência dos registros e evitar apontar ocorrências para estudantes que possam estar ausentes, realize e salve a chamada antes de registrar ocorrências.`,
        icon: '⛔'
      });
    }

    const typeObj = eventTypes.find((t) => t.id === typeId)?.val;
    const typeName = typeObj ? typeObj.name : 'Geral';

    if (editingId) {
      // Edição de uma ocorrência existente (aluno individual)
      if (!studentId) {
        return setModal({
          isOpen: true,
          type: 'alert',
          title: 'Atenção',
          message: 'Selecione o aluno da ocorrência!',
          icon: '⚠️'
        });
      }

      const targetStudent = students.find((s) => s.id === studentId)?.val;
      if (targetStudent?.status === 'expedida') {
        return setModal({
          isOpen: true,
          type: 'alert',
          title: 'Operação Não Permitida',
          message: '⛔ Não é possível atualizar ocorrências para alunos com transferência expedida.',
          icon: '⛔'
        });
      }

      const isAbsent = isAttendanceDone && attendanceStatusMap[studentId] !== 'P';

      const data: any = {
        classId: selectedClassId,
        bimester: selectedBimester,
        date: selectedDate,
        typeId,
        type: typeName,
        studentId,
        description: description.trim(),
        teacher: currentTeacher,
        anoLetivo: currentYear,
        absentOnDate: isAbsent,
        studentAttendanceStatus: isAbsent ? (attendanceStatusMap[studentId] || 'F') : 'P',
        updatedAt: Date.now()
      };

      try {
        await update(ref(rtdb, dc(`eventos/${editingId}`)), data);
        setModal({
          isOpen: true,
          type: 'alert',
          title: 'Sucesso',
          message: 'Ocorrência atualizada com sucesso!',
          icon: '✅'
        });
        setDescription('');
        setEditingId(null);
        setStudentId('');
        setSelectedStudentIds([]);
        setSelectedDate(getTodayDateString());
        loadEvents();
      } catch (err: any) {
        setModal({
          isOpen: true,
          type: 'alert',
          title: 'Erro ao Salvar Evento',
          message: formatFriendlyError(err, 'Não foi possível salvar o registro de ocorrência'),
          icon: '❌'
        });
      }
    } else {
      // Lançamento em lote ou individual (um ou múltiplos alunos)
      if (selectedStudentIds.length === 0) {
        return setModal({
          isOpen: true,
          type: 'alert',
          title: 'Nenhum Aluno Selecionado',
          message: 'Selecione pelo menos um aluno para registrar a ocorrência.',
          icon: '⚠️'
        });
      }

      // Filtra alunos que não são expedidos
      const validStudentIds = selectedStudentIds.filter((sId) => {
        const targetStudent = students.find((s) => s.id === sId)?.val;
        return targetStudent && targetStudent.status !== 'expedida';
      });

      if (validStudentIds.length === 0) {
        return setModal({
          isOpen: true,
          type: 'alert',
          title: 'Nenhum Aluno Apto',
          message: '⛔ Nenhum aluno elegível selecionado. Alunos com transferência expedida não podem receber ocorrências.',
          icon: '⛔'
        });
      }

      const now = Date.now();
      const updates: Record<string, any> = {};

      for (const sId of validStudentIds) {
        const isAbsent = isAttendanceDone && attendanceStatusMap[sId] !== 'P';
        const newRef = push(ref(rtdb, dc('eventos')));
        if (newRef.key) {
          updates[`${dc('eventos')}/${newRef.key}`] = {
            classId: selectedClassId,
            bimester: selectedBimester,
            date: selectedDate,
            typeId,
            type: typeName,
            studentId: sId,
            description: description.trim(),
            teacher: currentTeacher,
            anoLetivo: currentYear,
            absentOnDate: isAbsent,
            studentAttendanceStatus: isAbsent ? (attendanceStatusMap[sId] || 'F') : 'P',
            createdAt: now
          };
        }
      }

      try {
        await update(ref(rtdb), updates);
        const absentCount = validStudentIds.filter((id) => attendanceStatusMap[id] !== 'P').length;
        let successMessage = '';
        if (validStudentIds.length === 1) {
          successMessage = absentCount === 1
            ? 'Ocorrência pontual registrada com sucesso para o aluno ausente na data!'
            : 'Ocorrência registrada com sucesso para o aluno selecionado!';
        } else {
          successMessage = absentCount > 0
            ? `${validStudentIds.length} ocorrências registradas com sucesso (${absentCount} aluno(s) ausente(s) na data incluído(s) pontualmente)!`
            : `${validStudentIds.length} ocorrências registradas com sucesso em lote!`;
        }

        setModal({
          isOpen: true,
          type: 'alert',
          title: 'Sucesso',
          message: successMessage,
          icon: '✅'
        });

        setDescription('');
        setSelectedStudentIds([]);
        setEditingId(null);
        setSelectedDate(getTodayDateString());
        loadEvents();
      } catch (err: any) {
        setModal({
          isOpen: true,
          type: 'alert',
          title: 'Erro ao Salvar Eventos',
          message: formatFriendlyError(err, 'Não foi possível salvar os registros de ocorrência'),
          icon: '❌'
        });
      }
    }
  };

  const handleEdit = (item: { id: string; val: EventOccurrence }) => {
    setSelectedClassId(item.val.classId);
    setSelectedBimester(item.val.bimester || '1');
    setSelectedDate(item.val.date);
    setTypeId(item.val.typeId);
    setStudentId(item.val.studentId);
    setSelectedStudentIds([item.val.studentId]);
    setDescription(item.val.description);
    setEditingId(item.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCancelEdit = () => {
    setDescription('');
    setEditingId(null);
    setStudentId('');
    setSelectedStudentIds([]);
    setSelectedDate(getTodayDateString());
  };

  const handleDelete = (id: string) => {
    setModal({
      isOpen: true,
      type: 'confirm',
      title: 'Confirmar Exclusão',
      message: 'Tem certeza que deseja excluir esta ocorrência?',
      icon: '⚠️',
      danger: true,
      onConfirm: async () => {
        try {
          await remove(ref(rtdb, dc(`eventos/${id}`)));
          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Excluído',
            message: 'Ocorrência excluída com sucesso!',
            icon: '✅'
          });
          setSelectedEventIdsForDeletion((prev) => prev.filter((i) => i !== id));
          loadEvents();
        } catch (err: any) {
          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Erro ao Excluir Evento',
            message: formatFriendlyError(err, 'Não foi possível excluir a ocorrência'),
            icon: '❌'
          });
        }
      }
    });
  };

  // Exclusão em lote no histórico
  const handleToggleEventSelectionForDeletion = (id: string) => {
    setSelectedEventIdsForDeletion((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const handleDeleteSelectedBatch = () => {
    // Avalia estritamente contra o filtro atual para que apenas ocorrências visíveis sejam excluídas
    const visibleIdSet = new Set(filteredEventsList.map((item) => item.id));
    const targetIds = selectedEventIdsForDeletion.filter((id) => visibleIdSet.has(id));

    if (targetIds.length === 0) return;

    const count = targetIds.length;
    setModal({
      isOpen: true,
      type: 'confirm',
      title: 'Excluir Ocorrências em Lote',
      message: `Tem certeza que deseja excluir em lote as ${count} ocorrência(s) selecionada(s) no filtro atual? Esta ação é irreversível e removerá todos os registros selecionados do banco de dados.`,
      icon: '⚠️',
      danger: true,
      onConfirm: async () => {
        try {
          const updates: Record<string, any> = {};
          targetIds.forEach((id) => {
            updates[`${dc('eventos')}/${id}`] = null;
          });
          await update(ref(rtdb), updates);
          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Excluído com Sucesso',
            message: `${count} ocorrência(s) excluída(s) com sucesso em lote!`,
            icon: '✅'
          });
          setSelectedEventIdsForDeletion([]);
          loadEvents();
        } catch (err: any) {
          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Erro ao Excluir Ocorrências',
            message: formatFriendlyError(err, 'Não foi possível excluir as ocorrências em lote'),
            icon: '❌'
          });
        }
      }
    });
  };

  // Filtragem da lista de ocorrências já cadastradas (por Turma, Bimestre, Período e Busca Textual)
  const filteredEventsList = useMemo(() => {
    let result = events;

    // Filtro por Período (Data Inicial e Data Final)
    if (filterStartDate) {
      result = result.filter((item) => (item.val.date || '') >= filterStartDate);
    }
    if (filterEndDate) {
      result = result.filter((item) => (item.val.date || '') <= filterEndDate);
    }

    // Filtro por busca textual
    if (filterSearch.trim()) {
      const q = filterSearch.toLowerCase().trim();
      result = result.filter((item) => {
        const ev = item.val;
        const turma = classes.find((c) => c.id === ev.classId)?.val;
        const studentObj = turma?.alunos?.[ev.studentId];
        const sName = (studentObj?.name || '').toLowerCase();
        const sNum = String(studentObj?.number || '');
        const desc = (ev.description || '').toLowerCase();
        const type = (ev.type || '').toLowerCase();
        return sName.includes(q) || sNum.includes(q) || desc.includes(q) || type.includes(q);
      });
    }

    return result;
  }, [events, filterSearch, filterStartDate, filterEndDate, classes]);

  // Reavalia a seleção de ocorrências para exclusão em lote sempre que a lista filtrada for alterada
  // (por mudança de Turma, Bimestre, Período ou Busca), descartando seleções fantasmas de itens que não estão mais visíveis
  useEffect(() => {
    const visibleIdSet = new Set(filteredEventsList.map((item) => item.id));
    setSelectedEventIdsForDeletion((prev) => {
      const next = prev.filter((id) => visibleIdSet.has(id));
      if (next.length !== prev.length) {
        return next;
      }
      return prev;
    });
  }, [filteredEventsList]);

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6">
      <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-800 flex items-center gap-2">
            <AlertCircle className="w-6 h-6 text-indigo-600" />
            Eventos & Ocorrências
          </h2>
          <p className="text-xs sm:text-sm text-slate-500">
            Registro pedagógico e disciplinar de ocorrências individuais ou em lote integrado à chamada
          </p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 sm:p-6 shadow-xs mb-8">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base font-bold text-slate-800">
              {editingId ? 'Editar Ocorrência' : 'Nova Ocorrência'}
            </h3>
            {!editingId && (
              <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                Suporta lançamento em lote
              </span>
            )}
            {loadingAttendance && (
              <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full animate-pulse">
                <Clock className="w-3 h-3 text-indigo-600" />
                Verificando chamada...
              </span>
            )}
          </div>
          {editingId && (
            <button
              onClick={handleCancelEdit}
              className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-2.5 py-1 rounded-md transition-colors"
            >
              <X className="w-3 h-3" /> Cancelar Edição
            </button>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Parâmetros gerais: Turma, Bimestre, Data e Tipo de Evento */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Turma *
              </label>
              <select
                id="event-class-select"
                value={selectedClassId}
                onChange={(e) => setSelectedClassId(e.target.value)}
                className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                required
              >
                <option value="">Selecione a Turma</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.val.year}º {c.val.letter} — {c.val.shift} ({c.val.schoolName})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Bimestre *
              </label>
              <select
                id="event-bimester-select"
                value={selectedBimester}
                onChange={(e) => setSelectedBimester(e.target.value)}
                className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                required
              >
                <option value="1">1º Bimestre</option>
                <option value="2">2º Bimestre</option>
                <option value="3">3º Bimestre</option>
                <option value="4">4º Bimestre</option>
              </select>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-slate-700">
                  Data *
                </label>
                <button
                  type="button"
                  onClick={() => setSelectedDate(getTodayDateString())}
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded transition-colors inline-flex items-center gap-1 ${
                    selectedDate === getTodayDateString()
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : 'bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100'
                  }`}
                  title="Sincronizar com a data de hoje do servidor"
                >
                  <Calendar className="w-3 h-3" />
                  {selectedDate === getTodayDateString() ? 'Hoje ✓' : 'Definir Hoje'}
                </button>
              </div>
              <input
                id="event-date-input"
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-medium"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Tipo de Evento *
              </label>
              <select
                id="event-type-select"
                value={typeId}
                onChange={(e) => setTypeId(e.target.value)}
                className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                required
              >
                <option value="">Selecione o Tipo</option>
                {eventTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.val.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Bloqueio e Informações de Presença na Chamada (Caminho 1) */}
          {selectedClassId && selectedDate && isAttendanceDone === false && (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-xs text-rose-950 space-y-2.5">
              <div className="flex items-start gap-2.5">
                <CalendarX className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h4 className="font-bold text-sm text-rose-900 flex items-center gap-1.5">
                    Chamada Não Realizada Nesta Data ({formatDate(selectedDate)})
                  </h4>
                  <p className="text-rose-800 leading-relaxed">
                    Não foi localizada nenhuma lista de presença salva para esta turma no <strong>{selectedBimester}º Bimestre</strong> na data <strong>{formatDate(selectedDate)}</strong>.
                  </p>
                  <p className="text-rose-900 font-semibold leading-relaxed bg-rose-100/70 p-2.5 rounded-xl border border-rose-200/80">
                    🛡️ <strong>Regra de Integridade Pedagógica:</strong><br />
                    Para prevenir anotações equivocadas de ocorrências para alunos que possam ter faltado na data, <u>é obrigatório registrar e salvar a chamada antes de lançar qualquer ocorrência</u>.
                  </p>
                </div>
              </div>

              {onNavigate && (
                <div className="pt-1 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onNavigate('attendance-screen')}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-xl shadow-xs transition-colors"
                  >
                    <CalendarCheck className="w-4 h-4" />
                    Ir para a Chamada Desta Turma
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Seleção de Aluno(s): Em Lote no cadastro novo ou Individual na Edição */}
          {editingId ? (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Aluno Envolvido (Modo Edição Individual) *
              </label>
              <select
                id="event-student-select"
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
                className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                required
              >
                <option value="">Selecione o Aluno</option>
                {students
                  .filter((s) => s.val.status !== 'expedida' || s.id === studentId)
                  .map((s) => {
                    const isExpedido = s.val.status === 'expedida';
                    const attStatus = attendanceStatusMap[s.id];
                    const isPresente = attStatus === 'P';
                    return (
                      <option key={s.id} value={s.id}>
                        {s.val.number} - {s.val.name} {isExpedido ? '(Transferência Expedida)' : isAttendanceDone && !isPresente ? `(Ausente na Chamada - ${attStatus === 'FJ' ? 'Falta Justificada' : 'Falta'})` : isAttendanceDone && isPresente ? '(Presente ✓)' : ''}
                      </option>
                    );
                  })}
              </select>
            </div>
          ) : (
            <div className={`border rounded-xl p-3.5 space-y-3 transition-colors ${
              isAttendanceDone === false
                ? 'border-rose-200 bg-rose-50/20 opacity-70 cursor-not-allowed'
                : 'border-slate-200 bg-slate-50/60'
            }`}>
              {/* Notificação Pedagógica Explicando o Vínculo com a Chamada */}
              {isAttendanceDone === true && (
                <div>
                  {absentStudents.length > 0 ? (
                    <div className="p-3 bg-amber-50 border border-amber-200/90 rounded-xl text-xs text-amber-950 flex items-start gap-2.5">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <div className="space-y-1.5 flex-1">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="font-bold text-amber-900">
                            Frequência Vinculada à Chamada do Dia {formatDate(selectedDate)}
                          </span>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-200/80 text-amber-900">
                            {absentStudents.length} ausente(s) na data
                          </span>
                        </div>
                        <p className="text-amber-900/90 leading-relaxed">
                          Dos <strong>{eligibleStudents.length} alunos</strong> da turma, <strong>{presentStudents.length} estavam presentes</strong> e <strong>{absentStudents.length} {absentStudents.length === 1 ? 'teve falta' : 'tiveram faltas'}</strong> registradas nesta data.
                        </p>
                        <div className="bg-amber-100/70 p-2.5 rounded-lg border border-amber-200 text-amber-950 leading-relaxed font-medium space-y-1">
                          <div>
                            📌 <strong>Lançamento em Lote vs. Ocorrência Pontual:</strong>
                          </div>
                          <div>
                            • <strong>Em lote ("Todos Presentes"):</strong> seleciona automaticamente apenas os <strong>{presentStudents.length} alunos presentes</strong>, evitando ocorrências coletivas por engano para quem não esteve na aula.
                          </div>
                          <div>
                            • <strong>Específica para aluno ausente:</strong> se precisar registrar um fato pontual para quem faltou (ex: falta em avaliação/trabalho, entrega de atestado médico, justificativa ou comunicação aos responsáveis), <u>basta clicar diretamente no aluno ausente</u> na lista abaixo.
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="p-2.5 bg-emerald-50 border border-emerald-200/80 rounded-xl text-xs text-emerald-900 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>
                        <strong>Chamada 100% presente:</strong> Todos os <strong>{presentStudents.length} alunos</strong> ativos da turma estavam presentes no dia {formatDate(selectedDate)} e estão aptos a receber ocorrências.
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Cabeçalho da Seleção de Alunos */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <Users className="w-4 h-4 text-indigo-600" />
                    Aluno(s) Envolvido(s) *
                  </label>
                  {isAttendanceDone === true ? (
                    <span
                      className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                        selectedStudentIds.length > 0
                          ? 'bg-indigo-100 text-indigo-800 border border-indigo-200'
                          : 'bg-amber-100 text-amber-800 border border-amber-200'
                      }`}
                    >
                      {selectedStudentIds.length} selecionado(s) {selectedStudentIds.filter((id) => attendanceStatusMap[id] !== 'P').length > 0 ? `(${selectedStudentIds.filter((id) => attendanceStatusMap[id] !== 'P').length} ausente pontual)` : `de ${presentStudents.length} presentes`}
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
                      Chamada Pendente
                    </span>
                  )}
                </div>

                {/* Botões de Ação Rápida */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    type="button"
                    onClick={handleSelectAll}
                    disabled={!isAttendanceDone || presentStudents.length === 0}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg shadow-2xs transition-colors disabled:opacity-40"
                    title={
                      isAttendanceDone
                        ? `Selecionar todos os ${presentStudents.length} alunos presentes na chamada`
                        : 'Realize a chamada antes de selecionar'
                    }
                  >
                    <CheckSquare className="w-3.5 h-3.5 text-indigo-600" />
                    Todos Presentes ({presentStudents.length})
                  </button>
                  <button
                    type="button"
                    onClick={handleDeselectAll}
                    disabled={selectedStudentIds.length === 0}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg shadow-2xs transition-colors disabled:opacity-40"
                    title="Desmarcar todos os alunos"
                  >
                    <Square className="w-3.5 h-3.5 text-slate-500" />
                    Nenhum
                  </button>
                  <button
                    type="button"
                    onClick={handleInvertSelection}
                    disabled={!isAttendanceDone || presentStudents.length === 0}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg shadow-2xs transition-colors disabled:opacity-40"
                    title="Inverter seleção entre os alunos presentes"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-slate-600" />
                    Inverter
                  </button>
                </div>
              </div>

              {/* Barra de Filtro/Busca Rápida de Alunos */}
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    disabled={!isAttendanceDone}
                    value={studentSearch}
                    onChange={(e) => setStudentSearch(e.target.value)}
                    placeholder={
                      isAttendanceDone
                        ? "Filtrar alunos por número ou nome..."
                        : "Realize a chamada para liberar a busca de alunos..."
                    }
                    className="w-full pl-8 pr-7 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 disabled:bg-slate-100 disabled:text-slate-400"
                  />
                  {studentSearch && (
                    <button
                      type="button"
                      onClick={() => setStudentSearch('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>

                {studentSearch.trim() && isAttendanceDone && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={handleSelectFiltered}
                      className="px-2 py-1 text-[11px] font-semibold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-md transition-colors"
                    >
                      Marcar Filtrados Presentes ({filteredPresentStudents.length})
                    </button>
                    <button
                      type="button"
                      onClick={handleDeselectFiltered}
                      className="px-2 py-1 text-[11px] font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 rounded-md transition-colors"
                    >
                      Desmarcar Filtrados
                    </button>
                  </div>
                )}
              </div>

              {/* Lista/Grade de Alunos Selecionáveis */}
              {isAttendanceDone === false ? (
                <div className="py-6 text-center text-xs text-rose-700 bg-white rounded-lg border border-rose-200 font-medium">
                  🔒 A seleção de estudantes está bloqueada pois a chamada do dia {formatDate(selectedDate)} ainda não foi realizada.
                </div>
              ) : students.length === 0 ? (
                <div className="py-6 text-center text-xs text-slate-400 bg-white rounded-lg border border-slate-200">
                  {selectedClassId ? 'Nenhum aluno cadastrado nesta turma.' : 'Selecione uma turma para carregar os alunos.'}
                </div>
              ) : filteredFormStudents.length === 0 ? (
                <div className="py-6 text-center text-xs text-slate-400 bg-white rounded-lg border border-slate-200">
                  Nenhum aluno corresponde à busca "{studentSearch}".
                </div>
              ) : (
                <div className="max-h-56 overflow-y-auto p-1.5 bg-white border border-slate-200 rounded-xl grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
                  {filteredFormStudents.map((s) => {
                    const isExpedido = s.val.status === 'expedida';
                    const isRecebida = s.val.status === 'recebida';
                    const attStatus = attendanceStatusMap[s.id];
                    const isPresente = attStatus === 'P';
                    const isSelected = selectedStudentIds.includes(s.id);

                    if (isExpedido) {
                      return (
                        <div
                          key={s.id}
                          className="flex items-center gap-2 p-2 rounded-lg border border-dashed border-slate-200 bg-slate-50/50 opacity-50 cursor-not-allowed text-xs"
                          title="Aluno com transferência expedida não pode receber ocorrências"
                        >
                          <span className="w-3.5 h-3.5 rounded border border-slate-300 flex items-center justify-center shrink-0 bg-slate-200" />
                          <span className="font-mono font-bold text-[11px] text-slate-400">
                            {s.val.number ? `Nº ${s.val.number}` : '--'}
                          </span>
                          <span className="truncate flex-1 text-slate-500 line-through">
                            {s.val.name}
                          </span>
                          <span className="text-[9px] font-semibold px-1 py-0.5 rounded bg-rose-100 text-rose-700 shrink-0">
                            Expedido
                          </span>
                        </div>
                      );
                    }

                    // Se a chamada foi feita e o aluno NÃO estava presente: permite inclusão pontual consciente
                    if (isAttendanceDone && !isPresente) {
                      if (isSelected) {
                        return (
                          <div
                            key={s.id}
                            role="checkbox"
                            aria-checked={true}
                            tabIndex={0}
                            onClick={() => handleToggleStudent(s.id)}
                            onKeyDown={(e) => {
                              if (e.key === ' ' || e.key === 'Enter') {
                                e.preventDefault();
                                handleToggleStudent(s.id);
                              }
                            }}
                            className="flex items-center gap-2 p-2 rounded-lg border border-amber-400 bg-amber-50 text-amber-950 text-xs cursor-pointer select-none transition-all shadow-2xs font-medium"
                            title="Aluno ausente na chamada, selecionado pontualmente para esta ocorrência específica. Clique para desmarcar."
                          >
                            <div className="w-4 h-4 rounded border flex items-center justify-center shrink-0 bg-amber-600 border-amber-600 text-white">
                              <Check className="w-3 h-3 stroke-[3]" />
                            </div>
                            <span className="font-mono font-bold text-[11px] px-1.5 py-0.5 rounded shrink-0 bg-amber-200 text-amber-900">
                              {s.val.number ? `Nº ${s.val.number}` : '--'}
                            </span>
                            <span className="truncate flex-1" title={s.val.name}>
                              {s.val.name}
                            </span>
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-200/90 text-amber-900 shrink-0">
                              ⚠️ {attStatus === 'FJ' ? 'Falta Just.' : 'Ausente'} (Pontual)
                            </span>
                          </div>
                        );
                      }

                      return (
                        <div
                          key={s.id}
                          role="checkbox"
                          aria-checked={false}
                          tabIndex={0}
                          onClick={() => handleToggleStudent(s.id)}
                          onKeyDown={(e) => {
                            if (e.key === ' ' || e.key === 'Enter') {
                              e.preventDefault();
                              handleToggleStudent(s.id);
                            }
                          }}
                          className="flex items-center gap-2 p-2 rounded-lg border border-rose-200/80 bg-rose-50/40 hover:bg-rose-50 hover:border-rose-300 text-slate-700 text-xs cursor-pointer select-none transition-all"
                          title={`Aluno ausente (${attStatus === 'FJ' ? 'Falta Justificada' : 'Falta'}) na chamada do dia ${formatDate(selectedDate)}. Clique para incluir pontualmente nesta ocorrência.`}
                        >
                          <div className="w-4 h-4 rounded border border-rose-300 bg-white flex items-center justify-center shrink-0 text-rose-600 font-bold text-[10px]">
                            !
                          </div>
                          <span className="font-mono font-bold text-[11px] px-1.5 py-0.5 rounded shrink-0 bg-rose-100 text-rose-800">
                            {s.val.number ? `Nº ${s.val.number}` : '--'}
                          </span>
                          <span className="truncate flex-1 text-slate-700" title={s.val.name}>
                            {s.val.name}
                          </span>
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 shrink-0">
                            {attStatus === 'FJ' ? 'Falta Just.' : 'Faltou'}
                          </span>
                        </div>
                      );
                    }

                    // Aluno ativo e presente na chamada
                    return (
                      <div
                        key={s.id}
                        role="checkbox"
                        aria-checked={isSelected}
                        tabIndex={0}
                        onClick={() => handleToggleStudent(s.id)}
                        onKeyDown={(e) => {
                          if (e.key === ' ' || e.key === 'Enter') {
                            e.preventDefault();
                            handleToggleStudent(s.id);
                          }
                        }}
                        className={`flex items-center gap-2 p-2 rounded-lg border text-xs cursor-pointer select-none transition-all ${
                          isSelected
                            ? 'bg-indigo-50/90 border-indigo-400 text-indigo-950 font-medium shadow-2xs'
                            : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-700'
                        }`}
                      >
                        <div
                          className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                            isSelected
                              ? 'bg-indigo-600 border-indigo-600 text-white'
                              : 'bg-white border-slate-300'
                          }`}
                        >
                          {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                        </div>
                        <span
                          className={`font-mono font-bold text-[11px] px-1.5 py-0.5 rounded shrink-0 ${
                            isSelected
                              ? 'bg-indigo-200/80 text-indigo-900'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {s.val.number ? `Nº ${s.val.number}` : '--'}
                        </span>
                        <span className="truncate flex-1" title={s.val.name}>
                          {s.val.name}
                        </span>
                        {isRecebida && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 shrink-0">
                            TR. REC
                          </span>
                        )}
                        <span className="text-[9px] font-semibold px-1 py-0.5 rounded bg-emerald-100 text-emerald-800 shrink-0">
                          Presente ✓
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Chips dos Alunos Selecionados */}
              {selectedStudentIds.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <div className="flex items-center justify-between text-[11px] text-slate-600 font-semibold">
                    <span>Alunos selecionados para o registro ({selectedStudentIds.length}):</span>
                    <button
                      type="button"
                      onClick={handleDeselectAll}
                      className="text-rose-600 hover:text-rose-700 text-[10px] underline"
                    >
                      Limpar seleção
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 max-h-24 overflow-y-auto p-1 bg-white rounded-lg border border-slate-200/80">
                    {selectedStudentIds.map((sId) => {
                      const st = students.find((s) => s.id === sId)?.val;
                      if (!st) return null;
                      const isAbsent = isAttendanceDone && attendanceStatusMap[sId] !== 'P';
                      return (
                        <span
                          key={sId}
                          className={`inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md text-[11px] font-medium border ${
                            isAbsent
                              ? 'bg-amber-50 text-amber-900 border-amber-300'
                              : 'bg-indigo-50 text-indigo-800 border-indigo-200'
                          }`}
                        >
                          <span>
                            {st.number ? `Nº ${st.number}` : ''} {st.name} {isAbsent ? '(Ausente na data)' : ''}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleStudent(sId);
                            }}
                            className={`p-0.5 rounded transition-colors ${
                              isAbsent
                                ? 'hover:bg-amber-200 text-amber-700 hover:text-amber-950'
                                : 'hover:bg-indigo-200 text-indigo-600 hover:text-indigo-900'
                            }`}
                            title="Remover este aluno da seleção"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Dica de Produtividade */}
              <div className="text-[11px] text-slate-600 bg-indigo-50/70 border border-indigo-100/90 p-2.5 rounded-lg flex items-start gap-2">
                <Sparkles className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                <span className="leading-relaxed">
                  <strong>Dica de agilidade em lote:</strong> Para ocorrências positivas (ex.: <em>alunos que terminaram a atividade</em>), clique em <strong>Todos Presentes</strong> e desmarque apenas as exceções. Para ocorrências negativas (ex.: <em>alunos que não terminaram</em>), marque diretamente apenas os alunos correspondentes.
                </span>
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Descrição do Ocorrido *
            </label>
            <textarea
              id="event-description-input"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Relate detalhadamente o ocorrido ou ação pedagógica tomada (este texto será atribuído a todos os alunos selecionados)..."
              className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 resize-y"
              required
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              id="event-save-btn"
              type="submit"
              disabled={isAttendanceDone === false}
              className={`inline-flex items-center gap-1.5 px-5 py-2 text-sm font-semibold text-white rounded-xl shadow-xs transition-colors ${
                isAttendanceDone === false
                  ? 'bg-slate-400 cursor-not-allowed opacity-70'
                  : 'bg-indigo-600 hover:bg-indigo-700'
              }`}
            >
              {isAttendanceDone === false ? (
                <>
                  <CalendarX className="w-4 h-4" />
                  Realize a chamada para habilitar o lançamento
                </>
              ) : editingId ? (
                <>
                  <Edit2 className="w-4 h-4" />
                  Atualizar Ocorrência
                </>
              ) : selectedStudentIds.length > 1 ? (
                <>
                  <Users className="w-4 h-4" />
                  Registrar em Lote para {selectedStudentIds.length} Alunos Presentes
                </>
              ) : selectedStudentIds.length === 1 ? (
                <>
                  <Plus className="w-4 h-4" />
                  Registrar Ocorrência (1 Aluno Presente)
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  Registrar Ocorrência
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 sm:p-6 shadow-xs">
        {/* Cabeçalho da Listagem de Ocorrências com Filtro por Período */}
        <div className="space-y-3 mb-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h3 className="text-base font-bold text-slate-800">
              Ocorrências Registradas ({filteredEventsList.length} de {events.length})
            </h3>
          </div>

          {/* Barra de Filtros: Turma, Bimestre, Período e Busca */}
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <div className="flex items-center gap-1 text-slate-500">
              <Filter className="w-4 h-4 text-slate-400" />
              <span className="font-semibold text-slate-600">Filtros:</span>
            </div>

            <select
              id="filter-events-class"
              value={filterClassId}
              onChange={(e) => {
                setFilterClassId(e.target.value);
                setSelectedEventIdsForDeletion([]);
              }}
              className="px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            >
              <option value="">Todas as Turmas</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.val.year}º {c.val.letter} — {c.val.shift}
                </option>
              ))}
            </select>

            <select
              id="filter-events-bimester"
              value={filterBimester}
              onChange={(e) => {
                setFilterBimester(e.target.value);
                setSelectedEventIdsForDeletion([]);
              }}
              className="px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            >
              <option value="">Todos os Bimestres</option>
              <option value="1">1º Bimestre</option>
              <option value="2">2º Bimestre</option>
              <option value="3">3º Bimestre</option>
              <option value="4">4º Bimestre</option>
            </select>

            {/* Filtro por Período (Data Inicial e Data Final) */}
            <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-lg flex-wrap">
              <span className="text-[11px] font-semibold text-slate-600 flex items-center gap-1">
                <Calendar className="w-3 h-3 text-indigo-600" />
                Período:
              </span>
              <input
                type="date"
                value={filterStartDate}
                onChange={(e) => setFilterStartDate(e.target.value)}
                className="text-xs bg-white border border-slate-200 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-medium"
                title="Data inicial do período"
              />
              <span className="text-xs text-slate-400">até</span>
              <input
                type="date"
                value={filterEndDate}
                onChange={(e) => setFilterEndDate(e.target.value)}
                className="text-xs bg-white border border-slate-200 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-medium"
                title="Data final do período"
              />
              <button
                type="button"
                onClick={() => {
                  const today = getTodayDateString();
                  setFilterStartDate(today);
                  setFilterEndDate(today);
                }}
                className={`text-[10px] font-bold px-1.5 py-0.5 rounded transition-colors ${
                  filterStartDate === getTodayDateString() && filterEndDate === getTodayDateString()
                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                    : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-200'
                }`}
                title="Filtrar ocorrências da data de hoje"
              >
                Hoje
              </button>
              {(filterStartDate || filterEndDate) && (
                <button
                  type="button"
                  onClick={() => {
                    setFilterStartDate('');
                    setFilterEndDate('');
                  }}
                  className="text-slate-400 hover:text-slate-600 p-0.5"
                  title="Limpar filtro de período"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="relative">
              <input
                type="text"
                value={filterSearch}
                onChange={(e) => setFilterSearch(e.target.value)}
                placeholder="Buscar ocorrências..."
                className="pl-2.5 pr-6 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 w-44"
              />
              {filterSearch && (
                <button
                  onClick={() => setFilterSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* Barra de Ação em Lote no Histórico (Marcar Visíveis / Excluir Selecionadas) */}
          {filteredEventsList.length > 0 && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 bg-slate-50 border border-slate-200/80 rounded-xl">
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => setSelectedEventIdsForDeletion(filteredEventsList.map((item) => item.id))}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg shadow-2xs transition-colors"
                  title="Selecionar todas as ocorrências exibidas neste filtro"
                >
                  <CheckSquare className="w-3.5 h-3.5 text-indigo-600" />
                  Marcar Visíveis ({filteredEventsList.length})
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedEventIdsForDeletion([])}
                  disabled={selectedEventIdsForDeletion.length === 0}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg shadow-2xs transition-colors disabled:opacity-40"
                  title="Desmarcar todas as ocorrências"
                >
                  <Square className="w-3.5 h-3.5 text-slate-500" />
                  Desmarcar
                </button>
                {selectedEventIdsForDeletion.length > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-indigo-100 text-indigo-800 border border-indigo-200">
                    {selectedEventIdsForDeletion.length} de {filteredEventsList.length} visíveis selecionada(s)
                  </span>
                )}
              </div>

              {selectedEventIdsForDeletion.length > 0 && (
                <button
                  type="button"
                  onClick={handleDeleteSelectedBatch}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-xs transition-colors"
                  title="Excluir todas as ocorrências selecionadas no filtro atual"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Excluir {selectedEventIdsForDeletion.length} Selecionada(s) no Filtro Atual
                </button>
              )}
            </div>
          )}
        </div>

        {loading ? (
          <div className="py-8 text-center text-sm text-slate-400">Carregando ocorrências...</div>
        ) : filteredEventsList.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-400">
            Nenhuma ocorrência registrada com os filtros selecionados.
          </div>
        ) : (
          <div className="space-y-3">
            {filteredEventsList.map((item) => {
              const ev = item.val;
              const turma = classes.find((c) => c.id === ev.classId)?.val;
              const turmaStr = turma ? `${turma.year}º ${turma.letter} (${turma.shift})` : 'Turma';
              const type = eventTypes.find((t) => t.id === ev.typeId)?.val;
              const studentObj = turma?.alunos?.[ev.studentId];
              const studentName = studentObj?.name || 'Aluno';
              const studentNum = studentObj?.number || '';
              const isExpedido = studentObj?.status === 'expedida';
              const isRecebida = studentObj?.status === 'recebida';
              const isSelectedForDeletion = selectedEventIdsForDeletion.includes(item.id);

              return (
                <div
                  key={item.id}
                  className={`p-4 rounded-xl border transition-all ${
                    isSelectedForDeletion
                      ? 'border-rose-300 bg-rose-50/50 shadow-xs'
                      : isExpedido
                      ? 'border-slate-200 bg-slate-50/40 opacity-80'
                      : 'border-slate-100 bg-slate-50/60 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {/* Checkbox de seleção para ação/exclusão em lote */}
                    <div
                      role="checkbox"
                      aria-checked={isSelectedForDeletion}
                      tabIndex={0}
                      onClick={() => handleToggleEventSelectionForDeletion(item.id)}
                      onKeyDown={(e) => {
                        if (e.key === ' ' || e.key === 'Enter') {
                          e.preventDefault();
                          handleToggleEventSelectionForDeletion(item.id);
                        }
                      }}
                      className={`w-5 h-5 mt-0.5 rounded border flex items-center justify-center shrink-0 cursor-pointer transition-colors ${
                        isSelectedForDeletion
                          ? 'bg-rose-600 border-rose-600 text-white shadow-2xs'
                          : 'bg-white border-slate-300 hover:border-indigo-400'
                      }`}
                      title="Marcar esta ocorrência para exclusão em lote"
                    >
                      {isSelectedForDeletion && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                    </div>

                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm text-slate-800">
                          {studentNum ? `Nº ${studentNum} - ` : ''}
                          {studentName}
                        </span>
                        {isExpedido && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200 uppercase tracking-wider">
                            Transferência Expedida
                          </span>
                        )}
                        {isRecebida && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 uppercase tracking-wider">
                            Transferência Recebida
                          </span>
                        )}
                        {type && (
                          <span
                            className="px-2 py-0.5 rounded-full text-[10px] font-bold text-white uppercase tracking-wider"
                            style={{ backgroundColor: type.color || '#e74c3c' }}
                          >
                            {type.name}
                          </span>
                        )}
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-200 text-slate-700">
                          {turmaStr}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-100 text-indigo-700">
                          {ev.bimester ? `${ev.bimester}º Bim` : 'Sem Bimestre'}
                        </span>
                        <span className="text-xs text-slate-500 font-medium">
                          📅 {formatDate(ev.date)}
                        </span>
                        {ev.absentOnDate && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold text-amber-900 bg-amber-100 border border-amber-300 flex items-center gap-1">
                            ⚠️ Ausente na data ({ev.studentAttendanceStatus === 'FJ' ? 'Falta Just.' : 'Faltou'})
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-slate-700 mt-2 p-2.5 bg-white rounded-lg border border-slate-200/80 leading-relaxed whitespace-pre-line">
                        {ev.description}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        id={`event-edit-${item.id}`}
                        onClick={() => handleEdit(item)}
                        className="p-1.5 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                        title="Editar"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        id={`event-delete-${item.id}`}
                        onClick={() => handleDelete(item.id)}
                        className="p-1.5 text-slate-600 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                        title="Excluir"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
