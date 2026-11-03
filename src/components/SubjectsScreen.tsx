import React, { useState, useEffect } from 'react';
import { SubjectItem, DEFAULT_SUBJECTS, ModalConfig, sortSubjectsByOrder } from '../types';
import { get, ref, set, push, update, remove, rtdb, verificarIsAdmin } from '../lib/firebase';
import { formatFriendlyError } from '../lib/errorHandler';
import { checkSubjectDeleteIntegrity } from '../lib/referentialIntegrity';
import {
  BookOpen,
  Plus,
  Edit2,
  Trash2,
  RefreshCw,
  Hash,
  ChevronUp,
  ChevronDown,
  Sparkles,
  Info
} from 'lucide-react';

interface SubjectsScreenProps {
  setModal: (config: ModalConfig) => void;
}

export const SubjectsScreen: React.FC<SubjectsScreenProps> = ({ setModal }) => {
  const [subjects, setSubjects] = useState<{ id: string; val: SubjectItem }[]>([]);
  const [name, setName] = useState('');
  const [shortName, setShortName] = useState('');
  const [category, setCategory] = useState<'regente' | 'diversificada'>('regente');
  const [order, setOrder] = useState<number | ''>('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const getNextSuggestedOrder = (list: { id: string; val: SubjectItem }[]): number => {
    const orders = list
      .map((s) => (typeof s.val.order === 'number' && !isNaN(s.val.order) ? s.val.order : 0))
      .filter((n) => n > 0);
    return orders.length > 0 ? Math.max(...orders) + 1 : 1;
  };

  const loadSubjects = async () => {
    try {
      setLoading(true);
      const snap = await get(ref(rtdb, 'diario-classe/disciplinas'));
      if (snap.exists()) {
        const val = snap.val() || {};
        const list: { id: string; val: SubjectItem }[] = [];
        Object.keys(val).forEach((k) => {
          const item = val[k];
          const sItem: SubjectItem =
            typeof item === 'object' && item !== null
              ? {
                  id: item.id || k,
                  name: item.name || k,
                  shortName: item.shortName || item.name || k,
                  category: item.category === 'diversificada' ? 'diversificada' : 'regente',
                  order: typeof item.order === 'number' && !isNaN(item.order) ? item.order : undefined
                }
              : { id: k, name: String(item), shortName: String(item), category: 'regente' };
          list.push({ id: k, val: sItem });
        });

        // Ordena numericamente pelo campo order (1, 2, 3...) e fallback por nome
        list.sort((a, b) => {
          const oA = typeof a.val.order === 'number' && !isNaN(a.val.order) ? a.val.order : 9999;
          const oB = typeof b.val.order === 'number' && !isNaN(b.val.order) ? b.val.order : 9999;
          if (oA !== oB) return oA - oB;
          return (a.val.name || '').localeCompare(b.val.name || '');
        });

        setSubjects(list);
        if (!editingId) {
          setOrder(getNextSuggestedOrder(list));
        }
      } else {
        // Se ainda não houver disciplinas no banco, carrega as padrões já ordenadas da BNCC
        const defaultList = DEFAULT_SUBJECTS.map((s) => ({ id: s.id, val: s }));
        setSubjects(defaultList);
        if (!editingId) {
          setOrder(getNextSuggestedOrder(defaultList));
        }
      }
    } catch (err: any) {
      console.error(err);
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro ao Carregar Disciplinas',
        message: formatFriendlyError(err, 'Não foi possível carregar a lista de disciplinas'),
        icon: '⚠️'
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSubjects();
    verificarIsAdmin().then((admin) => setIsAdmin(admin));
  }, []);

  const handleInitializeDefaults = async () => {
    if (!isAdmin) {
      return setModal({
        isOpen: true,
        type: 'alert',
        title: 'Acesso Restrito',
        message: '⛔ Apenas Administradores têm permissão para restaurar matérias padrão.',
        icon: '⛔'
      });
    }

    setModal({
      isOpen: true,
      type: 'confirm',
      title: 'Restaurar Matérias Padrão da BNCC',
      message:
        'Deseja gravar no banco todas as disciplinas padrão da BNCC para o Ensino Fundamental I com a numeração oficial predefinida (Língua Portuguesa 1º, Arte 2º, Educação Física 3º, etc.)?',
      icon: '📚',
      onConfirm: async () => {
        try {
          setSaving(true);
          const updates: Record<string, any> = {};
          DEFAULT_SUBJECTS.forEach((sub) => {
            updates[`diario-classe/disciplinas/${sub.id}`] = sub;
          });
          await update(ref(rtdb), updates);
          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Sucesso',
            message: 'Disciplinas padrão com numeração da BNCC gravadas no banco de dados!',
            icon: '✅'
          });
          await loadSubjects();
        } catch (err: any) {
          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Erro ao Restaurar Matérias',
            message: formatFriendlyError(err, 'Não foi possível gravar as disciplinas padrão'),
            icon: '❌'
          });
        } finally {
          setSaving(false);
        }
      }
    });
  };

  const handleApplyBNCCSequence = async () => {
    if (!isAdmin) {
      return setModal({
        isOpen: true,
        type: 'alert',
        title: 'Acesso Restrito',
        message: '⛔ Apenas Administradores têm permissão para reordenar matérias pela BNCC.',
        icon: '⛔'
      });
    }

    setModal({
      isOpen: true,
      type: 'confirm',
      title: 'Aplicar Sequência Padrão BNCC (Fund. I)',
      message:
        'Deseja aplicar a numeração oficial da BNCC (1º Língua Portuguesa, 2º Arte, 3º Educação Física, 4º Língua Inglesa, 5º Matemática, 6º Ciências, 7º Geografia, 8º História, 9º Ensino Religioso, 10º Computação) nas matérias cadastradas correspondentes?',
      icon: '✨',
      onConfirm: async () => {
        try {
          setSaving(true);
          const updates: Record<string, any> = {};
          const bnccMapById: Record<string, number> = {};
          DEFAULT_SUBJECTS.forEach((d) => {
            if (d.order) bnccMapById[d.id] = d.order;
          });

          subjects.forEach((s) => {
            let assignedOrder = bnccMapById[s.id];
            if (!assignedOrder) {
              const normName = (s.val.name || '')
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '');
              const matched = DEFAULT_SUBJECTS.find(
                (d) =>
                  d.name
                    .toLowerCase()
                    .normalize('NFD')
                    .replace(/[\u0300-\u036f]/g, '') === normName
              );
              if (matched && matched.order) {
                assignedOrder = matched.order;
              }
            }
            if (assignedOrder) {
              updates[`diario-classe/disciplinas/${s.id}/order`] = assignedOrder;
            }
          });

          if (Object.keys(updates).length > 0) {
            await update(ref(rtdb), updates);
            setModal({
              isOpen: true,
              type: 'alert',
              title: 'Sucesso',
              message: 'Ordem padrão da BNCC aplicada às matérias cadastradas!',
              icon: '✅'
            });
            await loadSubjects();
          } else {
            setModal({
              isOpen: true,
              type: 'alert',
              title: 'Aviso',
              message: 'Nenhuma matéria correspondente à BNCC foi localizada para reordenar.',
              icon: 'ℹ️'
            });
          }
        } catch (err: any) {
          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Erro ao Aplicar Sequência',
            message: formatFriendlyError(err, 'Não foi possível atualizar a ordem das matérias'),
            icon: '❌'
          });
        } finally {
          setSaving(false);
        }
      }
    });
  };

  const handleQuickMove = async (sub: { id: string; val: SubjectItem }, direction: 'up' | 'down') => {
    const currentIndex = subjects.findIndex((s) => s.id === sub.id);
    if (currentIndex === -1) return;
    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= subjects.length) return;

    const currentItem = subjects[currentIndex];
    const targetItem = subjects[targetIndex];

    const currentOrder =
      typeof currentItem.val.order === 'number' && !isNaN(currentItem.val.order)
        ? currentItem.val.order
        : currentIndex + 1;
    let targetOrder =
      typeof targetItem.val.order === 'number' && !isNaN(targetItem.val.order)
        ? targetItem.val.order
        : targetIndex + 1;

    if (currentOrder === targetOrder) {
      targetOrder = direction === 'up' ? Math.max(1, currentOrder - 1) : currentOrder + 1;
    }

    const updates: Record<string, any> = {};
    updates[`diario-classe/disciplinas/${currentItem.id}/order`] = targetOrder;
    updates[`diario-classe/disciplinas/${targetItem.id}/order`] = currentOrder;

    try {
      setSaving(true);
      await update(ref(rtdb), updates);
      await loadSubjects();
    } catch (err: any) {
      console.error('Erro ao reordenar matéria:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      return setModal({
        isOpen: true,
        type: 'alert',
        title: 'Atenção',
        message: 'Preencha o nome da disciplina!',
        icon: '⚠️'
      });
    }

    const shortCode = shortName.trim().toUpperCase() || name.trim().substring(0, 3).toUpperCase();
    const parsedOrder =
      order === '' || isNaN(Number(order)) ? undefined : Math.max(1, parseInt(String(order), 10));

    const data: SubjectItem = {
      id: editingId || name.trim().toLowerCase().replace(/[^a-z0-9]/g, '_'),
      name: name.trim(),
      shortName: shortCode,
      category,
      ...(parsedOrder !== undefined ? { order: parsedOrder } : {})
    };

    try {
      setSaving(true);
      if (editingId) {
        await update(ref(rtdb, `diario-classe/disciplinas/${editingId}`), data);
        setModal({
          isOpen: true,
          type: 'alert',
          title: 'Sucesso',
          message: 'Disciplina e sua ordem no boletim atualizadas com sucesso!',
          icon: '✅'
        });
      } else {
        const idKey = name.trim().toLowerCase().replace(/[^a-z0-9]/g, '_');
        await set(ref(rtdb, `diario-classe/disciplinas/${idKey}`), data);
        setModal({
          isOpen: true,
          type: 'alert',
          title: 'Sucesso',
          message: 'Nova disciplina cadastrada com sua ordem no boletim definida!',
          icon: '✅'
        });
      }

      setName('');
      setShortName('');
      setCategory('regente');
      setEditingId(null);
      await loadSubjects();
    } catch (err: any) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro ao Salvar Disciplina',
        message: formatFriendlyError(err, 'Não foi possível salvar a disciplina'),
        icon: '❌'
      });
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (sub: { id: string; val: SubjectItem }) => {
    setEditingId(sub.id);
    setName(sub.val.name || '');
    setShortName(sub.val.shortName || '');
    setCategory(sub.val.category || 'regente');
    setOrder(typeof sub.val.order === 'number' && !isNaN(sub.val.order) ? sub.val.order : '');
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setName('');
    setShortName('');
    setCategory('regente');
    setOrder(getNextSuggestedOrder(subjects));
  };

  const handleDelete = (id: string, subName: string) => {
    setModal({
      isOpen: true,
      type: 'confirm',
      title: 'Excluir Disciplina',
      message: `Tem certeza que deseja excluir a disciplina "${subName}"?`,
      icon: '🗑️',
      danger: true,
      onConfirm: async () => {
        try {
          const integrity = await checkSubjectDeleteIntegrity(id, subName);
          if (!integrity.canDelete) {
            return setModal({
              isOpen: true,
              type: 'alert',
              title: 'Exclusão Bloqueada',
              message: `⛔ ${integrity.reason}`,
              icon: '⛔'
            });
          }

          await remove(ref(rtdb, `diario-classe/disciplinas/${id}`));
          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Excluído',
            message: 'Disciplina removida com sucesso.',
            icon: '✅'
          });
          loadSubjects();
        } catch (err: any) {
          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Erro ao Excluir Disciplina',
            message: formatFriendlyError(err, 'Não foi possível excluir a disciplina'),
            icon: '❌'
          });
        }
      }
    });
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-100 text-indigo-700 rounded-xl shadow-xs">
              <BookOpen className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-800">Disciplinas & Matérias</h1>
              <p className="text-sm text-slate-500">
                Gerencie as matérias curriculares e defina a ordem numérica (1, 2, 3...) de exibição no Boletim Escolar
              </p>
            </div>
          </div>
        </div>

        {isAdmin && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleApplyBNCCSequence}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-semibold rounded-xl border border-emerald-200 transition cursor-pointer shadow-xs"
              title="Aplica a sequência 1º ao 10º padrão da BNCC para o Ensino Fundamental I"
            >
              <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
              <span>Ordem BNCC (Fund. I)</span>
            </button>
            <button
              onClick={handleInitializeDefaults}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-semibold rounded-xl border border-indigo-200 transition cursor-pointer shadow-xs"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Restaurar Padrões</span>
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Formulário de Cadastro / Edição */}
        <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-xs h-fit">
          <h2 className="text-base font-bold text-slate-800 mb-4 flex items-center gap-2">
            <Plus className="w-4 h-4 text-indigo-600" />
            {editingId ? 'Editar Disciplina' : 'Nova Disciplina'}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Nome da Disciplina *
              </label>
              <input
                id="subject-name-input"
                type="text"
                required
                placeholder="Ex: Língua Portuguesa, Matemática, Robótica..."
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Sigla / Código Curto (opcional)
              </label>
              <input
                id="subject-short-input"
                type="text"
                maxLength={6}
                placeholder="Ex: LP, MAT, ART, ROB"
                value={shortName}
                onChange={(e) => setShortName(e.target.value)}
                className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-bold uppercase"
              />
            </div>

            {/* Campo Numérico de Ordem no Boletim */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                  <Hash className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Ordem no Boletim (1, 2, 3...)</span>
                </label>
                <span className="text-[11px] font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-100">
                  Fundamental I
                </span>
              </div>
              <input
                id="subject-order-input"
                type="number"
                min={1}
                max={999}
                placeholder="Ex: 1, 2, 3..."
                value={order}
                onChange={(e) =>
                  setOrder(e.target.value === '' ? '' : parseInt(e.target.value, 10) || '')
                }
                className="w-full px-3.5 py-2 border border-indigo-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-bold text-indigo-900 bg-indigo-50/20"
              />
              <p className="text-[11px] text-slate-400 mt-1 flex items-start gap-1">
                <Info className="w-3 h-3 text-slate-400 shrink-0 mt-0.5" />
                <span>
                  Define a posição exata em que esta matéria será listada no cabeçalho e linhas do Boletim Escolar (PDF e XLSX).
                </span>
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Tipo de Componente Curricular
              </label>
              <select
                id="subject-category-select"
                value={category}
                onChange={(e) => setCategory(e.target.value as 'regente' | 'diversificada')}
                className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
              >
                <option value="regente">Base Nacional Comum / Regente</option>
                <option value="diversificada">Parte Diversificada / Especialista</option>
              </select>
            </div>

            <div className="flex items-center gap-2 pt-2">
              {editingId && (
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  className="flex-1 px-4 py-2 border border-slate-200 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-50 transition cursor-pointer"
                >
                  Cancelar
                </button>
              )}
              <button
                id="btn-save-subject"
                type="submit"
                disabled={saving}
                className="flex-1 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white rounded-xl text-xs font-bold shadow-xs transition cursor-pointer"
              >
                {saving
                  ? 'Salvando...'
                  : editingId
                  ? 'Atualizar Disciplina'
                  : 'Cadastrar Disciplina'}
              </button>
            </div>
          </form>
        </div>

        {/* Lista de Disciplinas */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Disciplinas Disponíveis ({subjects.length})
                </span>
                <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                  Ordenadas para o Boletim
                </span>
              </div>
              <span className="text-xs text-slate-400">
                A sequência abaixo é a que aparece no Boletim Escolar
              </span>
            </div>

            {loading ? (
              <div className="p-8 text-center text-slate-400 text-sm">Carregando disciplinas...</div>
            ) : subjects.length === 0 ? (
              <div className="p-8 text-center text-slate-500">
                <BookOpen className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                <p className="font-semibold text-sm">Nenhuma disciplina cadastrada</p>
                <p className="text-xs text-slate-400 mt-1">
                  Clique em "Restaurar Padrões" ou cadastre uma nova à esquerda.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {subjects.map((sub, idx) => (
                  <div
                    key={sub.id}
                    className="flex items-center justify-between px-6 py-3 hover:bg-slate-50/80 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {/* Badge da Ordem Numérica */}
                      <div
                        className="flex flex-col items-center justify-center min-w-[2.5rem] px-1.5 py-1 rounded-xl bg-indigo-50 border border-indigo-200/80 text-indigo-700 shadow-2xs"
                        title="Ordem de exibição no Boletim Escolar"
                      >
                        <span className="text-[9px] font-bold uppercase tracking-tight text-indigo-500">
                          Ordem
                        </span>
                        <span className="text-sm font-black leading-none">
                          {typeof sub.val.order === 'number' && !isNaN(sub.val.order)
                            ? `${sub.val.order}º`
                            : '-'}
                        </span>
                      </div>

                      {/* Sigla */}
                      <span className="w-10 h-8 flex items-center justify-center rounded-lg bg-slate-100 text-slate-700 text-xs font-bold border border-slate-200">
                        {sub.val.shortName || sub.id.substring(0, 3).toUpperCase()}
                      </span>

                      {/* Nome e Categoria */}
                      <div>
                        <div className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                          <span>{sub.val.name}</span>
                          {sub.val.order === undefined && (
                            <span className="text-[10px] font-medium text-amber-600 bg-amber-50 px-1.5 py-0.2 rounded border border-amber-200">
                              Sem ordem
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-400">
                          {sub.val.category === 'diversificada'
                            ? 'Parte Diversificada / Especialista'
                            : 'Base Comum / Regente'}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {/* Botões rápidos de subir / descer na lista */}
                      <div className="flex items-center bg-slate-100 rounded-lg p-0.5 border border-slate-200">
                        <button
                          type="button"
                          disabled={saving || idx === 0}
                          onClick={() => handleQuickMove(sub, 'up')}
                          className="p-1 text-slate-500 hover:text-indigo-600 hover:bg-white disabled:opacity-30 disabled:hover:bg-transparent rounded transition cursor-pointer"
                          title="Subir posição no Boletim"
                        >
                          <ChevronUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={saving || idx === subjects.length - 1}
                          onClick={() => handleQuickMove(sub, 'down')}
                          className="p-1 text-slate-500 hover:text-indigo-600 hover:bg-white disabled:opacity-30 disabled:hover:bg-transparent rounded transition cursor-pointer"
                          title="Descer posição no Boletim"
                        >
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <button
                        onClick={() => handleEdit(sub)}
                        className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition cursor-pointer"
                        title="Editar nome, sigla e número da ordem"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(sub.id, sub.val.name)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                        title="Excluir disciplina"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
