import React, { useState, useEffect } from 'react';
import { BNCCSkill, ModalConfig } from '../types';
import { get, ref, push, update, remove, rtdb, verificarIsAdmin } from '../lib/firebase';
import { formatFriendlyError } from '../lib/errorHandler';
import { checkBnccDeleteIntegrity } from '../lib/referentialIntegrity';
import {
  BNCC_GROUPS,
  getSkillApplicableYears,
  inferBNCCYearsFromCode,
  formatSkillYearsLabel,
  isSkillApplicableToYear
} from '../lib/bnccHelper';
import { seedBNCCDatabase } from '../lib/bnccSeeder';
import {
  Bookmark,
  Plus,
  Edit2,
  Trash2,
  Download,
  Upload,
  X,
  Filter,
  Layers,
  Sparkles,
  CheckSquare,
  Square,
  Wand2,
  Database,
  RefreshCw,
  Settings,
  ChevronDown
} from 'lucide-react';

interface BNCCScreenProps {
  setModal: (config: ModalConfig) => void;
}

export const BNCCScreen: React.FC<BNCCScreenProps> = ({ setModal }) => {
  const [bnccList, setBnccList] = useState<{ id: string; val: BNCCSkill }[]>([]);
  const [selectedYears, setSelectedYears] = useState<string[]>(['1']);
  const [code, setCode] = useState('');
  const [desc, setDesc] = useState('');
  const [filterYear, setFilterYear] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const [showToolsMenu, setShowToolsMenu] = useState(false);

  const loadBNCC = async () => {
    try {
      setLoading(true);
      const snap = await get(ref(rtdb, 'diario-classe/bncc'));
      const val = snap.val() || {};
      const list: { id: string; val: BNCCSkill }[] = [];
      Object.keys(val).forEach((k) => list.push({ id: k, val: val[k] }));
      list.sort((a, b) => a.val.code.localeCompare(b.val.code));
      setBnccList(list);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBNCC();
    verificarIsAdmin().then((admin) => setIsAdmin(admin));
  }, []);

  // Quando o usuário digita o código (ex: EF15LP01), detecta automaticamente os anos correspondentes se não estiver editando
  const handleCodeChange = (newCode: string) => {
    setCode(newCode);
    const inferred = inferBNCCYearsFromCode(newCode);
    if (inferred.length > 0) {
      setSelectedYears(inferred);
    }
  };

  const toggleYear = (y: string) => {
    setSelectedYears((prev) => {
      if (prev.includes(y)) {
        const next = prev.filter((item) => item !== y);
        return next.length > 0 ? next : prev; // Não permite desmarcar tudo
      } else {
        return [...prev, y].sort();
      }
    });
  };

  const applyPreset = (presetYears: string[]) => {
    setSelectedYears([...presetYears].sort());
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedYears.length === 0 || !code.trim() || !desc.trim()) {
      return setModal({
        isOpen: true,
        type: 'alert',
        title: 'Atenção',
        message: 'Preencha todos os campos do código BNCC (Selecione pelo menos um ano escolar, Código e Descrição)!',
        icon: '⚠️'
      });
    }

    const cleanCode = code.trim().toUpperCase();
    const sortedYears = [...selectedYears].sort();

    // Codificação de compatibilidade para o campo legador 'year'
    let legacyYear = sortedYears.join(',');
    if (sortedYears.length === 5) legacyYear = '15';
    else if (sortedYears.length === 3 && sortedYears.includes('3') && sortedYears.includes('4') && sortedYears.includes('5')) legacyYear = '35';
    else if (sortedYears.length === 2 && sortedYears.includes('1') && sortedYears.includes('2')) legacyYear = '12';
    else if (sortedYears.length === 1) legacyYear = sortedYears[0];

    const data: any = {
      year: legacyYear,
      years: sortedYears,
      code: cleanCode,
      desc: desc.trim()
    };

    try {
      if (editingId) {
        await update(ref(rtdb, `diario-classe/bncc/${editingId}`), data);
        setModal({
          isOpen: true,
          type: 'alert',
          title: 'Sucesso',
          message: 'Código BNCC atualizado!',
          icon: '✅'
        });
      } else {
        data.createdAt = Date.now();
        await push(ref(rtdb, 'diario-classe/bncc'), data);
        setModal({
          isOpen: true,
          type: 'alert',
          title: 'Sucesso',
          message: 'Código BNCC adicionado com sucesso!',
          icon: '✅'
        });
      }

      setCode('');
      setDesc('');
      setSelectedYears(['1']);
      setEditingId(null);
      loadBNCC();
    } catch (err: any) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro ao Salvar BNCC',
        message: formatFriendlyError(err, 'Não foi possível salvar o código BNCC'),
        icon: '❌'
      });
    }
  };

  const handleEdit = (item: { id: string; val: BNCCSkill }) => {
    const applicable = getSkillApplicableYears(item.val);
    setSelectedYears(applicable.length > 0 ? applicable : ['1']);
    setCode(item.val.code);
    setDesc(item.val.desc || item.val.description || '');
    setEditingId(item.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCancelEdit = () => {
    setCode('');
    setDesc('');
    setSelectedYears(['1']);
    setEditingId(null);
  };

  const handleDelete = async (item: { id: string; val: BNCCSkill }) => {
    // 1. Checagem prévia de integridade referencial
    const check = await checkBnccDeleteIntegrity(item.id, item.val.code);
    if (!check.canDelete) {
      return setModal({
        isOpen: true,
        type: 'alert',
        title: 'Exclusão Bloqueada por Integridade',
        message: check.reason || 'Esta habilidade está em uso em planos de aula e não pode ser excluída.',
        icon: '🛡️'
      });
    }

    setModal({
      isOpen: true,
      type: 'confirm',
      title: 'Confirmar Exclusão',
      message: `Tem certeza que deseja excluir a habilidade BNCC "${item.val.code}"?`,
      icon: '⚠️',
      danger: true,
      onConfirm: async () => {
        try {
          await remove(ref(rtdb, `diario-classe/bncc/${item.id}`));
          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Excluído',
            message: 'Código BNCC excluído com sucesso!',
            icon: '✅'
          });
          loadBNCC();
        } catch (err: any) {
          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Erro ao Excluir BNCC',
            message: formatFriendlyError(err, 'Não foi possível excluir a habilidade BNCC'),
            icon: '❌'
          });
        }
      }
    });
  };

  const exportBNCCJSON = async () => {
    try {
      const snap = await get(ref(rtdb, 'diario-classe/bncc'));
      const val = snap.val() || {};
      
      // Exporta com a estrutura completa e enriquecida (incluindo o array plurianual `years`)
      const exportData: Record<string, any> = {};
      Object.keys(val).forEach((k) => {
        const item = val[k];
        if (item && item.code) {
          const applicableYears = getSkillApplicableYears(item);
          exportData[k] = {
            code: item.code.trim().toUpperCase(),
            desc: item.desc || item.description || '',
            year: item.year || (applicableYears.length > 1 ? applicableYears.join(',') : applicableYears[0] || '1'),
            years: applicableYears.length > 0 ? applicableYears : ['1'],
            createdAt: item.createdAt || Date.now()
          };
        }
      });

      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bncc_habilidades_${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error('Erro na exportação:', err);
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro na Exportação',
        message: formatFriendlyError(err, 'Não foi possível exportar as habilidades BNCC'),
        icon: '❌'
      });
    }
  };

  const importBNCCJSON = () => {
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
          const raw = JSON.parse(event.target.result);
          
          // Suporta tanto formato de Objeto Firebase { [key]: { code, desc, years } }
          // quanto formato de Lista/Array [ { code, desc, years } ]
          let itemsList: { code: string; desc: string; year?: string; years?: string[]; id?: string }[] = [];
          if (Array.isArray(raw)) {
            itemsList = raw.filter((it) => it && (it.code || it.codigo));
          } else if (typeof raw === 'object' && raw !== null) {
            Object.keys(raw).forEach((k) => {
              const it = raw[k];
              if (it && typeof it === 'object' && (it.code || it.codigo)) {
                itemsList.push({ ...it, id: k });
              }
            });
          }

          if (itemsList.length === 0) {
            return setModal({
              isOpen: true,
              type: 'alert',
              title: 'Arquivo Vazio ou Incompatível',
              message: 'Nenhum registro de habilidade BNCC válido com o campo "code" foi encontrado no arquivo JSON.',
              icon: '⚠️'
            });
          }

          // Ler dados existentes para evitar duplicações por código normativo
          const currentSnap = await get(ref(rtdb, 'diario-classe/bncc'));
          const currentVal = currentSnap.val() || {};
          const existingByCode: Record<string, { id: string; val: any }> = {};
          Object.keys(currentVal).forEach((k) => {
            const item = currentVal[k];
            if (item && item.code) {
              existingByCode[String(item.code).trim().toUpperCase()] = { id: k, val: item };
            }
          });

          const updates: Record<string, any> = {};
          let insertedCount = 0;
          let updatedCount = 0;

          itemsList.forEach((item) => {
            const rawCode = String(item.code || (item as any).codigo || '').trim().toUpperCase();
            if (!rawCode) return;

            const descText = String(item.desc || (item as any).description || (item as any).descricao || '').trim();
            const applicableYears = getSkillApplicableYears({
              code: rawCode,
              year: item.year || (item as any).ano,
              years: item.years || (item as any).anos
            });
            const validYears = applicableYears.length > 0 ? applicableYears : ['1'];
            const yearRepr = item.year || (validYears.length > 1 ? validYears.join(',') : validYears[0]);

            const existing = existingByCode[rawCode];
            if (existing) {
              // Atualiza preservando a chave id existente (mantém integridade de planos de aula)
              const existingYears = getSkillApplicableYears(existing.val);
              const mergedYears = Array.from(new Set([...existingYears, ...validYears])).sort();
              
              updates[`diario-classe/bncc/${existing.id}/years`] = mergedYears;
              updates[`diario-classe/bncc/${existing.id}/year`] = yearRepr;
              if (descText && (!existing.val.desc || descText.length > existing.val.desc.length)) {
                updates[`diario-classe/bncc/${existing.id}/desc`] = descText;
              }
              updatedCount++;
            } else {
              // Cria nova chave push ou aproveita o id se informado
              const key = item.id || push(ref(rtdb, 'diario-classe/bncc')).key;
              if (key) {
                updates[`diario-classe/bncc/${key}`] = {
                  code: rawCode,
                  desc: descText,
                  year: yearRepr,
                  years: validYears,
                  createdAt: Date.now()
                };
                insertedCount++;
              }
            }
          });

          if (Object.keys(updates).length > 0) {
            await update(ref(rtdb), updates);
          }

          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Importação Concluída',
            message: `Habilidades importadas com sucesso!\n• Inseridas: ${insertedCount}\n• Atualizadas com abrangência: ${updatedCount}\n• Total processado: ${itemsList.length}`,
            icon: '✅'
          });
          loadBNCC();
        } catch (err: any) {
          console.error('Erro na importação:', err);
          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Erro na Importação',
            message: 'O arquivo selecionado não contém um JSON válido ou está corrompido.',
            icon: '❌'
          });
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  // Utilitário para alinhar/migrar habilidades existentes automaticamente pelo código
  const handleAutoAlignExistingSkills = () => {
    if (!isAdmin) return;

    setModal({
      isOpen: true,
      type: 'confirm',
      title: 'Ajustar Habilidades Existentes',
      message:
        'Deseja atualizar automaticamente as habilidades já cadastradas que possuem códigos plurianuais (ex: EF15... para 1º ao 5º ano, EF35... para 3º ao 5º ano e EF12... para 1º e 2º)? Habilidades que já estão corretas não serão alteradas.',
      icon: '✨',
      onConfirm: async () => {
        try {
          setMigrating(true);
          const snap = await get(ref(rtdb, 'diario-classe/bncc'));
          const val = snap.val() || {};
          const updates: Record<string, any> = {};
          let count = 0;

          Object.keys(val).forEach((k) => {
            const skill = val[k];
            if (skill && skill.code) {
              const inferred = inferBNCCYearsFromCode(skill.code);
              if (inferred.length > 1) {
                const currentYears = getSkillApplicableYears(skill);
                // Se a habilidade atual tem menos anos que a abrangência oficial do código
                if (currentYears.length < inferred.length) {
                  let legacyYear = inferred.join(',');
                  if (inferred.length === 5) legacyYear = '15';
                  else if (inferred.length === 3) legacyYear = '35';
                  else if (inferred.length === 2) legacyYear = '12';

                  updates[`diario-classe/bncc/${k}/years`] = inferred;
                  updates[`diario-classe/bncc/${k}/year`] = legacyYear;
                  count++;
                }
              }
            }
          });

          if (count > 0) {
            await update(ref(rtdb), updates);
            setModal({
              isOpen: true,
              type: 'alert',
              title: 'Habilidades Atualizadas',
              message: `${count} habilidade(s) plurianual(is) tiveram sua abrangência de anos ajustada com sucesso!`,
              icon: '✅'
            });
            loadBNCC();
          } else {
            setModal({
              isOpen: true,
              type: 'alert',
              title: 'Tudo em Ordem',
              message: 'Todas as habilidades da base já estão devidamente alinhadas aos seus respectivos blocos!',
              icon: '👍'
            });
          }
        } catch (err: any) {
          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Erro ao Ajustar',
            message: formatFriendlyError(err, 'Falha ao atualizar habilidades'),
            icon: '❌'
          });
        } finally {
          setMigrating(false);
        }
      }
    });
  };

  const handleSeedDatabase = () => {
    if (!isAdmin) {
      return setModal({
        isOpen: true,
        type: 'alert',
        title: 'Acesso Restrito',
        message: '⛔ Apenas Administradores têm permissão para popular dados no banco.',
        icon: '⛔'
      });
    }

    setModal({
      isOpen: true,
      type: 'confirm',
      title: 'Popular Habilidades BNCC na Base',
      message:
        'Deseja carregar o catálogo normativo oficial da BNCC (incluindo as habilidades em bloco EF15, EF12, EF35 e habilidades fundamentais de todas as disciplinas) diretamente no banco de dados Firebase? Habilidades já existentes serão enriquecidas sem apagar nenhum registro.',
      icon: '🌱',
      onConfirm: async () => {
        try {
          setIsSeeding(true);
          const result = await seedBNCCDatabase();
          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Base BNCC Populada!',
            message: `Operação concluída com sucesso no Firebase!\n• Inseridas: ${result.inserted}\n• Atualizadas com blocos: ${result.updated}\n• Já sincronizadas: ${result.unchanged}`,
            icon: '✅'
          });
          loadBNCC();
        } catch (err: any) {
          setModal({
            isOpen: true,
            type: 'alert',
            title: 'Erro ao Popular Base',
            message: formatFriendlyError(err, 'Não foi possível inserir as habilidades na base'),
            icon: '❌'
          });
        } finally {
          setIsSeeding(false);
        }
      }
    });
  };

  const filteredList = bnccList.filter((b) => {
    if (!filterYear) return true;
    return isSkillApplicableToYear(b.val, filterYear);
  });

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6">
      <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Bookmark className="w-6 h-6 text-indigo-600" />
            Códigos & Habilidades BNCC
          </h2>
          <p className="text-xs sm:text-sm text-slate-500">
            Base curricular oficial por ano letivo e blocos plurianuais (1º ao 5º anos)
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap relative">
          <button
            id="export-bncc-btn"
            onClick={exportBNCCJSON}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg border border-emerald-200 transition-colors shadow-2xs"
            title="Exportar catálogo da BNCC em formato JSON"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Exportar JSON</span>
          </button>

          {isAdmin && (
            <>
              <button
                id="import-bncc-btn"
                onClick={importBNCCJSON}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg border border-amber-200 transition-colors shadow-2xs"
                title="Importar habilidades BNCC de um arquivo JSON"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Importar JSON</span>
              </button>

              {/* Menu Recolhido de Manutenção e Ferramentas Administrativas */}
              <div className="relative inline-block text-left">
                <button
                  id="bncc-tools-menu-btn"
                  onClick={() => setShowToolsMenu(!showToolsMenu)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors shadow-2xs ${
                    showToolsMenu
                      ? 'bg-slate-200/90 text-slate-900 border-slate-300'
                      : 'bg-white text-slate-700 hover:bg-slate-50 border-slate-200'
                  }`}
                  title="Ferramentas avançadas e manutenção de catálogo"
                >
                  <Settings className="w-3.5 h-3.5 text-slate-500" />
                  <span>Manutenção</span>
                  <ChevronDown className="w-3 h-3 text-slate-400" />
                </button>

                {showToolsMenu && (
                  <>
                    <div
                      className="fixed inset-0 z-20"
                      onClick={() => setShowToolsMenu(false)}
                    />
                    <div className="absolute right-0 mt-1.5 w-64 rounded-xl bg-white p-1.5 shadow-lg ring-1 ring-black/5 border border-slate-200 z-30 space-y-1">
                      <div className="px-2.5 py-1.5 text-[11px] font-bold tracking-wider text-slate-400 uppercase">
                        Carga & Sincronização
                      </div>

                      <button
                        id="seed-bncc-btn"
                        onClick={() => {
                          setShowToolsMenu(false);
                          handleSeedDatabase();
                        }}
                        disabled={isSeeding}
                        className="w-full flex items-start gap-2.5 px-2.5 py-2 text-left rounded-lg text-xs font-medium text-slate-700 hover:bg-indigo-50 hover:text-indigo-900 disabled:opacity-50 transition-colors"
                      >
                        {isSeeding ? (
                          <RefreshCw className="w-4 h-4 text-indigo-600 animate-spin shrink-0 mt-0.5" />
                        ) : (
                          <Database className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                        )}
                        <div>
                          <div className="font-bold text-slate-800">
                            {isSeeding ? 'Gravando na Base...' : 'Popular Base BNCC'}
                          </div>
                          <p className="text-[11px] text-slate-500 font-normal">
                            Carrega o catálogo normativo oficial e blocos plurianuais
                          </p>
                        </div>
                      </button>

                      <button
                        id="align-bncc-btn"
                        onClick={() => {
                          setShowToolsMenu(false);
                          handleAutoAlignExistingSkills();
                        }}
                        disabled={migrating}
                        className="w-full flex items-start gap-2.5 px-2.5 py-2 text-left rounded-lg text-xs font-medium text-slate-700 hover:bg-indigo-50 hover:text-indigo-900 disabled:opacity-50 transition-colors"
                      >
                        <Wand2 className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                        <div>
                          <div className="font-bold text-slate-800">
                            {migrating ? 'Alinhando...' : 'Alinhar Blocos Plurianuais'}
                          </div>
                          <p className="text-[11px] text-slate-500 font-normal">
                            Readequa o escopo de séries das habilidades já salvas
                          </p>
                        </div>
                      </button>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 sm:p-6 shadow-xs mb-8">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
            <Layers className="w-4 h-4 text-indigo-600" />
            {editingId ? 'Editar Código BNCC' : 'Novo Código BNCC'}
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
          {/* Seletor Inteligente de Anos / Séries */}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <span>Abrangência de Séries / Anos Atendidos *</span>
                <span className="text-[11px] font-normal text-slate-500">
                  (Selecione os anos ou use um atalho oficial da BNCC)
                </span>
              </label>
              <span className="text-[11px] font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-100">
                {selectedYears.length === 5
                  ? 'Plurianual (1º ao 5º Ano)'
                  : selectedYears.map((y) => `${y}º`).join(', ') + ' Ano'}
              </span>
            </div>

            {/* Atalhos Rápidos Normativos BNCC */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] font-medium text-slate-500 flex items-center gap-1 mr-1">
                <Sparkles className="w-3 h-3 text-amber-500" /> Atalhos Oficiais:
              </span>
              {BNCC_GROUPS.map((group) => {
                const isSelected =
                  group.years.length === selectedYears.length &&
                  group.years.every((y) => selectedYears.includes(y));
                return (
                  <button
                    key={group.id}
                    type="button"
                    onClick={() => applyPreset(group.years)}
                    className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-colors ${
                      isSelected
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'bg-white hover:bg-slate-200/80 text-slate-700 border border-slate-200'
                    }`}
                    title={group.description}
                  >
                    {group.shortLabel}
                  </button>
                );
              })}
            </div>

            {/* Checkboxes Individuais de 1º a 5º */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-1 border-t border-slate-200/60">
              {['1', '2', '3', '4', '5'].map((y) => {
                const checked = selectedYears.includes(y);
                return (
                  <button
                    key={y}
                    type="button"
                    onClick={() => toggleYear(y)}
                    className={`flex items-center gap-2 p-2 rounded-lg text-xs font-semibold transition-all text-left ${
                      checked
                        ? 'bg-indigo-50/80 border border-indigo-300 text-indigo-900'
                        : 'bg-white border border-slate-200 hover:bg-slate-100/60 text-slate-600'
                    }`}
                  >
                    {checked ? (
                      <CheckSquare className="w-4 h-4 text-indigo-600 shrink-0" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-300 shrink-0" />
                    )}
                    <span>{y}º Ano</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-1">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Código da Habilidade *
              </label>
              <input
                id="bncc-code-input"
                type="text"
                value={code}
                onChange={(e) => handleCodeChange(e.target.value)}
                placeholder="Ex: EF15LP01, EF35EF01"
                className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl uppercase font-mono font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                required
              />
              <p className="text-[10px] text-slate-400 mt-1">
                Dica: ao digitar códigos como EF15..., o app detecta os anos automaticamente.
              </p>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Descrição da Habilidade / Competência *
              </label>
              <textarea
                id="bncc-desc-input"
                rows={2}
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                placeholder="Ex: Identificar e reproduzir, em cantigas, quadras, quadrinhas, parlendas..."
                className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 resize-y"
                required
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              id="bncc-save-btn"
              type="submit"
              className="inline-flex items-center gap-1.5 px-5 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-xs transition-colors"
            >
              <Plus className="w-4 h-4" />
              {editingId ? 'Atualizar BNCC' : 'Adicionar Código BNCC'}
            </button>
          </div>
        </form>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 sm:p-6 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <h3 className="text-base font-bold text-slate-800">
            Códigos Cadastrados ({filteredList.length})
          </h3>
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400" />
            <select
              id="filter-bncc-year"
              value={filterYear}
              onChange={(e) => setFilterYear(e.target.value)}
              className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            >
              <option value="">Todas as Séries / Blocos</option>
              <option value="1">Atende 1º Ano</option>
              <option value="2">Atende 2º Ano</option>
              <option value="3">Atende 3º Ano</option>
              <option value="4">Atende 4º Ano</option>
              <option value="5">Atende 5º Ano</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="py-8 text-center text-sm text-slate-400">Carregando códigos BNCC...</div>
        ) : filteredList.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-400">
            Nenhum código BNCC cadastrado para o filtro selecionado.
          </div>
        ) : (
          <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
            {filteredList.map((item) => {
              const yearsLabel = formatSkillYearsLabel(item.val);
              const isPluriannual = getSkillApplicableYears(item.val).length > 1;

              return (
                <div
                  key={item.id}
                  className="flex items-start justify-between p-4 rounded-xl border border-slate-100 bg-slate-50/60 hover:bg-slate-50 transition-colors gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-extrabold text-sm text-indigo-700 font-mono">
                        {item.val.code}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                          isPluriannual
                            ? 'bg-purple-100 text-purple-800 border border-purple-200'
                            : 'bg-slate-200 text-slate-700'
                        }`}
                      >
                        {yearsLabel}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                      {item.val.desc || item.val.description}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      id={`bncc-edit-${item.id}`}
                      onClick={() => handleEdit(item)}
                      className="p-1.5 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                      title="Editar"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      id={`bncc-delete-${item.id}`}
                      onClick={() => handleDelete(item)}
                      className="p-1.5 text-slate-600 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                      title="Excluir"
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
