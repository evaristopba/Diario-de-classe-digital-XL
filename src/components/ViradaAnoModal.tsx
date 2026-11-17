import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowRight,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileJson,
  RefreshCw,
  Upload,
  X,
  AlertTriangle,
  Sparkles
} from 'lucide-react';
import { ClassRoom, ModalConfig, School } from '../types';
import { getCurrentAuthUid, push, ref, rtdb, update } from '../lib/firebase';
import { SinoConfig } from '../lib/sino';
import { formatFriendlyError } from '../lib/errorHandler';
import {
  PreviaViradaAno,
  construirPacoteVirada,
  exportarViradaExcel,
  exportarViradaJSON,
  gerarPreviaImportacaoVirada,
  montarUpdatesVirada,
  normalizarSerieNumero,
  parseArquivoVirada
} from '../lib/viradaAno';

interface ViradaAnoModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentYear: string;
  allClassesAllYears: { id: string; val: ClassRoom }[];
  schools: School[];
  sinoConfig?: SinoConfig;
  setModal: (config: ModalConfig) => void;
  onCompleted: () => void;
}

export const ViradaAnoModal: React.FC<ViradaAnoModalProps> = ({
  isOpen,
  onClose,
  currentYear,
  allClassesAllYears,
  schools,
  sinoConfig,
  setModal,
  onCompleted
}) => {
  const [activeTab, setActiveTab] = useState<'export' | 'import'>('export');

  // Anos existentes nas turmas + corrente/anterior/próximo (sem hardcode)
  const anosDisponiveis = useMemo(() => {
    const set = new Set<string>();
    const curNum = Number(currentYear) || new Date().getFullYear();
    set.add(String(curNum - 1));
    set.add(String(curNum));
    set.add(String(curNum + 1));
    allClassesAllYears.forEach((c) => {
      const y = String(c.val.anoLetivo || '').trim();
      if (/^\d{4}$/.test(y)) set.add(y);
    });
    return Array.from(set).sort((a, b) => Number(b) - Number(a));
  }, [allClassesAllYears, currentYear]);

  const defaultOrigem = useMemo(() => {
    const curNum = Number(currentYear) || new Date().getFullYear();
    const prev = String(curNum - 1);
    const hasPrev = allClassesAllYears.some(
      (c) => String(c.val.anoLetivo || '').trim() === prev
    );
    return hasPrev ? prev : String(curNum);
  }, [allClassesAllYears, currentYear]);

  const [anoOrigem, setAnoOrigem] = useState<string>(defaultOrigem);
  const [anoDestino, setAnoDestino] = useState<string>(() => {
    const origNum = Number(defaultOrigem) || new Date().getFullYear();
    const curNum = Number(currentYear) || origNum;
    return origNum < curNum ? String(curNum) : String(origNum + 1);
  });
  const [schoolIdFiltro, setSchoolIdFiltro] = useState<string>('');
  const [seriesOrigem, setSeriesOrigem] = useState<string[]>(['1', '2', '3', '4']);
  const [incluirConcluintes5Ano, setIncluirConcluintes5Ano] = useState<boolean>(false);
  const [apenasAlunosAtivos, setApenasAlunosAtivos] = useState<boolean>(true);

  const [importAnoDestino, setImportAnoDestino] = useState<string>(currentYear);
  const [importFileName, setImportFileName] = useState<string>('');
  const [previa, setPrevia] = useState<PreviaViradaAno | null>(null);
  const [applying, setApplying] = useState<boolean>(false);

  useEffect(() => {
    if (!isOpen) return;
    setAnoOrigem(defaultOrigem);
    const origNum = Number(defaultOrigem) || new Date().getFullYear();
    const curNum = Number(currentYear) || origNum;
    setAnoDestino(origNum < curNum ? String(curNum) : String(origNum + 1));
    setImportAnoDestino(currentYear);
    setPrevia(null);
    setImportFileName('');
  }, [isOpen, defaultOrigem, currentYear]);

  useEffect(() => {
    if (!isOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !applying) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [isOpen, applying, onClose]);

  const pacotePreview = useMemo(() => {
    return construirPacoteVirada(allClassesAllYears, schools, {
      anoOrigem,
      anoDestino,
      schoolIdFiltro,
      seriesOrigem: incluirConcluintes5Ano
        ? Array.from(new Set([...seriesOrigem, '5']))
        : seriesOrigem,
      incluirConcluintes5Ano,
      apenasAlunosAtivos,
      ordenarAlfabeticamente: true
    });
  }, [
    allClassesAllYears,
    schools,
    anoOrigem,
    anoDestino,
    schoolIdFiltro,
    seriesOrigem,
    incluirConcluintes5Ano,
    apenasAlunosAtivos
  ]);

  const totalAlunosPacote = useMemo(
    () => pacotePreview.turmas.reduce((acc, t) => acc + t.alunos.length, 0),
    [pacotePreview]
  );

  const contagemPorSerieOrigem = useMemo(() => {
    const counts: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
    allClassesAllYears.forEach(({ val }) => {
      const cAno = String(val.anoLetivo || '').trim();
      if (cAno && cAno !== String(anoOrigem).trim()) return;
      if (schoolIdFiltro && val.schoolId !== schoolIdFiltro) return;
      const s = normalizarSerieNumero(val.year);
      if (counts[s] !== undefined) counts[s]++;
    });
    return counts;
  }, [allClassesAllYears, anoOrigem, schoolIdFiltro]);

  if (!isOpen) return null;

  const toggleSerie = (serie: string) => {
    setSeriesOrigem((prev) =>
      prev.includes(serie) ? prev.filter((x) => x !== serie) : [...prev, serie]
    );
  };

  const handleExportExcel = () => {
    if (pacotePreview.turmas.length === 0) {
      return setModal({
        isOpen: true,
        type: 'alert',
        title: 'Nenhuma Turma Selecionada',
        message: `Não foram encontradas turmas no ano ${anoOrigem} para as séries selecionadas.`,
        icon: '⚠️'
      });
    }
    const file = exportarViradaExcel(pacotePreview);
    setModal({
      isOpen: true,
      type: 'alert',
      title: 'Planilha da Virada Exportada',
      message: `Arquivo "${file}" gerado com ${pacotePreview.turmas.length} turma(s) e ${totalAlunosPacote} aluno(s) já promovidos para ${anoDestino}.\n\nEdite no Excel/Sheets (remova quem saiu, ajuste letras/turnos ou inclua novatos) e importe de volta na aba "Importar Planilha / JSON".`,
      icon: '📊'
    });
  };

  const handleExportJSON = () => {
    if (pacotePreview.turmas.length === 0) {
      return setModal({
        isOpen: true,
        type: 'alert',
        title: 'Nenhuma Turma Selecionada',
        message: `Não foram encontradas turmas no ano ${anoOrigem} para as séries selecionadas.`,
        icon: '⚠️'
      });
    }
    const file = exportarViradaJSON(pacotePreview);
    setModal({
      isOpen: true,
      type: 'alert',
      title: 'JSON da Virada Exportado',
      message: `Arquivo "${file}" exportado com ${pacotePreview.turmas.length} turma(s) e ${totalAlunosPacote} aluno(s) limpos (sem IDs antigos, notas ou grade horária).`,
      icon: '✅'
    });
  };

  const handlePromocaoDireta = () => {
    if (pacotePreview.turmas.length === 0) {
      return setModal({
        isOpen: true,
        type: 'alert',
        title: 'Nenhuma Turma Selecionada',
        message: `Não foram encontradas turmas no ano ${anoOrigem} para as séries selecionadas.`,
        icon: '⚠️'
      });
    }
    const prev = gerarPreviaImportacaoVirada(
      pacotePreview,
      schools,
      allClassesAllYears,
      sinoConfig,
      anoDestino
    );
    setImportAnoDestino(anoDestino);
    setImportFileName(`Promoção direta ${anoOrigem} → ${anoDestino}`);
    setPrevia(prev);
    setActiveTab('import');
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    try {
      const targetYear = /^\d{4}$/.test(importAnoDestino.trim())
        ? importAnoDestino.trim()
        : currentYear;
      const pkg = await parseArquivoVirada(file, targetYear);
      const effectiveDest =
        /^\d{4}$/.test(pkg.anoDestino) && pkg.anoDestino !== targetYear && file.name.toLowerCase().endsWith('.json')
          ? pkg.anoDestino
          : targetYear;
      const prev = gerarPreviaImportacaoVirada(
        pkg,
        schools,
        allClassesAllYears,
        sinoConfig,
        effectiveDest
      );
      setImportAnoDestino(prev.anoDestino);
      setImportFileName(file.name);
      setPrevia(prev);
    } catch (err: any) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro ao Ler Arquivo',
        message: err?.message || 'Não foi possível interpretar o arquivo selecionado.',
        icon: '❌'
      });
    }
  };

  const handleConfirmImport = async () => {
    if (!previa) return;
    if (previa.turmasNovas === 0 && previa.alunosNovos === 0) {
      return setModal({
        isOpen: true,
        type: 'alert',
        title: 'Nada Novo para Gravar',
        message: 'Todas as turmas e alunos do arquivo já existem no ano de destino.',
        icon: 'ℹ️'
      });
    }

    const uid = getCurrentAuthUid();
    if (!uid) return;

    setApplying(true);
    try {
      const updates = montarUpdatesVirada(previa, uid, (path) => {
        const p = push(ref(rtdb, path));
        if (!p.key) throw new Error('Falha ao gerar chave no banco de dados.');
        return p.key;
      });
      await update(ref(rtdb), updates);

      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Virada Aplicada com Sucesso!',
        message:
          `Ano Letivo ${previa.anoDestino} atualizado:\n` +
          `• ${previa.turmasNovas} turma(s) nova(s) criada(s)\n` +
          `• ${previa.turmasReaproveitadas} turma(s) existente(s) reaproveitada(s)\n` +
          `• ${previa.alunosNovos} aluno(s) matriculado(s)\n` +
          (previa.alunosDuplicados > 0
            ? `• ${previa.alunosDuplicados} duplicado(s) ignorado(s)\n`
            : '') +
          `\nLembrete: para visualizar/gerenciar essas turmas, certifique-se de estar logado no Ano Letivo ${previa.anoDestino}.`,
        icon: '🎉'
      });
      setPrevia(null);
      onCompleted();
      onClose();
    } catch (err: any) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro ao Gravar Virada',
        message: formatFriendlyError(err, 'Não foi possível gravar as turmas e alunos.'),
        icon: '❌'
      });
    } finally {
      setApplying(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/60 backdrop-blur-xs overflow-hidden overscroll-contain">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Cabeçalho Fixo */}
        <div className="shrink-0 p-4 sm:p-5 bg-gradient-to-r from-indigo-600 to-violet-600 text-white flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-white/20 text-indigo-100">
                Virada de Ano Letivo
              </span>
              <span className="text-xs font-semibold text-indigo-100">
                Logado em {currentYear}
              </span>
            </div>
            <h3 className="font-black text-lg sm:text-xl tracking-tight mt-1 flex items-center gap-2">
              <RefreshCw className="w-5 h-5" />
              <span>Promover Turmas • Excel (.xlsx) & JSON</span>
            </h3>
            <p className="text-xs text-indigo-100 mt-0.5">
              Exporte as séries que continuam na escola (1º→2º ... 4º→5º), edite no Excel se precisar e reimporte sem recadastrar tudo.
            </p>
          </div>
          <button
            type="button"
            onClick={() => !applying && onClose()}
            className="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-xl transition cursor-pointer shrink-0"
            title="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Abas Fixas */}
        <div className="shrink-0 px-4 pt-3 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('export')}
            className={`px-4 py-2 text-xs font-bold rounded-t-xl border-b-2 transition cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'export'
                ? 'border-indigo-600 text-indigo-700 bg-white'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <Download className="w-3.5 h-3.5" />
            <span>1. Exportar / Promover</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('import')}
            className={`px-4 py-2 text-xs font-bold rounded-t-xl border-b-2 transition cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'import'
                ? 'border-indigo-600 text-indigo-700 bg-white'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            <span>2. Importar Planilha / JSON</span>
            {previa && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-emerald-100 text-emerald-800">
                Prévia
              </span>
            )}
          </button>
        </div>

        {/* Corpo Rolável */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-5 space-y-4">
          {activeTab === 'export' ? (
            <>
              {/* Parâmetros Ano Origem / Destino / Escola */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Ano de Origem (Turmas Atuais)
                  </label>
                  <select
                    value={anoOrigem}
                    onChange={(e) => {
                      const v = e.target.value;
                      setAnoOrigem(v);
                      const n = Number(v);
                      if (Number.isFinite(n)) setAnoDestino(String(n + 1));
                    }}
                    className="w-full px-3 py-2 text-sm font-semibold bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  >
                    {anosDisponiveis.map((yr) => (
                      <option key={yr} value={yr}>
                        {yr}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Ano Letivo Destino
                  </label>
                  <input
                    type="number"
                    min="2020"
                    value={anoDestino}
                    onChange={(e) => setAnoDestino(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-bold text-indigo-700 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Filtrar Escola
                  </label>
                  <select
                    value={schoolIdFiltro}
                    onChange={(e) => setSchoolIdFiltro(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  >
                    <option value="">Todas as Escolas</option>
                    {schools.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Seleção de Séries que Promovem */}
              <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <span className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                    Séries que permanecem e avançam de ano
                  </span>
                  <span className="text-[11px] text-slate-500">
                    5º Ano (concluintes) fica desmarcado por padrão
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {(['1', '2', '3', '4'] as const).map((s) => {
                    const checked = seriesOrigem.includes(s);
                    const prox = Number(s) + 1;
                    return (
                      <label
                        key={s}
                        className={`flex items-center justify-between gap-2 p-2.5 rounded-xl border text-xs cursor-pointer transition ${
                          checked
                            ? 'bg-indigo-50 border-indigo-300 text-indigo-900 font-bold'
                            : 'bg-slate-50 border-slate-200 text-slate-500'
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleSerie(s)}
                            className="rounded text-indigo-600 focus:ring-indigo-500"
                          />
                          <span>
                            {s}º <ArrowRight className="w-3 h-3 inline mx-0.5" /> {prox}º
                          </span>
                        </div>
                        <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-white border border-slate-200 text-slate-600">
                          {contagemPorSerieOrigem[s] || 0}
                        </span>
                      </label>
                    );
                  })}

                  <label
                    className={`flex items-center justify-between gap-2 p-2.5 rounded-xl border text-xs cursor-pointer transition ${
                      incluirConcluintes5Ano
                        ? 'bg-amber-50 border-amber-300 text-amber-900 font-bold'
                        : 'bg-slate-50 border-slate-200 text-slate-500'
                    }`}
                    title="Opcional: mantém turmas de 5º Ano (ex.: para repetir estrutura)"
                  >
                    <div className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={incluirConcluintes5Ano}
                        onChange={(e) => setIncluirConcluintes5Ano(e.target.checked)}
                        className="rounded text-amber-600 focus:ring-amber-500"
                      />
                      <span>5º (manter)</span>
                    </div>
                    <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-white border border-slate-200 text-slate-600">
                      {contagemPorSerieOrigem['5'] || 0}
                    </span>
                  </label>
                </div>

                <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={apenasAlunosAtivos}
                    onChange={(e) => setApenasAlunosAtivos(e.target.checked)}
                    className="rounded text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>
                    Incluir somente <strong>alunos ativos</strong> (ignorar alunos com Transferência Expedida)
                  </span>
                </label>
              </div>

              {/* Resumo do Pacote */}
              <div className="p-4 rounded-xl bg-indigo-50/70 border border-indigo-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <span className="text-xs font-extrabold text-indigo-950 block">
                    Resumo preparado para {anoOrigem} → {anoDestino}
                  </span>
                  <span className="text-xs text-indigo-800">
                    <strong>{pacotePreview.turmas.length}</strong> turma(s) promovida(s) •{' '}
                    <strong>{totalAlunosPacote}</strong> aluno(s) • sem notas, faltas ou grade horária antiga.
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={handleExportExcel}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-xs transition cursor-pointer"
                  >
                    <FileSpreadsheet className="w-4 h-4" />
                    <span>Exportar Excel (.xlsx)</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleExportJSON}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold rounded-xl shadow-xs transition cursor-pointer"
                  >
                    <FileJson className="w-4 h-4" />
                    <span>Exportar JSON</span>
                  </button>
                  <button
                    type="button"
                    onClick={handlePromocaoDireta}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-xs transition cursor-pointer"
                  >
                    <Sparkles className="w-4 h-4" />
                    <span>Promover Direto</span>
                  </button>
                </div>
              </div>

              {/* Pré-visualização das Turmas Selecionadas */}
              {pacotePreview.turmas.length > 0 && (
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <div className="px-3.5 py-2 bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-600 uppercase">
                    Turmas incluídas ({pacotePreview.turmas.length})
                  </div>
                  <div className="divide-y divide-slate-100 max-h-56 overflow-y-auto">
                    {pacotePreview.turmas.map((t, i) => (
                      <div
                        key={i}
                        className="px-3.5 py-2 text-xs flex items-center justify-between gap-2 hover:bg-slate-50"
                      >
                        <div className="min-w-0">
                          <span className="font-bold text-slate-800">
                            {t.year}º Ano {t.letter} — {t.shift}
                          </span>
                          <span className="text-slate-500 ml-2 text-[11px]">
                            ({t.schoolName})
                          </span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {t.serieOrigem && t.serieOrigem !== t.year && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-semibold">
                              de {t.serieOrigem}º Ano
                            </span>
                          )}
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
                            {t.alunos.length} aluno{t.alunos.length === 1 ? '' : 's'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              {/* Seleção de Arquivo e Ano Destino */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200 items-end">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Ano Letivo Destino (Importação)
                  </label>
                  <input
                    type="number"
                    min="2020"
                    value={importAnoDestino}
                    onChange={(e) => {
                      setImportAnoDestino(e.target.value);
                      setPrevia(null);
                    }}
                    className="w-full px-3 py-2 text-sm font-bold text-indigo-700 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Arquivo editado (.xlsx, .xls, .csv) ou JSON de Virada
                  </label>
                  <label className="flex items-center justify-center gap-2 w-full px-4 py-2 bg-white hover:bg-indigo-50 border-2 border-dashed border-indigo-300 rounded-xl text-xs font-bold text-indigo-700 cursor-pointer transition">
                    <Upload className="w-4 h-4" />
                    <span>
                      {importFileName ? `Selecionado: ${importFileName}` : 'Escolher Planilha (.xlsx) ou JSON'}
                    </span>
                    <input
                      type="file"
                      accept=".xlsx,.xls,.csv,.json"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>

              {!previa ? (
                <div className="p-6 text-center text-xs text-slate-500 bg-slate-50/50 rounded-xl border border-slate-200">
                  Selecione uma planilha <strong>.xlsx</strong> (exportada e ajustada no Excel/Sheets) ou um <strong>.json</strong> de virada para visualizar a prévia antes de gravar no banco de dados.
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Cards da Prévia */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                    <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200">
                      <span className="text-[10px] font-bold uppercase text-emerald-700 block">
                        Turmas Novas
                      </span>
                      <span className="text-lg font-black text-emerald-900">{previa.turmasNovas}</span>
                    </div>
                    <div className="p-3 rounded-xl bg-sky-50 border border-sky-200">
                      <span className="text-[10px] font-bold uppercase text-sky-700 block">
                        Turmas Existentes
                      </span>
                      <span className="text-lg font-black text-sky-900">{previa.turmasReaproveitadas}</span>
                    </div>
                    <div className="p-3 rounded-xl bg-indigo-50 border border-indigo-200">
                      <span className="text-[10px] font-bold uppercase text-indigo-700 block">
                        Alunos a Matricular
                      </span>
                      <span className="text-lg font-black text-indigo-900">{previa.alunosNovos}</span>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                      <span className="text-[10px] font-bold uppercase text-slate-500 block">
                        Duplicados Ignorados
                      </span>
                      <span className="text-lg font-black text-slate-700">{previa.alunosDuplicados}</span>
                    </div>
                  </div>

                  {previa.avisos.length > 0 && (
                    <div className="p-3 rounded-xl bg-amber-50 border border-amber-300 text-xs text-amber-900 space-y-1">
                      <div className="font-bold flex items-center gap-1.5">
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                        <span>Atenção ({previa.avisos.length} aviso(s)):</span>
                      </div>
                      <ul className="list-disc pl-5 space-y-0.5 text-[11px]">
                        {previa.avisos.map((av, idx) => (
                          <li key={idx}>{av}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {previa.itens.length > 0 && (
                    <div className="border border-slate-200 rounded-xl overflow-hidden">
                      <div className="px-3.5 py-2 bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-600 uppercase">
                        Detalhamento da Importação ({previa.anoDestino})
                      </div>
                      <div className="divide-y divide-slate-100 max-h-60 overflow-y-auto">
                        {previa.itens.map((it, idx) => (
                          <div
                            key={idx}
                            className="px-3.5 py-2 text-xs flex items-center justify-between gap-2 flex-wrap"
                          >
                            <div>
                              <span
                                className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full mr-2 ${
                                  it.acao === 'criar'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : 'bg-sky-100 text-sky-800'
                                }`}
                              >
                                {it.acao === 'criar' ? 'Nova Turma' : 'Reaproveitar'}
                              </span>
                              <span className="font-bold text-slate-800">
                                {it.year}º Ano {it.letter} — {it.shift}
                              </span>
                              <span className="text-slate-500 text-[11px] ml-1.5">
                                ({it.schoolName})
                              </span>
                            </div>
                            <div className="text-[11px] font-semibold text-slate-700">
                              +{it.alunosNovos.length} aluno(s)
                              {it.alunosDuplicados.length > 0 && (
                                <span className="text-slate-400 ml-1">
                                  ({it.alunosDuplicados.length} dup.)
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Rodapé Fixo */}
        <div className="shrink-0 p-3.5 sm:p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3 flex-wrap">
          <span className="text-[11px] text-slate-500">
            Histórico de anos anteriores, notas e chamadas não são apagados nem sobrescritos.
          </span>
          <div className="flex items-center gap-2">
            {activeTab === 'import' && previa && (previa.turmasNovas > 0 || previa.alunosNovos > 0) && (
              <button
                type="button"
                disabled={applying}
                onClick={handleConfirmImport}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-xs transition cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>
                  {applying
                    ? 'Gravando...'
                    : `Confirmar e Gravar em ${previa.anoDestino}`}
                </span>
              </button>
            )}
            <button
              type="button"
              disabled={applying}
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-xl transition cursor-pointer"
            >
              Fechar
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
