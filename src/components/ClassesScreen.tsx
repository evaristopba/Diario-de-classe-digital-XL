import React, { useState, useEffect } from 'react';
import {
  ClassRoom,
  School,
  Teacher,
  SubjectItem,
  ModalConfig,
  GRADE_DIAS_SEMANA,
  normalizarIntervaloGrupoPorDia,
  getTurnoCanonical,
  GrupoSinoId
} from '../types';
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
import {
  SinoConfig,
  definirSinoConfig,
  duracaoAulaMinutos,
  perfisDoTurno,
  perfilPorAno,
  resolverPerfilIdTurma
} from '../lib/sino';
import {
  isBibliotecarioDocente,
  isSpecialistTeacherDocente,
  resolveRegenteForClass
} from '../lib/regenteHA';
import { Users, Plus, Edit2, Trash2, Download, Upload, X, UserPlus, Clock, UserCheck, RefreshCw } from 'lucide-react';
import { ViradaAnoModal } from './ViradaAnoModal';

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
  const [allClassesAllYears, setAllClassesAllYears] = useState<{ id: string; val: ClassRoom }[]>([]);
  const [viradaModalOpen, setViradaModalOpen] = useState(false);
  const [schools, setSchools] = useState<School[]>([]);
  const [schoolId, setSchoolId] = useState('');
  const [year, setYear] = useState('');
  const [shift, setShift] = useState('');
  const [letter, setLetter] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [intervaloGrupo, setIntervaloGrupo] = useState<string>('');
  const [intervaloGrupoPorDia, setIntervaloGrupoPorDia] = useState<Partial<Record<1 | 2 | 3 | 4 | 5, GrupoSinoId>>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [sinoConfig, setSinoConfig] = useState<SinoConfig | undefined>(undefined);
  const [teachers, setTeachers] = useState<{ id: string; val: Teacher }[]>([]);
  const [subjects, setSubjects] = useState<SubjectItem[]>([]);
  const [atribuicoes, setAtribuicoes] = useState<Record<string, Record<string, boolean>>>({});
  const [adminIds, setAdminIds] = useState<Record<string, boolean>>({});

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
      setAllClassesAllYears(results);
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
    get(ref(rtdb, 'diario-classe/config/sino'))
      .then((snap) => {
        const val = snap.exists() ? (snap.val() as SinoConfig) : undefined;
        setSinoConfig(val);
        definirSinoConfig(val);
      })
      .catch(() => {});
    Promise.all([
      get(ref(rtdb, 'diario-classe/professores')).catch(() => null),
      get(ref(rtdb, 'diario-classe/disciplinas')).catch(() => null),
      get(ref(rtdb, 'diario-classe/atribuicoes')).catch(() => null),
      get(ref(rtdb, 'diario-classe/admins')).catch(() => null)
    ]).then(([profsSnap, subsSnap, atribsSnap, adminsSnap]) => {
      if (profsSnap?.exists()) {
        const raw = profsSnap.val() || {};
        const list = Object.keys(raw)
          .filter((id) => raw[id] && raw[id].status !== 'inactive')
          .map((id) => ({ id, val: raw[id] as Teacher }))
          .sort((a, b) => (a.val.name || '').localeCompare(b.val.name || ''));
        setTeachers(list);
      }
      if (subsSnap?.exists()) {
        const raw = subsSnap.val() || {};
        setSubjects(Object.keys(raw).map((k) => ({ id: k, ...raw[k] })));
      }
      setAtribuicoes(atribsSnap?.exists() ? (atribsSnap.val() as Record<string, Record<string, boolean>>) : {});
      setAdminIds(adminsSnap?.exists() ? (adminsSnap.val() as Record<string, boolean>) : {});
    });
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

    const turnoCanon = getTurnoCanonical(shift);
    const suportaSino = turnoCanon === 'manha' || turnoCanon === 'tarde';
    const perfisForm = suportaSino ? perfisDoTurno(sinoConfig, schoolId || undefined, turnoCanon) : [];
    const perfilSugeridoId = suportaSino ? perfilPorAno(perfisForm, year).id : undefined;
    const grupoParaSalvar = suportaSino
      ? (perfisForm.some((p) => p.id === intervaloGrupo) ? intervaloGrupo : perfilSugeridoId)
      : undefined;

    const cleanPorDia: Record<string, GrupoSinoId> = {};
    if (suportaSino) {
      ([1, 2, 3, 4, 5] as const).forEach((d) => {
        const g = intervaloGrupoPorDia[d];
        if (g) cleanPorDia[`d${d}`] = g;
      });
    }

    const data: any = {
      schoolId,
      schoolName,
      year,
      shift,
      letter: letter.trim().toUpperCase(),
      intervaloGrupo: suportaSino && (turnoCanon === 'manha' || perfisForm.length > 1) ? grupoParaSalvar : undefined,
      anoLetivo: currentYear
    };

    if (teacherId) {
      data.teacherId = teacherId;
    } else if (editingId) {
      data.teacherId = null;
    }

    if (suportaSino && Object.keys(cleanPorDia).length > 0) {
      data.intervaloGrupoPorDia = cleanPorDia;
    } else if (editingId) {
      data.intervaloGrupoPorDia = null;
    }

    try {
      let savedClassId = editingId;
      if (editingId) {
        data.updatedAt = Date.now();
        const updates: Record<string, any> = {};
        Object.keys(data).forEach((k) => {
          if (data[k] !== undefined) {
            updates[`diario-classe/turmas/${editingId}/${k}`] = data[k];
          }
        });
        if (teacherId && isAdmin) {
          updates[`diario-classe/atribuicoes/${teacherId}/${editingId}`] = true;
          const profObj = teachers.find((t) => t.id === teacherId);
          if (profObj?.val.authUid && profObj.val.authUid !== teacherId) {
            updates[`diario-classe/atribuicoes/${profObj.val.authUid}/${editingId}`] = true;
          }
        }
        await update(ref(rtdb), updates);
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
        savedClassId = newId;
        data.createdAt = Date.now();
        data.criadoPor = uid;

        const updates: Record<string, any> = {};
        updates[`diario-classe/turmas/${newId}`] = data;
        updates[`diario-classe/atribuicoes/${uid}/${newId}`] = true;
        if (teacherId && isAdmin) {
          updates[`diario-classe/atribuicoes/${teacherId}/${newId}`] = true;
          const profObj = teachers.find((t) => t.id === teacherId);
          if (profObj?.val.authUid && profObj.val.authUid !== teacherId) {
            updates[`diario-classe/atribuicoes/${profObj.val.authUid}/${newId}`] = true;
          }
        }

        await update(ref(rtdb), updates);
        setModal({
          isOpen: true,
          type: 'alert',
          title: 'Sucesso',
          message: 'Turma cadastrada com atribuição realizada!',
          icon: '✅'
        });
      }

      if (teacherId && isAdmin && savedClassId) {
        const targetCid = savedClassId;
        setAtribuicoes((prev) => ({
          ...prev,
          [teacherId]: { ...(prev[teacherId] || {}), [targetCid]: true }
        }));
      }

      setYear('');
      setShift('');
      setLetter('');
      setTeacherId('');
      setIntervaloGrupo('');
      setIntervaloGrupoPorDia({});
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
    setTeacherId(item.val.teacherId || '');
    const resolvedPid = resolverPerfilIdTurma(sinoConfig, {
      ...item.val,
      intervaloGrupoPorDia: undefined
    });
    setIntervaloGrupo(resolvedPid);
    setIntervaloGrupoPorDia(normalizarIntervaloGrupoPorDia(item.val.intervaloGrupoPorDia));
    setEditingId(item.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCancelEdit = () => {
    setYear('');
    setShift('');
    setLetter('');
    setTeacherId('');
    setIntervaloGrupo('');
    setIntervaloGrupoPorDia({});
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
        <div className="flex items-center gap-2 flex-wrap">
          {isAdmin && (
            <button
              id="virada-ano-btn"
              type="button"
              onClick={() => setViradaModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg border border-indigo-200 transition-colors cursor-pointer"
              title="Promover séries (1º→2º...4º→5º), exportar planilha editável em Excel (.xlsx) ou reimportar para o novo ano letivo"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Virada de Ano / Excel</span>
            </button>
          )}
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
                  const turnoCanon = getTurnoCanonical(shift);
                  if (val && (turnoCanon === 'manha' || turnoCanon === 'tarde')) {
                    const ps = perfisDoTurno(sinoConfig, schoolId || undefined, turnoCanon);
                    setIntervaloGrupo(perfilPorAno(ps, val).id);
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
                onChange={(e) => {
                  const novoTurno = e.target.value;
                  setShift(novoTurno);
                  const turnoCanon = getTurnoCanonical(novoTurno);
                  if (turnoCanon === 'manha' || turnoCanon === 'tarde') {
                    const ps = perfisDoTurno(sinoConfig, schoolId || undefined, turnoCanon);
                    setIntervaloGrupo(perfilPorAno(ps, year).id);
                  } else {
                    setIntervaloGrupo('');
                  }
                }}
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

            {isAdmin && (
              <div className="sm:col-span-2 md:col-span-3">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Professor(a) Regente Titular (opcional — assegura a H.A. automática)
                </label>
                <select
                  id="class-regente-select"
                  value={teacherId}
                  onChange={(e) => setTeacherId(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                >
                  <option value="">Detectar automaticamente pelas atribuições</option>
                  {teachers
                    .filter((t) => !isSpecialistTeacherDocente(t.val, subjects) && !isBibliotecarioDocente(t.val))
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.val.name}{t.val.subject ? ` (${t.val.subject})` : ''}
                      </option>
                    ))}
                </select>
              </div>
            )}

            {(shift === 'Manhã' || shift === 'Tarde') && (() => {
              const turnoForm: 'manha' | 'tarde' = shift === 'Tarde' ? 'tarde' : 'manha';
              const perfisForm = perfisDoTurno(sinoConfig, schoolId || undefined, turnoForm);
              if (turnoForm === 'tarde' && perfisForm.length <= 1 && Object.keys(intervaloGrupoPorDia).length === 0) {
                return null;
              }
              const durForm = duracaoAulaMinutos(sinoConfig, schoolId || undefined, turnoForm);
              const selecionadoId = perfisForm.some((p) => p.id === intervaloGrupo)
                ? intervaloGrupo
                : perfilPorAno(perfisForm, year).id;
              const perfilBase = perfisForm[0];
              const refOutro = perfisForm[1] || perfisForm[0];
              return (
              <div className="sm:col-span-2 md:col-span-4 bg-indigo-50/70 p-3.5 rounded-xl border border-indigo-100 space-y-3">
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
                  <div>
                    <span className="text-xs font-bold text-indigo-950 block">
                      Padrão de Sino / Intervalo ({turnoForm === 'tarde' ? 'Vespertino' : 'Matutino'})
                    </span>
                    <span className="text-[11px] text-indigo-700">
                      Início às {perfilBase?.cfg.aulas['1'].inicio} • {durForm} min/aula • Padrão da turma (pode variar por dia abaixo)
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs flex-wrap">
                    {perfisForm.map((p) => (
                      <label key={p.id} className="inline-flex items-center gap-1.5 cursor-pointer font-medium text-slate-700">
                        <input
                          type="radio"
                          name="intervaloGrupo"
                          value={p.id}
                          checked={selecionadoId === p.id}
                          onChange={() => setIntervaloGrupo(p.id)}
                          className="text-indigo-600 focus:ring-indigo-500"
                        />
                        <span>{p.nome} (Recreio {p.cfg.intervalo.inicio} • 5ª {p.cfg.aulas['5'].inicio})</span>
                      </label>
                    ))}
                  </div>
                </div>

                {perfisForm.length > 1 && (
                  <div className="pt-2.5 border-t border-indigo-200/70">
                    <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                      <span className="text-[11px] font-bold text-indigo-900">
                        Sino específico por dia da semana (opcional — ex.: Terça com 5ª aula às {refOutro?.cfg.aulas['5'].inicio}):
                      </span>
                      {Object.keys(intervaloGrupoPorDia).length > 0 && (
                        <button
                          type="button"
                          onClick={() => setIntervaloGrupoPorDia({})}
                          className="text-[11px] font-semibold text-indigo-700 hover:underline cursor-pointer"
                        >
                          Usar padrão em todos os dias
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                      {GRADE_DIAS_SEMANA.map((d) => {
                        const rawValDia = intervaloGrupoPorDia[d.id] || '';
                        const valDia = rawValDia
                          ? perfisForm.some((p) => p.id === rawValDia)
                            ? rawValDia
                            : resolverPerfilIdTurma(sinoConfig, {
                                schoolId: schoolId || undefined,
                                shift,
                                year,
                                intervaloGrupo: rawValDia
                              })
                          : '';
                        return (
                          <div key={d.id} className="bg-white/90 rounded-lg border border-indigo-200/80 p-2">
                            <label className="block text-[11px] font-bold text-slate-700 mb-1">{d.nome}</label>
                            <select
                              value={valDia}
                              onChange={(e) => {
                                const v = e.target.value as GrupoSinoId | '';
                                setIntervaloGrupoPorDia((prev) => {
                                  const next = { ...prev };
                                  if (!v) delete next[d.id];
                                  else next[d.id] = v;
                                  return next;
                                });
                              }}
                              className="w-full px-2 py-1 text-[11px] bg-slate-50 border border-slate-200 rounded-md outline-none focus:ring-1 focus:ring-indigo-500"
                            >
                              <option value="">Padrão da turma</option>
                              {perfisForm.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.curto} (5ª {p.cfg.aulas['5'].inicio})
                                </option>
                              ))}
                            </select>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
              );
            })()}
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
              const regenteRes = resolveRegenteForClass({
                classId: id,
                classVal: val,
                teachers,
                atribuicoes,
                subjects,
                adminIds
              });
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
                      {regenteRes.teacher && (
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-800"
                          title={
                            regenteRes.source === 'explicit'
                              ? 'Regente titular definido na turma'
                              : 'Regente identificado automaticamente pelas atribuições'
                          }
                        >
                          <UserCheck className="w-3 h-3" />
                          Regente: {regenteRes.teacher.val.name}
                        </span>
                      )}
                      {(val.shift === 'Manhã' || val.shift === 'Tarde') && (() => {
                        const turnoVal: 'manha' | 'tarde' = val.shift === 'Tarde' ? 'tarde' : 'manha';
                        const perfisTurma = perfisDoTurno(sinoConfig, val.schoolId, turnoVal);
                        const pidTurma = resolverPerfilIdTurma(sinoConfig, {
                          ...val,
                          intervaloGrupoPorDia: undefined
                        });
                        const idxPerfil = Math.max(0, perfisTurma.findIndex((p) => p.id === pidTurma));
                        const perfilTurma = perfisTurma[idxPerfil] || perfisTurma[0];
                        const porDiaNorm = normalizarIntervaloGrupoPorDia(val.intervaloGrupoPorDia);
                        const diasCustom = Object.entries(porDiaNorm);
                        if (turnoVal === 'tarde' && perfisTurma.length <= 1 && diasCustom.length === 0) {
                          return null;
                        }
                        const badgePalette = [
                          'bg-emerald-100 text-emerald-800 border-emerald-200',
                          'bg-sky-100 text-sky-800 border-sky-200',
                          'bg-indigo-100 text-indigo-800 border-indigo-200',
                          'bg-purple-100 text-purple-800 border-purple-200'
                        ];
                        return (
                          <>
                            {perfilTurma && (
                              <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${badgePalette[idxPerfil % badgePalette.length]}`}>
                                Sino: {perfilTurma.nome} (Recreio {perfilTurma.cfg.intervalo.inicio} – {perfilTurma.cfg.intervalo.fim})
                              </span>
                            )}
                            {diasCustom.length > 0 && (
                              <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-900 border border-amber-200">
                                Por dia:{' '}
                                {diasCustom
                                  .map(([dStr, grp]) => {
                                    const dNome = GRADE_DIAS_SEMANA.find((x) => x.id === Number(dStr))?.curto || dStr;
                                    const pidDia = resolverPerfilIdTurma(sinoConfig, {
                                      ...val,
                                      intervaloGrupo: grp,
                                      intervaloGrupoPorDia: undefined
                                    });
                                    const pDia = perfisTurma.find((p) => p.id === pidDia) || perfilTurma;
                                    return `${dNome}: ${pDia.curto} (${pDia.cfg.aulas['5'].inicio})`;
                                  })
                                  .join(' • ')}
                              </span>
                            )}
                          </>
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

      {isAdmin && (
        <ViradaAnoModal
          isOpen={viradaModalOpen}
          onClose={() => setViradaModalOpen(false)}
          currentYear={currentYear}
          allClassesAllYears={allClassesAllYears}
          schools={schools}
          sinoConfig={sinoConfig}
          setModal={setModal}
          onCompleted={loadClasses}
        />
      )}
    </div>
  );
};
