import React, { useState } from 'react';
import {
  X,
  BookOpen,
  Camera,
  Barcode,
  Layers,
  RotateCcw,
  ArrowRightLeft,
  FileSpreadsheet,
  CheckCircle2,
  HelpCircle,
  Sparkles,
  Info,
  Clock,
  Building2,
  GraduationCap
} from 'lucide-react';

interface LibraryManualModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type ManualSection = 'geral' | 'cadastro' | 'emprestimos' | 'cantinho' | 'remanejamento' | 'exportacao';

export const LibraryManualModal: React.FC<LibraryManualModalProps> = ({
  isOpen,
  onClose
}) => {
  const [activeSection, setActiveSection] = useState<ManualSection>('geral');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/70 backdrop-blur-xs overflow-y-auto">
      <div className="relative w-full max-w-4xl bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden my-2 sm:my-6 flex flex-col max-h-[calc(100dvh-1rem)] sm:max-h-[90dvh]">
        {/* Cabeçalho do Modal */}
        <div className="bg-gradient-to-r from-teal-900 via-emerald-900 to-indigo-950 text-white p-4 sm:p-6 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2.5 bg-emerald-500/20 border border-emerald-400/30 text-emerald-300 rounded-2xl">
              <BookOpen className="w-6 h-6" />
            </div>
            <div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-white/10 rounded-full text-[11px] font-semibold text-emerald-200 mb-1">
                <HelpCircle className="w-3.5 h-3.5" />
                <span>Guia Pedagógico & Operacional</span>
              </div>
              <h2 className="text-xl sm:text-2xl font-black tracking-tight">
                Manual da Biblioteca & Cantinho da Leitura
              </h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-white/70 hover:text-white hover:bg-white/10 transition cursor-pointer shrink-0"
            title="Fechar Manual"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Barra de Navegação Interna por Tópicos */}
        <div className="flex items-center gap-1.5 p-3 bg-slate-100 border-b border-slate-200 overflow-x-auto shrink-0 scrollbar-none">
          <button
            onClick={() => setActiveSection('geral')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
              activeSection === 'geral'
                ? 'bg-white text-emerald-800 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Info className="w-3.5 h-3.5 text-emerald-600" />
            <span>1. Visão Geral</span>
          </button>

          <button
            onClick={() => setActiveSection('cadastro')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
              activeSection === 'cadastro'
                ? 'bg-white text-emerald-800 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            <span>2. Cadastro com IA & ISBN</span>
          </button>

          <button
            onClick={() => setActiveSection('emprestimos')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
              activeSection === 'emprestimos'
                ? 'bg-white text-emerald-800 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <RotateCcw className="w-3.5 h-3.5 text-indigo-600" />
            <span>3. Empréstimos & Prazos</span>
          </button>

          <button
            onClick={() => setActiveSection('cantinho')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
              activeSection === 'cantinho'
                ? 'bg-white text-emerald-800 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Layers className="w-3.5 h-3.5 text-teal-600" />
            <span>4. Cantinho da Leitura</span>
          </button>

          <button
            onClick={() => setActiveSection('remanejamento')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
              activeSection === 'remanejamento'
                ? 'bg-white text-emerald-800 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ArrowRightLeft className="w-3.5 h-3.5 text-blue-600" />
            <span>5. Remanejamento</span>
          </button>

          <button
            onClick={() => setActiveSection('exportacao')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
              activeSection === 'exportacao'
                ? 'bg-white text-emerald-800 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
            <span>6. Relatórios & Excel</span>
          </button>
        </div>

        {/* Conteúdo do Tópico Selecionado */}
        <div className="p-5 sm:p-7 overflow-y-auto space-y-6 text-slate-700 text-sm leading-relaxed">
          {/* SEÇÃO 1: VISÃO GERAL */}
          {activeSection === 'geral' && (
            <div className="space-y-5">
              <div className="bg-emerald-50/80 border border-emerald-200 rounded-2xl p-4.5">
                <h3 className="font-bold text-emerald-950 text-base mb-1.5 flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  Biblioteca Escolar Integrada & Descentralizada
                </h3>
                <p className="text-emerald-900/90 text-sm">
                  O módulo de Biblioteca foi projetado para gerenciar tanto a <strong>biblioteca central da escola</strong> quanto a dinâmica pedagógica do <strong>Cantinho da Leitura dentro da sala de aula</strong>. O controle de acervo é unificado em tempo real, calculando exemplares totais, livres na estante, emprestados a estudantes ou alocados em turmas.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="p-4 bg-white border border-slate-200 rounded-2xl shadow-xs space-y-2">
                  <div className="w-8 h-8 rounded-xl bg-teal-100 text-teal-800 flex items-center justify-center font-bold text-xs">
                    01
                  </div>
                  <h4 className="font-bold text-slate-900 text-sm">Acervo Patrimonial</h4>
                  <p className="text-xs text-slate-600">
                    Controle de títulos, tombo, gênero, editora, sinopse e quantidade física de exemplares por escola.
                  </p>
                </div>

                <div className="p-4 bg-white border border-slate-200 rounded-2xl shadow-xs space-y-2">
                  <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold text-xs">
                    02
                  </div>
                  <h4 className="font-bold text-slate-900 text-sm">Circulação & Prazos</h4>
                  <p className="text-xs text-slate-600">
                    Empréstimo rápido para alunos das turmas, alerta de atraso automático e renovação com 1 clique.
                  </p>
                </div>

                <div className="p-4 bg-white border border-slate-200 rounded-2xl shadow-xs space-y-2">
                  <div className="w-8 h-8 rounded-xl bg-indigo-100 text-indigo-800 flex items-center justify-center font-bold text-xs">
                    03
                  </div>
                  <h4 className="font-bold text-slate-900 text-sm">Cantinho da Leitura</h4>
                  <p className="text-xs text-slate-600">
                    Obras na estante da sala de aula com controle de saída para casa gerenciado pelo professor da turma.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* SEÇÃO 2: CADASTRO COM IA & ISBN */}
          {activeSection === 'cadastro' && (
            <div className="space-y-5">
              <div className="bg-amber-50/70 border border-amber-200 rounded-2xl p-4.5">
                <h3 className="font-bold text-amber-950 text-base mb-1.5 flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-amber-600" />
                  Preenchimento Automático sem Digitação Exaustiva
                </h3>
                <p className="text-amber-900/90 text-sm">
                  Cadastre obras em poucos segundos utilizando o assistente inteligente disponível na tela de cadastro.
                </p>
              </div>

              <div className="space-y-4">
                <div className="border border-slate-200 rounded-2xl p-4 space-y-2 bg-slate-50/50">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-800 bg-emerald-100 px-2.5 py-1 rounded-lg">
                    <Camera className="w-3.5 h-3.5" />
                    Opção A: Leitura Visual com IA (Gemini Vision)
                  </span>
                  <ol className="list-decimal list-inside text-xs sm:text-sm text-slate-700 space-y-1.5 mt-2">
                    <li>Fotografe ou envie a <strong>Capa Frontal</strong> do livro.</li>
                    <li>Fotografe ou envie a <strong>Contracapa / Ficha Catalográfica</strong> (onde ficam o código de barras, ISBN e sinopse).</li>
                    <li>Clique em <strong>"Identificar Livro com IA"</strong>. O sistema extrai automaticamente título, autor, ilustrador, editora, ano, gênero sugerido e sinopse.</li>
                    <li><strong>Limpeza Automática</strong>: Ao trocar de livro ou carregar novas fotos, o sistema limpa os dados anteriores para garantir que não haja contaminação de informações entre livros.</li>
                  </ol>
                </div>

                <div className="border border-slate-200 rounded-2xl p-4 space-y-2 bg-slate-50/50">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-800 bg-indigo-100 px-2.5 py-1 rounded-lg">
                    <Barcode className="w-3.5 h-3.5" />
                    Opção B: Busca Instantânea por ISBN
                  </span>
                  <p className="text-xs sm:text-sm text-slate-700">
                    Digite ou leia com leitor de código de barras o ISBN de 10 ou 13 dígitos e clique em <strong>"Buscar ISBN"</strong>. As bases oficiais do Google Books e OpenLibrary retornarão a capa oficial e a ficha técnica completa.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* SEÇÃO 3: EMPRÉSTIMOS & PRAZOS */}
          {activeSection === 'emprestimos' && (
            <div className="space-y-5">
              <div className="bg-indigo-50/70 border border-indigo-200 rounded-2xl p-4.5">
                <h3 className="font-bold text-indigo-950 text-base mb-1.5 flex items-center gap-2">
                  <RotateCcw className="w-5 h-5 text-indigo-600" />
                  Fluxo de Empréstimos e Devoluções
                </h3>
                <p className="text-indigo-900/90 text-sm">
                  Controle rigoroso dos exemplares em circulação, vinculados diretamente à lista oficial de alunos das turmas cadastradas.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="border border-slate-200 rounded-2xl p-4 space-y-2">
                  <h4 className="font-bold text-slate-900 flex items-center gap-2">
                    <Clock className="w-4 h-4 text-emerald-600" />
                    Realizar Empréstimo
                  </h4>
                  <ul className="text-xs text-slate-600 space-y-1 list-disc list-inside">
                    <li>Clique em <strong>Novo Empréstimo</strong> ou no botão <strong>Emprestar</strong> no card do livro.</li>
                    <li>Selecione a <strong>Turma</strong> e depois o(a) <strong>Estudante</strong>.</li>
                    <li>Defina a data de devolução (sugestão de 7 dias).</li>
                    <li>O exemplar livre do acervo é debitado automaticamente.</li>
                  </ul>
                </div>

                <div className="border border-slate-200 rounded-2xl p-4 space-y-2">
                  <h4 className="font-bold text-slate-900 flex items-center gap-2">
                    <RotateCcw className="w-4 h-4 text-amber-600" />
                    Renovação & Devolução
                  </h4>
                  <ul className="text-xs text-slate-600 space-y-1 list-disc list-inside">
                    <li><strong>Renovação em 1 clique</strong>: Estende o prazo por mais 7 dias no painel de circulação.</li>
                    <li><strong>Alerta de Atraso</strong>: Empréstimos vencidos são destacados visualmente em vermelho.</li>
                    <li><strong>Devolução</strong>: Ao clicar em "Devolver", o exemplar retorna imediatamente à estante.</li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* SEÇÃO 4: CANTINHO DA LEITURA */}
          {activeSection === 'cantinho' && (
            <div className="space-y-5">
              <div className="bg-teal-50/80 border border-teal-200 rounded-2xl p-4.5">
                <h3 className="font-bold text-teal-950 text-base mb-1.5 flex items-center gap-2">
                  <Layers className="w-5 h-5 text-teal-600" />
                  Cantinho da Leitura em Sala de Aula
                </h3>
                <p className="text-teal-900/90 text-sm">
                  O Cantinho da Leitura leva os livros da biblioteca central diretamente para a estante da sala de aula, promovendo projetos literários e leitura diária.
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex items-start gap-3 p-3.5 bg-slate-50 rounded-2xl border border-slate-200">
                  <span className="w-6 h-6 rounded-full bg-teal-600 text-white font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">
                    1
                  </span>
                  <div>
                    <h5 className="font-bold text-slate-900 text-xs sm:text-sm">Alocação de Obras para a Turma</h5>
                    <p className="text-xs text-slate-600">
                      Na aba <strong>Acervo</strong>, clique no botão <strong>Cantinho</strong> do livro desejado. Escolha a turma e informe a quantidade de exemplares que irão para a sala. Esses exemplares saem da disponibilidade da biblioteca central e entram no acervo da sala de aula.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3.5 bg-slate-50 rounded-2xl border border-slate-200">
                  <span className="w-6 h-6 rounded-full bg-teal-600 text-white font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">
                    2
                  </span>
                  <div>
                    <h5 className="font-bold text-slate-900 text-xs sm:text-sm">Empréstimo Rápido em Sala de Aula</h5>
                    <p className="text-xs text-slate-600">
                      Na aba <strong>Cantinho da Leitura</strong>, o professor clica em <strong>Emprestar</strong> diretamente no card do livro da turma, seleciona o aluno e registra o empréstimo domiciliar.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3.5 bg-slate-50 rounded-2xl border border-slate-200">
                  <span className="w-6 h-6 rounded-full bg-teal-600 text-white font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">
                    3
                  </span>
                  <div>
                    <h5 className="font-bold text-slate-900 text-xs sm:text-sm">Recebimento do Aluno</h5>
                    <p className="text-xs text-slate-600">
                      Na sub-aba <strong>Empréstimos Ativos</strong>, o professor clica em <strong>Receber na Sala</strong> quando o aluno traz o livro de volta. O livro retorna à estante da sala.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3.5 bg-slate-50 rounded-2xl border border-slate-200">
                  <span className="w-6 h-6 rounded-full bg-teal-600 text-white font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">
                    4
                  </span>
                  <div>
                    <h5 className="font-bold text-slate-900 text-xs sm:text-sm">Retorno ao Acervo Central</h5>
                    <p className="text-xs text-slate-600">
                      Ao final do projeto ou bimestre, o professor clica em <strong>Acervo</strong> no card da obra para devolver os exemplares à biblioteca geral, restaurando a quantidade central.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* SEÇÃO 5: REMANEJAMENTO */}
          {activeSection === 'remanejamento' && (
            <div className="space-y-5">
              <div className="bg-blue-50/70 border border-blue-200 rounded-2xl p-4.5">
                <h3 className="font-bold text-blue-950 text-base mb-1.5 flex items-center gap-2">
                  <ArrowRightLeft className="w-5 h-5 text-blue-600" />
                  Transferência de Obras entre Escolas da Rede
                </h3>
                <p className="text-blue-900/90 text-sm">
                  Permite remanejar lotes de exemplares entre bibliotecas de diferentes escolas municipais, mantendo auditoria completa com justificativa e responsável.
                </p>
              </div>

              <div className="border border-slate-200 rounded-2xl p-4 space-y-3">
                <h4 className="font-bold text-slate-900">Como funciona:</h4>
                <ul className="text-xs sm:text-sm text-slate-600 space-y-2 list-disc list-inside">
                  <li>No card do livro na aba <strong>Acervo</strong>, clique no botão <strong>Remanejar</strong>.</li>
                  <li>Selecione a escola receptora e a quantidade de exemplares a transferir (respeitando o saldo disponível da escola de origem).</li>
                  <li>Insira o motivo pedagógico ou institucional da transferência.</li>
                  <li>O sistema grava a movimentação formal no <strong>Histórico de Remanejamentos</strong>.</li>
                </ul>
              </div>
            </div>
          )}

          {/* SEÇÃO 6: EXPORTAÇÃO */}
          {activeSection === 'exportacao' && (
            <div className="space-y-5">
              <div className="bg-emerald-50/70 border border-emerald-200 rounded-2xl p-4.5">
                <h3 className="font-bold text-emerald-950 text-base mb-1.5 flex items-center gap-2">
                  <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
                  Relatórios Gerenciais e Planilhas Excel
                </h3>
                <p className="text-emerald-900/90 text-sm">
                  Todos os dados podem ser exportados com formatação profissional em planilhas Excel (.xlsx) e comprovantes em PDF.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-4 border border-slate-200 rounded-2xl space-y-2">
                  <span className="font-bold text-slate-900 text-sm block">📊 Planilhas Excel (.xlsx)</span>
                  <ul className="text-xs text-slate-600 space-y-1 list-disc list-inside">
                    <li><strong>Acervo Completo</strong>: Tombo, título, autor, gênero, editora e estoque por escola.</li>
                    <li><strong>Circulação</strong>: Livros emprestados, alunos, turmas, datas e atrasos.</li>
                    <li><strong>Cantinho da Leitura</strong>: Inventário e empréstimos por sala.</li>
                  </ul>
                </div>

                <div className="p-4 border border-slate-200 rounded-2xl space-y-2">
                  <span className="font-bold text-slate-900 text-sm block">🖨️ Documentos PDF</span>
                  <ul className="text-xs text-slate-600 space-y-1 list-disc list-inside">
                    <li><strong>Comprovante de Empréstimo</strong> com termo de compromisso e data de devolução para assinatura do aluno/responsável.</li>
                  </ul>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Rodapé do Modal com Ações */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
          <span className="text-xs text-slate-500 hidden sm:inline">
            Para mais detalhes técnicos, consulte o arquivo <code>MANUAL_BIBLIOTECA.md</code> na raiz do projeto.
          </span>
          <button
            onClick={onClose}
            className="w-full sm:w-auto px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs sm:text-sm font-bold shadow-xs transition cursor-pointer ml-auto"
          >
            Entendido, fechar manual
          </button>
        </div>
      </div>
    </div>
  );
};
