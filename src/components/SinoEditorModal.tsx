import React, { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { ref, rtdb, set } from '../lib/firebase';
import { formatFriendlyError } from '../lib/errorHandler';
import {
  AvisoSino,
  FaixaHora,
  GRUPOS_SINO,
  GrupoSinoId,
  SINO_PADRAO,
  SinoConfig,
  SinoEfetivo,
  SinoGrupoCfg,
  modeloPosRecreio1020,
  sinoEfetivo,
  sinoGrupoParaGravar,
  validarSinoGrupo
} from '../lib/sino';

interface Props {
  schools: Record<string, { name: string }>;
  config: SinoConfig | undefined;
  escolaInicial?: string;
  onSalvo: (novaConfig: SinoConfig) => void;
  onFechar: () => void;
}

type Periodo = 'matutino' | 'vespertino';
const REDE = '__rede__';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

/** Editor do sino (aulas e intervalos) por escola. Só administradores abrem (a regra do banco também exige). */
const SinoEditorModal: React.FC<Props> = ({ schools, config, escolaInicial, onSalvo, onFechar }) => {
  const [escopo, setEscopo] = useState<string>(escolaInicial && schools[escolaInicial] ? escolaInicial : REDE);
  const [periodo, setPeriodo] = useState<Periodo>('matutino');
  const [grupoAtivo, setGrupoAtivo] = useState<GrupoSinoId>('G23');
  const [salvando, setSalvando] = useState(false);
  const [erroGravacao, setErroGravacao] = useState<string | null>(null);

  const efetivoDoEscopo = (esc: string): SinoEfetivo =>
    esc === REDE ? sinoEfetivo({ padrao: config?.padrao }, undefined) : sinoEfetivo(config, esc);

  const [rascunho, setRascunho] = useState<SinoEfetivo>(() => clone(efetivoDoEscopo(escopo)));

  const trocarEscopo = (novo: string) => {
    setEscopo(novo);
    setRascunho(clone(efetivoDoEscopo(novo)));
    setErroGravacao(null);
  };

  const personalizado =
    escopo === REDE ? Boolean(config?.padrao?.[periodo]) : Boolean(config?.escolas?.[escopo]?.[periodo]);

  const grupoCfg: SinoGrupoCfg = periodo === 'matutino' ? rascunho.matutino[grupoAtivo] : rascunho.vespertino;

  const atualizarGrupo = (fn: (g: SinoGrupoCfg) => SinoGrupoCfg) => {
    setRascunho((prev) =>
      periodo === 'matutino'
        ? { ...prev, matutino: { ...prev.matutino, [grupoAtivo]: fn(clone(prev.matutino[grupoAtivo])) } }
        : { ...prev, vespertino: fn(clone(prev.vespertino)) }
    );
  };

  const alvos: { id: GrupoSinoId | 'T'; nome: string; cfg: SinoGrupoCfg }[] =
    periodo === 'matutino'
      ? GRUPOS_SINO.map((g) => ({ id: g.id, nome: g.nome, cfg: rascunho.matutino[g.id] }))
      : [{ id: 'T', nome: 'Vespertino', cfg: rascunho.vespertino }];

  const validacoes = useMemo(() => alvos.map((a) => ({ ...a, avisos: validarSinoGrupo(a.cfg) })), [rascunho, periodo]);
  const avisosAtuais: AvisoSino[] = validacoes.find((v) => v.id === (periodo === 'matutino' ? grupoAtivo : 'T'))?.avisos || [];
  const totalErros = validacoes.reduce((acc, v) => acc + v.avisos.filter((a) => a.nivel === 'erro').length, 0);

  const setFaixa = (campo: 'intervalo' | 'complementar' | 'refeicaoFinal', parte: keyof FaixaHora, valor: string) =>
    atualizarGrupo((g) => ({ ...g, [campo]: { ...(g[campo] || { inicio: '', fim: '' }), [parte]: valor } }));
  const setAula = (ordem: string, parte: keyof FaixaHora, valor: string) =>
    atualizarGrupo((g) => ({ ...g, aulas: { ...g.aulas, [ordem]: { ...g.aulas[ordem], [parte]: valor } } }));
  const alternarOpcional = (campo: 'complementar' | 'refeicaoFinal', ligado: boolean) =>
    atualizarGrupo((g) => {
      const novo = { ...g } as SinoGrupoCfg;
      if (ligado) novo[campo] = { inicio: '', fim: '' };
      else delete novo[campo];
      return novo;
    });

  const caminhoDoEscopo = (p: Periodo) =>
    escopo === REDE ? `diario-classe/config/sino/padrao/${p}` : `diario-classe/config/sino/escolas/${escopo}/${p}`;

  const salvar = async () => {
    if (totalErros > 0) {
      setErroGravacao('Corrija os erros em vermelho antes de salvar.');
      return;
    }
    setSalvando(true);
    setErroGravacao(null);
    try {
      let valor: any;
      if (periodo === 'matutino') {
        valor = {
          G1: sinoGrupoParaGravar(rascunho.matutino.G1),
          G23: sinoGrupoParaGravar(rascunho.matutino.G23),
          G45: sinoGrupoParaGravar(rascunho.matutino.G45)
        };
      } else {
        valor = sinoGrupoParaGravar(rascunho.vespertino);
      }
      await set(ref(rtdb, caminhoDoEscopo(periodo)), valor);

      const nova: SinoConfig = clone(config || {});
      if (escopo === REDE) {
        nova.padrao = { ...(nova.padrao || {}), [periodo]: valor };
      } else {
        nova.escolas = { ...(nova.escolas || {}) };
        nova.escolas[escopo] = { ...(nova.escolas[escopo] || {}), [periodo]: valor };
      }
      onSalvo(nova);
    } catch (err: any) {
      setErroGravacao(formatFriendlyError(err, 'Não foi possível salvar o horário do sino.'));
    } finally {
      setSalvando(false);
    }
  };

  const removerPersonalizacao = async () => {
    setSalvando(true);
    setErroGravacao(null);
    try {
      await set(ref(rtdb, caminhoDoEscopo(periodo)), null);
      const nova: SinoConfig = clone(config || {});
      if (escopo === REDE) {
        if (nova.padrao) delete (nova.padrao as any)[periodo];
      } else if (nova.escolas?.[escopo]) {
        delete (nova.escolas[escopo] as any)[periodo];
      }
      onSalvo(nova);
      setRascunho(clone(sinoEfetivo(nova, escopo === REDE ? undefined : escopo)));
    } catch (err: any) {
      setErroGravacao(formatFriendlyError(err, 'Não foi possível remover a personalização.'));
    } finally {
      setSalvando(false);
    }
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
      <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden">
        <div className="p-4 bg-gradient-to-r from-indigo-600 to-indigo-700 text-white flex items-center justify-between shrink-0">
          <div>
            <h3 className="font-bold text-base">⏰ Horário do Sino (aulas e intervalos)</h3>
            <p className="text-xs text-indigo-100">Cada escola pode ter o seu. O que não for personalizado segue o padrão da rede.</p>
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
                {Object.keys(schools).map((id) => (
                  <option key={id} value={id}>
                    {schools[id].name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Turno:</label>
              <div className="flex gap-1.5">
                {(['matutino', 'vespertino'] as Periodo[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPeriodo(p)}
                    className={`flex-1 px-3 py-2 rounded-xl text-xs font-bold border cursor-pointer transition ${
                      periodo === p ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    {p === 'matutino' ? 'Matutino' : 'Vespertino'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <p className={`text-[11px] font-semibold px-3 py-1.5 rounded-lg border ${personalizado ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>
            {personalizado
              ? escopo === REDE
                ? '✅ O padrão da rede está personalizado neste turno.'
                : '✅ Esta escola tem horário próprio neste turno.'
              : escopo === REDE
              ? 'ℹ️ Usando o padrão embutido do sistema. Salve para definir o padrão da rede.'
              : 'ℹ️ Esta escola segue o padrão da rede. Salve para criar um horário próprio.'}
          </p>

          {periodo === 'matutino' && (
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">Série / grupo de recreio:</label>
              <div className="flex flex-wrap gap-1.5">
                {GRUPOS_SINO.map((g) => {
                  const erros = validacoes.find((v) => v.id === g.id)?.avisos.some((a) => a.nivel === 'erro');
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => setGrupoAtivo(g.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold border cursor-pointer transition ${
                        grupoAtivo === g.id ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      {g.nome} {erros ? '⛔' : ''}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="border border-slate-200 rounded-xl overflow-hidden">
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
                    <td className="px-3 py-1.5"><Campo valor={grupoCfg.aulas[o]?.inicio} onChange={(v) => setAula(o, 'inicio', v)} /></td>
                    <td className="px-3 py-1.5"><Campo valor={grupoCfg.aulas[o]?.fim} onChange={(v) => setAula(o, 'fim', v)} /></td>
                  </tr>
                ))}
                <tr className="bg-amber-50/60">
                  <td className="px-3 py-1.5 font-bold text-amber-900">Intervalo / recreio</td>
                  <td className="px-3 py-1.5"><Campo valor={grupoCfg.intervalo.inicio} onChange={(v) => setFaixa('intervalo', 'inicio', v)} /></td>
                  <td className="px-3 py-1.5"><Campo valor={grupoCfg.intervalo.fim} onChange={(v) => setFaixa('intervalo', 'fim', v)} /></td>
                </tr>
                {(['complementar', 'refeicaoFinal'] as const).map((campo) => (
                  <tr key={campo} className="bg-sky-50/40">
                    <td className="px-3 py-1.5">
                      <label className="flex items-center gap-1.5 font-bold text-sky-900 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={Boolean(grupoCfg[campo])}
                          onChange={(e) => alternarOpcional(campo, e.target.checked)}
                          className="rounded text-sky-600"
                        />
                        {campo === 'complementar' ? 'Leitura / lanche' : 'Refeição e saída'}
                      </label>
                    </td>
                    {grupoCfg[campo] ? (
                      <>
                        <td className="px-3 py-1.5"><Campo valor={grupoCfg[campo]!.inicio} onChange={(v) => setFaixa(campo, 'inicio', v)} /></td>
                        <td className="px-3 py-1.5"><Campo valor={grupoCfg[campo]!.fim} onChange={(v) => setFaixa(campo, 'fim', v)} /></td>
                      </>
                    ) : (
                      <td colSpan={2} className="px-3 py-1.5 text-slate-400">não se aplica</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

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
              <button
                type="button"
                onClick={() => setRascunho((prev) => ({ ...prev, matutino: modeloPosRecreio1020() }))}
                className="px-3 py-1.5 text-[11px] font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg cursor-pointer"
                title="Recreio 10:00–10:20; 4ª aula 10:20–11:10; 5ª aula 11:10–12:00, para os três grupos"
              >
                Aplicar modelo: aulas após o recreio 10:20 / 11:10 (ex.: Capitão)
              </button>
            )}
            <button
              type="button"
              onClick={() =>
                setRascunho((prev) =>
                  periodo === 'matutino' ? { ...prev, matutino: clone(SINO_PADRAO.matutino) } : { ...prev, vespertino: clone(SINO_PADRAO.vespertino) }
                )
              }
              className="px-3 py-1.5 text-[11px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg cursor-pointer"
            >
              Voltar ao padrão do sistema
            </button>
            {personalizado && (
              <button
                type="button"
                onClick={removerPersonalizacao}
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
