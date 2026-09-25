import React, { useState, useEffect } from 'react';
import { ScreenType } from '../types';
import { getBackupRoutineStatus } from '../lib/backupService';
import {
  verificarIsAdmin,
  verificarExibirApresentacaoAdmin,
  salvarConfigExibirApresentacaoAdmin
} from '../lib/firebase';
import {
  Building2,
  Users,
  UserCheck,
  GraduationCap,
  CheckSquare,
  BookOpen,
  AlertCircle,
  Bookmark,
  Award,
  FileSpreadsheet,
  Tag,
  AlertTriangle,
  Download,
  Layers,
  BookMarked,
  ShieldAlert,
  ShieldCheck,
  Copy,
  Check,
  ExternalLink,
  HelpCircle,
  Code,
  Terminal,
  Globe,
  UploadCloud,
  Presentation,
  Video,
  Sparkles
} from 'lucide-react';

interface DashboardProps {
  onNavigate: (screen: ScreenType) => void;
}

interface MenuCardItem {
  id: ScreenType;
  title: string;
  desc: string;
  icon: React.ReactNode;
  color: string;
  badge?: string;
}

export const Dashboard: React.FC<DashboardProps> = ({ onNavigate }) => {
  const [showRulesModal, setShowRulesModal] = useState(false);
  const [showDeployGuide, setShowDeployGuide] = useState(false);
  const [copiedRules, setCopiedRules] = useState(false);
  const [copiedGitCmd, setCopiedGitCmd] = useState(false);
  const [isDownloadingZip, setIsDownloadingZip] = useState(false);
  const [isDownloadingHtml, setIsDownloadingHtml] = useState(false);
  const [routineStatus, setRoutineStatus] = useState(getBackupRoutineStatus());
  const [isAdmin, setIsAdmin] = useState(false);
  const [showPresentationButton, setShowPresentationButton] = useState(false);

  useEffect(() => {
    setRoutineStatus(getBackupRoutineStatus());
    verificarIsAdmin()
      .then((admin) => {
        setIsAdmin(admin);
        if (admin) {
          verificarExibirApresentacaoAdmin().then((show) => setShowPresentationButton(show));
        }
      })
      .catch(() => setIsAdmin(false));
  }, []);

  const handleTogglePresentation = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.checked;
    setShowPresentationButton(val);
    await salvarConfigExibirApresentacaoAdmin(val);
  };

  // Função para download direto que contorna 100% o cache do navegador
  const handleDownloadFreshFile = async (url: string, filename: string, isZip: boolean) => {
    if (isZip) setIsDownloadingZip(true);
    else setIsDownloadingHtml(true);

    try {
      const timestamp = Date.now();
      const response = await fetch(`${url}?v=${timestamp}`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache'
        }
      });
      if (!response.ok) throw new Error(`Status ${response.status}`);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => window.URL.revokeObjectURL(blobUrl), 3000);
    } catch (err) {
      console.warn('Fallback para download direto:', err);
      const link = document.createElement('a');
      link.href = `${url}?v=${Date.now()}`;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } finally {
      if (isZip) setIsDownloadingZip(false);
      else setIsDownloadingHtml(false);
    }
  };

  // Exibir download apenas em ambiente de desenvolvimento
  const isDevEnvironment =
    typeof window !== 'undefined' &&
    (window.location.hostname.includes('run.app') ||
      window.location.hostname.includes('localhost') ||
      window.location.hostname.includes('127.0.0.1'));

  const firebaseRulesJSON = `{
  "rules": {
    "diario-classe": {
      "escolas": {
        ".read": "auth != null",
        ".write": "auth != null && (root.child('diario-classe/admins/' + auth.uid).val() === true || root.child('diario-classe/admins').val() === null)",
        ".indexOn": [
          "name",
          "createdAt"
        ],
        "$schoolId": {
          ".validate": "newData.hasChildren(['name'])"
        }
      },
      "turmas": {
        ".read": "auth != null",
        ".write": "auth != null && (root.child('diario-classe/admins/' + auth.uid).val() === true || root.child('diario-classe/admins').val() === null)",
        ".indexOn": [
          "schoolId",
          "createdAt",
          "anoLetivo"
        ],
        "$turmaId": {
          ".read": "auth != null",
          ".write": "auth != null && (root.child('diario-classe/admins/' + auth.uid).val() === true || root.child('diario-classe/admins').val() === null)",
          ".validate": "newData.hasChildren(['year', 'letter', 'shift', 'schoolId', 'schoolName'])",
          "alunos": {
            ".read": "auth != null",
            ".write": "auth != null && (root.child('diario-classe/admins/' + auth.uid).val() === true || root.child('diario-classe/admins').val() === null || root.child('diario-classe/atribuicoes/' + auth.uid + '/' + $turmaId).val() === true)",
            ".indexOn": [
              "number",
              "name",
              "ra",
              "anoLetivo",
              "status"
            ],
            "$alunoId": {
              ".validate": "newData.hasChildren(['name','number','ra'])"
            }
          }
        }
      },
      "professores": {
        ".read": true,
        ".write": "auth != null && (root.child('diario-classe/admins/' + auth.uid).val() === true || root.child('diario-classe/admins').val() === null)",
        "$uid": {
          ".read": true,
          ".write": "auth != null && (root.child('diario-classe/admins/' + auth.uid).val() === true || root.child('diario-classe/admins').val() === null || auth.uid === $uid)",
          ".validate": "newData.hasChildren(['name'])"
        }
      },
      "disciplinas": {
        ".read": "auth != null",
        ".write": "auth != null && (root.child('diario-classe/admins/' + auth.uid).val() === true || root.child('diario-classe/admins').val() === null)",
        ".indexOn": [
          "name",
          "category"
        ],
        "$disciplinaId": {
          ".validate": "newData.hasChildren(['name', 'id'])"
        }
      },
      "bncc": {
        ".read": "auth != null",
        ".write": "auth != null && (root.child('diario-classe/admins/' + auth.uid).val() === true || root.child('diario-classe/admins').val() === null)",
        ".indexOn": [
          "year",
          "code"
        ],
        "$bnccId": {
          ".validate": "newData.hasChildren(['code', 'desc', 'year'])"
        }
      },
      "categorias": {
        ".read": "auth != null",
        ".write": "auth != null && (root.child('diario-classe/admins/' + auth.uid).val() === true || root.child('diario-classe/admins').val() === null)",
        ".indexOn": [
          "name"
        ],
        "$categoriaId": {
          ".validate": "newData.hasChildren(['name', 'color'])"
        }
      },
      "tipos-evento": {
        ".read": "auth != null",
        ".write": "auth != null && (root.child('diario-classe/admins/' + auth.uid).val() === true || root.child('diario-classe/admins').val() === null)",
        ".indexOn": [
          "name"
        ],
        "$tipoId": {
          ".validate": "newData.hasChildren(['name', 'color'])"
        }
      },
      "atribuicoes": {
        ".read": "auth != null",
        ".write": "auth != null && (root.child('diario-classe/admins/' + auth.uid).val() === true || root.child('diario-classe/admins').val() === null)",
        "$uid": {
          ".read": "auth != null && (root.child('diario-classe/admins/' + auth.uid).val() === true || auth.uid === $uid || root.child('diario-classe/admins').val() === null)",
          ".write": "auth != null && (root.child('diario-classe/admins/' + auth.uid).val() === true || root.child('diario-classe/admins').val() === null)"
        }
      },
      "dados": {
        ".read": "auth != null",
        "$uid": {
          ".read": "auth != null && (auth.uid === $uid || root.child('diario-classe/admins/' + auth.uid).val() === true || root.child('diario-classe/admins').val() === null)",
          ".write": "auth != null && (auth.uid === $uid || root.child('diario-classe/admins/' + auth.uid).val() === true || root.child('diario-classe/admins').val() === null)",
          "chamada": {
            ".indexOn": [
              "classId_bimester_date",
              "classId_date",
              "studentId",
              "anoLetivo"
            ],
            "$chamadaId": {
              ".validate": "newData.hasChildren(['classId', 'studentId', 'date', 'status']) && (newData.child('status').val() === 'P' || newData.child('status').val() === 'A' || newData.child('status').val() === 'F' || newData.child('status').val() === 'C' || newData.child('status').val() === 'FJ')"
            }
          },
          "notas": {
            ".indexOn": [
              "classId",
              "studentId",
              "anoLetivo",
              "bimester"
            ],
            "$notaId": {
              ".validate": "newData.hasChildren(['classId', 'studentId', 'bimester', 'value']) && newData.child('value').isNumber() && newData.child('value').val() >= 0 && newData.child('value').val() <= 10"
            }
          },
          "eventos": {
            ".indexOn": [
              "classId",
              "studentId",
              "bimester",
              "createdAt",
              "anoLetivo"
            ],
            "$eventoId": {
              ".validate": "newData.hasChildren(['classId', 'studentId', 'date', 'description'])"
            }
          },
          "planos-aula": {
            ".indexOn": [
              "classId",
              "bimester",
              "anoLetivo",
              "createdAt"
            ],
            "$planoId": {
              ".validate": "newData.hasChildren(['classId', 'bimester', 'date', 'planned'])"
            }
          },
          "bncc": {
            ".indexOn": [
              "year",
              "code"
            ],
            "$bnccId": {
              ".validate": "newData.hasChildren(['code', 'desc', 'year'])"
            }
          },
          "categorias": {
            ".indexOn": [
              "name"
            ],
            "$categoriaId": {
              ".validate": "newData.hasChildren(['name', 'color'])"
            }
          },
          "tipos-evento": {
            ".indexOn": [
              "name"
            ],
            "$tipoId": {
              ".validate": "newData.hasChildren(['name', 'color'])"
            }
          },
          "$other": {
            ".validate": false
          }
        }
      },
      "admins": {
        ".read": "auth != null",
        "$uid": {
          ".write": "auth != null && (root.child('diario-classe/admins').val() === null || root.child('diario-classe/admins/' + auth.uid).val() === true)"
        }
      },
      "bibliotecarios": {
        ".read": "auth != null",
        "$uid": {
          ".write": "auth != null && (root.child('diario-classe/admins/' + auth.uid).val() === true || root.child('diario-classe/admins').val() === null)"
        }
      },
      "biblioteca": {
        ".read": "auth != null",
        "livros": {
          ".read": "auth != null",
          ".write": "auth != null && (root.child('diario-classe/admins/' + auth.uid).val() === true || root.child('diario-classe/bibliotecarios/' + auth.uid).val() === true || root.child('diario-classe/professores/' + auth.uid + '/canManageLibrary').val() === true || root.child('diario-classe/admins').val() === null)",
          ".indexOn": ["title", "author", "isbn", "category", "createdAt"],
          "$livroId": {
            ".validate": "newData.hasChildren(['title'])"
          }
        },
        "acervos": {
          ".read": "auth != null",
          "$schoolId": {
            "$livroId": {
              ".read": "auth != null",
              ".write": "auth != null && (root.child('diario-classe/admins/' + auth.uid).val() === true || root.child('diario-classe/bibliotecarios/' + auth.uid).val() === true || root.child('diario-classe/professores/' + auth.uid + '/canManageLibrary').val() === true || root.child('diario-classe/admins').val() === null)"
            }
          }
        },
        "emprestimos": {
          ".read": "auth != null",
          ".indexOn": ["studentId", "classId", "schoolId", "bookId", "status", "dueDate", "loanDate"],
          "$emprestimoId": {
            ".write": "auth != null && (root.child('diario-classe/admins/' + auth.uid).val() === true || root.child('diario-classe/bibliotecarios/' + auth.uid).val() === true || root.child('diario-classe/professores/' + auth.uid + '/canManageLibrary').val() === true || root.child('diario-classe/admins').val() === null || root.child('diario-classe/atribuicoes/' + auth.uid + '/' + newData.child('classId').val()).val() === true || root.child('diario-classe/atribuicoes/' + auth.uid + '/' + data.child('classId').val()).val() === true)",
            ".validate": "newData.hasChildren(['bookId', 'schoolId', 'classId', 'studentId', 'loanDate', 'status'])"
          }
        },
        "reservas": {
          ".read": "auth != null",
          ".indexOn": ["bookId", "schoolId", "status", "createdAt"],
          "$reservaId": {
            ".write": "auth != null && (root.child('diario-classe/admins/' + auth.uid).val() === true || root.child('diario-classe/bibliotecarios/' + auth.uid).val() === true || root.child('diario-classe/professores/' + auth.uid + '/canManageLibrary').val() === true || root.child('diario-classe/admins').val() === null || root.child('diario-classe/atribuicoes/' + auth.uid + '/' + newData.child('classId').val()).val() === true || root.child('diario-classe/atribuicoes/' + auth.uid + '/' + data.child('classId').val()).val() === true)",
            ".validate": "newData.hasChildren(['bookId', 'schoolId', 'classId', 'studentId', 'status'])"
          }
        },
        "movimentacoes": {
          ".read": "auth != null",
          ".write": "auth != null && (root.child('diario-classe/admins/' + auth.uid).val() === true || root.child('diario-classe/bibliotecarios/' + auth.uid).val() === true || root.child('diario-classe/professores/' + auth.uid + '/canManageLibrary').val() === true || root.child('diario-classe/admins').val() === null)",
          ".indexOn": ["bookId", "sourceSchoolId", "targetSchoolId", "date"]
        },
        "cantinhos": {
          ".read": "auth != null",
          ".indexOn": ["turmaId", "schoolId", "bookId"],
          "$allocationKey": {
            ".write": "auth != null && (root.child('diario-classe/admins/' + auth.uid).val() === true || root.child('diario-classe/bibliotecarios/' + auth.uid).val() === true || root.child('diario-classe/professores/' + auth.uid + '/canManageLibrary').val() === true || root.child('diario-classe/admins').val() === null || (newData.exists() && root.child('diario-classe/atribuicoes/' + auth.uid + '/' + newData.child('turmaId').val()).val() === true) || (data.exists() && root.child('diario-classe/atribuicoes/' + auth.uid + '/' + data.child('turmaId').val()).val() === true))"
          }
        }
      }
    }
  }
}`;

  const handleCopyRules = () => {
    navigator.clipboard.writeText(firebaseRulesJSON);
    setCopiedRules(true);
    setTimeout(() => setCopiedRules(false), 2500);
  };

  const menuItems: MenuCardItem[] = [
    {
      id: 'schools-screen',
      title: 'Escolas',
      desc: 'Cadastro e gerenciamento de unidades escolares',
      icon: <Building2 className="w-8 h-8" />,
      color: 'bg-blue-50 text-blue-600 border-blue-200 hover:border-blue-400 group-hover:bg-blue-600 group-hover:text-white',
      badge: 'Admin'
    },
    {
      id: 'teachers-screen',
      title: 'Professores',
      desc: 'Cadastro de docentes, login, senha de acesso e especialidades',
      icon: <UserCheck className="w-8 h-8" />,
      color: 'bg-indigo-50 text-indigo-600 border-indigo-200 hover:border-indigo-400 group-hover:bg-indigo-600 group-hover:text-white',
      badge: 'Admin'
    },
    {
      id: 'assignments-screen',
      title: 'Atribuição de Turmas',
      desc: 'Vincular classes e turmas aos respectivos professores',
      icon: <CheckSquare className="w-8 h-8" />,
      color: 'bg-emerald-50 text-emerald-600 border-emerald-200 hover:border-emerald-400 group-hover:bg-emerald-600 group-hover:text-white',
      badge: 'Admin'
    },
    {
      id: 'classes-screen',
      title: 'Turmas',
      desc: 'Cadastro e organização de séries, turnos e unidades escolares',
      icon: <Users className="w-8 h-8" />,
      color: 'bg-amber-50 text-amber-600 border-amber-200 hover:border-amber-400 group-hover:bg-amber-600 group-hover:text-white',
      badge: 'Admin'
    },
    {
      id: 'students-screen',
      title: 'Alunos',
      desc: 'Cadastro de alunos, número de chamada, RA, data de nascimento e transferências',
      icon: <GraduationCap className="w-8 h-8" />,
      color: 'bg-orange-50 text-orange-600 border-orange-200 hover:border-orange-400 group-hover:bg-orange-600 group-hover:text-white',
      badge: 'Admin'
    },
    {
      id: 'attendance-screen',
      title: 'Chamada',
      desc: 'Registro diário de presença, faltas e justificativas',
      icon: <CheckSquare className="w-8 h-8" />,
      color: 'bg-emerald-50 text-emerald-600 border-emerald-200 hover:border-emerald-400 group-hover:bg-emerald-600 group-hover:text-white'
    },
    {
      id: 'lesson-plan-screen',
      title: 'Plano de Aula',
      desc: 'Planejamento semanal/diário integrado à BNCC',
      icon: <BookOpen className="w-8 h-8" />,
      color: 'bg-teal-50 text-teal-600 border-teal-200 hover:border-teal-400 group-hover:bg-teal-600 group-hover:text-white'
    },
    {
      id: 'events-screen',
      title: 'Ocorrências',
      desc: 'Registro disciplinar, comunicados e observações',
      icon: <AlertCircle className="w-8 h-8" />,
      color: 'bg-red-50 text-red-600 border-red-200 hover:border-red-400 group-hover:bg-red-600 group-hover:text-white'
    },
    {
      id: 'bncc-screen',
      title: 'Códigos BNCC',
      desc: 'Habilidades da Base Nacional Comum Curricular por ano',
      icon: <Bookmark className="w-8 h-8" />,
      color: 'bg-sky-50 text-sky-600 border-sky-200 hover:border-sky-400 group-hover:bg-sky-600 group-hover:text-white'
    },
    {
      id: 'grades-screen',
      title: 'Notas',
      desc: 'Lançamento bimestral de notas por disciplina dinâmica',
      icon: <Award className="w-8 h-8" />,
      color: 'bg-purple-50 text-purple-600 border-purple-200 hover:border-purple-400 group-hover:bg-purple-600 group-hover:text-white'
    },
    {
      id: 'subjects-screen',
      title: 'Disciplinas & Matérias',
      desc: 'Grade curricular flexível, criar, editar e excluir disciplinas',
      icon: <Layers className="w-8 h-8" />,
      color: 'bg-fuchsia-50 text-fuchsia-600 border-fuchsia-200 hover:border-fuchsia-400 group-hover:bg-fuchsia-600 group-hover:text-white',
      badge: 'Currículo'
    },
    {
      id: 'reports-screen',
      title: 'Relatórios',
      desc: 'Boletins, frequências, fichas individuais em PDF e XLSX',
      icon: <FileSpreadsheet className="w-8 h-8" />,
      color: 'bg-rose-50 text-rose-600 border-rose-200 hover:border-rose-400 group-hover:bg-rose-600 group-hover:text-white',
      badge: 'PDF & Excel'
    },
    {
      id: 'categories-screen',
      title: 'Categorias',
      desc: 'Classificação por tema ou atividade pedagógica com cores',
      icon: <Tag className="w-8 h-8" />,
      color: 'bg-cyan-50 text-cyan-600 border-cyan-200 hover:border-cyan-400 group-hover:bg-cyan-600 group-hover:text-white'
    },
    {
      id: 'event-types-screen',
      title: 'Tipos de Evento',
      desc: 'Categorias de ocorrências comportamentais e pedagógicas',
      icon: <AlertTriangle className="w-8 h-8" />,
      color: 'bg-orange-50 text-orange-600 border-orange-200 hover:border-orange-400 group-hover:bg-orange-600 group-hover:text-white'
    },
    {
      id: 'library-screen',
      title: 'Biblioteca Escolar',
      desc: 'Acervo de livros, controle de empréstimos, devoluções e prazos',
      icon: <BookMarked className="w-8 h-8" />,
      color: 'bg-teal-50 text-teal-700 border-teal-200 hover:border-teal-400 group-hover:bg-teal-600 group-hover:text-white',
      badge: 'Leitura'
    },
    {
      id: 'backup-screen',
      title: 'Rotina de Backup',
      desc: 'Cópia de segurança e restauração completa de dados em JSON',
      icon: <ShieldCheck className="w-8 h-8" />,
      color: 'bg-emerald-50 text-emerald-600 border-emerald-200 hover:border-emerald-400 group-hover:bg-emerald-600 group-hover:text-white',
      badge: 'Segurança'
    },
    ...(showPresentationButton
      ? [
          {
            id: 'presentation-screen' as ScreenType,
            title: 'Apresentação Municipal',
            desc: 'Pitch executivo para Secretário(a) e roteiro para gravação de vídeo institucional',
            icon: <Presentation className="w-8 h-8" />,
            color:
              'bg-indigo-50 text-indigo-700 border-indigo-200 hover:border-indigo-400 group-hover:bg-indigo-700 group-hover:text-white',
            badge: 'Admin • Pitch'
          }
        ]
      : [])
  ];

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Alerta inteligente de rotina de backup caso o último tenha expirado */}
      {routineStatus.needsBackup && (
        <div className="p-4 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-amber-500 text-white rounded-xl shadow-xs shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-xs sm:text-sm font-bold text-amber-900">
                Rotina de Cópia de Segurança Recomendada
              </h4>
              <p className="text-xs text-amber-700 mt-0.5">
                {routineStatus.lastBackupTime
                  ? `Seu último backup foi realizado há ${routineStatus.daysSinceLastBackup} dias (${routineStatus.lastBackupDateStr}).`
                  : 'Nenhum backup foi gerado recentemente neste dispositivo.'}{' '}
                Recomendamos exportar uma cópia em JSON para manter seus registros seguros.
              </p>
            </div>
          </div>
          <button
            onClick={() => onNavigate('backup-screen')}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-xl shadow-xs transition shrink-0 cursor-pointer"
          >
            Fazer Backup Agora
          </button>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-2">
        <div>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-800 tracking-tight">
            Painel de Controle
          </h2>
          <p className="text-sm text-slate-600 mt-1">
            Selecione um módulo abaixo para gerenciar turmas, registros e emitir relatórios
          </p>
        </div>

        {/* Utilitários de implantação e download: visíveis apenas no ambiente de desenvolvimento/preview da plataforma, ocultos após deploy em produção na Vercel */}
        {isDevEnvironment && (
          <div className="flex flex-wrap items-center gap-2">
            {/* Botão de Apresentação Municipal (Apenas Admin e quando o checkbox estiver ativo) */}
            {isAdmin && showPresentationButton && (
              <button
                id="btn-open-pitch-screen"
                onClick={() => onNavigate('presentation-screen')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-xs transition cursor-pointer"
                title="Acessar Apresentação Institucional e Roteiro de Vídeo"
              >
                <Presentation className="w-4 h-4 text-amber-300" />
                <span>Apresentação / Pitch</span>
              </button>
            )}

            {/* Checkbox discreto para Professor ADMIN: ativa/desativa botão na interface sem poluição visual */}
            {isAdmin && (
              <label
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200/80 rounded-xl text-[11px] font-semibold text-slate-600 cursor-pointer transition select-none border border-slate-200"
                title="Exibir ou ocultar o botão de Apresentação Municipal na interface principal sem gerar poluição visual"
              >
                <input
                  type="checkbox"
                  checked={showPresentationButton}
                  onChange={handleTogglePresentation}
                  className="w-3.5 h-3.5 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer"
                />
                <span>Atalho Apresentação</span>
              </label>
            )}

            {/* Botão de Rotina de Backup */}
            <button
              id="btn-open-backup-screen"
              onClick={() => onNavigate('backup-screen')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-xs font-bold rounded-xl shadow-xs transition cursor-pointer"
              title="Acessar Rotina de Backup e Restauração"
            >
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>Backup dos Dados</span>
            </button>
            {/* Botão de Guia GitHub & Vercel */}
            <button
              id="btn-open-deploy-guide"
              onClick={() => setShowDeployGuide(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 text-xs font-bold rounded-xl shadow-xs transition"
              title="Guia passo a passo para GitHub e Vercel"
            >
              <ExternalLink className="w-4 h-4 text-indigo-600" />
              <span>Guia GitHub & Vercel</span>
            </button>

            {/* Botão de Regras do Firebase */}
            <button
              id="btn-open-rules-modal"
              onClick={() => setShowRulesModal(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-xs font-bold rounded-xl shadow-xs transition"
              title="Visualizar e copiar as regras do Firebase Realtime Database"
            >
              <ShieldAlert className="w-4 h-4 text-amber-600" />
              <span>Regras do Firebase</span>
            </button>

            <button
              id="btn-download-singlefile-html"
              onClick={() => handleDownloadFreshFile('/app-unico.html', 'app-unico.html', false)}
              disabled={isDownloadingHtml}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-xs transition cursor-pointer"
              title="Baixar aplicativo autocontido em arquivo HTML único (Versão mais recente)"
            >
              {isDownloadingHtml ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>Baixando HTML...</span>
                </>
              ) : (
                <>
                  <Code className="w-4 h-4" />
                  <span>Arquivo Único (.HTML)</span>
                </>
              )}
            </button>

            <button
              id="btn-download-project-zip"
              onClick={() => handleDownloadFreshFile('/diario-de-classe.zip', 'diario-de-classe.zip', true)}
              disabled={isDownloadingZip}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-xs transition cursor-pointer"
              title="Exportar código-fonte completo mais recente para GitHub / Vercel"
            >
              {isDownloadingZip ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>Baixando ZIP...</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span>Projeto Completo (.ZIP)</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
        {menuItems.map((item) => (
          <button
            id={`menu-card-${item.id}`}
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className="group relative flex flex-col items-start p-6 bg-white rounded-2xl border border-slate-200/80 hover:border-indigo-500 shadow-2xs hover:shadow-xl hover:-translate-y-1 transition-all duration-200 text-left cursor-pointer"
          >
            {item.badge && (
              <span className="absolute top-4 right-4 text-[10px] uppercase tracking-wider font-extrabold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                {item.badge}
              </span>
            )}
            <div
              className={`p-3 rounded-2xl border mb-4 transition-all duration-200 ${item.color}`}
            >
              {item.icon}
            </div>
            <h3 className="text-base font-bold text-slate-800 group-hover:text-indigo-600 transition-colors mb-1">
              {item.title}
            </h3>
            <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">
              {item.desc}
            </p>
          </button>
        ))}
      </div>

      {/* Modal de Regras de Segurança do Firebase Console */}
      {showRulesModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-2xl w-full p-6 shadow-2xl border border-slate-100 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-amber-100 text-amber-700 rounded-xl">
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-800">Regras do Firebase Realtime Database</h3>
                  <p className="text-xs text-slate-500">
                    Copie e publique estas regras no seu Firebase Console (Aba Regras)
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowRulesModal(false)}
                className="text-slate-400 hover:text-slate-600 text-xl leading-none"
              >
                ✕
              </button>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 mb-3 text-xs text-slate-600 space-y-1.5">
              <p className="font-semibold text-slate-800 flex items-center gap-1.5">
                <HelpCircle className="w-4 h-4 text-indigo-600" />
                Como aplicar no Firebase Console:
              </p>
              <ol className="list-decimal list-inside space-y-0.5 text-[11px] text-slate-600 pl-1">
                <li>Acesse o Firebase Console e abra seu projeto.</li>
                <li>Vá em <strong>Realtime Database</strong> &gt; aba <strong>Regras</strong> (Rules).</li>
                <li>Substitua todo o conteúdo pelo JSON abaixo e clique em <strong>Publicar</strong> (Publish).</li>
              </ol>
            </div>

            <div className="relative flex-1 min-h-0 bg-slate-950 rounded-2xl p-4 overflow-hidden border border-slate-800">
              <button
                id="btn-copy-rules-json"
                onClick={handleCopyRules}
                className="absolute top-3 right-3 z-10 flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold shadow-sm transition"
              >
                {copiedRules ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedRules ? 'Copiado!' : 'Copiar Regras'}</span>
              </button>

              <pre className="text-[11px] font-mono text-emerald-400 h-full overflow-y-auto pr-2 scrollbar-thin">
                {firebaseRulesJSON}
              </pre>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100 mt-3">
              <button
                onClick={() => setShowRulesModal(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-sm font-semibold transition"
              >
                Fechar
              </button>
              <button
                onClick={handleCopyRules}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold shadow-xs transition flex items-center gap-1.5"
              >
                {copiedRules ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                <span>{copiedRules ? 'Regras Copiadas!' : 'Copiar JSON'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Guia Passo a Passo GitHub & Vercel */}
      {showDeployGuide && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-3xl w-full p-6 shadow-2xl border border-slate-100 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-indigo-100 text-indigo-700 rounded-xl">
                  <Globe className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-800">Fluxo de Publicação (GitHub + Vercel)</h3>
                  <p className="text-xs text-slate-500">
                    Como hospedar seu Diário de Classe gratuitamente com domínio próprio ou .vercel.app
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowDeployGuide(false)}
                className="text-slate-400 hover:text-slate-600 text-xl leading-none"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 overflow-y-auto pr-2 scrollbar-thin text-xs text-slate-700 flex-1 min-h-0">
              {/* Opção 1: Vercel com GitHub */}
              <div className="p-4 bg-indigo-50/70 border border-indigo-100 rounded-2xl">
                <h4 className="font-bold text-sm text-indigo-900 flex items-center gap-2 mb-2">
                  <UploadCloud className="w-4 h-4 text-indigo-600" />
                  Método 1: Deploy Completo na Vercel (Recomendado)
                </h4>
                <div className="space-y-2">
                  <p className="text-slate-600">
                    1. Baixe o <strong>Projeto Completo (.ZIP)</strong> pelo botão no topo do painel e descompacte a pasta no seu computador.
                  </p>
                  <p className="text-slate-600">
                    2. Crie um novo repositório no seu <a href="https://github.com/new" target="_blank" rel="noreferrer" className="text-indigo-600 font-semibold underline">GitHub</a>.
                  </p>
                  <p className="text-slate-600">
                    3. Abra o terminal na pasta descompactada e envie os arquivos para o GitHub:
                  </p>

                  <div className="relative bg-slate-900 text-emerald-400 p-3 rounded-xl font-mono text-[11px]">
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(`git init\ngit add .\ngit commit -m "feat: diario de classe digital"\ngit branch -M main\ngit remote add origin https://github.com/SEU_USUARIO/SEU_REPOSITORIO.git\ngit push -u origin main`);
                        setCopiedGitCmd(true);
                        setTimeout(() => setCopiedGitCmd(false), 2500);
                      }}
                      className="absolute top-2 right-2 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-white rounded text-[10px] flex items-center gap-1"
                    >
                      {copiedGitCmd ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedGitCmd ? 'Copiado!' : 'Copiar'}</span>
                    </button>
                    <code>
                      git init<br />
                      git add .<br />
                      git commit -m "feat: diario de classe digital"<br />
                      git branch -M main<br />
                      git remote add origin https://github.com/SEU_USUARIO/SEU_REPOSITORIO.git<br />
                      git push -u origin main
                    </code>
                  </div>

                  <p className="text-slate-600 pt-1">
                    4. Acesse <a href="https://vercel.com" target="_blank" rel="noreferrer" className="text-indigo-600 font-semibold underline">Vercel.com</a>, clique em <strong>"Add New..." &gt; "Project"</strong> e importe seu repositório.
                  </p>
                  <p className="text-slate-600">
                    5. A Vercel detecta o framework <strong>Vite</strong> automaticamente e publica as funções da pasta <code>api/</code> (leitura de capas por IA e busca por ISBN).
                  </p>
                  <p className="text-slate-600">
                    6. Antes de clicar em <strong>"Deploy"</strong>, abra <strong>Environment Variables</strong> e crie <code>GEMINI_API_KEY</code> com a sua chave do Google AI Studio. Sem ela, a leitura de capa/contracapa por IA não funciona. Depois, confira em <code>/api/health</code>.
                  </p>
                </div>
              </div>

              {/* Opção 2: Arquivo Único */}
              <div className="p-4 bg-emerald-50/70 border border-emerald-100 rounded-2xl">
                <h4 className="font-bold text-sm text-emerald-900 flex items-center gap-2 mb-2">
                  <Code className="w-4 h-4 text-emerald-600" />
                  Método 2: Arquivo Único Autocontido (`app-unico.html`)
                </h4>
                <p className="text-slate-600 leading-relaxed mb-2">
                  Se preferir não usar servidor Node.js ou gerenciador de pacotes, baixe o <strong>Arquivo Único (.HTML)</strong>:
                </p>
                <ul className="list-disc list-inside space-y-1 text-slate-600 pl-1">
                  <li>Contém todo o HTML, CSS (Tailwind) e JavaScript empacotados em um único arquivo de ~2MB.</li>
                  <li>Pode ser aberto diretamente no Google Chrome / Edge com duplo clique ou enviado para GitHub Pages / Cloudflare Pages como `index.html`.</li>
                </ul>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100 mt-3">
              <button
                onClick={() => setShowDeployGuide(false)}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition shadow-xs"
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
