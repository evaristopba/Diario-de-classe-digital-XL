import React, { useState, useEffect } from 'react';
import { EventType, ModalConfig } from '../types';
import { get, ref, push, update, remove, rtdb } from '../lib/firebase';
import { formatFriendlyError } from '../lib/errorHandler';
import { AlertTriangle, Plus, Edit2, Trash2, Download, Upload, X } from 'lucide-react';

interface EventTypesScreenProps {
  setModal: (config: ModalConfig) => void;
}

export const EventTypesScreen: React.FC<EventTypesScreenProps> = ({ setModal }) => {
  const [types, setTypes] = useState<{ id: string; val: EventType }[]>([]);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#e74c3c');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadTypes = async () => {
    try {
      setLoading(true);
      const snap = await get(ref(rtdb, 'diario-classe/tipos-evento'));
      const val = snap.val() || {};
      const list: { id: string; val: EventType }[] = [];
      Object.keys(val).forEach((k) => list.push({ id: k, val: val[k] }));
      list.sort((a, b) => a.val.name.localeCompare(b.val.name));
      setTypes(list);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTypes();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      return setModal({
        isOpen: true,
        type: 'alert',
        title: 'Atenção',
        message: 'Preencha o nome do tipo de evento!',
        icon: '⚠️'
      });
    }

    const data: any = {
      name: name.trim(),
      color: color || '#e74c3c'
    };

    try {
      if (editingId) {
        await update(ref(rtdb, `diario-classe/tipos-evento/${editingId}`), data);
        setModal({
          isOpen: true,
          type: 'alert',
          title: 'Sucesso',
          message: 'Tipo de evento atualizado com sucesso!',
          icon: '✅'
        });
      } else {
        data.createdAt = Date.now();
        await push(ref(rtdb, 'diario-classe/tipos-evento'), data);
        setModal({
          isOpen: true,
          type: 'alert',
          title: 'Sucesso',
          message: 'Tipo de evento cadastrado com sucesso!',
          icon: '✅'
        });
      }

      setName('');
      setColor('#e74c3c');
      setEditingId(null);
      loadTypes();
    } catch (err: any) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro ao Salvar Tipo de Evento',
        message: formatFriendlyError(err, 'Não foi possível salvar o tipo de evento'),
        icon: '❌'
      });
    }
  };

  const handleEdit = (item: { id: string; val: EventType }) => {
    setName(item.val.name);
    setColor(item.val.color || '#e74c3c');
    setEditingId(item.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCancelEdit = () => {
    setName('');
    setColor('#e74c3c');
    setEditingId(null);
  };

  const handleDelete = (id: string) => {
    setModal({
      isOpen: true,
      type: 'confirm',
      title: 'Confirmar Exclusão',
      message: 'Tem certeza que deseja excluir este tipo de evento?',
      icon: '⚠️',
      danger: true,
      onConfirm: async () => {
        try {
          await remove(ref(rtdb, `diario-classe/tipos-evento/${id}`));
          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Excluído',
            message: 'Tipo de evento excluído com sucesso!',
            icon: '✅'
          });
          loadTypes();
        } catch (err: any) {
          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Erro ao Excluir Tipo de Evento',
            message: formatFriendlyError(err, 'Não foi possível excluir o tipo de evento'),
            icon: '❌'
          });
        }
      }
    });
  };

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6">
      <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-800 flex items-center gap-2">
            <AlertTriangle className="w-6 h-6 text-indigo-600" />
            Tipos de Evento / Ocorrência
          </h2>
          <p className="text-xs sm:text-sm text-slate-500">
            Cadastre categorias de ocorrências (comportamental, elogio, acadêmico, indisciplina)
          </p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 sm:p-6 shadow-xs mb-8">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-slate-800">
            {editingId ? 'Editar Tipo de Evento' : 'Novo Tipo de Evento'}
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
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Nome do Tipo *
              </label>
              <input
                id="event-type-name-input"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Comportamental, Elogio, Acadêmico, Disciplinar"
                className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Cor da Etiqueta
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="event-type-color-input"
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="w-10 h-10 p-0.5 rounded-lg border border-slate-200 cursor-pointer"
                />
                <input
                  type="text"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="flex-1 px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none uppercase font-mono"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              id="event-type-save-btn"
              type="submit"
              className="inline-flex items-center gap-1.5 px-5 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-xs transition-colors"
            >
              <Plus className="w-4 h-4" />
              {editingId ? 'Atualizar Tipo' : 'Adicionar Tipo'}
            </button>
          </div>
        </form>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 sm:p-6 shadow-xs">
        <h3 className="text-base font-bold text-slate-800 mb-4">
          Tipos Cadastrados ({types.length})
        </h3>

        {loading ? (
          <div className="py-8 text-center text-sm text-slate-400">Carregando tipos...</div>
        ) : types.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-400">
            Nenhum tipo de evento cadastrado no momento.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {types.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between p-3.5 rounded-xl border border-slate-100 bg-slate-50/60 hover:bg-slate-50 transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className="w-4 h-4 rounded-full border border-black/10 shrink-0"
                    style={{ backgroundColor: item.val.color || '#e74c3c' }}
                  ></span>
                  <span className="text-sm font-bold text-slate-800">{item.val.name}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    id={`event-type-edit-${item.id}`}
                    onClick={() => handleEdit(item)}
                    className="p-1.5 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                    title="Editar"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    id={`event-type-delete-${item.id}`}
                    onClick={() => handleDelete(item.id)}
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
