import React, { useState, useEffect } from 'react';
import { ClassRoom, School, ModalConfig } from '../types';
import {
  get,
  ref,
  push,
  update,
  remove,
  rtdb,
  carregarMinhasTurmas,
  getCurrentAuthUid,
  verificarIsAdmin
} from '../lib/firebase';
import { formatFriendlyError } from '../lib/errorHandler';
import { checkClassDeleteIntegrity } from '../lib/referentialIntegrity';
import { Users, Plus, Edit2, Trash2, Download, Upload, X, UserPlus, Clock } from 'lucide-react';

interface ClassesScreenProps {
  currentYear: string;
  setModal: (config: ModalConfig) => void;
  onNavigateToStudents?: (classId: string) => void;
  onNavigateToSchedule?: (classId: string) => void;
}

export const ClassesScreen: React.FC<ClassesScreenProps> = ({
  currentYear,
  setModal,
  onNavigateToStudents,
  onNavigateToSchedule
}) => {
  const [classes, setClasses] = useState<{ id: string; val: ClassRoom }[]>([]);
  const [schools, setSchools] = useState<School[]>([]);
  const [schoolId, setSchoolId] = useState('');
  const [year, setYear] = useState('');
  const [shift, setShift] = useState('');
  const [letter, setLetter] = useState('');
  const [intervaloGrupo, setIntervaloGrupo] = useState<'1' | 'A' | 'B'>('A');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const loadSchools = async () => {
    try {
      const snap = await get(ref(rtdb, 'diario-classe/escolas'));
      const list: School[] = [];
      const val = snap.val() || {};
      Object.keys(val).forEach((k) => list.push({ id: k, ...val[k] }));
      list.sort((a, b) => a.name.localeCompare(b.name));
      setSchools(list);
    } catch (err: any) {
      console.error(err);
    }
  };

  const loadClasses = async () => {
    try {
      setLoading(true);
      const results = await carregarMinhasTurmas();
      results.sort((a, b) => (a.val.createdAt || 0) - (b.val.createdAt || 0));
      const filtered = results.filter(
        (r) => !r.val.anoLetivo || !currentYear || String(r.val.anoLetivo).trim() === String(currentYear).trim()
      );
      setClasses(filtered);
    } catch (err: any) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro ao Carregar Turmas',
        message: formatFriendlyError(err, 'Não foi possível carregar a lista de turmas'),
        icon: '❌'
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSchools();
    loadClasses();
    verificarIsAdmin().then((admin) => setIsAdmin(admin));
  }, [currentYear]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!schoolId || !year || !shift || !letter.trim()) {
      return setModal({
        isOpen: true,
        type: 'alert',
        title: 'Atenção',
        message: 'Preencha todos os campos da turma!',
        icon: '⚠️'
      });
    }

    const selectedSchool = schools.find((s) => s.id === schoolId);
    const schoolName = selectedSchool ? selectedSchool.name : 'Escola';
    const uid = getCurrentAuthUid();
    if (!uid) return;

    const data: any = {
      schoolId,
      schoolName,
      year,
      shift,
      letter: letter.trim().toUpperCase(),
      intervaloGrupo: shift === 'Manhã' ? (intervaloGrupo || (year === '1' ? '1' : year === '4' || year === '5' ? 'B' : 'A')) : undefined,
      anoLetivo: currentYear
    };

    try {
      if (editingId) {
        data.updatedAt = Date.now();
        await update(ref(rtdb, `diario-classe/turmas/${editingId}`), data);
        setModal({
          isOpen: true,
          type: 'alert',
          title: 'Sucesso',
          message: 'Turma atualizada com sucesso!',
          icon: '✅'
        });
      } else {
        const newRef = push(ref(rtdb, 'diario-classe/turmas'));
        const newId = newRef.key;
        data.createdAt = Date.now();
        data.criadoPor = uid;

        const updates: Record<string, any> = {};
        updates[`diario-classe/turmas/${newId}`] = data;
        updates[`diario-classe/atribuicoes/${uid}/${newId}`] = true;

        await update(ref(rtdb), updates);
        setModal({
          isOpen: true,
          type: 'alert',
          title: 'Sucesso',
          message: 'Turma cadastrada com atribuição realizada!',
          icon: '✅'
        });
      }

      setYear('');
      setShift('');
      setLetter('');
      setIntervaloGrupo('A');
      setEditingId(null);
      loadClasses();
    } catch (err: any) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro ao Salvar Turma',
        message: formatFriendlyError(err, 'Não foi possível salvar os dados da turma'),
        icon: '❌'
      });
    }
  };

  const handleEdit = (item: { id: string; val: ClassRoom }) => {
    setSchoolId(item.val.schoolId);
    setYear(item.val.year);
    setShift(item.val.shift);
    setLetter(item.val.letter);
    const rawG = item.val.intervaloGrupo || (item.val.year === '1' ? '1' : item.val.year === '4' || item.val.year === '5' ? 'B' : 'A');
    const g = rawG === '1' || rawG === 'ano1' ? '1' : rawG === 'B' || rawG === 'ano45' ? 'B' : 'A';
    setIntervaloGrupo(g);
    setEditingId(item.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCancelEdit = () => {
    setYear('');
    setShift('');
    setLetter('');
    setIntervaloGrupo('A');
    setEditingId(null);
  };

  const handleDeleteClass = (id: string) => {
    const uid = getCurrentAuthUid();
    setModal({
      isOpen: true,
      type: 'confirm',
      title: 'Confirmar Exclusão',
      message: 'Tem certeza que deseja excluir esta turma e suas vinculações?',
      icon: '⚠️',
      danger: true,
      onConfirm: async () => {
        try {
          const integrity = await checkClassDeleteIntegrity(id);
          if (!integrity.canDelete) {
            return setModal({
              isOpen: true,
              type: 'alert',
              title: 'Exclusão Bloqueada',
              message: `⛔ ${integrity.reason}`,
              icon: '⛔'
            });
          }

          await remove(ref(rtdb, `diario-classe/turmas/${id}`));
          if (uid) {
            await remove(ref(rtdb, `diario-classe/atribuicoes/${uid}/${id}`));
          }
          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Excluído',
            message: 'Turma excluída com sucesso!',
            icon: '✅'
          });
          loadClasses();
        } catch (err: any) {
          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Erro ao Excluir Turma',
            message: formatFriendlyError(err, 'Não foi possível excluir a turma'),
            icon: '❌'
          });
        }
      }
    });
  };

  const exportClassesJSON = async () => {
    try {
      const snap = await get(ref(rtdb, 'diario-classe/turmas'));
      const data = snap.val();
      if (!data) return;
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `turmas_${currentYear}_${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro na Exportação',
        message: formatFriendlyError(err, 'Não foi possível exportar os dados'),
        icon: '❌'
      });
    }
  };

  const importClassesJSON = () => {
    if (!isAdmin) {
      return setModal({
        isOpen: true,
        type: 'alert',
        title: 'Acesso Restrito',
        message: '⛔ Apenas Administradores têm permissão para importar dados no sistema.',
        icon: '⛔'
      });
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e: any) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (event: any) => {
        try {
          const data = JSON.parse(event.target.result);
          const updates: Record<string, any> = {};
          Object.keys(data).forEach((key) => {
            updates[`diario-classe/turmas/${key}`] = data[key];
          });
          await update(ref(rtdb), updates);
          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Sucesso',
            message: 'Turmas importadas com sucesso!',
            icon: '✅'
          });
          loadClasses();
        } catch {
          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Erro',
            message: 'Arquivo JSON inválido!',
            icon: '❌'
          });
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6">
      <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Users className="w-6 h-6 text-indigo-600" />
            Turmas
          </h2>
          <p className="text-xs sm:text-sm text-slate-500">
            Cadastre e organize as séries, turnos e vínculos escolares
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            id="export-classes-btn"
            onClick={exportClassesJSON}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg border border-emerald-200 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Exportar JSON</span>
          </button>
          {isAdmin && (
            <button
              id="import-classes-btn"
              onClick={importClassesJSON}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg border border-amber-200 transition-colors"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Importar JSON</span>
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 sm:p-6 shadow-xs mb-8">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-slate-800">
            {editingId ? 'Editar Turma' : 'Nova Turma'}
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
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Escola *
              </label>
              <select
                id="class-school-select"
                value={schoolId}
                onChange={(e) => setSchoolId(e.target.value)}
                className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                required
              >
                <option value="">Selecione a Escola</option>
                {schools.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Ano / Série *
              </label>
              <select
                id="class-year-select"
                value={year}
                onChange={(e) => {
                  const val = e.target.value;
                  setYear(val);
                  if (val === '1') {
                    setIntervaloGrupo('1');
                  } else if (val === '4' || val === '5') {
                    setIntervaloGrupo('B');
                  } else if (val) {
                    setIntervaloGrupo('A');
                  }
                }}
                className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                required
              >
                <option value="">Ano</option>
                <option value="1">1º Ano</option>
                <option value="2">2º Ano</option>
                <option value="3">3º Ano</option>
                <option value="4">4º Ano</option>
                <option value="5">5º Ano</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Turno *
              </label>
              <select
                id="class-shift-select"
                value={shift}
                onChange={(e) => setShift(e.target.value)}
                className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                required
              >
                <option value="">Turno</option>
                <option value="Manhã">Manhã</option>
                <option value="Tarde">Tarde</option>
                <option value="Integral">Integral</option>
                <option value="Noite">Noite</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Letra / Identificador *
              </label>
              <input
                id="class-letter-input"
                type="text"
                value={letter}
                onChange={(e) => setLetter(e.target.value)}
                placeholder="Ex: A, B, C"
                maxLength={5}
                className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl uppercase focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                required
              />
            </div>

            {shift === 'Manhã' && (
              <div className="sm:col-span-2 md:col-span-4 bg-indigo-50/70 p-3.5 rounded-xl border border-indigo-100 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
                <div>
                  <span className="text-xs font-bold text-indigo-950 block">Padrão de Sino / Intervalo (Matutino)</span>
                  <span className="text-[11px] text-indigo-700">Início às 07:00 • 50 min/aula • Seleção ajustável para flexibilidade na grade</span>
                </div>
                <div className="flex items-center gap-3 text-xs flex-wrap">
                  <label className="inline-flex items-center gap-1.5 cursor-pointer font-medium text-slate-700">
                    <input
                      type="radio"
                      name="intervaloGrupo"
                      value="1"
                      checked={intervaloGrupo === '1'}
                      onChange={() => setIntervaloGrupo('1')}
                      className="text-emerald-600 focus:ring-emerald-500"
                    />
                    <span>1º Ano (Recreio 09:10 – 09:30)</span>
                  </label>
                  <label className="inline-flex items-center gap-1.5 cursor-pointer font-medium text-slate-700">
                    <input
                      type="radio"
                      name="intervaloGrupo"
                      value="A"
                      checked={intervaloGrupo === 'A'}
                      onChange={() => setIntervaloGrupo('A')}
                      className="text-sky-600 focus:ring-sky-500"
                    />
                    <span>2º e 3º Anos (09:30 – 09:50)</span>
                  </label>
                  <label className="inline-flex items-center gap-1.5 cursor-pointer font-medium text-slate-700">
                    <input
                      type="radio"
                      name="intervaloGrupo"
                      value="B"
                      checked={intervaloGrupo === 'B'}
                      onChange={() => setIntervaloGrupo('B')}
                      className="text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>4º e 5º Anos (09:55 – 10:15)</span>
                  </label>
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              id="class-save-btn"
              type="submit"
              className="inline-flex items-center gap-1.5 px-5 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-xs transition-colors"
            >
              <Plus className="w-4 h-4" />
              {editingId ? 'Atualizar Turma' : 'Adicionar Turma'}
            </button>
          </div>
        </form>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 sm:p-6 shadow-xs">
        <h3 className="text-base font-bold text-slate-800 mb-4">
          Turmas Atribuídas ({classes.length})
        </h3>

        {loading ? (
          <div className="py-8 text-center text-sm text-slate-400">Carregando turmas...</div>
        ) : classes.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-400">
            Nenhuma turma cadastrada para o ano letivo {currentYear}.
          </div>
        ) : (
          <div className="space-y-3">
            {classes.map(({ id, val }) => {
              const alunosCount = val.alunos ? Object.keys(val.alunos).length : 0;
              return (
                <div
                  key={id}
                  className="flex items-center justify-between p-4 rounded-xl border border-slate-100 bg-slate-50/60 hover:bg-slate-50 transition-colors flex-wrap gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm text-slate-800">
                        {val.year}º Ano {val.letter} — {val.shift}
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-100 text-indigo-700">
                        {alunosCount} {alunosCount === 1 ? 'aluno' : 'alunos'}
                      </span>
                      {val.shift === 'Manhã' && (() => {
                        const rawG = val.intervaloGrupo || (val.year === '1' ? '1' : val.year === '4' || val.year === '5' ? 'B' : 'A');
                        const g = rawG === '1' || rawG === 'ano1' ? '1' : rawG === 'B' || rawG === 'ano45' ? 'B' : 'A';
                        if (g === '1') {
                          return (
                            <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
                              Sino: 1º Ano (Recreio 09:10 – 09:30)
                            </span>
                          );
                        }
                        if (g === 'B') {
                          return (
                            <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-100 text-indigo-800 border border-indigo-200">
                              Sino: 4º/5º Anos (Recreio 09:55 – 10:15)
                            </span>
                          );
                        }
                        return (
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-sky-100 text-sky-800 border border-sky-200">
                            Sino: 2º/3º Anos (Recreio 09:30 – 09:50)
                          </span>
                        );
                      })()}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      {val.schoolName} | Ano Letivo: {val.anoLetivo || currentYear}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {onNavigateToSchedule && (
                      <button
                        id={`class-schedule-${id}`}
                        type="button"
                        onClick={() => onNavigateToSchedule(id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-violet-700 bg-violet-50 hover:bg-violet-100 hover:text-violet-800 rounded-lg border border-violet-200 transition-colors shadow-2xs cursor-pointer"
                        title="Ver e editar horários e especialistas desta turma"
                      >
                        <Clock className="w-3.5 h-3.5 text-violet-600" />
                        <span>Horários</span>
                      </button>
                    )}
                    {onNavigateToStudents && (
                      <button
                        id={`class-manage-students-${id}`}
                        type="button"
                        onClick={() => onNavigateToStudents(id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 hover:text-indigo-800 rounded-lg border border-indigo-200 transition-colors shadow-2xs cursor-pointer"
                        title="Cadastrar e gerenciar alunos desta turma"
                      >
                        <UserPlus className="w-3.5 h-3.5 text-indigo-600" />
                        <span>Gerenciar Alunos</span>
                      </button>
                    )}
                    <button
                      id={`class-edit-${id}`}
                      onClick={() => handleEdit({ id, val })}
                      className="p-1.5 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                      title="Editar Turma"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      id={`class-delete-${id}`}
                      onClick={() => handleDeleteClass(id)}
                      className="p-1.5 text-slate-600 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                      title="Excluir Turma"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
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
