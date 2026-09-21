import React, { useState, useEffect } from 'react';
import { EventOccurrence, EventType, ClassRoom, Student, ModalConfig } from '../types';
import {
  get,
  ref,
  push,
  update,
  remove,
  rtdb,
  dc,
  carregarMinhasTurmas
} from '../lib/firebase';
import { formatFriendlyError } from '../lib/errorHandler';
import { formatDate } from '../lib/reports';
import {
  AlertCircle,
  Plus,
  Edit2,
  Trash2,
  Download,
  Upload,
  X,
  Filter
} from 'lucide-react';

interface EventsScreenProps {
  currentTeacher: string;
  currentYear: string;
  setModal: (config: ModalConfig) => void;
}

export const EventsScreen: React.FC<EventsScreenProps> = ({
  currentTeacher,
  currentYear,
  setModal
}) => {
  const [classes, setClasses] = useState<{ id: string; val: ClassRoom }[]>([]);
  const [eventTypes, setEventTypes] = useState<{ id: string; val: EventType }[]>([]);
  const [students, setStudents] = useState<{ id: string; val: Student }[]>([]);

  const [selectedClassId, setSelectedClassId] = useState('');
  const [selectedBimester, setSelectedBimester] = useState('1');
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split('T')[0]
  );
  const [typeId, setTypeId] = useState('');
  const [studentId, setStudentId] = useState('');
  const [description, setDescription] = useState('');

  const [filterClassId, setFilterClassId] = useState('');
  const [filterBimester, setFilterBimester] = useState('');
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
    }
  }, [selectedClassId, currentYear]);

  useEffect(() => {
    loadEvents();
  }, [filterClassId, filterBimester, currentYear]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClassId || !selectedBimester || !selectedDate || !typeId || !studentId || !description.trim()) {
      return setModal({
        isOpen: true,
        type: 'alert',
        title: 'Atenção',
        message: 'Preencha todos os campos do evento!',
        icon: '⚠️'
      });
    }

    const targetStudent = students.find((s) => s.id === studentId)?.val;
    if (!editingId && targetStudent?.status === 'expedida') {
      return setModal({
        isOpen: true,
        type: 'alert',
        title: 'Operação Não Permitida',
        message: '⛔ Não é possível registrar novas ocorrências para alunos com transferência expedida.',
        icon: '⛔'
      });
    }

    const typeObj = eventTypes.find((t) => t.id === typeId)?.val;
    const data: any = {
      classId: selectedClassId,
      bimester: selectedBimester,
      date: selectedDate,
      typeId,
      type: typeObj ? typeObj.name : 'Geral',
      studentId,
      description: description.trim(),
      teacher: currentTeacher,
      anoLetivo: currentYear
    };

    try {
      if (editingId) {
        data.updatedAt = Date.now();
        await update(ref(rtdb, dc(`eventos/${editingId}`)), data);
        setModal({
          isOpen: true,
          type: 'alert',
          title: 'Sucesso',
          message: 'Ocorrência atualizada com sucesso!',
          icon: '✅'
        });
      } else {
        data.createdAt = Date.now();
        await push(ref(rtdb, dc('eventos')), data);
        setModal({
          isOpen: true,
          type: 'alert',
          title: 'Sucesso',
          message: 'Ocorrência registrada com sucesso!',
          icon: '✅'
        });
      }

      setDescription('');
      setEditingId(null);
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
  };

  const handleEdit = (item: { id: string; val: EventOccurrence }) => {
    setSelectedClassId(item.val.classId);
    setSelectedBimester(item.val.bimester || '1');
    setSelectedDate(item.val.date);
    setTypeId(item.val.typeId);
    setStudentId(item.val.studentId);
    setDescription(item.val.description);
    setEditingId(item.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCancelEdit = () => {
    setDescription('');
    setEditingId(null);
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

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6">
      <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-800 flex items-center gap-2">
            <AlertCircle className="w-6 h-6 text-indigo-600" />
            Eventos & Ocorrências
          </h2>
          <p className="text-xs sm:text-sm text-slate-500">
            Registro pedagógico e disciplinar de ocorrências individuais por estudante
          </p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 sm:p-6 shadow-xs mb-8">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-slate-800">
            {editingId ? 'Editar Ocorrência' : 'Nova Ocorrência'}
          </h3>
          {editingId && (
            <button
              onClick={handleCancelEdit}
              className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-100 px-2.5 py-1 rounded-md"
            >
              <X className="w-3 h-3" /> Cancelar Edição
            </button>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Data *
              </label>
              <input
                id="event-date-input"
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Aluno Envolvido *
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
                  .filter((s) => s.val.status !== 'expedida' || (editingId && s.id === studentId))
                  .map((s) => {
                    const isExpedido = s.val.status === 'expedida';
                    return (
                      <option key={s.id} value={s.id} disabled={isExpedido && !editingId}>
                        {s.val.number} - {s.val.name} {isExpedido ? '(Transferência Expedida - Histórico)' : s.val.status === 'recebida' ? '(Transferência Recebida)' : ''}
                      </option>
                    );
                  })}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Descrição do Ocorrido *
            </label>
            <textarea
              id="event-description-input"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Relate detalhadamente o ocorrido ou ação pedagógica tomada..."
              className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 resize-y"
              required
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              id="event-save-btn"
              type="submit"
              className="inline-flex items-center gap-1.5 px-5 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-xs transition-colors"
            >
              <Plus className="w-4 h-4" />
              {editingId ? 'Atualizar Ocorrência' : 'Registrar Ocorrência'}
            </button>
          </div>
        </form>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 sm:p-6 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <h3 className="text-base font-bold text-slate-800">
            Ocorrências Registradas ({events.length})
          </h3>
          <div className="flex items-center gap-2 flex-wrap">
            <Filter className="w-4 h-4 text-slate-400" />
            <select
              id="filter-events-class"
              value={filterClassId}
              onChange={(e) => setFilterClassId(e.target.value)}
              className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
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
              onChange={(e) => setFilterBimester(e.target.value)}
              className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            >
              <option value="">Todos os Bimestres</option>
              <option value="1">1º Bimestre</option>
              <option value="2">2º Bimestre</option>
              <option value="3">3º Bimestre</option>
              <option value="4">4º Bimestre</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="py-8 text-center text-sm text-slate-400">Carregando ocorrências...</div>
        ) : events.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-400">
            Nenhuma ocorrência registrada com os filtros selecionados.
          </div>
        ) : (
          <div className="space-y-3">
            {events.map((item) => {
              const ev = item.val;
              const turma = classes.find((c) => c.id === ev.classId)?.val;
              const turmaStr = turma ? `${turma.year}º ${turma.letter} (${turma.shift})` : 'Turma';
              const type = eventTypes.find((t) => t.id === ev.typeId)?.val;
              const studentObj = turma?.alunos?.[ev.studentId];
              const studentName = studentObj?.name || 'Aluno';
              const studentNum = studentObj?.number || '';
              const isExpedido = studentObj?.status === 'expedida';
              const isRecebida = studentObj?.status === 'recebida';

              return (
                <div
                  key={item.id}
                  className={`p-4 rounded-xl border transition-colors ${
                    isExpedido ? 'border-slate-200 bg-slate-50/40 opacity-80' : 'border-slate-100 bg-slate-50/60 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="space-y-1 flex-1">
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
                      </div>

                      <p className="text-xs text-slate-700 mt-2 p-2.5 bg-white rounded-lg border border-slate-200/80 leading-relaxed whitespace-pre-line">
                        {ev.description}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
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
