import React, { useState, useEffect } from 'react';
import { Teacher, ClassRoom, ModalConfig } from '../types';
import {
  carregarProfessores,
  carregarMinhasTurmas,
  carregarTodasAtribuicoes,
  atribuirTurmaProfessor,
  ref,
  get,
  rtdb
} from '../lib/firebase';
import { formatFriendlyError } from '../lib/errorHandler';
import {
  Award,
  UserCheck,
  CheckCircle2,
  Circle,
  Search,
  BookOpen,
  Filter,
  GraduationCap,
  Sparkles
} from 'lucide-react';

interface AssignmentsScreenProps {
  currentYear: string;
  setModal: (config: ModalConfig) => void;
  selectedTeacherId?: string;
}

export const AssignmentsScreen: React.FC<AssignmentsScreenProps> = ({
  currentYear,
  setModal,
  selectedTeacherId: initialTeacherId
}) => {
  const [teachers, setTeachers] = useState<Array<{ id: string; val: Teacher }>>([]);
  const [allClasses, setAllClasses] = useState<Array<{ id: string; val: ClassRoom }>>([]);
  const [assignments, setAssignments] = useState<Record<string, Record<string, boolean>>>({});
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>(initialTeacherId || '');
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterYear, setFilterYear] = useState<string>(currentYear);

  const loadData = async () => {
    setLoading(true);
    try {
      // 1. Carregar Professores
      const profs = await carregarProfessores();
      profs.sort((a, b) => (a.val.name || '').localeCompare(b.val.name || ''));
      setTeachers(profs);

      if (profs.length > 0 && !selectedTeacherId) {
        setSelectedTeacherId(initialTeacherId || profs[0].id);
      }

      // 2. Carregar todas as turmas cadastradas na base compartilhada
      const snapTurmas = await get(ref(rtdb, 'diario-classe/turmas'));
      if (snapTurmas.exists()) {
        const val = snapTurmas.val();
        const turmasList = Object.keys(val).map((id) => ({ id, val: val[id] }));
        turmasList.sort((a, b) => (a.val.schoolName || '').localeCompare(b.val.schoolName || ''));
        setAllClasses(turmasList);
      } else {
        // Fallback para turmas do usuário
        const fallback = await carregarMinhasTurmas();
        setAllClasses(fallback);
      }

      // 3. Carregar mapa de atribuições
      const atribs = await carregarTodasAtribuicoes();
      setAssignments(atribs);
    } catch (err: any) {
      console.error(err);
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro ao Carregar Atribuições',
        message: formatFriendlyError(err, 'Não foi possível carregar o mapa de atribuições de turmas'),
        icon: '⚠️'
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleToggleAssignment = async (classId: string, currentStatus: boolean) => {
    if (!selectedTeacherId) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Selecione um professor',
        message: 'Por favor, selecione um professor na lista para atribuir ou desatribuir turmas.',
        icon: '⚠️'
      });
      return;
    }

    const newStatus = !currentStatus;

    // Atualização otimista local
    setAssignments((prev) => ({
      ...prev,
      [selectedTeacherId]: {
        ...(prev[selectedTeacherId] || {}),
        [classId]: newStatus
      }
    }));

    try {
      await atribuirTurmaProfessor(selectedTeacherId, classId, newStatus);
    } catch (err: any) {
      // Reverter se falhar
      setAssignments((prev) => ({
        ...prev,
        [selectedTeacherId]: {
          ...(prev[selectedTeacherId] || {}),
          [classId]: currentStatus
        }
      }));

      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro ao Salvar Atribuição',
        message: formatFriendlyError(err, 'Não foi possível alterar a atribuição da turma'),
        icon: '❌'
      });
    }
  };

  const selectedTeacher = teachers.find((t) => t.id === selectedTeacherId);

  // Filtrar turmas pelo ano letivo e busca
  const filteredClasses = allClasses.filter((c) => {
    const matchYear =
      !filterYear ||
      !c.val.anoLetivo ||
      String(c.val.anoLetivo).trim() === String(filterYear).trim();
    const q = searchTerm.toLowerCase();
    const matchSearch =
      (c.val.schoolName || '').toLowerCase().includes(q) ||
      (c.val.year || '').toLowerCase().includes(q) ||
      (c.val.letter || '').toLowerCase().includes(q) ||
      (c.val.shift || '').toLowerCase().includes(q);
    return matchYear && matchSearch;
  });

  // Contagem de turmas atribuídas ao professor selecionado
  const getTeacherAssignmentSet = (teacher: { id: string; val: Teacher } | undefined) => {
    if (!teacher) return new Set<string>();
    const set = new Set<string>();
    const idsToCheck = [teacher.id];
    if (teacher.val.authUid) idsToCheck.push(teacher.val.authUid);
    idsToCheck.forEach((tId) => {
      const teacherMap = assignments[tId] || {};
      Object.keys(teacherMap).forEach((cid) => {
        if (teacherMap[cid]) set.add(cid);
      });
    });
    return set;
  };

  const selectedTeacherAssignedSet = getTeacherAssignmentSet(selectedTeacher);
  const assignedCount = selectedTeacherAssignedSet.size;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-100 text-emerald-700 rounded-xl">
              <Award className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-800">Atribuição de Turmas</h1>
              <p className="text-sm text-slate-500">
                Vincule professores às suas respectivas turmas e unidades escolares
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-xs">
          <Filter className="w-4 h-4 text-slate-400" />
          <span className="text-xs font-semibold text-slate-500">Ano Letivo:</span>
          <select
            value={filterYear}
            onChange={(e) => setFilterYear(e.target.value)}
            className="text-sm font-bold text-indigo-600 bg-transparent outline-none cursor-pointer"
          >
            <option value="2026">2026</option>
            <option value="2025">2025</option>
            <option value="2024">2024</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-500 shadow-sm">
          <div className="animate-spin inline-block w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full mb-3"></div>
          <p>Carregando professores e turmas...</p>
        </div>
      ) : teachers.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center shadow-sm">
          <UserCheck className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-slate-700">Nenhum professor cadastrado</h3>
          <p className="text-sm text-slate-500 max-w-md mx-auto mt-1 mb-4">
            Cadastre primeiro os docentes no módulo de Professores para realizar as atribuições de turmas.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Coluna 1: Lista de Professores */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
            <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-3 flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-indigo-600" /> Selecione o Docente
            </h2>

            <div className="space-y-2 max-h-[550px] overflow-y-auto pr-1">
              {teachers.map((t) => {
                const isSelected = t.id === selectedTeacherId;
                const count = getTeacherAssignmentSet(t).size;

                return (
                  <button
                    key={t.id}
                    id={`btn-select-teacher-${t.id}`}
                    onClick={() => setSelectedTeacherId(t.id)}
                    className={`w-full text-left p-3 rounded-xl border transition flex items-center justify-between gap-2 ${
                      isSelected
                        ? 'bg-indigo-50 border-indigo-300 shadow-xs'
                        : 'bg-slate-50/50 hover:bg-slate-100 border-slate-100'
                    }`}
                  >
                    <div className="min-w-0">
                      <p
                        className={`text-sm font-bold truncate ${
                          isSelected ? 'text-indigo-900' : 'text-slate-700'
                        }`}
                      >
                        {t.val.name}
                      </p>
                      <p className="text-xs text-slate-500 truncate">
                        {t.val.subject || t.val.email || 'Docente'}
                      </p>
                    </div>

                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-bold shrink-0 ${
                        count > 0
                          ? 'bg-indigo-100 text-indigo-700'
                          : 'bg-slate-200 text-slate-600'
                      }`}
                    >
                      {count} {count === 1 ? 'turma' : 'turmas'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Coluna 2 e 3: Grade de Turmas para Atribuir */}
          <div className="lg:col-span-2 space-y-4">
            {selectedTeacher && (
              <div className="bg-gradient-to-r from-indigo-900 to-indigo-800 text-white rounded-2xl p-5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-indigo-200">
                    Atribuindo para:
                  </span>
                  <h2 className="text-xl font-bold">{selectedTeacher.val.name}</h2>
                  <p className="text-xs text-indigo-200 mt-0.5">
                    {selectedTeacher.val.subject ? `Disciplina: ${selectedTeacher.val.subject} • ` : ''}
                    {selectedTeacher.val.email}
                  </p>
                </div>
                <div className="bg-white/10 backdrop-blur-xs px-4 py-2.5 rounded-xl text-center shrink-0 border border-white/10">
                  <span className="block text-2xl font-black">{assignedCount}</span>
                  <span className="text-[11px] text-indigo-100 font-medium">Turmas Atribuídas</span>
                </div>
              </div>
            )}

            {/* Barra de Filtro de Turmas */}
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                id="search-assignment-class"
                type="text"
                placeholder="Filtrar turmas por escola, ano, letra ou turno..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-xs"
              />
            </div>

            {/* Lista de Turmas com Checkboxes Rápidos */}
            {filteredClasses.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-500 shadow-xs">
                <GraduationCap className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                <p className="font-semibold text-slate-700">Nenhuma turma disponível</p>
                <p className="text-xs text-slate-400 mt-1">
                  Cadastre turmas no módulo de Turmas para vincular a este docente.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {filteredClasses.map((c) => {
                  const isAssigned = selectedTeacherAssignedSet.has(c.id);

                  // Identificar outros professores com esta turma
                  const otherTeachers = teachers.filter(
                    (t) =>
                      t.id !== selectedTeacherId &&
                      getTeacherAssignmentSet(t).has(c.id)
                  );

                  return (
                    <div
                      key={c.id}
                      id={`card-assign-${c.id}`}
                      onClick={() => handleToggleAssignment(c.id, isAssigned)}
                      className={`p-4 rounded-2xl border cursor-pointer transition flex flex-col justify-between select-none ${
                        isAssigned
                          ? 'bg-emerald-50/70 border-emerald-300 shadow-xs'
                          : 'bg-white hover:bg-slate-50/80 border-slate-200 shadow-xs'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div>
                          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
                            {c.val.schoolName || 'Escola'}
                          </span>
                          <h3 className="text-base font-bold text-slate-800">
                            {c.val.year} {c.val.letter}
                            <span className="text-xs font-normal text-slate-500 ml-2">
                              ({c.val.shift})
                            </span>
                          </h3>
                        </div>

                        <div className="mt-1">
                          {isAssigned ? (
                            <CheckCircle2 className="w-6 h-6 text-emerald-600 fill-emerald-100" />
                          ) : (
                            <Circle className="w-6 h-6 text-slate-300" />
                          )}
                        </div>
                      </div>

                      {/* Outros professores atribuídos */}
                      {otherTeachers.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-slate-100 text-[11px] text-slate-500 flex items-center gap-1">
                          <span className="font-semibold text-slate-600">Também leciona:</span>
                          <span className="truncate">
                            {otherTeachers.map((ot) => ot.val.name).join(', ')}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
