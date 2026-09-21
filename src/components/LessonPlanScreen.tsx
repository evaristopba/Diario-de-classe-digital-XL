import React, { useState, useEffect } from 'react';
import { LessonPlan, ClassRoom, Category, BNCCSkill, ModalConfig } from '../types';
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
import { isSkillApplicableToYear, formatSkillYearsLabel, getSkillApplicableYears } from '../lib/bnccHelper';
import {
  BookOpen,
  Plus,
  Edit2,
  Trash2,
  Download,
  Upload,
  X,
  Search,
  CheckCircle2,
  Filter,
  Calendar,
  RotateCcw
} from 'lucide-react';

interface LessonPlanScreenProps {
  currentTeacher: string;
  currentYear: string;
  setModal: (config: ModalConfig) => void;
}

export const LessonPlanScreen: React.FC<LessonPlanScreenProps> = ({
  currentTeacher,
  currentYear,
  setModal
}) => {
  const [classes, setClasses] = useState<{ id: string; val: ClassRoom }[]>([]);
  const [categories, setCategories] = useState<{ id: string; val: Category }[]>([]);
  const [bnccList, setBnccList] = useState<{ id: string; val: BNCCSkill }[]>([]);

  const [selectedClassId, setSelectedClassId] = useState('');
  const [selectedBimester, setSelectedBimester] = useState('1');
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split('T')[0]
  );
  const [categoryId, setCategoryId] = useState('');
  const [selectedBnccIds, setSelectedBnccIds] = useState<string[]>([]);
  const [planned, setPlanned] = useState('');
  const [given, setGiven] = useState('');
  const [obs, setObs] = useState('');

  const [filterClassId, setFilterClassId] = useState('');
  const [filterBimester, setFilterBimester] = useState('');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [lessonPlans, setLessonPlans] = useState<{ id: string; val: LessonPlan }[]>([]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [showBnccCards, setShowBnccCards] = useState(true);
  const [bnccSearch, setBnccSearch] = useState('');
  const [filterBnccByYear, setFilterBnccByYear] = useState(true);
  const [loading, setLoading] = useState(false);

  const loadData = async () => {
    try {
      const turmas = await carregarMinhasTurmas();
      const filtered = turmas.filter(
        (r) => !r.val.anoLetivo || !currentYear || String(r.val.anoLetivo).trim() === String(currentYear).trim()
      );
      setClasses(filtered);
      if (filtered.length > 0 && !selectedClassId) {
        setSelectedClassId(filtered[0].id);
      }

      const catSnap = await get(ref(rtdb, 'diario-classe/categorias'));
      const catVal = catSnap.val() || {};
      const catArr: { id: string; val: Category }[] = [];
      Object.keys(catVal).forEach((k) => catArr.push({ id: k, val: catVal[k] }));
      catArr.sort((a, b) => a.val.name.localeCompare(b.val.name));
      setCategories(catArr);

      const bnccSnap = await get(ref(rtdb, 'diario-classe/bncc'));
      const bnccVal = bnccSnap.val() || {};
      const bnccArr: { id: string; val: BNCCSkill }[] = [];
      Object.keys(bnccVal).forEach((k) => bnccArr.push({ id: k, val: bnccVal[k] }));
      setBnccList(bnccArr);
    } catch (err) {
      console.error(err);
    }
  };

  const loadLessonPlans = async () => {
    try {
      setLoading(true);
      const snap = await get(ref(rtdb, dc('planos-aula')));
      const val = snap.val() || {};
      const list: { id: string; val: LessonPlan }[] = [];
      Object.keys(val).forEach((k) => {
        const p = val[k];
        if (!p.anoLetivo || p.anoLetivo === currentYear) {
          if (!filterClassId || p.classId === filterClassId) {
            if (!filterBimester || String(p.bimester) === String(filterBimester)) {
              // Filtro por período (de/até)
              if (filterStartDate && p.date && p.date < filterStartDate) {
                return;
              }
              if (filterEndDate && p.date && p.date > filterEndDate) {
                return;
              }
              list.push({ id: k, val: p });
            }
          }
        }
      });
      // Ordena mostrando os planos mais novos primeiro (data decrescente e timestamp de criação/atualização decrescente)
      list.sort((a, b) => {
        const dateCmp = (b.val.date || '').localeCompare(a.val.date || '');
        if (dateCmp !== 0) return dateCmp;
        const bTime = b.val.createdAt || b.val.ratifiedAt || 0;
        const aTime = a.val.createdAt || a.val.ratifiedAt || 0;
        return bTime - aTime;
      });
      setLessonPlans(list);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [currentYear]);

  useEffect(() => {
    loadLessonPlans();
  }, [filterClassId, filterBimester, filterStartDate, filterEndDate, currentYear]);

  const currentClass = classes.find((c) => c.id === selectedClassId)?.val;
  const currentClassYear = currentClass ? currentClass.year : '';

  const filteredBncc = bnccList
    .filter(
      (b) => !filterBnccByYear || !currentClassYear || isSkillApplicableToYear(b.val, currentClassYear)
    )
    .filter(
      (b) =>
        !bnccSearch ||
        b.val.code.toLowerCase().includes(bnccSearch.toLowerCase()) ||
        (b.val.desc || b.val.description || '').toLowerCase().includes(bnccSearch.toLowerCase())
    )
    .sort((a, b) => a.val.code.localeCompare(b.val.code));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClassId || !selectedBimester || !selectedDate || !planned.trim() || !categoryId) {
      return setModal({
        isOpen: true,
        type: 'alert',
        title: 'Atenção',
        message: 'Preencha todos os campos obrigatórios (Turma, Bimestre, Data, Categoria e Conteúdo Programado)!',
        icon: '⚠️'
      });
    }

    // Mapear códigos das habilidades selecionadas para busca e relatórios
    const selectedCodes = selectedBnccIds
      .map((id) => bnccList.find((b) => b.id === id)?.val?.code)
      .filter(Boolean) as string[];

    const data: any = {
      classId: selectedClassId,
      bimester: selectedBimester,
      date: selectedDate,
      categoryId,
      bnccId: selectedBnccIds[0] || '', // retrocompatibilidade com nós antigos
      bnccIds: selectedBnccIds,
      bnccCodes: selectedCodes,
      planned: planned.trim(),
      given: given.trim(),
      obs: obs.trim(),
      teacher: currentTeacher,
      anoLetivo: currentYear
    };

    try {
      if (editingId) {
        data.ratifiedAt = Date.now();
        await update(ref(rtdb, dc(`planos-aula/${editingId}`)), data);
        setModal({
          isOpen: true,
          type: 'alert',
          title: 'Sucesso',
          message: 'Plano de aula atualizado com sucesso!',
          icon: '✅'
        });
      } else {
        data.createdAt = Date.now();
        await push(ref(rtdb, dc('planos-aula')), data);
        setModal({
          isOpen: true,
          type: 'alert',
          title: 'Sucesso',
          message: 'Plano de aula salvo com sucesso!',
          icon: '✅'
        });
      }

      setPlanned('');
      setGiven('');
      setObs('');
      setSelectedBnccIds([]);
      setEditingId(null);
      loadLessonPlans();
    } catch (err: any) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro ao Salvar Plano',
        message: formatFriendlyError(err, 'Não foi possível salvar o plano de aula'),
        icon: '❌'
      });
    }
  };

  const handleEdit = (item: { id: string; val: LessonPlan }) => {
    setSelectedClassId(item.val.classId);
    setSelectedBimester(item.val.bimester || '1');
    setSelectedDate(item.val.date);
    setCategoryId(item.val.categoryId || '');
    
    // Recupera múltiplos IDs (ou retrocompatível com item.val.bnccId ou item.val.bnccCodes)
    let initialIds: string[] = [];
    if (Array.isArray(item.val.bnccIds) && item.val.bnccIds.length > 0) {
      initialIds = item.val.bnccIds;
    } else if (item.val.bnccId) {
      initialIds = [item.val.bnccId];
    } else if (Array.isArray(item.val.bnccCodes) && item.val.bnccCodes.length > 0) {
      initialIds = bnccList
        .filter((b) => item.val.bnccCodes?.includes(b.val.code))
        .map((b) => b.id);
    }
    setSelectedBnccIds(initialIds);

    setPlanned(item.val.planned || '');
    setGiven(item.val.given || '');
    setObs(item.val.obs || '');
    setEditingId(item.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCancelEdit = () => {
    setPlanned('');
    setGiven('');
    setObs('');
    setSelectedBnccIds([]);
    setEditingId(null);
  };

  const handleDelete = (id: string) => {
    setModal({
      isOpen: true,
      type: 'confirm',
      title: 'Confirmar Exclusão',
      message: 'Tem certeza que deseja excluir este plano de aula?',
      icon: '⚠️',
      danger: true,
      onConfirm: async () => {
        try {
          await remove(ref(rtdb, dc(`planos-aula/${id}`)));
          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Excluído',
            message: 'Plano de aula excluído com sucesso!',
            icon: '✅'
          });
          loadLessonPlans();
        } catch (err: any) {
          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Erro ao Excluir Plano',
            message: formatFriendlyError(err, 'Não foi possível excluir o plano de aula'),
            icon: '❌'
          });
        }
      }
    });
  };

  const handleCheckOrphans = async () => {
    try {
      const snap = await get(ref(rtdb, dc('planos-aula')));
      const val = snap.val() || {};
      const orphans: Record<string, string[]> = {};
      let total = 0;

      Object.keys(val).forEach((k) => {
        const p = val[k];
        if (p) {
          const noBimester = !p.bimester || String(p.bimester).trim() === '';
          const noYear = !p.anoLetivo || String(p.anoLetivo).trim() === '';
          if (noBimester || noYear) {
            const cId = p.classId || 'sem_turma';
            if (!orphans[cId]) orphans[cId] = [];
            orphans[cId].push(k);
            total++;
          }
        }
      });

      if (total === 0) {
        return setModal({
          isOpen: true,
          type: 'alert',
          title: 'Tudo Limpo',
          message: 'Nenhum plano de aula incompleto encontrado!',
          icon: '✅'
        });
      }

      setModal({
        isOpen: true,
        type: 'custom',
        title: '🧹 Limpeza de Planos Incompletos',
        icon: '🧹',
        children: (
          <div className="text-left space-y-3">
            <p className="text-xs text-slate-600">
              Foram encontrados <strong>{total}</strong> planos de aula sem bimestre ou sem ano letivo.
            </p>
            <button
              onClick={async () => {
                const updates: Record<string, any> = {};
                Object.keys(orphans).forEach((cId) => {
                  orphans[cId].forEach((k) => (updates[dc(`planos-aula/${k}`)] = null));
                });
                await update(ref(rtdb), updates);
                loadLessonPlans();
                setModal({
                  isOpen: true,
                  type: 'alert',
                  title: 'Concluído',
                  message: 'Todos os planos incompletos foram removidos!',
                  icon: '✅'
                });
              }}
              className="w-full py-2 bg-rose-600 text-white text-xs font-bold rounded-lg"
            >
              Excluir Todos ({total})
            </button>
          </div>
        )
      });
    } catch (err: any) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro na Verificação',
        message: formatFriendlyError(err, 'Não foi possível verificar os planos de aula'),
        icon: '❌'
      });
    }
  };

  const selectedBnccObjs = bnccList
    .filter((b) => selectedBnccIds.includes(b.id))
    .map((b) => ({ id: b.id, val: b.val }));

  const toggleBnccSelection = (id: string) => {
    setSelectedBnccIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6">
      <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-800 flex items-center gap-2">
            <BookOpen className="w-6 h-6 text-indigo-600" />
            Plano de Aula
          </h2>
          <p className="text-xs sm:text-sm text-slate-500">
            Registro detalhado de aulas ministradas, categorias pedagógicas e habilidades BNCC
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            id="lesson-check-orphans-btn"
            onClick={handleCheckOrphans}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-purple-700 bg-purple-50 hover:bg-purple-100 rounded-lg border border-purple-200 transition-colors"
          >
            <Search className="w-3.5 h-3.5" />
            <span>Verificar Incompletos</span>
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 sm:p-6 shadow-xs mb-8">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-slate-800">
            {editingId ? 'Editar Plano de Aula' : 'Novo Plano de Aula'}
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
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Turma *
              </label>
              <select
                id="lesson-class-select"
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
                id="lesson-bimester-select"
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
                id="lesson-date-input"
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Categoria de Atividade *
              </label>
              <select
                id="lesson-category-select"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                required
              >
                <option value="">Selecione a Categoria</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.val.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* BNCC Visual Cards Section */}
          <div className="border border-slate-200 rounded-2xl p-4 bg-slate-50/50">
            <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
              <div>
                <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <span>Habilidade BNCC</span>
                  <span className="text-[11px] font-normal text-slate-500">
                    {filterBnccByYear && currentClassYear
                      ? `(Filtrado para ${currentClassYear}º ano + habilidades plurianuais)`
                      : '(Todas as habilidades da BNCC)'}
                  </span>
                </label>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {currentClassYear && (
                  <button
                    type="button"
                    onClick={() => setFilterBnccByYear(!filterBnccByYear)}
                    className={`text-[11px] font-medium px-2 py-1 rounded-md border transition-colors ${
                      filterBnccByYear
                        ? 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100'
                        : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
                    }`}
                    title="Alternar entre ver apenas habilidades deste ano/plurianuais ou todas"
                  >
                    {filterBnccByYear ? `✓ Apenas ${currentClassYear}º ano/Plurianual` : 'Exibindo Todas'}
                  </button>
                )}
                <input
                  type="text"
                  value={bnccSearch}
                  onChange={(e) => setBnccSearch(e.target.value)}
                  placeholder="Filtrar por código ou texto..."
                  className="px-2.5 py-1 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
                <button
                  type="button"
                  onClick={() => setShowBnccCards(!showBnccCards)}
                  className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 bg-indigo-50 px-2.5 py-1 rounded-md"
                >
                  {showBnccCards ? 'Ocultar Lista' : 'Expandir Habilidades'}
                </button>
              </div>
            </div>

            {selectedBnccObjs.length > 0 && (
              <div className="mb-3 p-3 bg-emerald-50/90 border border-emerald-200 rounded-xl space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-emerald-900 flex items-center gap-1.5">
                    <span>Habilidades Selecionadas ({selectedBnccObjs.length}):</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelectedBnccIds([])}
                    className="text-[11px] text-emerald-700 hover:text-emerald-900 font-semibold px-2 py-0.5 rounded hover:bg-emerald-100 transition-colors"
                  >
                    Desmarcar Todas
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {selectedBnccObjs.map((b) => (
                    <span
                      key={b.id}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-white border border-emerald-300 text-emerald-900 shadow-xs"
                    >
                      <strong className="font-mono">{b.val.code}</strong>
                      <span className="text-[10px] text-emerald-700 max-w-[200px] truncate hidden sm:inline">
                        - {b.val.desc || b.val.description}
                      </span>
                      <button
                        type="button"
                        onClick={() => toggleBnccSelection(b.id)}
                        className="ml-1 text-slate-400 hover:text-rose-600 font-bold"
                        title="Remover habilidade"
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {showBnccCards && (
              <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1">
                <button
                  type="button"
                  onClick={() => setSelectedBnccIds([])}
                  className={`w-full text-left p-2.5 rounded-xl border text-xs transition-all ${
                    selectedBnccIds.length === 0
                      ? 'border-emerald-500 bg-emerald-50/80 font-semibold text-emerald-900'
                      : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <CheckCircle2
                      className={`w-4 h-4 ${selectedBnccIds.length === 0 ? 'text-emerald-600' : 'text-slate-300'}`}
                    />
                    <span>Nenhum código BNCC associado (Apenas conteúdo e categoria)</span>
                  </span>
                </button>

                {filteredBncc.length === 0 ? (
                  <div className="p-3 text-center text-xs text-slate-500 bg-white rounded-xl border border-slate-200">
                    <p className="font-medium text-slate-700">Nenhuma habilidade encontrada para o filtro atual.</p>
                    {currentClassYear && filterBnccByYear && (
                      <p className="mt-1 text-[11px] text-slate-500">
                        Clique no botão acima "Exibindo Todas" ou ajuste a busca para visualizar outros códigos.
                      </p>
                    )}
                  </div>
                ) : (
                  filteredBncc.map((item) => {
                    const isSelected = selectedBnccIds.includes(item.id);
                    const yearsLabel = formatSkillYearsLabel(item.val);
                    const isPluriannual = getSkillApplicableYears(item.val).length > 1;

                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => toggleBnccSelection(item.id)}
                        className={`w-full text-left p-2.5 rounded-xl border text-xs transition-all ${
                          isSelected
                            ? 'border-emerald-500 bg-emerald-50/90 text-emerald-950 font-medium ring-1 ring-emerald-500/20'
                            : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                        }`}
                      >
                        <div className="flex items-start gap-2.5">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {}} // controlado pelo onClick do container
                            className="mt-0.5 rounded text-emerald-600 focus:ring-emerald-500 pointer-events-none"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <strong className="font-bold text-slate-900 font-mono">{item.val.code}</strong>
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                  isPluriannual
                                    ? 'bg-purple-100 text-purple-800'
                                    : 'bg-slate-100 text-slate-600'
                                }`}
                              >
                                {yearsLabel}
                              </span>
                              {isSelected && (
                                <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-emerald-200 text-emerald-800">
                                  ✓ Selecionada
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-600 mt-0.5 leading-snug">
                              {item.val.desc || item.val.description}
                            </p>
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Conteúdo Programado *
            </label>
            <textarea
              id="lesson-planned-input"
              rows={2}
              value={planned}
              onChange={(e) => setPlanned(e.target.value)}
              placeholder="Descreva o conteúdo planejado para a aula..."
              className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 resize-y"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Conteúdo Ministrado / Desenvolvido
            </label>
            <textarea
              id="lesson-given-input"
              rows={2}
              value={given}
              onChange={(e) => setGiven(e.target.value)}
              placeholder="Descreva o que foi efetivamente trabalhado com os alunos..."
              className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 resize-y"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Observações Pedagógicas
            </label>
            <textarea
              id="lesson-obs-input"
              rows={2}
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              placeholder="Anotações gerais, dificuldades observadas ou próximos passos..."
              className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 resize-y"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              id="lesson-save-btn"
              type="submit"
              className="inline-flex items-center gap-1.5 px-5 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-xs transition-colors"
            >
              <Plus className="w-4 h-4" />
              {editingId ? 'Atualizar Plano' : 'Salvar Plano de Aula'}
            </button>
          </div>
        </form>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 sm:p-6 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <h3 className="text-base font-bold text-slate-800">
            Planos Registrados ({lessonPlans.length})
          </h3>
          <div className="flex items-center gap-2 flex-wrap">
            <Filter className="w-4 h-4 text-slate-400" />
            <select
              id="filter-lesson-class"
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
              id="filter-lesson-bimester"
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

            {/* Filtro por Período */}
            <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-xs">
              <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="text-[11px] font-medium text-slate-500">De:</span>
              <input
                id="filter-lesson-start-date"
                type="date"
                value={filterStartDate}
                onChange={(e) => setFilterStartDate(e.target.value)}
                className="bg-transparent text-slate-700 text-xs focus:outline-none"
              />
              <span className="text-[11px] font-medium text-slate-500">Até:</span>
              <input
                id="filter-lesson-end-date"
                type="date"
                value={filterEndDate}
                onChange={(e) => setFilterEndDate(e.target.value)}
                className="bg-transparent text-slate-700 text-xs focus:outline-none"
              />
              {(filterStartDate || filterEndDate) && (
                <button
                  id="filter-lesson-clear-period"
                  type="button"
                  title="Limpar filtro de período"
                  onClick={() => {
                    setFilterStartDate('');
                    setFilterEndDate('');
                  }}
                  className="p-0.5 text-slate-400 hover:text-rose-600 rounded transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {(filterClassId || filterBimester || filterStartDate || filterEndDate) && (
              <button
                id="filter-lesson-reset-all"
                type="button"
                onClick={() => {
                  setFilterClassId('');
                  setFilterBimester('');
                  setFilterStartDate('');
                  setFilterEndDate('');
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-slate-600 hover:text-indigo-600 bg-slate-100 hover:bg-slate-200/80 rounded-lg transition-colors"
                title="Limpar todos os filtros"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Limpar Filtros</span>
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="py-8 text-center text-sm text-slate-400">Carregando planos de aula...</div>
        ) : lessonPlans.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-400">
            Nenhum plano de aula encontrado com os filtros atuais.
          </div>
        ) : (
          <div className="space-y-3">
            {lessonPlans.map((item) => {
              const plan = item.val;
              const turma = classes.find((c) => c.id === plan.classId)?.val;
              const turmaStr = turma ? `${turma.year}º ${turma.letter} (${turma.shift})` : 'Turma';
              const cat = categories.find((c) => c.id === plan.categoryId)?.val;
              const bncc = bnccList.find((b) => b.id === plan.bnccId)?.val;

              return (
                <div
                  key={item.id}
                  className="p-4 rounded-xl border border-slate-100 bg-slate-50/60 hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="space-y-1 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm text-slate-800">
                          📅 {formatDate(plan.date)}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-200 text-slate-700">
                          {turmaStr}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-100 text-indigo-700">
                          {plan.bimester ? `${plan.bimester}º Bimestre` : 'Sem Bimestre'}
                        </span>
                        {cat && (
                          <span
                            className="px-2 py-0.5 rounded-full text-[11px] font-semibold text-white"
                            style={{ backgroundColor: cat.color || '#667eea' }}
                          >
                            {cat.name}
                          </span>
                        )}
                      </div>

                      {/* Exibição das Habilidades BNCC (Múltiplas ou Única) */}
                      {(() => {
                        // Coleta todas as habilidades associadas a este plano
                        const matchedSkills: BNCCSkill[] = [];
                        const seenCodes = new Set<string>();

                        if (Array.isArray(plan.bnccIds)) {
                          plan.bnccIds.forEach((id) => {
                            const b = bnccList.find((x) => x.id === id)?.val;
                            if (b && !seenCodes.has(b.code)) {
                              matchedSkills.push(b);
                              seenCodes.add(b.code);
                            }
                          });
                        }

                        if (Array.isArray(plan.bnccCodes)) {
                          plan.bnccCodes.forEach((c) => {
                            if (!seenCodes.has(c)) {
                              const b = bnccList.find((x) => x.val.code === c)?.val;
                              matchedSkills.push(b || { code: c, desc: '', year: '1' });
                              seenCodes.add(c);
                            }
                          });
                        }

                        if (plan.bnccId && !seenCodes.has(plan.bnccId)) {
                          const b = bnccList.find((x) => x.id === plan.bnccId)?.val;
                          if (b && !seenCodes.has(b.code)) {
                            matchedSkills.push(b);
                            seenCodes.add(b.code);
                          }
                        }

                        if (matchedSkills.length === 0) return null;

                        return (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {matchedSkills.map((b) => (
                              <span
                                key={b.code}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-emerald-50 text-emerald-800 border border-emerald-200"
                                title={b.desc || b.description || ''}
                              >
                                <strong className="font-mono">{b.code}</strong>
                                {b.desc && (
                                  <span className="text-[11px] text-emerald-700 max-w-[240px] truncate hidden md:inline">
                                    - {b.desc}
                                  </span>
                                )}
                              </span>
                            ))}
                          </div>
                        );
                      })()}

                      <div className="text-xs text-slate-700 mt-2 space-y-1">
                        <p>
                          <strong>Programado:</strong> {plan.planned}
                        </p>
                        {plan.given && (
                          <p className="text-slate-600">
                            <strong>Ministrado:</strong> {plan.given}
                          </p>
                        )}
                        {plan.obs && (
                          <p className="text-slate-500 italic">
                            <strong>Obs:</strong> {plan.obs}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        id={`lesson-edit-${item.id}`}
                        onClick={() => handleEdit(item)}
                        className="p-1.5 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                        title="Editar"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        id={`lesson-delete-${item.id}`}
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
