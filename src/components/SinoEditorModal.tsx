import React, { useMemo, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { ref, rtdb, set } from '../lib/firebase';
import { formatFriendlyError } from '../lib/errorHandler';
import {
  AvisoSino,
  FaixaHora,
  PerfilSino,
  SINO_PADRAO,
  SinoConfig,
  SinoGrupoCfg,
  modeloDoisIntervalos,
  modeloPosRecreio1020,
  perfisDoTurno,
  sinoGrupoParaGravar,
  sugerirNomeCurto,
  validarSinoGrupo
} from '../lib/sino';

interface Props {
  schools: Record<string, { name: string }>;
  config: SinoConfig | undefined;
  escolaInicial?: string;
  onSalvo: (novaConfig: SinoConfig, fecharModal?: boolean) => void;
  onFechar: () => void;
}

type Periodo = 'matutino' | 'vespertino';
const REDE = '__rede__';

const SERIES_OPCOES: { id: string; label: string }[] = [
  { id: 'infantil', label: 'Infantil' },
  { id: '1', label: '1º Ano' },
  { id: '2', label: '2º Ano' },
  { id: '3', label: '3º Ano' },
  { id: '4', label: '4º Ano' },
  { id: '5', label: '5º Ano' }
];

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

interface RascunhoTurnos {
  matutino: PerfilSino[];
  vespertino: PerfilSino[];
}

function carregarRascunhoEscopo(config: SinoConfig | undefined, esc: string): RascunhoTurnos {
  const cfgBase: SinoConfig | undefined = esc === REDE ? { padrao: config?.padrao } : config;
  const sid = esc === REDE ? undefined : esc;
  return {
    matutino: clone(perfisDoTurno(cfgBase, sid, 'manha')),
    vespertino: clone(perfisDoTurno(cfgBase, sid, 'tarde'))
  };
}

function perfisDeMapa(mapa: Record<string, SinoGrupoCfg>): PerfilSino[] {
  return Object.entries(mapa).map(([id, cfg], idx) => ({
    id,
    nome: cfg.nome || `Perfil ${id}`,
    curto: cfg.curto || sugerirNomeCurto(cfg.nome || id),
    ordem: cfg.ordem ?? idx + 1,
    anosSugeridos: Array.isArray(cfg.anosSugeridos) ? [...cfg.anosSugeridos] : [],
    cfg: clone(cfg)
  }));
}

/** Editor flexível do sino (perfis livres de aulas e intervalos por escola e turno). Só administradores abrem. */
const SinoEditorModal: React.FC<Props> = ({ schools, config, escolaInicial, onSalvo, onFechar }) => {
  const [escopo, setEscopo] = useState<string>(escolaInicial && schools[escolaInicial] ? escolaInicial : REDE);
  const [periodo, setPeriodo] = useState<Periodo>('matutino');
  const [rascunho, setRascunho] = useState<RascunhoTurnos>(() => carregarRascunhoEscopo(config, escopo));
  const [perfilAtivoId, setPerfilAtivoId] = useState<string>(() => rascunho.matutino[0]?.id || 'G23');
  const [salvando, setSalvando] = useState(false);
  const [erroGravacao, setErroGravacao] = useState<string | null>(null);

  const listaPerfis = rascunho[periodo];
  const perfilAtivo = listaPerfis.find((p) => p.id === perfilAtivoId) || listaPerfis[0];

  const trocarEscopo = (novo: string) => {
    const novoRascunho = carregarRascunhoEscopo(config, novo);
    setEscopo(novo);
    setRascunho(novoRascunho);
    setPerfilAtivoId(novoRascunho[periodo][0]?.id || '');
    setErroGravacao(null);
  };

  const trocarPeriodo = (novoP: Periodo) => {
    setPeriodo(novoP);
    setPerfilAtivoId(rascunho[novoP][0]?.id || '');
    setErroGravacao(null);
  };

  const personalizado =
    escopo === REDE ? Boolean(config?.padrao?.[periodo]) : Boolean(config?.escolas?.[escopo]?.[periodo]);

  const atualizarPerfil = (id: string, fn: (p: PerfilSino) => PerfilSino) => {
    setRascunho((prev) => ({
      ...prev,
      [periodo]: prev[periodo].map((p) => (p.id === id ? fn(clone(p)) : p))
    }));
  };

  const adicionarPerfil = () => {
    const baseCfg = perfilAtivo ? clone(perfilAtivo.cfg) : clone(periodo === 'matutino' ? SINO_PADRAO.matutino.G23 : SINO_PADRAO.vespertino);
    const novoId = `P_${Date.now().toString(36).slice(-5)}`;
    const novoNumero = listaPerfis.length + 1;
    const novoNome = `Novo Horário ${novoNumero}`;
    const novoPerfil: PerfilSino = {
      id: novoId,
      nome: novoNome,
      curto: sugerirNomeCurto(novoNome),
      ordem: novoNumero,
      anosSugeridos: [],
      cfg: {
        ...baseCfg,
        nome: novoNome,
        curto: sugerirNomeCurto(novoNome),
        ordem: novoNumero
      }
    };
    delete novoPerfil.cfg.anosSugeridos;
    setRascunho((prev) => ({
      ...prev,
      [periodo]: [...prev[periodo], novoPerfil]
    }));
    setPerfilAtivoId(novoId);
    setErroGravacao(null);
  };

  const removerPerfil = (id: string) => {
    if (listaPerfis.length <= 1) return;
    const restantes = listaPerfis.filter((p) => p.id !== id);
    setRascunho((prev) => ({
      ...prev,
      [periodo]: restantes
    }));
    if (perfilAtivo?.id === id) {
      setPerfilAtivoId(restantes[0]?.id || '');
    }
    setErroGravacao(null);
  };

  const toggleSerieSugerida = (serieId: string) => {
    if (!perfilAtivo) return;
    setRascunho((prev) => ({
      ...prev,
      [periodo]: prev[periodo].map((p) => {
        if (p.id === perfilAtivo.id) {
          const jaTem = p.anosSugeridos.includes(serieId);
          const novas = jaTem ? p.anosSugeridos.filter((s) => s !== serieId) : [...p.anosSugeridos, serieId];
          return { ...p, anosSugeridos: novas };
        }
        // Garante que cada série fique sugerida em no máximo 1 perfil do mesmo turno
        return { ...p, anosSugeridos: p.anosSugeridos.filter((s) => s !== serieId) };
      })
    }));
  };

  const validacoes = useMemo(
    () =>
      listaPerfis.map((p) => ({
        id: p.id,
        nome: p.nome,
        avisos: validarSinoGrupo({ ...p.cfg, nome: p.nome })
      })),
    [listaPerfis]
  );

  const avisosAtuais: AvisoSino[] = validacoes.find((v) => v.id === perfilAtivo?.id)?.avisos || [];
  const totalErros = validacoes.reduce((acc, v) => acc + v.avisos.filter((a) => a.nivel === 'erro').length, 0);

  const setFaixa = (campo: 'intervalo' | 'complementar' | 'refeicaoFinal', parte: keyof FaixaHora, valor: string) => {
    if (!perfilAtivo) return;
    atualizarPerfil(perfilAtivo.id, (p) => ({
      ...p,
      cfg: {
        ...p.cfg,
        [campo]: { ...(p.cfg[campo] || { inicio: '', fim: '' }), [parte]: valor }
      }
    }));
  };

  const setAula = (ordem: string, parte: keyof FaixaHora, valor: string) => {
    if (!perfilAtivo) return;
    atualizarPerfil(perfilAtivo.id, (p) => ({
      ...p,
      cfg: {
        ...p.cfg,
        aulas: { ...p.cfg.aulas, [ordem]: { ...p.cfg.aulas[ordem], [parte]: valor } }
      }
    }));
  };

  const alternarOpcional = (campo: 'complementar' | 'refeicaoFinal', ligado: boolean) => {
    if (!perfilAtivo) return;
    atualizarPerfil(perfilAtivo.id, (p) => {
      const novoCfg = { ...p.cfg };
      if (ligado) novoCfg[campo] = { inicio: '', fim: '' };
      else delete novoCfg[campo];
      return { ...p, cfg: novoCfg };
    });
  };

  const caminhoDoEscopo = (p: Periodo) =>
    escopo === REDE ? `diario-classe/config/sino/padrao/${p}` : `diario-classe/config/sino/escolas/${escopo}/${p}`;

  const salvar = async () => {
    if (totalErros > 0) {
      setErroGravacao('Corrija os erros em vermelho antes de salvar.');
      return;
    }
    if (listaPerfis.length === 0) {
      setErroGravacao('Mantenha pelo menos um perfil de horário neste turno.');
      return;
    }
    setSalvando(true);
    setErroGravacao(null);
    try {
      const serializarPerfil = (p: PerfilSino, idx: number): SinoGrupoCfg => {
        const cfgComMeta: SinoGrupoCfg = {
          ...p.cfg,
          nome: p.nome.trim() || `Perfil ${p.id}`,
          curto: (p.curto || '').trim() || sugerirNomeCurto(p.nome),
          ordem: idx + 1,
          anosSugeridos: p.anosSugeridos.length > 0 ? p.anosSugeridos : undefined
        };
        return sinoGrupoParaGravar(cfgComMeta);
      };

      let valor: any;
      if (periodo === 'vespertino' && listaPerfis.length === 1 && listaPerfis[0].id === 'T') {
        valor = serializarPerfil(listaPerfis[0], 0);
      } else {
        const mapa: Record<string, SinoGrupoCfg> = {};
        listaPerfis.forEach((p, idx) => {
          mapa[p.id] = serializarPerfil(p, idx);
        });
        valor = mapa;
      }

      await set(ref(rtdb, caminhoDoEscopo(periodo)), valor);

      const nova: SinoConfig = clone(config || {});
      if (escopo === REDE) {
        nova.padrao = { ...(nova.padrao || {}), [periodo]: valor };
      } else {
        nova.escolas = { ...(nova.escolas || {}) };
        nova.escolas[escopo] = { ...(nova.escolas[escopo] || {}), [periodo]: valor };
      }
      onSalvo(nova, true);
    } catch (err: any) {
      setErroGravacao(formatFriendlyError(err, 'Não foi possível salvar o horário do sino.'));
    } finally {
      setSalvando(false);
    }
  };

  const removerPersonalizacao = async (escopoAlvo: string = escopo, manterModal = true) => {
    if (escopoAlvo === REDE && escopo !== REDE) return;
    setSalvando(true);
    setErroGravacao(null);
    try {
      const caminhoAlvo =
        escopoAlvo === REDE
          ? `diario-classe/config/sino/padrao/${periodo}`
          : `diario-classe/config/sino/escolas/${escopoAlvo}/${periodo}`;
      await set(ref(rtdb, caminhoAlvo), null);
      const nova: SinoConfig = clone(config || {});
      if (escopoAlvo === REDE) {
        if (nova.padrao) delete (nova.padrao as any)[periodo];
      } else if (nova.escolas?.[escopoAlvo]) {
        delete (nova.escolas[escopoAlvo] as any)[periodo];
        if (Object.keys(nova.escolas[escopoAlvo] || {}).length === 0) {
          delete nova.escolas[escopoAlvo];
        }
      }
      onSalvo(nova, !manterModal);
      if (escopoAlvo === escopo) {
        const recarregado = carregarRascunhoEscopo(nova, escopo);
        setRascunho(recarregado);
        setPerfilAtivoId(recarregado[periodo][0]?.id || '');
      }
    } catch (err: any) {
      setErroGravacao(formatFriendlyError(err, 'Não foi possível remover a personalização.'));
    } finally {
      setSalvando(false);
    }
  };

  const removerOverridesDasEscolas = async (schoolIds: string[]) => {
    if (schoolIds.length === 0) return;
    setSalvando(true);
    setErroGravacao(null);
    try {
      await Promise.all(
        schoolIds.map((sid) => set(ref(rtdb, `diario-classe/config/sino/escolas/${sid}/${periodo}`), null))
      );
      const nova: SinoConfig = clone(config || {});
      schoolIds.forEach((sid) => {
        if (nova.escolas?.[sid]) {
          delete (nova.escolas[sid] as any)[periodo];
          if (Object.keys(nova.escolas[sid] || {}).length === 0) {
            delete nova.escolas[sid];
          }
        }
      });
      onSalvo(nova, false);
    } catch (err: any) {
      setErroGravacao(formatFriendlyError(err, 'Não foi possível aplicar o padrão da rede às escolas.'));
    } finally {
      setSalvando(false);
    }
  };

  const aplicarModeloMatutino = (mapa: Record<string, SinoGrupoCfg>) => {
    const novos = perfisDeMapa(mapa);
    setRascunho((prev) => ({ ...prev, matutino: novos }));
    setPerfilAtivoId(novos[0]?.id || '');
    setErroGravacao(null);
  };

  const Campo = ({ valor, onChange }: { valor: string; onChange: (v: string) => void }) => (
    <input
      type="time"
      value={valor || ''}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500"
    />
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden">
        <div className="p-4 bg-gradient-to-r from-indigo-600 to-indigo-700 text-white flex items-center justify-between shrink-0">
          <div>
            <h3 className="font-bold text-base">⏰ Horário do Sino (perfis de aulas e intervalos)</h3>
            <p className="text-xs text-indigo-100">Crie quantos intervalos a escola precisar (1, 2, 3...). O que não for personalizado segue o padrão da rede.</p>
          </div>
          <button type="button" onClick={onFechar} className="p-1 rounded-lg text-indigo-100 hover:text-white hover:bg-white/10 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Escola:</label>
              <select
                value={escopo}
                onChange={(e) => trocarEscopo(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm bg-white outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value={REDE}>Padrão da rede (todas as escolas sem horário próprio)</option>
                {Object.keys(schools).map((id) => {
                  const temNoPeriodo = Boolean(config?.escolas?.[id]?.[periodo]);
                  const temOutro = Boolean(config?.escolas?.[id]?.[periodo === 'matutino' ? 'vespertino' : 'matutino']);
                  const sufixo = temNoPeriodo
                    ? ' ★ (horário próprio neste turno)'
                    : temOutro
                    ? ' • (horário próprio em outro turno)'
                    : '';
                  return (
                    <option key={id} value={id}>
                      {schools[id].name}
                      {sufixo}
                    </option>
                  );
                })}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Turno:</label>
              <div className="flex gap-1.5">
                {(['matutino', 'vespertino'] as Periodo[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => trocarPeriodo(p)}
                    className={`flex-1 px-3 py-2 rounded-xl text-xs font-bold border cursor-pointer transition ${
                      periodo === p ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    {p === 'matutino' ? 'Matutino' : 'Vespertino'} ({rascunho[p].length})
                  </button>
                ))}
              </div>
            </div>
          </div>

          <p className={`text-[11px] font-semibold px-3 py-1.5 rounded-lg border ${personalizado ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>
            {personalizado
              ? escopo === REDE
                ? '✅ O padrão da rede está personalizado neste turno.'
                : '✅ Esta escola tem horário próprio neste turno (não segue o padrão da rede).'
              : escopo === REDE
              ? 'ℹ️ Usando o padrão embutido do sistema. Salve para definir o padrão da rede.'
              : 'ℹ️ Esta escola segue o padrão da rede. Salve para criar um horário próprio.'}
          </p>

          {escopo === REDE && (() => {
            const escolasComProprio = Object.keys(schools).filter((id) => Boolean(config?.escolas?.[id]?.[periodo]));
            if (escolasComProprio.length === 0) return null;
            return (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-[11px] font-bold text-amber-900">
                    ⚠️ {escolasComProprio.length} escola(s) têm horário próprio no {periodo === 'matutino' ? 'Matutino' : 'Vespertino'} e não seguem o padrão da rede:
                  </p>
                  {escolasComProprio.length > 1 && (
                    <button
                      type="button"
                      disabled={salvando}
                      onClick={() => removerOverridesDasEscolas(escolasComProprio)}
                      className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-amber-600 hover:bg-amber-700 text-white cursor-pointer transition disabled:opacity-50"
                    >
                      Aplicar padrão da rede em todas
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {escolasComProprio.map((sid) => (
                    <div
                      key={sid}
                      className="inline-flex items-center gap-1.5 bg-white border border-amber-300 rounded-lg px-2 py-1 text-[11px] text-amber-950"
                    >
                      <span className="font-semibold">{schools[sid].name}</span>
                      <button
                        type="button"
                        onClick={() => trocarEscopo(sid)}
                        className="px-1.5 py-0.5 rounded bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-[10px] cursor-pointer"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        disabled={salvando}
                        onClick={() => removerPersonalizacao(sid, true)}
                        className="px-1.5 py-0.5 rounded bg-amber-100 hover:bg-amber-200 text-amber-900 font-bold text-[10px] cursor-pointer disabled:opacity-50"
                        title="Remove o horário próprio desta escola para que ela passe a seguir o Padrão da rede"
                      >
                        Usar padrão da rede
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Lista livre de perfis / faixas de intervalo do turno */}
          <div>
            <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
              <label className="block text-xs font-bold text-slate-700">
                Perfis de horário / intervalo neste turno ({listaPerfis.length}):
              </label>
              <button
                type="button"
                onClick={adicionarPerfil}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 cursor-pointer transition"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Novo perfil / intervalo</span>
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {listaPerfis.map((p) => {
                const erros = validacoes.find((v) => v.id === p.id)?.avisos.some((a) => a.nivel === 'erro');
                const ativo = perfilAtivo?.id === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPerfilAtivoId(p.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border cursor-pointer transition flex items-center gap-1.5 ${
                      ativo ? 'bg-amber-500 text-white border-amber-500 shadow-2xs' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <span>{p.nome}</span>
                    <span className={`text-[10px] font-semibold ${ativo ? 'text-amber-50' : 'text-slate-400'}`}>
                      ({p.cfg.intervalo.inicio || '--:--'})
                    </span>
                    {erros ? '⛔' : ''}
                  </button>
                );
              })}
            </div>
          </div>

          {perfilAtivo && (
            <div className="bg-slate-50/80 border border-slate-200 rounded-xl p-3.5 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
                <div className="sm:col-span-6">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">Nome do perfil (ex.: 1º ao 3º Ano)</label>
                  <input
                    type="text"
                    value={perfilAtivo.nome}
                    onChange={(e) => {
                      const nome = e.target.value;
                      atualizarPerfil(perfilAtivo.id, (p) => ({
                        ...p,
                        nome,
                        curto: p.curto === sugerirNomeCurto(p.nome) || !p.curto ? sugerirNomeCurto(nome) : p.curto
                      }));
                    }}
                    placeholder="Ex.: 1º, 2º e 3º Anos"
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div className="sm:col-span-4">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">Rótulo curto (badges/tabelas)</label>
                  <input
                    type="text"
                    value={perfilAtivo.curto}
                    maxLength={14}
                    onChange={(e) => {
                      const curto = e.target.value;
                      atualizarPerfil(perfilAtivo.id, (p) => ({ ...p, curto }));
                    }}
                    placeholder="Ex.: 1º–3º"
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div className="sm:col-span-2 flex justify-end">
                  {listaPerfis.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removerPerfil(perfilAtivo.id)}
                      className="w-full sm:w-auto inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 cursor-pointer"
                      title="Excluir este perfil de horário"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Excluir</span>
                    </button>
                  )}
                </div>
              </div>

              <div>
                <span className="block text-[11px] font-bold text-slate-700 mb-1">
                  Séries vinculadas automaticamente (quando a turma não escolher manualmente):
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {SERIES_OPCOES.map((s) => {
                    const marcado = perfilAtivo.anosSugeridos.includes(s.id);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => toggleSerieSugerida(s.id)}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-bold border cursor-pointer transition ${
                          marcado
                            ? 'bg-indigo-600 text-white border-indigo-600'
                            : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100'
                        }`}
                      >
                        {marcado ? '✓ ' : ''}
                        {s.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-500 uppercase text-[10px]">
                    <tr>
                      <th className="text-left px-3 py-2 w-1/3">Item</th>
                      <th className="text-left px-3 py-2">Início</th>
                      <th className="text-left px-3 py-2">Fim</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {['1', '2', '3', '4', '5'].map((o) => (
                      <tr key={o}>
                        <td className="px-3 py-1.5 font-bold text-slate-700">{o}ª aula</td>
                        <td className="px-3 py-1.5"><Campo valor={perfilAtivo.cfg.aulas[o]?.inicio} onChange={(v) => setAula(o, 'inicio', v)} /></td>
                        <td className="px-3 py-1.5"><Campo valor={perfilAtivo.cfg.aulas[o]?.fim} onChange={(v) => setAula(o, 'fim', v)} /></td>
                      </tr>
                    ))}
                    <tr className="bg-amber-50/60">
                      <td className="px-3 py-1.5 font-bold text-amber-900">Intervalo / recreio</td>
                      <td className="px-3 py-1.5"><Campo valor={perfilAtivo.cfg.intervalo.inicio} onChange={(v) => setFaixa('intervalo', 'inicio', v)} /></td>
                      <td className="px-3 py-1.5"><Campo valor={perfilAtivo.cfg.intervalo.fim} onChange={(v) => setFaixa('intervalo', 'fim', v)} /></td>
                    </tr>
                    {(['complementar', 'refeicaoFinal'] as const).map((campo) => (
                      <tr key={campo} className="bg-sky-50/40">
                        <td className="px-3 py-1.5">
                          <label className="flex items-center gap-1.5 font-bold text-sky-900 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={Boolean(perfilAtivo.cfg[campo])}
                              onChange={(e) => alternarOpcional(campo, e.target.checked)}
                              className="rounded text-sky-600"
                            />
                            {campo === 'complementar' ? 'Leitura / lanche' : 'Refeição e saída'}
                          </label>
                        </td>
                        {perfilAtivo.cfg[campo] ? (
                          <>
                            <td className="px-3 py-1.5"><Campo valor={perfilAtivo.cfg[campo]!.inicio} onChange={(v) => setFaixa(campo, 'inicio', v)} /></td>
                            <td className="px-3 py-1.5"><Campo valor={perfilAtivo.cfg[campo]!.fim} onChange={(v) => setFaixa(campo, 'fim', v)} /></td>
                          </>
                        ) : (
                          <td colSpan={2} className="px-3 py-1.5 text-slate-400">não se aplica</td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {avisosAtuais.length > 0 && (
            <div className="space-y-1.5">
              {avisosAtuais.map((a, i) => (
                <p
                  key={i}
                  className={`text-[11px] font-semibold p-2 rounded-lg border ${
                    a.nivel === 'erro' ? 'bg-rose-50 text-rose-800 border-rose-200' : 'bg-amber-50 text-amber-800 border-amber-200'
                  }`}
                >
                  {a.nivel === 'erro' ? '⛔' : '⚠️'} {a.mensagem}
                </p>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {periodo === 'matutino' && (
              <>
                <button
                  type="button"
                  onClick={() => aplicarModeloMatutino(modeloDoisIntervalos())}
                  className="px-3 py-1.5 text-[11px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg cursor-pointer"
                  title="1º/2º/3º Anos: 09:30–09:50 • 4º/5º Anos: 09:55–10:15"
                >
                  Modelo: 2 intervalos (1º–3º 09:30 / 4º–5º 09:55)
                </button>
                <button
                  type="button"
                  onClick={() => aplicarModeloMatutino(modeloPosRecreio1020())}
                  className="px-3 py-1.5 text-[11px] font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg cursor-pointer"
                  title="Recreio único 10:00–10:20; 4ª aula 10:20–11:10; 5ª aula 11:10–12:00"
                >
                  Modelo: recreio único 10:00 (ex.: Capitão)
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => {
                if (periodo === 'matutino') {
                  aplicarModeloMatutino(SINO_PADRAO.matutino);
                } else {
                  const vesp = perfisDeMapa({ T: SINO_PADRAO.vespertino });
                  setRascunho((prev) => ({ ...prev, vespertino: vesp }));
                  setPerfilAtivoId(vesp[0]?.id || 'T');
                }
              }}
              className="px-3 py-1.5 text-[11px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg cursor-pointer"
            >
              Voltar ao padrão do sistema
            </button>
            {personalizado && (
              <button
                type="button"
                onClick={() => removerPersonalizacao()}
                disabled={salvando}
                className="px-3 py-1.5 text-[11px] font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg cursor-pointer"
              >
                {escopo === REDE ? 'Remover personalização do padrão da rede' : 'Remover horário próprio desta escola'}
              </button>
            )}
          </div>

          {erroGravacao && <p className="text-[11px] font-semibold p-2 rounded-lg border bg-rose-50 text-rose-800 border-rose-200">⛔ {erroGravacao}</p>}
        </div>

        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2 shrink-0">
          <button type="button" onClick={onFechar} className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200 rounded-xl cursor-pointer">
            Fechar
          </button>
          <button
            type="button"
            onClick={salvar}
            disabled={salvando}
            className="px-5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-xl shadow-xs cursor-pointer"
          >
            {salvando ? 'Gravando...' : 'Salvar horário'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SinoEditorModal;
