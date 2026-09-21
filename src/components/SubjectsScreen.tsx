import React, { useState, useEffect } from 'react';
import { SubjectItem, DEFAULT_SUBJECTS, ModalConfig } from '../types';
import { get, ref, set, push, update, remove, rtdb, verificarIsAdmin } from '../lib/firebase';
import { formatFriendlyError } from '../lib/errorHandler';
import { checkSubjectDeleteIntegrity } from '../lib/referentialIntegrity';
import { BookOpen, Plus, Edit2, Trash2, Download, Upload, RefreshCw, Layers } from 'lucide-react';

interface SubjectsScreenProps {
  setModal: (config: ModalConfig) => void;
}

export const SubjectsScreen: React.FC<SubjectsScreenProps> = ({ setModal }) => {
  const [subjects, setSubjects] = useState<{ id: string; val: SubjectItem }[]>([]);
  const [name, setName] = useState('');
  const [shortName, setShortName] = useState('');
  const [category, setCategory] = useState<'regente' | 'diversificada'>('regente');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const loadSubjects = async () => {
    try {
      setLoading(true);
      const snap = await get(ref(rtdb, 'diario-classe/disciplinas'));
      if (snap.exists()) {
        const val = snap.val() || {};
        const list: { id: string; val: SubjectItem }[] = [];
        Object.keys(val).forEach((k) => list.push({ id: k, val: val[k] }));
        list.sort((a, b) => (a.val.name || '').localeCompare(b.val.name || ''));
        setSubjects(list);
      } else {
        // Se ainda não houver disciplinas no banco, carrega as padrões para visualização
        const defaultList = DEFAULT_SUBJECTS.map((s) => ({ id: s.id, val: s }));
        setSubjects(defaultList);
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
      title: 'Restaurar Matérias Padrão',
      message: 'Deseja cadastrar no banco todas as disciplinas padrão da BNCC (Língua Portuguesa, Matemática, História, etc.)?',
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
            message: 'Disciplinas padrão gravadas no banco de dados!',
            icon: '✅'
          });
          loadSubjects();
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
    const data: SubjectItem = {
      id: editingId || name.trim().toLowerCase().replace(/[^a-z0-9]/g, '_'),
      name: name.trim(),
      shortName: shortCode,
      category
    };

    try {
      setSaving(true);
      if (editingId) {
        await update(ref(rtdb, `diario-classe/disciplinas/${editingId}`), data);
        setModal({
          isOpen: true,
          type: 'alert',
          title: 'Sucesso',
          message: 'Disciplina atualizada com sucesso!',
          icon: '✅'
        });
      } else {
        const idKey = name.trim().toLowerCase().replace(/[^a-z0-9]/g, '_');
        await set(ref(rtdb, `diario-classe/disciplinas/${idKey}`), data);
        setModal({
          isOpen: true,
          type: 'alert',
          title: 'Sucesso',
          message: 'Nova disciplina cadastrada com sucesso!',
          icon: '✅'
        });
      }

      setName('');
      setShortName('');
      setCategory('regente');
      setEditingId(null);
      loadSubjects();
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
            <div className="p-2.5 bg-indigo-100 text-indigo-700 rounded-xl">
              <BookOpen className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-800">Disciplinas & Matérias</h1>
              <p className="text-sm text-slate-500">
                Gerencie as matérias curriculares, crie novas disciplinas personalizadas ou edite a grade
              </p>
            </div>
          </div>
        </div>

        {isAdmin && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleInitializeDefaults}
              disabled={saving}
              className="inline-flex items-center gap-2 px-3.5 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-semibold rounded-xl border border-indigo-200 transition cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Restaurar Matérias Padrão</span>
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Form */}
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
                placeholder="Ex: Robótica, Espanhol, Filosofia..."
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
                placeholder="Ex: ROB, ESP, FIL"
                value={shortName}
                onChange={(e) => setShortName(e.target.value)}
                className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-bold uppercase"
              />
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
                  onClick={() => {
                    setEditingId(null);
                    setName('');
                    setShortName('');
                  }}
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
                {saving ? 'Salvando...' : editingId ? 'Atualizar Disciplina' : 'Cadastrar Disciplina'}
              </button>
            </div>
          </form>
        </div>

        {/* Lista de Disciplinas */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Disciplinas Disponíveis ({subjects.length})
              </span>
              <span className="text-xs text-slate-400">
                Utilizadas no lançamento de Notas, Médias e Boletins
              </span>
            </div>

            {loading ? (
              <div className="p-8 text-center text-slate-400 text-sm">Carregando disciplinas...</div>
            ) : subjects.length === 0 ? (
              <div className="p-8 text-center text-slate-500">
                <BookOpen className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                <p className="font-semibold text-sm">Nenhuma disciplina cadastrada</p>
                <p className="text-xs text-slate-400 mt-1">
                  Clique em "Restaurar Matérias Padrão" ou cadastre uma nova à esquerda.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {subjects.map((sub) => (
                  <div
                    key={sub.id}
                    className="flex items-center justify-between px-6 py-3.5 hover:bg-slate-50/80 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-10 h-8 flex items-center justify-center rounded-lg bg-indigo-50 text-indigo-700 text-xs font-bold border border-indigo-100">
                        {sub.val.shortName || sub.id.substring(0, 3).toUpperCase()}
                      </span>
                      <div>
                        <div className="text-sm font-bold text-slate-800">{sub.val.name}</div>
                        <div className="text-xs text-slate-400">
                          {sub.val.category === 'diversificada'
                            ? 'Parte Diversificada / Especialista'
                            : 'Base Comum / Regente'}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleEdit(sub)}
                        className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition cursor-pointer"
                        title="Editar"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(sub.id, sub.val.name)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                        title="Excluir"
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
