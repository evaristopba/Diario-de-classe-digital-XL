import React, { useState, useEffect } from 'react';
import { School, ModalConfig } from '../types';
import { get, ref, push, update, remove, rtdb, verificarIsAdmin } from '../lib/firebase';
import { formatFriendlyError } from '../lib/errorHandler';
import { checkSchoolDeleteIntegrity } from '../lib/referentialIntegrity';
import { Building2, Plus, Edit2, Trash2, Download, Upload, X } from 'lucide-react';

interface SchoolsScreenProps {
  setModal: (config: ModalConfig) => void;
}

export const SchoolsScreen: React.FC<SchoolsScreenProps> = ({ setModal }) => {
  const [schools, setSchools] = useState<School[]>([]);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const loadSchools = async () => {
    try {
      setLoading(true);
      const snap = await get(ref(rtdb, 'diario-classe/escolas'));
      const list: School[] = [];
      const val = snap.val() || {};
      Object.keys(val).forEach((k) => {
        list.push({ id: k, ...val[k] });
      });
      list.sort((a, b) => a.name.localeCompare(b.name));
      setSchools(list);
    } catch (err: any) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro ao Carregar Escolas',
        message: formatFriendlyError(err, 'Não foi possível carregar a lista de escolas'),
        icon: '❌'
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSchools();
    verificarIsAdmin().then((admin) => setIsAdmin(admin));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      return setModal({
        isOpen: true,
        type: 'alert',
        title: 'Atenção',
        message: 'Preencha o nome da escola!',
        icon: '⚠️'
      });
    }

    try {
      if (editingId) {
        await update(ref(rtdb, `diario-classe/escolas/${editingId}`), {
          name: name.trim(),
          address: address.trim()
        });
        setModal({
          isOpen: true,
          type: 'alert',
          title: 'Sucesso',
          message: 'Escola atualizada com sucesso!',
          icon: '✅'
        });
      } else {
        await push(ref(rtdb, 'diario-classe/escolas'), {
          name: name.trim(),
          address: address.trim(),
          createdAt: Date.now()
        });
        setModal({
          isOpen: true,
          type: 'alert',
          title: 'Sucesso',
          message: 'Escola cadastrada com sucesso!',
          icon: '✅'
        });
      }
      setName('');
      setAddress('');
      setEditingId(null);
      loadSchools();
    } catch (err: any) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro ao Salvar Escola',
        message: formatFriendlyError(err, 'Não foi possível salvar a escola'),
        icon: '❌'
      });
    }
  };

  const handleEdit = (school: School) => {
    setName(school.name);
    setAddress(school.address || '');
    setEditingId(school.id || null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCancelEdit = () => {
    setName('');
    setAddress('');
    setEditingId(null);
  };

  const handleDeleteSafely = async (id?: string) => {
    if (!id) return;
    setModal({
      isOpen: true,
      type: 'confirm',
      title: 'Confirmar Exclusão',
      message: 'Tem certeza que deseja excluir esta escola?',
      icon: '⚠️',
      danger: true,
      onConfirm: async () => {
        try {
          const integrity = await checkSchoolDeleteIntegrity(id);
          if (!integrity.canDelete) {
            return setModal({
              isOpen: true,
              type: 'alert',
              title: 'Exclusão Bloqueada',
              message: `⛔ ${integrity.reason}`,
              icon: '⛔'
            });
          }
          await remove(ref(rtdb, `diario-classe/escolas/${id}`));
          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Excluído',
            message: 'Escola excluída com sucesso!',
            icon: '✅'
          });
          loadSchools();
        } catch (err: any) {
          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Erro ao Excluir Escola',
            message: formatFriendlyError(err, 'Não foi possível excluir a escola'),
            icon: '❌'
          });
        }
      }
    });
  };

  const exportSchoolsJSON = async () => {
    try {
      const snap = await get(ref(rtdb, 'diario-classe/escolas'));
      const data = snap.val();
      if (!data) {
        return setModal({
          isOpen: true,
          type: 'alert',
          title: 'Aviso',
          message: 'Nenhuma escola encontrada para exportar!',
          icon: 'ℹ️'
        });
      }
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `escolas_${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro na Exportação',
        message: formatFriendlyError(err, 'Não foi possível exportar as escolas'),
        icon: '❌'
      });
    }
  };

  const importSchoolsJSON = () => {
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
            updates[`diario-classe/escolas/${key}`] = data[key];
          });
          await update(ref(rtdb), updates);
          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Sucesso',
            message: 'Escolas importadas com sucesso!',
            icon: '✅'
          });
          loadSchools();
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
            <Building2 className="w-6 h-6 text-indigo-600" />
            Escolas
          </h2>
          <p className="text-xs sm:text-sm text-slate-500">
            Cadastre as unidades escolares para vinculação com turmas e alunos
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            id="export-schools-btn"
            onClick={exportSchoolsJSON}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg border border-emerald-200 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Exportar JSON</span>
          </button>
          {isAdmin && (
            <button
              id="import-schools-btn"
              onClick={importSchoolsJSON}
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
            {editingId ? 'Editar Escola' : 'Nova Escola'}
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Nome da Escola *
              </label>
              <input
                id="school-name-input"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: EMEF Professor João da Silva"
                className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Endereço / Localização
              </label>
              <input
                id="school-address-input"
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Ex: Rua das Flores, 123 - Centro"
                className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              id="school-save-btn"
              type="submit"
              className="inline-flex items-center gap-1.5 px-5 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-xs transition-colors"
            >
              <Plus className="w-4 h-4" />
              {editingId ? 'Atualizar Escola' : 'Adicionar Escola'}
            </button>
          </div>
        </form>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 sm:p-6 shadow-xs">
        <h3 className="text-base font-bold text-slate-800 mb-4">
          Escolas Cadastradas ({schools.length})
        </h3>

        {loading ? (
          <div className="py-8 text-center text-sm text-slate-400">Carregando escolas...</div>
        ) : schools.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-400">
            Nenhuma escola cadastrada no momento. Adicione a primeira acima!
          </div>
        ) : (
          <div className="space-y-3">
            {schools.map((school) => (
              <div
                key={school.id}
                className="flex items-center justify-between p-4 rounded-xl border border-slate-100 bg-slate-50/60 hover:bg-slate-50 transition-colors flex-wrap gap-3"
              >
                <div className="min-w-0 flex-1">
                  <h4 className="text-sm font-bold text-slate-800 truncate">{school.name}</h4>
                  <p className="text-xs text-slate-500 mt-0.5">{school.address || 'Sem endereço informado'}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    id={`school-edit-${school.id}`}
                    onClick={() => handleEdit(school)}
                    className="p-1.5 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                    title="Editar"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    id={`school-delete-${school.id}`}
                    onClick={() => handleDeleteSafely(school.id)}
                    className="p-1.5 text-slate-600 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
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
  );
};
