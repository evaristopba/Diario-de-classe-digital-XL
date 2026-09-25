import React, { useState, useEffect } from 'react';
import { ScreenType, ModalConfig } from '../types';
import { verificarIsAdmin } from '../lib/firebase';
import {
  Presentation,
  Video,
  Monitor,
  Sparkles,
  Award,
  CheckCircle2,
  FileText,
  DollarSign,
  TrendingUp,
  Clock,
  BookOpen,
  Users,
  Building2,
  Play,
  Pause,
  RotateCcw,
  ArrowRight,
  ArrowLeft,
  Share2,
  Copy,
  Check,
  Printer,
  ShieldCheck,
  Layers,
  ChevronRight,
  Sparkle,
  Download,
  AlertTriangle,
  Lightbulb,
  ExternalLink,
  BookMarked
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface PresentationScreenProps {
  setModal: (config: ModalConfig) => void;
  onNavigate: (screen: ScreenType) => void;
}

type TabMode = 'pitch' | 'video-script' | 'proposal-print';
type VideoFormat = 'reels' | 'institucional' | 'features';

export const PresentationScreen: React.FC<PresentationScreenProps> = ({
  setModal,
  onNavigate
}) => {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabMode>('pitch');
  const [activeSlide, setActiveSlide] = useState(0);
  const [videoFormat, setVideoFormat] = useState<VideoFormat>('institucional');

  // Estado do Temporizador para gravação de vídeo
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [copiedScriptIndex, setCopiedScriptIndex] = useState<number | null>(null);
  const [copiedCaption, setCopiedCaption] = useState(false);

  useEffect(() => {
    verificarIsAdmin()
      .then((admin) => {
        setIsAdmin(admin);
      })
      .catch(() => setIsAdmin(false))
      .finally(() => setLoading(false));
  }, []);

  // Temporizador de apoio à gravação
  useEffect(() => {
    let interval: any = null;
    if (isTimerRunning) {
      interval = setInterval(() => {
        setTimerSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [isTimerRunning]);

  const formatTime = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const copyToClipboard = (text: string, index?: number) => {
    navigator.clipboard.writeText(text);
    if (index !== undefined) {
      setCopiedScriptIndex(index);
      setTimeout(() => setCopiedScriptIndex(null), 2500);
    } else {
      setCopiedCaption(true);
      setTimeout(() => setCopiedCaption(false), 2500);
    }
  };

  // Slides da Apresentação Executiva para o Secretário
  const slides = [
    {
      id: 'dor-solucao',
      title: '1. O Desafio Atual vs. Transformação Digital',
      badge: 'Eficiência & Economia',
      subtitle: 'Como o município elimina custos invisíveis e recupera o controle dos dados escolares',
      painPoints: [
        'Cadernos de chamada de papel comprados anualmente (alto custo com gráficas e toners).',
        'Risco constante de extravio, rasura ou perda física dos registros de frequência e notas.',
        'Atraso de semanas ao final do bimestre para a Secretaria saber quem são os alunos em evasão.',
        'Professores sobrecarregados preenchendo as mesmas informações em múltiplos relatórios.'
      ],
      solutions: [
        '100% Digital e Seguro: Fim das despesas recorrentes com cadernos de papel e encadernação.',
        'Acesso Centralizado: A Secretaria de Educação visualiza todas as escolas em um único painel.',
        'Alerta Precoce de Infrequência: Identificação em tempo real de alunos com risco de reprovação ou abandono.',
        'Valorização do Docente: O professor gasta menos tempo com burocracia e mais tempo ensinando.'
      ],
      speechKey:
        '“Secretário(a), cada caderno de chamada de papel impresso pela gráfica municipal custa caro e não gera inteligência de dados. Com o Diário de Classe Digital, o município economiza verbas públicas e passa a ter a rede na palma da mão em tempo real.”',
      demoAction: {
        label: 'Ver Painel Central da Rede',
        screen: 'dashboard' as ScreenType
      }
    },
    {
      id: 'gestao-rede',
      title: '2. Gestão Municipal Multi-Escola & Enturmação',
      badge: 'Controle da Secretaria',
      subtitle: 'Padronização pedagógica, atribuição de professores e histórico unificado de alunos',
      painPoints: [
        'Dificuldade para gerenciar professores regentes e especialistas (Arte, Ed. Física, Inglês, Informática Educativa / Tecnologia).',
        'Transferências de alunos entre escolas municipais que demoram para ser atualizadas.',
        'Falta de padronização nas matrizes curriculares entre unidades urbanas e rurais.'
      ],
      solutions: [
        'Módulo Escolas & Turmas: Cadastro centralizado de todas as unidades da rede de ensino.',
        'Atribuição Flexível: Regentes e especialistas compartilham a mesma turma sem conflito.',
        'Idealizado por Professor de Informática: Projeto concebido com a visão prática de quem vivencia os desafios reais da rede e os eixos da BNCC Computação.',
        'Identificação por R.A. e R.M.: Histórico completo do aluno em caso de remanejamento ou transferência.',
        'Grade Curricular Customizável: Criação e controle de disciplinas da Base Comum e Parte Diversificada.'
      ],
      speechKey:
        '“Nossa estrutura foi desenhada respeitando a realidade municipal: permite escolas urbanas, polos rurais, turmas multisseriadas e perfeita coordenação entre o professor regente da sala e os especialistas — como Arte, Ed. Física, Inglês e o Professor de Informática Educativa, cuja experiência direta em sala de aula e no laboratório inspirou a idealização deste sistema.”',
      demoAction: {
        label: 'Ver Gestão de Escolas & Turmas',
        screen: 'schools-screen' as ScreenType
      }
    },
    {
      id: 'sala-de-aula',
      title: '3. A Experiência do Professor: Simples e Rápida',
      badge: 'Zero Poluição Visual',
      subtitle: 'Menos de 15 segundos para fazer a chamada e plano de aula alinhado à BNCC com 1 clique',
      painPoints: [
        'Sistemas legados complexos e lentos que causam rejeição entre os professores.',
        'Dificuldade de localizar os códigos oficiais da BNCC em pilhas de documentos.',
        'Cálculos manuais de faltas e médias propensos a erros aritméticos.'
      ],
      solutions: [
        'Chamada em 1 Toque: Interface rápida no celular, tablet ou computador da escola.',
        'Banco BNCC Integrado: Busca inteligente por habilidades da Educação Infantil ao Ensino Fundamental.',
        'Planos de Aula Estruturados: Planejado, executado e ratificado sem retrabalho.',
        'Notas Dinâmicas: Lançamento ágil com cálculo de aproveitamento e situação final automática.'
      ],
      speechKey:
        '“A maior garantia de sucesso de um software na educação é a adesão do professor. Por isso, a interface é limpa, sem poluição visual, projetada para funcionar até mesmo em conexões modestas.”',
      demoAction: {
        label: 'Ver Módulo de Chamada Rápida',
        screen: 'attendance-screen' as ScreenType
      }
    },
    {
      id: 'leitura-ideb',
      title: '4. Fomento ao Letramento & IDEB: Biblioteca e Cantinho',
      badge: 'Apoio Pedagógico',
      subtitle: 'Integração inédita entre a Biblioteca Escolar central e o Cantinho da Leitura em sala',
      painPoints: [
        'Livros didáticos e paradidáticos perdidos ou esquecidos em armários escolares.',
        'Falta de estatísticas municipais sobre o engajamento leitor dos estudantes.',
        'Dificuldade do professor em controlar empréstimos rápidos de livros da própria sala de aula.'
      ],
      solutions: [
        'Acervo Municipal Compartilhado: Cadastro com leitura inteligente por IA de capas e ISBN.',
        'Cantinho da Leitura na Turma: O acervo físico vai para a sala de aula perto da criança.',
        'Histórico Leitor por Aluno: Registro de livros lidos para apoiar projetos de fluência leitora.',
        'Indicadores para o IDEB: Fortalecimento da alfabetização e proficiência textual na idade certa.'
      ],
      speechKey:
        '“Não somos apenas um diário burocrático; somos uma ferramenta pedagógica de apoio ao IDEB. O Cantinho da Leitura aproxima os livros do estudante e dá à Secretaria o mapa real da leitura no município.”',
      demoAction: {
        label: 'Ver Cantinho da Leitura & Acervo',
        screen: 'library-screen' as ScreenType
      }
    },
    {
      id: 'legal-soberania',
      title: '5. Conformidade Legal, Relatórios Oficiais & Soberania',
      badge: 'Segurança Institucional',
      subtitle: 'Boletins em PDF/Excel, fichas de rendimento e independência total do município',
      painPoints: [
        'Empresas que cobram mensalidades caras por aluno e aprisionam os dados do município.',
        'Dificuldade de emitir boletins no formato exigido pela legislação educacional (LDB / MEC).',
        'Insegurança jurídica caso o sistema caia ou cancele o contrato.'
      ],
      solutions: [
        'Boletins Oficiais Completos: Visão multi-disciplinar (todas as matérias) ou por matéria com R.A.',
        'Exportação Pronta em PDF e Planilhas Excel: Documentos prontos para impressão ou arquivo digital.',
        'Rotina de Backup Total em JSON: Soberania total dos dados que pertencem 100% à Prefeitura.',
        'Arquivo Único Autocontido: Funciona sem dependências pesadas, sem taxas por aluno.'
      ],
      speechKey:
        '“Os dados dos alunos e professores pertencem à municipalidade. Nossa plataforma garante exportação em lote de boletins, atas e relatórios oficiais, além de cópia integral de segurança a qualquer momento.”',
      demoAction: {
        label: 'Ver Módulo de Relatórios & Boletins',
        screen: 'reports-screen' as ScreenType
      }
    }
  ];

  // Roteiros para Gravação de Vídeo Institucional
  const scriptsVideo = {
    institucional: [
      {
        step: 1,
        time: '0:00 - 0:35',
        scene: 'Tela inicial do Dashboard com o título do Diário de Classe Digital',
        speech:
          'Olá gestores, professores e comunidade escolar! Hoje eu quero apresentar a solução que está transformando a gestão pedagógica municipal: o Diário de Classe Digital. Uma plataforma desenvolvida para modernizar a rotina das nossas escolas, trazendo eficiência, economia de recursos públicos e controle pedagógico em tempo real.',
        actionTarget: 'dashboard' as ScreenType
      },
      {
        step: 2,
        time: '0:35 - 1:15',
        scene: 'Acesse Escolas e Turmas, mostrando a visão multi-escola',
        speech:
          'Para a Secretaria de Educação, acabaram as pilhas de papéis e as planilhas desconectadas. O sistema centraliza todas as unidades escolares do município, turmas dos períodos matutino e vespertino, professores regentes e especialistas — Arte, Educação Física, Inglês e Informática Educativa —, além de todo o cadastro de alunos com R.A. e histórico de transferência.',
        actionTarget: 'schools-screen' as ScreenType
      },
      {
        step: 3,
        time: '1:15 - 2:00',
        scene: 'Abra a Chamada e mostre a rapidez do registro diário',
        speech:
          'Para o professor na sala de aula, o ganho de tempo é revolucionário. A chamada diária é feita em menos de 15 segundos no computador ou celular. Os planos de aula são integrados diretamente às habilidades oficiais da BNCC com um clique, sem burocracia.',
        actionTarget: 'attendance-screen' as ScreenType
      },
      {
        step: 4,
        time: '2:00 - 2:45',
        scene: 'Abra o Cantinho da Leitura e a Biblioteca Escolar',
        speech:
          'Um dos grandes diferenciais é o estímulo ao letramento e ao IDEB. O módulo de Biblioteca Escolar conta com o inovador Cantinho da Leitura, permitindo que a estante de livros esteja viva dentro da sala de aula, com controle fácil de empréstimos e histórico leitor de cada criança.',
        actionTarget: 'library-screen' as ScreenType
      },
      {
        step: 5,
        time: '2:45 - 3:30',
        scene: 'Abra o módulo de Relatórios e mostre o Boletim Bimestral em PDF',
        speech:
          'E no fechamento bimestral, tudo acontece automaticamente. Emissão de boletins escolares em alta qualidade, relatórios consolidados em PDF e planilhas Excel para prestação de contas aos órgãos de controle e aos pais de alunos.',
        actionTarget: 'reports-screen' as ScreenType
      },
      {
        step: 6,
        time: '3:30 - 4:00',
        scene: 'Volte ao Dashboard e conclua com a chamada para ação (CTA)',
        speech:
          'Tecnologia limpa, sustentável, econômica e 100% alinhada às diretrizes do MEC. O futuro da educação municipal já começou. Entre em contato conosco para agendar uma demonstração na sua Secretaria!',
        actionTarget: 'dashboard' as ScreenType
      }
    ],
    reels: [
      {
        step: 1,
        time: '0:00 - 0:15',
        scene: 'Inicie com o gancho: Fim dos cadernos de chamada de papel',
        speech:
          'Você sabia que uma secretaria de educação gasta milhares de reais todo ano imprimindo cadernos de chamada que depois ficam esquecidos em gavetas? Apresentamos o Diário de Classe Digital!',
        actionTarget: 'dashboard' as ScreenType
      },
      {
        step: 2,
        time: '0:15 - 0:40',
        scene: 'Faça a chamada ao vivo em segundos e mostre a BNCC',
        speech:
          'Olha como é rápido: o professor faz a chamada em 10 segundos, lança notas de todas as matérias e vincula o plano de aula direto aos códigos da BNCC sem perder tempo com burocracia.',
        actionTarget: 'attendance-screen' as ScreenType
      },
      {
        step: 3,
        time: '0:40 - 1:00',
        scene: 'Gere o Boletim Oficial em PDF na hora e convide a seguir',
        speech:
          'Ao final do bimestre, os boletins oficiais e as atas são gerados em PDF e Excel em um clique. Mais economia para a Prefeitura, mais tempo para o professor ensinar. Compartilhe esse vídeo com o Secretário de Educação da sua cidade!',
        actionTarget: 'reports-screen' as ScreenType
      }
    ],
    features: [
      {
        step: 1,
        time: 'Módulo 1',
        scene: 'Chamada Inteligente',
        speech:
          'Chamada instantânea: controle de presenças e faltas por data e bimestre com cálculo automático de frequência mínima legal (75%).',
        actionTarget: 'attendance-screen' as ScreenType
      },
      {
        step: 2,
        time: 'Módulo 2',
        scene: 'Planos de Aula BNCC',
        speech:
          'Planejamento pedagógico ágil: acervo de habilidades da BNCC por ano e disciplina com status de planejado, executado e ratificado.',
        actionTarget: 'lesson-plan-screen' as ScreenType
      },
      {
        step: 3,
        time: 'Módulo 3',
        scene: 'Boletins Oficiais & Relatórios',
        speech:
          'Boletim individual ou por turma completa, visão multi-disciplinar paisagem, fichas de rendimento e exportação para planilhas.',
        actionTarget: 'reports-screen' as ScreenType
      },
      {
        step: 4,
        time: 'Módulo 4',
        scene: 'Cantinho da Leitura & Biblioteca',
        speech:
          'Controle de livros na sala de aula: fomento à alfabetização e acompanhamento de leituras para elevar a nota do IDEB.',
        actionTarget: 'library-screen' as ScreenType
      }
    ]
  };

  // Gerar PDF da Proposta Executiva Municipal
  const handleGenerateProposalPdf = () => {
    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const currentYear = new Date().getFullYear().toString();

      // Cabeçalho Oficial
      doc.setFillColor(30, 41, 59); // slate-800
      doc.rect(0, 0, 210, 32, 'F');

      doc.setTextColor(255, 255, 255);
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text('PROPOSTA EXECUTIVA DE MODERNIZAÇÃO PEDAGÓGICA', 14, 14);

      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(203, 213, 225);
      doc.text(
        `Plataforma Diário de Classe Digital • Gestão Municipal de Ensino • Exercício ${currentYear}`,
        14,
        22
      );

      // Metadados
      doc.setTextColor(51, 65, 85);
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.text('Apresentado a: Secretaria Municipal de Educação', 14, 42);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text(`Data de Emissão: ${new Date().toLocaleDateString('pt-BR')} • Versão da Plataforma: 2026 Pro`, 14, 48);

      // Resumo Executivo
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text('1. RESUMO EXECUTIVO & PROPOSTA DE VALOR', 14, 58);

      doc.setFontSize(9.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(71, 85, 105);
      const summaryText =
        'O Diário de Classe Digital é um sistema de gestão educacional desenvolvido especificamente para redes municipais de ensino, concebido a partir da visão prática de um Professor de Informática Educativa da rede pública. A plataforma elimina totalmente o uso de cadernos físicos de chamada, otimiza o trabalho diário dos professores regentes e especialistas (Arte, Ed. Física, Inglês, Informática / Tecnologia), garante alinhamento de 100% dos planos de aula com a Base Nacional Comum Curricular (BNCC - MEC) e confere à Secretaria de Educação visão consolidada e em tempo real sobre frequência, notas, evasão escolar e incentivo à leitura.';
      const splitSummary = doc.splitTextToSize(summaryText, 182);
      doc.text(splitSummary, 14, 65);

      // Tabela de Comparativo de Impacto
      const impactTable = [
        ['Dimensão', 'Cenário Tradicional (Papel / Planilhas)', 'Com Diário de Classe Digital'],
        ['Custos com Papel', 'Impressão anual de cadernos, capas e formulários físicos.', 'Custo ZERO com papel de chamada e diários encadernados.'],
        ['Tempo de Chamada', '10 a 15 minutos por aula preenchendo grades manuais.', 'Menos de 15 segundos pelo celular ou notebook.'],
        ['Conformidade BNCC', 'Verificação manual demorada de códigos e habilidades.', 'Banco de códigos BNCC integrado e aplicado com 1 clique.'],
        ['Evasão Escolar', 'Descoberta tardia, geralmente ao término do semestre.', 'Alerta imediato de alunos em infrequência crítica (>25%).'],
        ['Boletins & Atas', 'Digitação duplicada de médias e cálculo manual de notas.', 'Boletins oficiais em PDF e Excel gerados instantaneamente.'],
        ['Incentivo à Leitura', 'Livros estáticos na biblioteca central, controle difícil.', 'Cantinho da Leitura integrado diretamente na sala de aula.']
      ];

      autoTable(doc, {
        startY: 92,
        head: [impactTable[0]],
        body: impactTable.slice(1),
        theme: 'striped',
        headStyles: { fillColor: [79, 70, 229], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8.5 },
        styles: { fontSize: 8, cellPadding: 3, textColor: [30, 41, 59] },
        columnStyles: {
          0: { cellWidth: 35, fontStyle: 'bold' },
          1: { cellWidth: 72 },
          2: { cellWidth: 75 }
        }
      });

      let finalY = (doc as any).lastAutoTable.finalY + 10;

      // Pilares de Implantação
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text('2. PILARES DE IMPLANTAÇÃO & SOBERANIA DOS DADOS', 14, finalY);

      finalY += 7;
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(71, 85, 105);

      const pillars = [
        '• Soberania dos Dados: O município mantém a posse de 100% das informações através de rotina diária de backup em JSON.',
        '• Compatibilidade com Infraestrutura Existente: Funciona em qualquer navegador moderno sem necessidade de servidores locais caros.',
        '• Segurança e Auditoria: Níveis de acesso estritos separando Administrador da Secretaria e Professores atribuídos.',
        '• Agilidade de Adesão: Interface intuitiva com curva de aprendizado inferior a 30 minutos para os professores da rede.'
      ];

      pillars.forEach((p) => {
        doc.text(p, 14, finalY);
        finalY += 6;
      });

      // Rodapé
      doc.setDrawColor(226, 232, 240);
      doc.line(14, 275, 196, 275);
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text('Diário de Classe Digital • Documento Executivo de Apresentação Municipal • Confidencial', 14, 282);
      doc.text('Página 1 de 1', 180, 282);

      doc.save(`Proposta-Executiva-Diario-de-Classe-Municipal-${currentYear}.pdf`);

      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Proposta Gerada com Sucesso!',
        message:
          'O arquivo PDF da Proposta Executiva foi gerado e baixado. Você pode imprimi-lo ou enviá-lo diretamente à Secretaria de Educação.',
        icon: '📄'
      });
    } catch (err: any) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro ao Gerar PDF',
        message: err.message || 'Falha ao processar o PDF da proposta executiva.',
        icon: '❌'
      });
    }
  };

  // Se estiver carregando verificação de autorização
  if (loading) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="text-sm font-semibold text-slate-600">Verificando permissões administrativas...</p>
        </div>
      </div>
    );
  }

  // Trava de segurança: exclusivo para Administrador
  if (!isAdmin) {
    return (
      <div className="max-w-3xl mx-auto p-6 sm:p-12 text-center">
        <div className="p-8 bg-white border border-red-200 rounded-3xl shadow-lg space-y-5">
          <div className="w-16 h-16 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center mx-auto shadow-xs">
            <AlertTriangle className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-black text-slate-800 tracking-tight">
            Acesso Restrito ao Administrador
          </h2>
          <p className="text-sm text-slate-600 max-w-lg mx-auto leading-relaxed">
            Este módulo reúne a <strong>Apresentação Executiva (Pitch para Secretário de Educação)</strong> e o{' '}
            <strong>Roteiro Institucional de Gravação de Vídeo</strong>. Por conter dados de posicionamento estratégico e
            proposta comercial do município, seu acesso é exclusivo para a administração.
          </p>
          <div className="pt-2">
            <button
              onClick={() => onNavigate('dashboard')}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-xs transition"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Voltar ao Painel de Controle</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Banner Principal de Cabeçalho */}
      <div className="relative overflow-hidden bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white rounded-3xl p-6 sm:p-8 shadow-xl border border-indigo-900/50">
        <div className="absolute top-0 right-0 -mt-8 -mr-8 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none"></div>

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="px-3 py-1 bg-amber-400/20 text-amber-300 border border-amber-400/30 text-[11px] font-extrabold uppercase tracking-wider rounded-full flex items-center gap-1.5">
                <Sparkle className="w-3 h-3 fill-amber-300" />
                Exclusivo Administrador • Pitch Municipal
              </span>
              <span className="px-3 py-1 bg-indigo-500/20 text-indigo-200 border border-indigo-500/30 text-[11px] font-medium rounded-full">
                Pronto para Gravação de Vídeo
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
              Apresentação para Secretário & Vídeo Institucional
            </h1>
            <p className="text-sm text-slate-300 max-w-2xl leading-relaxed">
              Materiais estratégicos, dados de impacto municipal e roteiro passo a passo com teleprompter
              para você gravar a tela do app e produzir um vídeo profissional para redes sociais.
            </p>
          </div>

          {/* Ações Rápidas no Topo */}
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={handleGenerateProposalPdf}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-md transition cursor-pointer"
              title="Baixar proposta formal em PDF para entrega ao Secretário de Educação"
            >
              <Download className="w-4 h-4" />
              <span>Baixar Proposta PDF</span>
            </button>
            <button
              onClick={() => setActiveTab('video-script')}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-md transition cursor-pointer"
            >
              <Video className="w-4 h-4" />
              <span>Modo Gravação de Tela</span>
            </button>
          </div>
        </div>

        {/* Abas de Navegação */}
        <div className="flex items-center gap-2 border-t border-slate-800 pt-5 mt-6 overflow-x-auto scrollbar-none">
          <button
            onClick={() => setActiveTab('pitch')}
            className={`px-4 py-2 text-xs font-bold rounded-xl transition flex items-center gap-2 cursor-pointer shrink-0 ${
              activeTab === 'pitch'
                ? 'bg-white text-slate-900 shadow-md'
                : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <Presentation className="w-4 h-4 text-indigo-600" />
            <span>Pitch para o Secretário (5 Pilares)</span>
          </button>

          <button
            onClick={() => setActiveTab('video-script')}
            className={`px-4 py-2 text-xs font-bold rounded-xl transition flex items-center gap-2 cursor-pointer shrink-0 ${
              activeTab === 'video-script'
                ? 'bg-white text-slate-900 shadow-md'
                : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <Video className="w-4 h-4 text-rose-600" />
            <span>Roteiro de Gravação de Tela (Vídeo Institucional)</span>
          </button>

          <button
            onClick={() => setActiveTab('proposal-print')}
            className={`px-4 py-2 text-xs font-bold rounded-xl transition flex items-center gap-2 cursor-pointer shrink-0 ${
              activeTab === 'proposal-print'
                ? 'bg-white text-slate-900 shadow-md'
                : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <FileText className="w-4 h-4 text-emerald-600" />
            <span>Guia Comercial & Argumentação Política</span>
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* ABA 1: PITCH PARA O SECRETÁRIO DE EDUCAÇÃO */}
      {/* ========================================================================= */}
      {activeTab === 'pitch' && (
        <div className="space-y-6">
          {/* Métricas Rápidas de Impacto Municipal */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Economia de Papel</span>
                <div className="p-2 bg-emerald-50 text-emerald-600 rounded-xl">
                  <DollarSign className="w-4 h-4" />
                </div>
              </div>
              <div className="text-2xl font-black text-slate-800">100% Digital</div>
              <p className="text-xs text-slate-500">
                Elimina impressão de cadernos físicos de chamada e formulários duplicados na rede.
              </p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Agilidade em Aula</span>
                <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
                  <Clock className="w-4 h-4" />
                </div>
              </div>
              <div className="text-2xl font-black text-slate-800">&lt; 15 Segundos</div>
              <p className="text-xs text-slate-500">
                Tempo médio do professor para registrar a frequência diária pelo smartphone ou notebook.
              </p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Conformidade Legal</span>
                <div className="p-2 bg-purple-50 text-purple-600 rounded-xl">
                  <Award className="w-4 h-4" />
                </div>
              </div>
              <div className="text-2xl font-black text-slate-800">100% BNCC</div>
              <p className="text-xs text-slate-500">
                Habilidades curriculares integradas para a Educação Infantil e Ensino Fundamental.
              </p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Estímulo ao IDEB</span>
                <div className="p-2 bg-amber-50 text-amber-600 rounded-xl">
                  <BookOpen className="w-4 h-4" />
                </div>
              </div>
              <div className="text-2xl font-black text-slate-800">Cantinho da Sala</div>
              <p className="text-xs text-slate-500">
                Gestão da biblioteca central e estante de livros na própria sala para alfabetização contínua.
              </p>
            </div>
          </div>

          {/* Navegador Interativo dos 5 Pilares */}
          <div className="bg-white rounded-3xl border border-slate-200/90 shadow-sm overflow-hidden">
            {/* Seletor de Slides */}
            <div className="bg-slate-50 border-b border-slate-200 p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-500 uppercase">Slide {activeSlide + 1} de {slides.length}:</span>
                <span className="text-xs font-extrabold text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-lg border border-indigo-100">
                  {slides[activeSlide].badge}
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                {slides.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setActiveSlide(i)}
                    className={`w-8 h-8 rounded-xl text-xs font-bold transition flex items-center justify-center cursor-pointer ${
                      activeSlide === i
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'bg-white text-slate-600 hover:bg-slate-200 border border-slate-200'
                    }`}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
            </div>

            {/* Conteúdo do Slide Selecionado */}
            <div className="p-6 sm:p-8 space-y-6">
              <div>
                <h3 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                  {slides[activeSlide].title}
                </h3>
                <p className="text-sm text-slate-600 mt-1">
                  {slides[activeSlide].subtitle}
                </p>
              </div>

              {/* Grid: A Dor da Secretaria vs A Solução do App */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-5 bg-red-50/60 border border-red-100 rounded-2xl space-y-3">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-red-700">
                    <AlertTriangle className="w-4 h-4 text-red-500" />
                    <span>Como a rede sofre hoje (Sem o App)</span>
                  </div>
                  <ul className="space-y-2 text-xs text-red-900/90 leading-relaxed">
                    {slides[activeSlide].painPoints.map((pain, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="text-red-500 font-bold">•</span>
                        <span>{pain}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="p-5 bg-emerald-50/70 border border-emerald-100 rounded-2xl space-y-3">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-700">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>A Solução Implementada pelo App</span>
                  </div>
                  <ul className="space-y-2 text-xs text-emerald-950 leading-relaxed">
                    {slides[activeSlide].solutions.map((sol, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="text-emerald-600 font-bold">✓</span>
                        <span>{sol}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* O que falar ao Secretário (Script de Fala) */}
              <div className="p-5 bg-gradient-to-r from-indigo-50/80 via-blue-50/60 to-purple-50/60 border border-indigo-100 rounded-2xl space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-bold text-indigo-900 uppercase tracking-wider">
                    <Lightbulb className="w-4 h-4 text-amber-500" />
                    <span>Argumento Chave (O que falar ao Secretário)</span>
                  </div>
                  <button
                    onClick={() => copyToClipboard(slides[activeSlide].speechKey)}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-700 hover:text-indigo-900 cursor-pointer"
                  >
                    {copiedCaption ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedCaption ? 'Copiado!' : 'Copiar fala'}</span>
                  </button>
                </div>
                <p className="text-xs sm:text-sm italic text-indigo-950 font-medium leading-relaxed">
                  {slides[activeSlide].speechKey}
                </p>
              </div>

              {/* Rodapé do Slide com Ação de Demonstração Ao Vivo */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-slate-100">
                <div className="flex items-center gap-2">
                  <button
                    disabled={activeSlide === 0}
                    onClick={() => setActiveSlide((prev) => Math.max(0, prev - 1))}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-slate-700 text-xs font-bold rounded-xl transition cursor-pointer"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span>Slide Anterior</span>
                  </button>

                  <button
                    disabled={activeSlide === slides.length - 1}
                    onClick={() => setActiveSlide((prev) => Math.min(slides.length - 1, prev + 1))}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-slate-700 text-xs font-bold rounded-xl transition cursor-pointer"
                  >
                    <span>Próximo Slide</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>

                {/* Botão de Demonstração em Tempo Real */}
                <button
                  onClick={() => onNavigate(slides[activeSlide].demoAction.screen)}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-xs transition cursor-pointer"
                  title="Abrir a tela real do sistema agora para mostrar ao Secretário"
                >
                  <ExternalLink className="w-4 h-4" />
                  <span>Demonstrar na Prática: {slides[activeSlide].demoAction.label}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* ABA 2: ROTEIRO DE GRAVAÇÃO DE VÍDEO INSTITUCIONAL (COM TELEPROMPTER) */}
      {/* ========================================================================= */}
      {activeTab === 'video-script' && (
        <div className="space-y-6">
          {/* Barra de Controle de Gravação & Temporizador */}
          <div className="bg-slate-900 text-white p-5 sm:p-6 rounded-3xl border border-slate-800 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></span>
                <h3 className="text-base font-bold text-white">
                  Assistente de Gravação de Vídeo & Teleprompter
                </h3>
              </div>
              <p className="text-xs text-slate-400">
                Grave sua tela com OBS, Loom ou o gravador nativo do Windows (Win+G) / Mac enquanto acompanha o roteiro abaixo.
              </p>
            </div>

            {/* Temporizador Digital */}
            <div className="flex items-center gap-4 bg-slate-950/80 px-4 py-3 rounded-2xl border border-slate-800">
              <div className="text-right">
                <div className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Tempo de Gravação</div>
                <div className="text-2xl font-mono font-black text-amber-400 tracking-wider">
                  {formatTime(timerSeconds)}
                </div>
              </div>

              <div className="flex items-center gap-1.5 border-l border-slate-800 pl-3">
                <button
                  onClick={() => setIsTimerRunning(!isTimerRunning)}
                  className={`p-2.5 rounded-xl text-xs font-bold transition flex items-center justify-center cursor-pointer ${
                    isTimerRunning
                      ? 'bg-amber-500 hover:bg-amber-600 text-slate-950'
                      : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                  }`}
                  title={isTimerRunning ? 'Pausar Cronômetro' : 'Iniciar Gravação'}
                >
                  {isTimerRunning ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 fill-white" />}
                </button>

                <button
                  onClick={() => {
                    setIsTimerRunning(false);
                    setTimerSeconds(0);
                  }}
                  className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition cursor-pointer"
                  title="Zerar Cronômetro"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Seletor de Formato do Vídeo */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200">
            <span className="text-xs font-bold text-slate-700">Formato de Conteúdo para Gravar:</span>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setVideoFormat('institucional')}
                className={`px-3.5 py-1.5 text-xs font-bold rounded-xl transition cursor-pointer ${
                  videoFormat === 'institucional'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                Vídeo Completo (3 a 4 min) • YouTube/LinkedIn
              </button>

              <button
                onClick={() => setVideoFormat('reels')}
                className={`px-3.5 py-1.5 text-xs font-bold rounded-xl transition cursor-pointer ${
                  videoFormat === 'reels'
                    ? 'bg-rose-600 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                Vídeo Rápido (60 a 90s) • Reels / Instagram
              </button>

              <button
                onClick={() => setVideoFormat('features')}
                className={`px-3.5 py-1.5 text-xs font-bold rounded-xl transition cursor-pointer ${
                  videoFormat === 'features'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                Pílulas de Recursos (30s) • Módulos
              </button>
            </div>
          </div>

          {/* Roteiro Passo a Passo de Gravação */}
          <div className="space-y-4">
            {scriptsVideo[videoFormat].map((step, idx) => (
              <div
                key={idx}
                className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-5 sm:p-6 transition hover:border-indigo-300 space-y-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2.5">
                    <span className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-700 font-extrabold text-xs flex items-center justify-center border border-indigo-100">
                      {step.step}
                    </span>
                    <h4 className="text-sm font-bold text-slate-800">
                      Passo {step.step}: {step.scene}
                    </h4>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-50 text-amber-800 text-[11px] font-bold rounded-lg border border-amber-200">
                      <Clock className="w-3 h-3 text-amber-600" />
                      <span>{step.time}</span>
                    </span>

                    <button
                      onClick={() => copyToClipboard(step.speech, idx)}
                      className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-slate-50 rounded-lg transition"
                      title="Copiar texto da locução"
                    >
                      {copiedScriptIndex === idx ? (
                        <Check className="w-4 h-4 text-emerald-600" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  {/* Cena e Ação na Tela */}
                  <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/70 space-y-1">
                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                      <Monitor className="w-3 h-3 text-indigo-600" />
                      <span>O que mostrar na gravação:</span>
                    </div>
                    <p className="text-xs font-semibold text-slate-800">
                      {step.scene}
                    </p>
                    <div className="pt-2">
                      <button
                        onClick={() => onNavigate(step.actionTarget)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold rounded-lg transition border border-indigo-100 cursor-pointer"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>Abrir Tela Agora</span>
                      </button>
                    </div>
                  </div>

                  {/* Locução / Script para Falar ou Gravar Áudio */}
                  <div className="lg:col-span-2 p-3.5 bg-indigo-50/50 rounded-xl border border-indigo-100/70 space-y-1">
                    <div className="text-[10px] font-bold text-indigo-900 uppercase tracking-wider flex items-center gap-1">
                      <Video className="w-3 h-3 text-indigo-600" />
                      <span>Texto da Locução (O que falar no microfone):</span>
                    </div>
                    <p className="text-xs sm:text-sm text-indigo-950 font-medium leading-relaxed italic">
                      "{step.speech}"
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Dicas Profissionais de Gravação */}
          <div className="bg-gradient-to-r from-slate-50 to-indigo-50/40 p-6 rounded-3xl border border-slate-200 space-y-4">
            <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-600" />
              Checklist para um Vídeo Institucional Impecável
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-slate-600">
              <div className="p-3 bg-white rounded-xl border border-slate-200">
                <span className="font-bold text-slate-800 block mb-1">1. Resolução e Zoom</span>
                Mantenha a janela do navegador em 1080p (Full HD) com o zoom padrão em 100%. A interface já é limpa e sem poluição visual.
              </div>
              <div className="p-3 bg-white rounded-xl border border-slate-200">
                <span className="font-bold text-slate-800 block mb-1">2. Áudio e Microfone</span>
                Grave em ambiente silencioso. Um microfone de lapela simples ou o fone do celular melhora a percepção de seriedade governamental.
              </div>
              <div className="p-3 bg-white rounded-xl border border-slate-200">
                <span className="font-bold text-slate-800 block mb-1">3. Legenda & Chamada (CTA)</span>
                Nas redes sociais, adicione legendas automáticas (pelo CapCut ou Instagram) e termine convidando os gestores para testarem.
              </div>
            </div>

            {/* Sugestão Pronta de Copy para Post no Instagram/LinkedIn */}
            <div className="p-4 bg-white rounded-2xl border border-indigo-100 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-indigo-900 flex items-center gap-1.5">
                  <Share2 className="w-3.5 h-3.5 text-indigo-600" />
                  Sugestão de Legenda Pronta para o Post (Redes Sociais)
                </span>
                <button
                  onClick={() => {
                    const caption = `🚀 Chegou o futuro da gestão escolar municipal: Diário de Classe Digital!\n\nElimine 100% dos cadernos físicos de chamada, otimize o tempo dos professores e tenha a rede de ensino na palma da mão com alinhamento total à BNCC.\n\n✅ Chamada em menos de 15 segundos\n✅ Boletins bimestrais oficiais em PDF e Excel\n✅ Cantinho da Leitura integrado para fomento ao IDEB\n✅ Soberania e segurança total dos dados da Secretaria\n\nMarque aqui um Secretário(a) de Educação ou Diretor de Escola que precisa conhecer essa solução!\n\n#EducacaoPublica #GestaoMunicipal #DiariodeClasse #InovacaoPedagogica #BNCC #TecnologiaEducacional`;
                    copyToClipboard(caption);
                  }}
                  className="inline-flex items-center gap-1 text-xs font-bold text-indigo-700 hover:text-indigo-900 cursor-pointer"
                >
                  {copiedCaption ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedCaption ? 'Legenda Copiada!' : 'Copiar Legenda'}</span>
                </button>
              </div>
              <p className="text-xs text-slate-600 whitespace-pre-line leading-relaxed font-mono bg-slate-50 p-3 rounded-xl border border-slate-100">
                {`🚀 Chegou o futuro da gestão escolar municipal: Diário de Classe Digital!

Elimine 100% dos cadernos físicos de chamada, otimize o tempo dos professores e tenha a rede de ensino na palma da mão com alinhamento total à BNCC.

✅ Chamada em menos de 15 segundos
✅ Boletins bimestrais oficiais em PDF e Excel
✅ Cantinho da Leitura integrado para fomento ao IDEB
✅ Soberania e segurança total dos dados da Secretaria

Marque aqui um Secretário(a) de Educação ou Diretor de Escola que precisa conhecer essa solução!

#EducacaoPublica #GestaoMunicipal #DiariodeClasse #InovacaoPedagogica #BNCC #TecnologiaEducacional`}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* ABA 3: GUIA COMERCIAL & ARGUMENTAÇÃO POLÍTICA */}
      {/* ========================================================================= */}
      {activeTab === 'proposal-print' && (
        <div className="space-y-6">
          <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 space-y-6 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5">
              <div>
                <h3 className="text-xl font-black text-slate-900">
                  Guia de Argumentação com o Secretário(a) de Educação
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  Respostas precisas para as dúvidas e objeções mais comuns de gestores públicos municipais.
                </p>
              </div>

              <button
                onClick={handleGenerateProposalPdf}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-xs transition cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>Imprimir / Salvar em PDF</span>
              </button>
            </div>

            <div className="space-y-4">
              <div className="p-5 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-indigo-600 text-white text-[10px] font-black flex items-center justify-center">1</span>
                  "Como fica se a escola tiver internet lenta ou ficar sem sinal?"
                </h4>
                <p className="text-xs text-slate-600 leading-relaxed pl-7">
                  <strong>Resposta:</strong> A plataforma é extremamente leve (arquitetura ultra-otimizada sem scripts pesados de terceiros) e pode ser distribuída em arquivo único autocontido. O consumo de dados é mínimo e os registros salvam instantaneamente na nuvem assim que a conexão oscilante restabelece.
                </p>
              </div>

              <div className="p-5 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-indigo-600 text-white text-[10px] font-black flex items-center justify-center">2</span>
                  "Os professores mais tradicionais vão ter dificuldade de usar?"
                </h4>
                <p className="text-xs text-slate-600 leading-relaxed pl-7">
                  <strong>Resposta:</strong> Criamos o sistema seguindo uma regra de ouro: <em>Zero Poluição Visual</em>. Não há telas confusas ou dezenas de botões inúteis. Fazer chamada exige apenas tocar no 'P' ou 'F'. O plano de aula já traz as habilidades BNCC sugeridas. A taxa de aceitação é comprovadamente muito superior aos softwares tradicionais do mercado.
                </p>
              </div>

              <div className="p-5 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-indigo-600 text-white text-[10px] font-black flex items-center justify-center">3</span>
                  "E a segurança dos dados dos alunos (LGPD) e soberania municipal?"
                </h4>
                <p className="text-xs text-slate-600 leading-relaxed pl-7">
                  <strong>Resposta:</strong> A Prefeitura não fica refém de contratos fechados ou taxas abusivas por estudante. Os dados pertencem 100% à municipalidade, com regras de segurança no banco de dados e rotina de backup com exportação integral em JSON e planilhas Excel a qualquer momento.
                </p>
              </div>

              <div className="p-5 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-indigo-600 text-white text-[10px] font-black flex items-center justify-center">4</span>
                  "Como isso ajuda na nota do IDEB da nossa rede?"
                </h4>
                <p className="text-xs text-slate-600 leading-relaxed pl-7">
                  <strong>Resposta:</strong> O IDEB é composto por taxa de aprovação (rendimento escolar) e notas da Prova Brasil (fluência em Língua Portuguesa e Matemática). Com o alerta precoce de evasão e o módulo exclusivo do Cantinho da Leitura integrado à sala de aula, o município combate a reprovação e estimula a proficiência leitora desde a base.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
