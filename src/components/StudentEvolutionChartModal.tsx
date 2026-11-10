import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ClassRoom, Student, SubjectItem } from '../types';
import { get, ref, rtdb, dc, getCurrentAuthUid } from '../lib/firebase';
import {
  X,
  TrendingUp,
  TrendingDown,
  Minus,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  FileSpreadsheet,
  Sparkles,
  Info,
  Award,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  BookOpen,
  Search,
  Users,
  CalendarDays,
  Layers,
  ArrowUpDown,
  Palette,
  Eye,
  Check,
  Printer
} from 'lucide-react';
import {
  generateStudentEvolutionReport,
  generateStudentEvolutionReportXLSX,
  generateClassFullTrajectoriesReportPDF,
  generateClassTrajectoryXLSX,
  downloadClassChartPNG,
  printClassChartDocument,
  generateClassChartSinglePagePDF
} from '../lib/reports';

interface StudentEvolutionChartModalProps {
  isOpen: boolean;
  onClose: () => void;
  classId: string;
  turma: ClassRoom | null;
  initialStudentId?: string | null;
  initialTab?: 'coletivo' | 'panorama' | 'curva' | 'disciplinas' | 'frequencia';
  initialSubject?: string;
  currentYear: string;
  teacherName: string;
  studentsList?: Student[];
  subjectsList?: SubjectItem[];
}

interface BimesterData {
  bimester: number;
  label: string;
  studentGrade: number | null;
  classAverage: number | null;
  attendanceRate: number | null;
  totalPresences: number;
  totalAbsences: number;
}

interface StudentTrajectoryRow {
  student: Student;
  grades: (number | null)[];
  annualAverage: number | null;
  trend: 'Evolutivo' | 'Em Queda' | 'Estável' | 'Sem dados';
  diff: number;
  presences: number;
  absences: number;
  attendanceRate: number | null;
}

// Color palette for individual students in collective mode
const STUDENT_PALETTE = [
  '#2563eb', // blue
  '#059669', // emerald
  '#7c3aed', // violet
  '#ea580c', // orange
  '#0891b2', // cyan
  '#e11d48', // rose
  '#d97706', // amber
  '#4f46e5', // indigo
  '#16a34a', // green
  '#9333ea', // purple
  '#c026d3', // fuchsia
  '#0284c7', // light blue
  '#ca8a04', // golden yellow
  '#475569', // slate
  '#be185d', // dark pink
  '#6d28d9', // deep violet
  '#0e7490', // deep cyan
  '#b91c1c', // dark red
  '#1e40af', // dark blue
  '#15803d', // dark green
];

// Mini Sparkline Component for Table Row
const Sparkline: React.FC<{ grades: (number | null)[]; trend: string }> = ({ grades, trend }) => {
  const valid = grades
    .map((g, i) => ({ val: g, idx: i }))
    .filter((p): p is { val: number; idx: number } => p.val !== null);

  if (valid.length < 2) {
    return <span className="text-[10px] text-slate-300 font-mono">--</span>;
  }

  const w = 48;
  const h = 18;
  const padding = 2.5;
  const innerW = w - padding * 2;
  const innerH = h - padding * 2;

  const points = valid.map((p) => {
    const x = padding + (p.idx / 3) * innerW;
    const clamped = Math.max(0, Math.min(10, p.val));
    const y = padding + innerH - (clamped / 10) * innerH;
    return { x, y, val: p.val };
  });

  const pathD = points.reduce((acc, pt, i) => {
    return i === 0 ? `M ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}` : `${acc} L ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
  }, '');

  const strokeColor =
    trend === 'Evolutivo' ? '#10b981' : trend === 'Em Queda' ? '#ef4444' : '#6366f1';

  const lastPt = points[points.length - 1];

  return (
    <svg width={w} height={h} className="inline-block overflow-visible">
      <path
        d={pathD}
        fill="none"
        stroke={strokeColor}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={lastPt.x} cy={lastPt.y} r="2.5" fill={strokeColor} />
    </svg>
  );
};

interface StudentEvolutionRowCardProps {
  row: StudentTrajectoryRow;
  turmaNome?: string;
  currentYear: string;
  overallAverage: number | null;
  bAverages: (number | null)[];
  selectedSubjectName: string;
  onOpenDetail: () => void;
  index: number;
}

const StudentEvolutionRowCard: React.FC<StudentEvolutionRowCardProps> = ({
  row,
  turmaNome,
  currentYear,
  overallAverage,
  bAverages,
  selectedSubjectName,
  onOpenDetail,
  index
}) => {
  const cardSvgRef = useRef<SVGSVGElement | null>(null);
  const [downloading, setDownloading] = useState(false);

  const handleExportCardPNG = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!cardSvgRef.current) return;
    try {
      setDownloading(true);
      const svgElement = cardSvgRef.current;
      const svgString = new XMLSerializer().serializeToString(svgElement);
      const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const blobURL = window.URL.createObjectURL(svgBlob);

      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement('canvas');
        const scale = 2;
        canvas.width = (svgElement.clientWidth || 540) * scale;
        canvas.height = (svgElement.clientHeight || 145) * scale;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          setDownloading(false);
          return;
        }

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

        const pngURL = canvas.toDataURL('image/png');
        const downloadLink = document.createElement('a');
        const cleanName = (row.student.name || 'aluno').replace(/\s+/g, '_');
        downloadLink.download = `grafico_evolucao_${cleanName}_${currentYear}.png`;
        downloadLink.href = pngURL;
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
        window.URL.revokeObjectURL(blobURL);
        setDownloading(false);
      };
      image.onerror = () => {
        setDownloading(false);
      };
      image.src = blobURL;
    } catch (err) {
      console.error('Erro ao exportar PNG do aluno:', err);
      setDownloading(false);
    }
  };

  // Coordinates mapping
  const getX = (b: number) => 58 + (b - 1) * 141; // 1: 58, 2: 199, 3: 340, 4: 481
  const getY = (val: number) => 22 + (10 - Math.max(0, Math.min(10, val))) * 9.5; // 10->22, 0->117

  // Student valid points
  const validPoints = row.grades
    .map((g, i) => (g !== null ? { b: i + 1, g, x: getX(i + 1), y: getY(g) } : null))
    .filter((p): p is { b: number; g: number; x: number; y: number } => p !== null);

  const studentLineD =
    validPoints.length >= 2
      ? validPoints.reduce((acc, pt, i) => (i === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`), '')
      : '';

  const studentAreaD =
    validPoints.length >= 2
      ? `${studentLineD} L ${validPoints[validPoints.length - 1].x} 117 L ${validPoints[0].x} 117 Z`
      : '';

  // Class average line points
  const classPoints = [1, 2, 3, 4]
    .map((b) => {
      const avg = bAverages[b - 1];
      return avg !== null ? { b, avg, x: getX(b), y: getY(avg) } : null;
    })
    .filter((p): p is { b: number; avg: number; x: number; y: number } => p !== null);

  const classLineD =
    classPoints.length >= 2
      ? classPoints.reduce((acc, pt, i) => (i === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`), '')
      : '';

  // Trend color
  const strokeColor =
    row.trend === 'Evolutivo'
      ? '#10b981'
      : row.trend === 'Em Queda'
      ? '#ef4444'
      : row.trend === 'Estável'
      ? '#6366f1'
      : '#64748b';

  const gradientId = `grad-${row.student.id || index}`;

  return (
    <div className="student-evolution-row-card bg-white rounded-2xl border border-slate-200 hover:border-indigo-300 hover:shadow-md transition-all p-3.5 sm:p-4 flex flex-col lg:flex-row items-stretch gap-4">
      {/* LEFT COLUMN: ALUNO COM SEUS DADOS */}
      <div className="w-full lg:w-[380px] shrink-0 flex flex-col justify-between border-b lg:border-b-0 lg:border-r border-slate-100 pb-3 lg:pb-0 lg:pr-4">
        {/* Top: Student call number, avatar, name, RA and trend badge */}
        <div>
          <div className="flex items-start gap-2.5">
            <span className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-indigo-600 text-white font-black text-xs sm:text-sm flex items-center justify-center shrink-0 shadow-xs">
              #{row.student.number || '-'}
            </span>
            <div className="flex-1 min-w-0">
              <h4 className="font-bold text-slate-900 text-sm sm:text-base leading-tight truncate" title={row.student.name}>
                {row.student.name}
              </h4>
              <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-slate-400 font-mono">
                {row.student.ra ? <span>RA: {row.student.ra}</span> : <span>Matrícula ativa</span>}
                <span>•</span>
                <span>{turmaNome || 'Turma'}</span>
              </div>
            </div>
            {/* Trend badge */}
            <span
              className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-lg shrink-0 ${
                row.trend === 'Evolutivo'
                  ? 'bg-emerald-100 text-emerald-800'
                  : row.trend === 'Em Queda'
                  ? 'bg-rose-100 text-rose-800'
                  : row.trend === 'Estável'
                  ? 'bg-blue-100 text-blue-800'
                  : 'bg-slate-100 text-slate-500'
              }`}
            >
              {row.trend === 'Evolutivo' && '↗️'}
              {row.trend === 'Em Queda' && '↘️'}
              {row.trend === 'Estável' && '➡️'}
              <span>{row.trend}</span>
              {row.diff !== 0 && (
                <span className="text-[10px] opacity-80">
                  ({row.diff > 0 ? `+${row.diff}` : row.diff})
                </span>
              )}
            </span>
          </div>

          {/* 4 BIMESTERS GRADES TILES */}
          <div className="grid grid-cols-4 gap-1.5 my-2.5 sm:my-3">
            {[0, 1, 2, 3].map((bIdx) => {
              const g = row.grades[bIdx];
              const isGood = g !== null && g >= 6.0;
              const isWarning = g !== null && g >= 5.0 && g < 6.0;
              return (
                <div
                  key={bIdx}
                  className={`p-1.5 sm:p-2 rounded-xl text-center border ${
                    g === null
                      ? 'bg-slate-50/70 border-slate-200/60'
                      : isGood
                      ? 'bg-emerald-50/80 border-emerald-200'
                      : isWarning
                      ? 'bg-amber-50/80 border-amber-200'
                      : 'bg-rose-50/80 border-rose-200'
                  }`}
                >
                  <span className="text-[10px] font-semibold text-slate-500 block">
                    {bIdx + 1}º Bim
                  </span>
                  <span
                    className={`text-xs sm:text-sm font-black block mt-0.5 ${
                      g === null
                        ? 'text-slate-300'
                        : isGood
                        ? 'text-emerald-700'
                        : isWarning
                        ? 'text-amber-700'
                        : 'text-rose-700'
                    }`}
                  >
                    {g !== null ? g.toFixed(1) : '-'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* BOTTOM METRICS STRIP */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs gap-2">
          {/* Annual Average */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 font-medium text-[11px]">Média:</span>
            <span
              className={`px-2 py-0.5 rounded-lg font-black text-xs ${
                row.annualAverage === null
                  ? 'bg-slate-100 text-slate-400'
                  : row.annualAverage >= 6.0
                  ? 'bg-emerald-100 text-emerald-800'
                  : row.annualAverage >= 5.0
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-rose-100 text-rose-800'
              }`}
            >
              {row.annualAverage !== null ? row.annualAverage.toFixed(1) : '-'}
            </span>
          </div>

          {/* Attendance */}
          <div className="flex items-center gap-1 text-[11px] text-slate-500">
            <CalendarDays className="w-3.5 h-3.5 text-slate-400" />
            <span>Freq:</span>
            <span
              className={`font-bold ${
                row.attendanceRate === null || row.attendanceRate >= 75
                  ? 'text-slate-700'
                  : 'text-rose-600'
              }`}
            >
              {row.attendanceRate !== null ? `${row.attendanceRate.toFixed(0)}%` : '-'}
            </span>
            {row.absences > 0 && (
              <span className="text-slate-400 text-[10px]">({row.absences}f)</span>
            )}
          </div>

          {/* Button to open full diagnostic */}
          <button
            type="button"
            onClick={onOpenDetail}
            className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 hover:underline cursor-pointer flex items-center gap-0.5"
            title="Abrir ficha individual detalhada"
          >
            <span>Ficha</span>
            <ChevronRight className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* RIGHT COLUMN: A LINHA DO GRÁFICO À FRENTE DO ALUNO */}
      <div className="flex-1 min-w-0 flex flex-col justify-between bg-slate-50/70 rounded-xl p-3 border border-slate-200/80">
        {/* Top Header of Chart */}
        <div className="flex items-center justify-between text-[11px] pb-1.5 mb-1 border-b border-slate-200/60 flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <span className="font-bold text-slate-700 flex items-center gap-1">
              <TrendingUp className="w-3.5 h-3.5 text-indigo-600" />
              <span>Curva de Rendimento Escolar</span>
            </span>
            <span className="flex items-center gap-1 text-slate-500 font-medium">
              <span className="w-3 h-0.5 border-b-2 border-dashed border-slate-400 inline-block" />
              <span>Média Turma ({overallAverage?.toFixed(1) || '-'})</span>
            </span>
            <span className="flex items-center gap-1 text-amber-600 font-medium">
              <span className="w-3 h-0.5 border-b-2 border-dotted border-amber-400 inline-block" />
              <span>Corte (5.0)</span>
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-[10px] text-slate-400 font-medium truncate max-w-[170px]">
              {selectedSubjectName}
            </div>
            <button
              type="button"
              onClick={handleExportCardPNG}
              disabled={downloading}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-700 text-slate-600 transition-colors cursor-pointer text-[11px] font-bold shadow-2xs shrink-0 no-print"
              title={`Salvar gráfico de ${row.student.name} em imagem PNG`}
            >
              <Download className="w-3.5 h-3.5 text-indigo-600" />
              <span>{downloading ? 'Salvando...' : 'Salvar PNG'}</span>
            </button>
          </div>
        </div>

        {/* SVG Chart */}
        <div className="w-full overflow-x-auto">
          <svg
            ref={cardSvgRef}
            viewBox="0 0 540 145"
            className="w-full h-[140px] min-w-[340px]"
            style={{ userSelect: 'none' }}
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={strokeColor} stopOpacity="0.22" />
                <stop offset="100%" stopColor={strokeColor} stopOpacity="0.0" />
              </linearGradient>
            </defs>

            {/* Horizontal Grid lines */}
            {[0, 2.5, 5.0, 7.5, 10.0].map((val) => {
              const y = getY(val);
              return (
                <g key={val}>
                  <line
                    x1="45"
                    y1={y}
                    x2="520"
                    y2={y}
                    stroke="#f1f5f9"
                    strokeWidth="1"
                  />
                  <text
                    x="40"
                    y={y + 3.5}
                    textAnchor="end"
                    fontSize="9"
                    fill="#94a3b8"
                    fontWeight="600"
                  >
                    {val.toFixed(1)}
                  </text>
                </g>
              );
            })}

            {/* Reference Line at 5.0 (Passing Grade) */}
            <line
              x1="45"
              y1={getY(5.0)}
              x2="520"
              y2={getY(5.0)}
              stroke="#f59e0b"
              strokeWidth="1.2"
              strokeDasharray="4 4"
              opacity="0.8"
            />
            <text
              x="518"
              y={getY(5.0) - 4}
              textAnchor="end"
              fontSize="8.5"
              fill="#d97706"
              fontWeight="bold"
            >
              Corte 5.0
            </text>

            {/* Vertical Bimester Ticks */}
            {[1, 2, 3, 4].map((b) => {
              const x = getX(b);
              return (
                <g key={b}>
                  <line
                    x1={x}
                    y1="22"
                    x2={x}
                    y2="117"
                    stroke="#f1f5f9"
                    strokeWidth="1"
                  />
                  <text
                    x={x}
                    y="134"
                    textAnchor="middle"
                    fontSize="10"
                    fontWeight="bold"
                    fill="#64748b"
                  >
                    {b}º Bim
                  </text>
                </g>
              );
            })}

            {/* Class Average Dashed Line */}
            {classLineD && (
              <path
                d={classLineD}
                fill="none"
                stroke="#cbd5e1"
                strokeWidth="2"
                strokeDasharray="4 4"
              />
            )}

            {/* Class Average Points */}
            {classPoints.map((pt) => (
              <circle
                key={`class-${pt.b}`}
                cx={pt.x}
                cy={pt.y}
                r="2.5"
                fill="#94a3b8"
              />
            ))}

            {/* Area under Student Curve */}
            {studentAreaD && (
              <path d={studentAreaD} fill={`url(#${gradientId})`} />
            )}

            {/* Student Line Path */}
            {studentLineD && (
              <path
                d={studentLineD}
                fill="none"
                stroke={strokeColor}
                strokeWidth="3.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}

            {/* Student Valid Points & Callouts */}
            {validPoints.map((pt) => {
              const isAbove = pt.y > 40;
              const calloutY = isAbove ? pt.y - 19 : pt.y + 9;

              return (
                <g key={`student-${pt.b}`}>
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r="6"
                    fill="#ffffff"
                    stroke={strokeColor}
                    strokeWidth="2.5"
                  />
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r="2.8"
                    fill={strokeColor}
                  />

                  {/* Grade Callout Pill directly on the curve */}
                  <rect
                    x={pt.x - 17}
                    y={calloutY}
                    width="34"
                    height="16"
                    rx="5"
                    fill="#ffffff"
                    stroke="#cbd5e1"
                    strokeWidth="1"
                  />
                  <text
                    x={pt.x}
                    y={calloutY + 11.5}
                    textAnchor="middle"
                    fontSize="9.5"
                    fontWeight="bold"
                    fill="#0f172a"
                  >
                    {pt.g.toFixed(1)}
                  </text>
                </g>
              );
            })}

            {/* If no grades launched for student */}
            {validPoints.length === 0 && (
              <g>
                <text
                  x="280"
                  y="70"
                  textAnchor="middle"
                  fontSize="11"
                  fill="#94a3b8"
                  fontWeight="600"
                >
                  Sem avaliações lançadas para este componente no ano letivo
                </text>
              </g>
            )}
          </svg>
        </div>
      </div>
    </div>
  );
};

export const StudentEvolutionChartModal: React.FC<StudentEvolutionChartModalProps> = ({
  isOpen,
  onClose,
  classId,
  turma,
  initialStudentId,
  initialTab,
  initialSubject,
  currentYear,
  teacherName,
  studentsList,
  subjectsList
}) => {
  const [loading, setLoading] = useState(false);
  const [students, setStudents] = useState<Student[]>(() => {
    if (studentsList && studentsList.length > 0) return studentsList;
    if (turma?.alunos) {
      const list: Student[] = [];
      Object.keys(turma.alunos).forEach((k) => {
        const s = turma.alunos![k];
        if (!s.anoLetivo || !currentYear || String(s.anoLetivo).trim() === String(currentYear).trim()) {
          list.push({ id: k, ...s });
        }
      });
      list.sort((a, b) => (a.number || 0) - (b.number || 0));
      return list;
    }
    return [];
  });
  const [selectedStudentId, setSelectedStudentId] = useState<string>(initialStudentId || '');
  const [selectedSubject, setSelectedSubject] = useState<string>(initialSubject || 'todas');
  const [availableSubjects, setAvailableSubjects] = useState<SubjectItem[]>(subjectsList || []);
  const [activeTab, setActiveTab] = useState<'coletivo' | 'panorama' | 'curva' | 'disciplinas' | 'frequencia'>('coletivo');
  const [hoveredBimester, setHoveredBimester] = useState<number | null>(null);

  // Table filtering and search
  const [searchTerm, setSearchTerm] = useState('');
  const [trendFilter, setTrendFilter] = useState<'todos' | 'Evolutivo' | 'Em Queda' | 'Estável'>('todos');

  // Collective chart state
  const [collectiveSubView, setCollectiveSubView] = useState<'linha_aluno' | 'linhas' | 'ranking' | 'distribuicao'>('linha_aluno');
  const [collectiveColorMode, setCollectiveColorMode] = useState<'aluno' | 'tendencia'>('aluno');
  const [collectiveSortBy, setCollectiveSortBy] = useState<'chamada' | 'ranking' | 'nome'>('chamada');
  const [comparisonStudentIds, setComparisonStudentIds] = useState<string[]>([]);
  const [collectiveHoveredStudentId, setCollectiveHoveredStudentId] = useState<string | null>(null);
  const [collectivePinnedStudentId, setCollectivePinnedStudentId] = useState<string | null>(null);
  const [collectiveSearch, setCollectiveSearch] = useState('');
  const [collectiveTrendFilter, setCollectiveTrendFilter] = useState<'todos' | 'Evolutivo' | 'Em Queda' | 'Estável' | 'abaixo_corte'>('todos');

  // Raw data from Firebase
  const [gradesVal, setGradesVal] = useState<Record<string, any>>({});
  const [chamadaVal, setChamadaVal] = useState<Record<string, any>>({});

  const svgRef = useRef<SVGSVGElement | null>(null);
  const collectiveSvgRef = useRef<SVGSVGElement | null>(null);

  // Update initial activeTab when opened
  useEffect(() => {
    if (isOpen) {
      document.body.classList.add('evolution-modal-open');
      if (initialTab) {
        setActiveTab(initialTab);
      } else if (initialStudentId) {
        setActiveTab('panorama');
      } else {
        setActiveTab('coletivo');
      }
    } else {
      document.body.classList.remove('evolution-modal-open');
    }
    return () => {
      document.body.classList.remove('evolution-modal-open');
    };
  }, [isOpen, initialTab, initialStudentId]);

  // Synchronize comparisonStudentIds so that by default ALL students are plotted
  useEffect(() => {
    if (students.length > 0) {
      setComparisonStudentIds((prev) => {
        if (prev.length === 0) {
          return students.map((s) => s.id || '').filter(Boolean);
        }
        const valid = prev.filter((id) => students.some((s) => s.id === id));
        return valid.length > 0 ? valid : students.map((s) => s.id || '').filter(Boolean);
      });
    }
  }, [students]);

  // Synchronize studentsList prop
  useEffect(() => {
    if (studentsList && studentsList.length > 0) {
      setStudents(studentsList);
      if (!selectedStudentId || !studentsList.some((s) => s.id === selectedStudentId)) {
        if (initialStudentId && studentsList.some((s) => s.id === initialStudentId)) {
          setSelectedStudentId(initialStudentId);
        } else {
          setSelectedStudentId(studentsList[0].id || '');
        }
      }
    }
  }, [studentsList, initialStudentId]);

  // Synchronize subjectsList prop
  useEffect(() => {
    if (subjectsList && subjectsList.length > 0) {
      setAvailableSubjects(subjectsList);
    }
  }, [subjectsList]);

  // Synchronize initialSubject prop
  useEffect(() => {
    if (initialSubject) {
      setSelectedSubject(initialSubject);
    }
  }, [initialSubject]);

  // Synchronize initialStudentId prop
  useEffect(() => {
    if (initialStudentId) {
      setSelectedStudentId(initialStudentId);
    }
  }, [initialStudentId]);

  // Load students, subjects, grades and attendance
  useEffect(() => {
    if (!isOpen || !classId) return;

    let isMounted = true;
    const fetchData = async () => {
      setLoading(true);
      try {
        // 1. Alunos: buscar do nó da turma e conciliar com turma.alunos ou studentsList
        let stList: Student[] = [];
        if (studentsList && studentsList.length > 0) {
          stList = [...studentsList];
        }

        if (stList.length === 0 && turma && turma.alunos) {
          Object.keys(turma.alunos).forEach((k) => {
            const s = turma.alunos![k];
            if (!s.anoLetivo || !currentYear || String(s.anoLetivo).trim() === String(currentYear).trim()) {
              stList.push({ id: k, ...s });
            }
          });
        }

        try {
          const snapAlunos = await get(ref(rtdb, `diario-classe/turmas/${classId}/alunos`));
          if (snapAlunos.exists()) {
            const stVal = snapAlunos.val() || {};
            const fromSnap: Student[] = [];
            Object.keys(stVal).forEach((k) => {
              const s = stVal[k];
              if (!s.anoLetivo || !currentYear || String(s.anoLetivo).trim() === String(currentYear).trim()) {
                fromSnap.push({ id: k, ...s });
              }
            });
            if (fromSnap.length > 0) {
              stList = fromSnap;
            }
          }
        } catch (errAlunos) {
          console.warn('Aviso: Erro ao ler alunos do nó da turma:', errAlunos);
        }

        stList.sort((a, b) => (a.number || 0) - (b.number || 0));

        if (isMounted && stList.length > 0) {
          setStudents(stList);
          if (initialStudentId && stList.some((s) => s.id === initialStudentId)) {
            setSelectedStudentId(initialStudentId);
          } else {
            setSelectedStudentId((prev) => (prev && stList.some((s) => s.id === prev) ? prev : stList[0].id || ''));
          }
        }

        // 2. Disciplinas cadastradas no app (ler de diario-classe/disciplinas)
        let subs: SubjectItem[] = [];
        if (subjectsList && subjectsList.length > 0) {
          subs = [...subjectsList];
        }

        try {
          const snapDisc = await get(ref(rtdb, 'diario-classe/disciplinas'));
          if (snapDisc.exists()) {
            const dVal = snapDisc.val() || {};
            const fromDisc: SubjectItem[] = Object.keys(dVal).map((k) => {
              const it = dVal[k];
              return typeof it === 'object' && it !== null
                ? {
                    id: it.id || k,
                    name: it.name || k,
                    shortName: it.shortName || it.name || k,
                    category: it.category === 'diversificada' ? 'diversificada' : 'regente'
                  }
                : { id: k, name: String(it), shortName: String(it), category: 'regente' };
            });
            fromDisc.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            if (fromDisc.length > 0) {
              subs = fromDisc;
            }
          }
        } catch (errDisc) {
          console.warn('Aviso: Erro ao carregar disciplinas do banco:', errDisc);
        }

        // 3. Notas: ler via dc('notas') e agregar registros da turma
        const gData: Record<string, any> = {};
        try {
          const snapNotas = await get(ref(rtdb, dc('notas')));
          if (snapNotas.exists()) {
            Object.assign(gData, snapNotas.val() || {});
          }
        } catch (errNotas) {
          console.warn('Aviso: dc(notas) não acessível diretamente:', errNotas);
        }

        try {
          const dadosSnap = await get(ref(rtdb, 'diario-classe/dados'));
          if (dadosSnap.exists()) {
            const dVal = dadosSnap.val() || {};
            Object.keys(dVal).forEach((uKey) => {
              const uNotas = dVal[uKey]?.notas;
              if (uNotas) {
                Object.keys(uNotas).forEach((nKey) => {
                  const item = uNotas[nKey];
                  if (item && item.classId === classId) {
                    gData[nKey] = item;
                  }
                });
              }
            });
          }
        } catch {
          // Permissão restrita se não for admin
        }

        // Se turma foi criada por outro professor, tentar ler notas desse professor
        try {
          if (turma?.criadoPor && turma.criadoPor !== getCurrentAuthUid()) {
            const snapTNotas = await get(ref(rtdb, `diario-classe/dados/${turma.criadoPor}/notas`));
            if (snapTNotas.exists()) {
              const tNotas = snapTNotas.val() || {};
              Object.keys(tNotas).forEach((k) => {
                if (tNotas[k]?.classId === classId) {
                  gData[k] = tNotas[k];
                }
              });
            }
          }
        } catch {
          // Ignora se não permitido
        }

        // 4. Chamada: ler via dc('chamada') e agregar registros da turma
        const cData: Record<string, any> = {};
        try {
          const snapChamada = await get(ref(rtdb, dc('chamada')));
          if (snapChamada.exists()) {
            Object.assign(cData, snapChamada.val() || {});
          }
        } catch (errChamada) {
          console.warn('Aviso: dc(chamada) não acessível diretamente:', errChamada);
        }

        try {
          const dadosSnap = await get(ref(rtdb, 'diario-classe/dados'));
          if (dadosSnap.exists()) {
            const dVal = dadosSnap.val() || {};
            Object.keys(dVal).forEach((uKey) => {
              const uChamada = dVal[uKey]?.chamada;
              if (uChamada) {
                Object.keys(uChamada).forEach((cKey) => {
                  const item = uChamada[cKey];
                  if (item && item.classId === classId) {
                    cData[cKey] = item;
                  }
                });
              }
            });
          }
        } catch {
          // Permissão restrita se não for admin
        }

        try {
          if (turma?.criadoPor && turma.criadoPor !== getCurrentAuthUid()) {
            const snapTChamada = await get(ref(rtdb, `diario-classe/dados/${turma.criadoPor}/chamada`));
            if (snapTChamada.exists()) {
              const tChamada = snapTChamada.val() || {};
              Object.keys(tChamada).forEach((k) => {
                if (tChamada[k]?.classId === classId) {
                  cData[k] = tChamada[k];
                }
              });
            }
          }
        } catch {
          // Ignora se não permitido
        }

        // Enriquecer matérias cadastradas com disciplinas que possuam notas nesta turma
        const knownSubjectIds = new Set(subs.map((s) => s.id));
        Object.keys(gData).forEach((k) => {
          const g = gData[k];
          if (g && g.classId === classId && g.subject && g.subject !== 'todas' && !knownSubjectIds.has(g.subject)) {
            const subName = g.subjectName || g.subject;
            subs.push({
              id: g.subject,
              name: subName,
              shortName: subName.substring(0, 3).toUpperCase(),
              category: 'regente'
            });
            knownSubjectIds.add(g.subject);
          }
        });

        if (isMounted) {
          setAvailableSubjects(subs);
          setGradesVal(gData);
          setChamadaVal(cData);
        }
      } catch (err) {
        console.error('Erro ao buscar dados para trajetória do aluno:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchData();

    return () => {
      isMounted = false;
    };
  }, [isOpen, classId, initialStudentId, currentYear, studentsList, subjectsList, turma]);

  // Current student object
  const currentStudent = useMemo(() => {
    return students.find((s) => s.id === selectedStudentId) || students[0] || null;
  }, [students, selectedStudentId]);

  // Current student index in list
  const currentStudentIndex = useMemo(() => {
    return students.findIndex((s) => s.id === selectedStudentId);
  }, [students, selectedStudentId]);

  // Navigation handlers
  const handlePrevStudent = () => {
    if (students.length === 0) return;
    const prevIdx = currentStudentIndex > 0 ? currentStudentIndex - 1 : students.length - 1;
    setSelectedStudentId(students[prevIdx].id || '');
  };

  const handleNextStudent = () => {
    if (students.length === 0) return;
    const nextIdx = currentStudentIndex < students.length - 1 ? currentStudentIndex + 1 : 0;
    setSelectedStudentId(students[nextIdx].id || '');
  };

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) {
        return;
      }
      if (e.key === 'ArrowLeft') {
        handlePrevStudent();
      } else if (e.key === 'ArrowRight') {
        handleNextStudent();
      } else if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, currentStudentIndex, students]);

  // Compute trajectories for ALL students of the class (identical to report logic)
  const classStudentsTrajectory = useMemo<StudentTrajectoryRow[]>(() => {
    if (!classId || students.length === 0) return [];

    // Group grades by student and bimester
    const stGrades: Record<string, { [b: number]: { sum: number; count: number } }> = {};
    Object.keys(gradesVal).forEach((k) => {
      const g = gradesVal[k];
      if (
        g.classId === classId &&
        (!g.anoLetivo || g.anoLetivo === currentYear)
      ) {
        if (selectedSubject !== 'todas' && g.subject !== selectedSubject) {
          return;
        }
        const b = parseInt(g.bimester, 10);
        if (b >= 1 && b <= 4 && g.studentId) {
          const val = parseFloat(g.value);
          if (!isNaN(val)) {
            if (!stGrades[g.studentId]) stGrades[g.studentId] = {};
            if (!stGrades[g.studentId][b]) stGrades[g.studentId][b] = { sum: 0, count: 0 };
            stGrades[g.studentId][b].sum += val;
            stGrades[g.studentId][b].count++;
          }
        }
      }
    });

    // Group attendance by student
    const stAttendance: Record<string, { presences: number; absences: number }> = {};
    Object.keys(chamadaVal).forEach((k) => {
      const att = chamadaVal[k];
      if (
        att.classId === classId &&
        (!att.anoLetivo || att.anoLetivo === currentYear) &&
        att.studentId
      ) {
        if (!stAttendance[att.studentId]) {
          stAttendance[att.studentId] = { presences: 0, absences: 0 };
        }
        if (att.status === 'P') stAttendance[att.studentId].presences++;
        else if (att.status === 'F') stAttendance[att.studentId].absences++;
      }
    });

    return students.map((st) => {
      const grades: (number | null)[] = [null, null, null, null];
      const sG = stGrades[st.id || ''];
      for (let b = 1; b <= 4; b++) {
        if (sG && sG[b] && sG[b].count > 0) {
          grades[b - 1] = Number((sG[b].sum / sG[b].count).toFixed(1));
        }
      }

      const valid = grades.filter((g): g is number => g !== null);
      const annualAverage =
        valid.length > 0 ? Number((valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(1)) : null;

      let trend: 'Evolutivo' | 'Em Queda' | 'Estável' | 'Sem dados' = 'Sem dados';
      let diff = 0;
      if (valid.length >= 2) {
        diff = Number((valid[valid.length - 1] - valid[0]).toFixed(1));
        if (diff > 0.5) trend = 'Evolutivo';
        else if (diff < -0.5) trend = 'Em Queda';
        else trend = 'Estável';
      }

      const att = stAttendance[st.id || ''] || { presences: 0, absences: 0 };
      const totalAtt = att.presences + att.absences;
      const attendanceRate = totalAtt > 0 ? Number(((att.presences / totalAtt) * 100).toFixed(1)) : null;

      return {
        student: st,
        grades,
        annualAverage,
        trend,
        diff,
        presences: att.presences,
        absences: att.absences,
        attendanceRate
      };
    });
  }, [classId, students, gradesVal, chamadaVal, currentYear, selectedSubject]);

  // Summary counts across all students
  const classSummary = useMemo(() => {
    const total = classStudentsTrajectory.length;
    const evolutivos = classStudentsTrajectory.filter((r) => r.trend === 'Evolutivo').length;
    const quedas = classStudentsTrajectory.filter((r) => r.trend === 'Em Queda').length;
    const estaveis = classStudentsTrajectory.filter((r) => r.trend === 'Estável').length;
    const abaixoCorte = classStudentsTrajectory.filter((r) => r.annualAverage !== null && r.annualAverage < 5.0).length;

    // Average per bimester across the class
    const bAverages: (number | null)[] = [null, null, null, null];
    for (let b = 0; b < 4; b++) {
      const valid = classStudentsTrajectory
        .map((r) => r.grades[b])
        .filter((g): g is number => g !== null);
      if (valid.length > 0) {
        bAverages[b] = Number((valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(1));
      }
    }

    const allAverages = classStudentsTrajectory
      .map((r) => r.annualAverage)
      .filter((a): a is number => a !== null);
    const overallAverage =
      allAverages.length > 0
        ? Number((allAverages.reduce((a, b) => a + b, 0) / allAverages.length).toFixed(1))
        : null;

    // Find highest average student
    let highestStudent: { name: string; avg: number } | null = null;
    classStudentsTrajectory.forEach((r) => {
      if (r.annualAverage !== null) {
        if (!highestStudent || r.annualAverage > highestStudent.avg) {
          highestStudent = { name: r.student.name, avg: r.annualAverage };
        }
      }
    });

    return {
      total,
      evolutivos,
      quedas,
      estaveis,
      abaixoCorte,
      bAverages,
      overallAverage,
      highestStudent
    };
  }, [classStudentsTrajectory]);

  // Filtered students list for table search & trend filter in panorama tab
  const filteredStudentsList = useMemo(() => {
    return classStudentsTrajectory.filter((row) => {
      if (trendFilter !== 'todos' && row.trend !== trendFilter) {
        return false;
      }
      if (searchTerm.trim() !== '') {
        const term = searchTerm.toLowerCase().trim();
        const matchesName = (row.student.name || '').toLowerCase().includes(term);
        const matchesNumber = String(row.student.number || '').includes(term);
        const matchesRa = (row.student.ra || '').toLowerCase().includes(term);
        return matchesName || matchesNumber || matchesRa;
      }
      return true;
    });
  }, [classStudentsTrajectory, trendFilter, searchTerm]);

  // Filtered list for the collective chart
  const collectiveFilteredStudents = useMemo(() => {
    return classStudentsTrajectory.filter((row) => {
      if (collectiveTrendFilter === 'abaixo_corte') {
        if (row.annualAverage === null || row.annualAverage >= 5.0) return false;
      } else if (collectiveTrendFilter !== 'todos' && row.trend !== collectiveTrendFilter) {
        return false;
      }
      if (collectiveSearch.trim() !== '') {
        const term = collectiveSearch.toLowerCase().trim();
        const matchesName = (row.student.name || '').toLowerCase().includes(term);
        const matchesNumber = String(row.student.number || '').includes(term);
        return matchesName || matchesNumber;
      }
      return true;
    });
  }, [classStudentsTrajectory, collectiveTrendFilter, collectiveSearch]);

  // Color map for each student based on call number order
  const studentColorMap = useMemo(() => {
    const map = new Map<string, string>();
    students.forEach((st, idx) => {
      if (st.id) {
        map.set(st.id, STUDENT_PALETTE[idx % STUDENT_PALETTE.length]);
      }
    });
    return map;
  }, [students]);

  // Sorted list for the interactive table: Chamada (default) vs Ranking vs Nome
  const collectiveSortedStudents = useMemo(() => {
    const list = [...collectiveFilteredStudents];
    if (collectiveSortBy === 'chamada') {
      list.sort((a, b) => (a.student.number || 0) - (b.student.number || 0));
    } else if (collectiveSortBy === 'ranking') {
      list.sort((a, b) => {
        const avgA = a.annualAverage ?? -1;
        const avgB = b.annualAverage ?? -1;
        return avgB - avgA;
      });
    } else if (collectiveSortBy === 'nome') {
      list.sort((a, b) => (a.student.name || '').localeCompare(b.student.name || ''));
    }
    return list;
  }, [collectiveFilteredStudents, collectiveSortBy]);

  // Students currently plotted on the SVG multi-line chart (All students plotted initially)
  const plottedStudents = useMemo(() => {
    return collectiveFilteredStudents.filter((row) =>
      comparisonStudentIds.includes(row.student.id || '')
    );
  }, [collectiveFilteredStudents, comparisonStudentIds]);

  // Comparison action handlers
  const handleSelectAllComparison = () => {
    setComparisonStudentIds(students.map((s) => s.id || '').filter(Boolean));
  };

  const handleClearComparison = () => {
    setComparisonStudentIds([]);
  };

  const handleToggleStudentComparison = (studentId: string) => {
    setComparisonStudentIds((prev) => {
      if (prev.includes(studentId)) {
        return prev.filter((id) => id !== studentId);
      } else {
        return [...prev, studentId];
      }
    });
  };

  const handleCompareOneOnOne = (studentId: string) => {
    setComparisonStudentIds([studentId]);
    setSelectedStudentId(studentId);
    setCollectivePinnedStudentId(studentId);
  };

  // Compute 4 Bimesters data for the currently selected student
  const bimesterData: BimesterData[] = useMemo(() => {
    if (!classId) return [];

    const result: BimesterData[] = [];

    for (let b = 1; b <= 4; b++) {
      let studentSum = 0;
      let studentCount = 0;
      let classSum = 0;
      let classCount = 0;

      Object.keys(gradesVal).forEach((k) => {
        const g = gradesVal[k];
        if (
          g.classId === classId &&
          String(g.bimester) === String(b) &&
          (!g.anoLetivo || g.anoLetivo === currentYear)
        ) {
          if (selectedSubject !== 'todas' && g.subject !== selectedSubject) {
            return;
          }

          const val = parseFloat(g.value);
          if (!isNaN(val)) {
            classSum += val;
            classCount++;

            if (currentStudent && g.studentId === currentStudent.id) {
              studentSum += val;
              studentCount++;
            }
          }
        }
      });

      // Attendance for this student in this bimester
      let presences = 0;
      let absences = 0;
      if (currentStudent) {
        Object.keys(chamadaVal).forEach((k) => {
          const att = chamadaVal[k];
          if (
            att.classId === classId &&
            att.studentId === currentStudent.id &&
            (!att.anoLetivo || att.anoLetivo === currentYear) &&
            String(att.bimester) === String(b)
          ) {
            if (att.status === 'P') presences++;
            else if (att.status === 'F') absences++;
          }
        });
      }

      const totalAttendance = presences + absences;
      const attendanceRate = totalAttendance > 0 ? (presences / totalAttendance) * 100 : null;

      result.push({
        bimester: b,
        label: `${b}º Bimestre`,
        studentGrade: studentCount > 0 ? Number((studentSum / studentCount).toFixed(1)) : null,
        classAverage: classCount > 0 ? Number((classSum / classCount).toFixed(1)) : null,
        attendanceRate: attendanceRate !== null ? Number(attendanceRate.toFixed(1)) : null,
        totalPresences: presences,
        totalAbsences: absences
      });
    }

    return result;
  }, [classId, currentYear, gradesVal, chamadaVal, currentStudent, selectedSubject]);

  // Compute student trajectory stats
  const stats = useMemo(() => {
    const validGrades = bimesterData
      .map((d) => d.studentGrade)
      .filter((g): g is number => g !== null);

    if (validGrades.length === 0) {
      return {
        annualAverage: null,
        trend: 'Sem dados',
        diff: 0,
        highest: null,
        highestBim: null,
        lowest: null,
        lowestBim: null,
        diagnostic: 'Ainda não constam notas registradas para este aluno no período.'
      };
    }

    const sum = validGrades.reduce((a, b) => a + b, 0);
    const annualAverage = Number((sum / validGrades.length).toFixed(1));

    let highest = -1;
    let highestBim = 1;
    let lowest = 999;
    let lowestBim = 1;

    bimesterData.forEach((d) => {
      if (d.studentGrade !== null) {
        if (d.studentGrade > highest) {
          highest = d.studentGrade;
          highestBim = d.bimester;
        }
        if (d.studentGrade < lowest) {
          lowest = d.studentGrade;
          lowestBim = d.bimester;
        }
      }
    });

    let trend = 'Estável';
    let diff = 0;
    if (validGrades.length >= 2) {
      const first = validGrades[0];
      const last = validGrades[validGrades.length - 1];
      diff = Number((last - first).toFixed(1));
      if (diff > 0.5) trend = 'Evolutivo';
      else if (diff < -0.5) trend = 'Em Queda';
      else trend = 'Estável';
    }

    // Diagnostic text
    let diagnostic = '';
    if (trend === 'Evolutivo') {
      diagnostic = `Trajetória ascendente positiva com avanço de +${diff} pontos ao longo do ano. O aluno superou o rendimento inicial e consolidou uma evolução expressiva.`;
    } else if (trend === 'Em Queda') {
      diagnostic = `Trajetória com oscilação descendente (-${Math.abs(diff)} pontos entre o início e o último bimestre). Recomenda-se acompanhamento e reforço pedagógico nas disciplinas com maior dificuldade.`;
    } else {
      diagnostic = `Desempenho com padrão de estabilidade ao longo dos bimestres. As notas oscilaram de forma regular em torno de ${annualAverage}.`;
    }

    return {
      annualAverage,
      trend,
      diff,
      highest: highest >= 0 ? highest : null,
      highestBim: highest >= 0 ? highestBim : null,
      lowest: lowest <= 10 ? lowest : null,
      lowestBim: lowest <= 10 ? lowestBim : null,
      diagnostic
    };
  }, [bimesterData]);

  // Breakdown by subject for the selected student
  const subjectBreakdown = useMemo(() => {
    if (!currentStudent || !classId) return [];

    return availableSubjects.map((sub) => {
      const gradesByBim: (number | null)[] = [null, null, null, null];
      let sum = 0;
      let count = 0;

      for (let b = 1; b <= 4; b++) {
        let bSum = 0;
        let bCount = 0;

        Object.keys(gradesVal).forEach((k) => {
          const g = gradesVal[k];
          if (
            g.classId === classId &&
            g.studentId === currentStudent.id &&
            g.subject === sub.id &&
            String(g.bimester) === String(b) &&
            (!g.anoLetivo || g.anoLetivo === currentYear)
          ) {
            const val = parseFloat(g.value);
            if (!isNaN(val)) {
              bSum += val;
              bCount++;
            }
          }
        });

        if (bCount > 0) {
          const avg = bSum / bCount;
          gradesByBim[b - 1] = Number(avg.toFixed(1));
          sum += avg;
          count++;
        }
      }

      const overallAvg = count > 0 ? Number((sum / count).toFixed(1)) : null;

      return {
        subject: sub,
        grades: gradesByBim,
        average: overallAvg
      };
    });
  }, [currentStudent, classId, availableSubjects, gradesVal, currentYear]);

  // Export chart as PNG (Always high resolution full class chart)
  const handleExportPNG = () => {
    if (!turma) return;
    const subName =
      selectedSubject === 'todas'
        ? 'Média Geral (Todas as Matérias)'
        : availableSubjects.find((s) => s.id === selectedSubject)?.name || 'Disciplina';

    downloadClassChartPNG({
      turma,
      teacherName,
      currentYear,
      selectedSubjectName: subName,
      studentsTrajectory: collectiveSortedStudents,
      classOverallAverage: classSummary.overallAverage,
      classBimAverages: classSummary.bAverages
    });
  };

  // Export PDF Report of the whole class with Page 1 = Full Class Chart + KPIs, Pages 2+ = All student cards
  const handleExportFullClassPDF = () => {
    if (!turma) return;
    const subName =
      selectedSubject === 'todas'
        ? 'Média Geral (Todas as Matérias)'
        : availableSubjects.find((s) => s.id === selectedSubject)?.name || 'Disciplina';

    generateClassFullTrajectoriesReportPDF({
      turma,
      teacherName,
      currentYear,
      selectedSubjectName: subName,
      studentsTrajectory: collectiveSortedStudents,
      classOverallAverage: classSummary.overallAverage,
      classBimAverages: classSummary.bAverages
    });
  };

  // Direct print of the class chart (triggers print preview in clean frame + auto PDF download)
  const handlePrint = () => {
    if (!turma) return;
    const subName =
      selectedSubject === 'todas'
        ? 'Média Geral (Todas as Matérias)'
        : availableSubjects.find((s) => s.id === selectedSubject)?.name || 'Disciplina';

    printClassChartDocument({
      turma,
      teacherName,
      currentYear,
      selectedSubjectName: subName,
      studentsTrajectory: collectiveSortedStudents,
      classOverallAverage: classSummary.overallAverage,
      classBimAverages: classSummary.bAverages
    });
  };

  // Single student report
  const handleExportSingleStudentPDF = () => {
    if (!turma || !currentStudent) return;
    generateStudentEvolutionReport(
      classId,
      currentStudent.id,
      turma,
      teacherName,
      currentYear
    );
  };

  // Export PDF Report (Individual or Full Class)
  const handleExportPDF = (forSingleStudent: boolean) => {
    if (!turma) return;
    if (forSingleStudent && currentStudent) {
      handleExportSingleStudentPDF();
    } else {
      handleExportFullClassPDF();
    }
  };

  // Export XLSX with real formulas and auto-embedded chart
  const handleExportXLSX = async (forSingleStudent: boolean) => {
    if (!turma) return;

    if (forSingleStudent && currentStudent) {
      generateStudentEvolutionReportXLSX(
        classId,
        currentStudent.id,
        turma,
        currentYear,
        teacherName
      );
      return;
    }

    const subName =
      selectedSubject === 'todas'
        ? 'Média Geral (Todas as Matérias)'
        : availableSubjects.find((s) => s.id === selectedSubject)?.name || 'Disciplina';

    await generateClassTrajectoryXLSX({
      turma,
      teacherName,
      currentYear,
      selectedSubjectName: subName,
      studentsTrajectory: collectiveSortedStudents.map((cs: any) => ({
        ...cs,
        totalPresences: cs.presences ?? cs.totalPresences,
        totalAbsences: cs.absences ?? cs.totalAbsences
      })),
      classOverallAverage: classSummary.overallAverage,
      classBimAverages: classSummary.bAverages
    });
  };

  if (!isOpen) return null;

  // SVG Chart Geometry Constants (Individual Chart)
  const svgWidth = 680;
  const svgHeight = 240;
  const paddingLeft = 45;
  const paddingRight = 35;
  const paddingTop = 20;
  const paddingBottom = 40;

  const chartWidth = svgWidth - paddingLeft - paddingRight;
  const chartHeight = svgHeight - paddingTop - paddingBottom;

  const getX = (bimester: number) => {
    const step = chartWidth / 3;
    return paddingLeft + (bimester - 1) * step;
  };

  const getY = (grade: number) => {
    const clamped = Math.max(0, Math.min(10, grade));
    return paddingTop + chartHeight - (clamped / 10) * chartHeight;
  };

  // Geometry for Collective Chart (Wider & Taller for clarity)
  const cSvgWidth = 840;
  const cSvgHeight = 360;
  const cPaddingLeft = 52;
  const cPaddingRight = 50;
  const cPaddingTop = 30;
  const cPaddingBottom = 45;
  const cChartWidth = cSvgWidth - cPaddingLeft - cPaddingRight;
  const cChartHeight = cSvgHeight - cPaddingTop - cPaddingBottom;

  const getCX = (bimester: number) => {
    const step = cChartWidth / 3;
    return cPaddingLeft + (bimester - 1) * step;
  };

  const getCY = (grade: number) => {
    const clamped = Math.max(0, Math.min(10, grade));
    return cPaddingTop + cChartHeight - (clamped / 10) * cChartHeight;
  };

  // Student specific points for individual chart
  const studentValidPoints = bimesterData
    .filter((d) => d.studentGrade !== null)
    .map((d) => ({
      x: getX(d.bimester),
      y: getY(d.studentGrade!),
      bimester: d.bimester,
      grade: d.studentGrade!
    }));

  const studentLinePath = studentValidPoints.length > 0
    ? studentValidPoints.reduce((acc, pt, idx) => {
        return idx === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`;
      }, '')
    : '';

  const studentAreaPath = studentValidPoints.length > 1
    ? `${studentLinePath} L ${studentValidPoints[studentValidPoints.length - 1].x} ${paddingTop + chartHeight} L ${studentValidPoints[0].x} ${paddingTop + chartHeight} Z`
    : '';

  const classValidPoints = bimesterData
    .filter((d) => d.classAverage !== null)
    .map((d) => ({
      x: getX(d.bimester),
      y: getY(d.classAverage!),
      bimester: d.bimester,
      average: d.classAverage!
    }));

  const classLinePath = classValidPoints.length > 0
    ? classValidPoints.reduce((acc, pt, idx) => {
        return idx === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`;
      }, '')
    : '';

  // Class Average Line for Collective Chart
  const collectiveClassAveragePoints = classSummary.bAverages
    .map((avg, idx) => (avg !== null ? { x: getCX(idx + 1), y: getCY(avg), bimester: idx + 1, avg } : null))
    .filter((p): p is { x: number; y: number; bimester: number; avg: number } => p !== null);

  const collectiveClassAveragePath = collectiveClassAveragePoints.length > 0
    ? collectiveClassAveragePoints.reduce((acc, pt, idx) => {
        return idx === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`;
      }, '')
    : '';

  // Active student in collective chart (hovered or pinned)
  const activeCollectiveStudentId = collectiveHoveredStudentId || collectivePinnedStudentId;
  const activeCollectiveRow = activeCollectiveStudentId
    ? classStudentsTrajectory.find((r) => r.student.id === activeCollectiveStudentId) || null
    : null;

  return (
    <div
      id="student-evolution-modal-root"
      className="evolution-modal-overlay fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto"
    >
      <div className="evolution-modal-container bg-white rounded-2xl shadow-2xl border border-slate-200/90 w-full max-w-6xl xl:max-w-7xl my-auto overflow-hidden flex flex-col max-h-[94vh]">
        
        {/* HEADER */}
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between bg-slate-50/70 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-bold text-slate-800 text-base">
                  Evolução & Trajetória Escolar
                </h3>
                <span className="text-xs text-slate-300">·</span>
                <span className="text-xs font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md">
                  {turma?.year}º {turma?.letter} ({currentYear})
                </span>
                <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md">
                  {classStudentsTrajectory.length} alunos
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Gráfico com todos os alunos montados, aluno à esquerda com seus dados e linha de evolução à frente
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 no-print">
            <button
              type="button"
              onClick={handlePrint}
              className="p-1.5 px-3 rounded-xl border border-slate-200 hover:bg-slate-100 hover:text-indigo-600 text-slate-700 transition-colors cursor-pointer flex items-center gap-1.5 text-xs font-bold shadow-2xs"
              title="Imprimir relatório da turma com gráficos (impressora ou PDF do navegador)"
            >
              <Printer className="w-4 h-4 text-indigo-600" />
              <span>Imprimir</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors cursor-pointer"
              title="Fechar (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* CONTROLS BAR: Student Selector, Subject Filter & Navigation Tabs */}
        <div className="px-5 py-2.5 border-b border-slate-100 bg-white flex flex-wrap items-center justify-between gap-2.5 shrink-0">
          
          {/* Quick Student Selector (Visible in individual views or for fast focus) */}
          <div className="flex items-center gap-1.5 flex-1 min-w-[260px] max-w-sm">
            <button
              onClick={handlePrevStudent}
              disabled={students.length <= 1}
              className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 disabled:opacity-40 transition-colors cursor-pointer"
              title="Aluno anterior (Seta ←)"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <div className="flex-1">
              <select
                id="student-evolution-select"
                value={selectedStudentId}
                onChange={(e) => {
                  setSelectedStudentId(e.target.value);
                  if (activeTab === 'coletivo') {
                    setCollectivePinnedStudentId(e.target.value);
                  }
                }}
                className="w-full px-2.5 py-1.5 text-xs sm:text-sm font-semibold bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 cursor-pointer"
              >
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    Nº {s.number} — {s.name} {s.status === 'recebida' ? '(TR. REC)' : ''}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={handleNextStudent}
              disabled={students.length <= 1}
              className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 disabled:opacity-40 transition-colors cursor-pointer"
              title="Próximo aluno (Seta →)"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Subject Filter & Segmented Tabs */}
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={selectedSubject}
              onChange={(e) => setSelectedSubject(e.target.value)}
              className="px-2.5 py-1.5 text-xs font-semibold bg-indigo-50/70 border border-indigo-200 text-indigo-900 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 cursor-pointer"
              title="Filtrar por disciplina"
            >
              <option value="todas">⭐ Média Geral (Todas)</option>
              {availableSubjects.map((sub) => (
                <option key={sub.id} value={sub.id}>
                  📖 {sub.name}
                </option>
              ))}
            </select>

            {/* Segmented Mode Selector */}
            <div className="flex items-center p-0.5 bg-slate-100 rounded-xl text-xs font-semibold text-slate-600 flex-wrap gap-0.5">
              <button
                onClick={() => setActiveTab('coletivo')}
                className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
                  activeTab === 'coletivo'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'hover:text-slate-900'
                }`}
                title="Gráfico com todos os alunos já montado simultaneamente"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>⭐ Gráfico de Todos os Alunos</span>
              </button>

              <button
                onClick={() => setActiveTab('panorama')}
                className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
                  activeTab === 'panorama'
                    ? 'bg-white text-indigo-700 shadow-xs'
                    : 'hover:text-slate-900'
                }`}
                title="Listagem completa da turma com gráfico do aluno em foco"
              >
                <Users className="w-3.5 h-3.5" />
                <span>Listagem & Aluno em Foco</span>
              </button>

              <button
                onClick={() => setActiveTab('curva')}
                className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
                  activeTab === 'curva'
                    ? 'bg-white text-indigo-700 shadow-xs'
                    : 'hover:text-slate-900'
                }`}
                title="Modo focado no gráfico individual detalhado"
              >
                <BarChart3 className="w-3.5 h-3.5" />
                <span>Aluno Detalhado</span>
              </button>

              <button
                onClick={() => setActiveTab('disciplinas')}
                className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
                  activeTab === 'disciplinas'
                    ? 'bg-white text-indigo-700 shadow-xs'
                    : 'hover:text-slate-900'
                }`}
                title="Desempenho por componente curricular"
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>Disciplinas</span>
              </button>

              <button
                onClick={() => setActiveTab('frequencia')}
                className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
                  activeTab === 'frequencia'
                    ? 'bg-white text-indigo-700 shadow-xs'
                    : 'hover:text-slate-900'
                }`}
                title="Frequência e assiduidade nos bimestres"
              >
                <CalendarDays className="w-3.5 h-3.5" />
                <span>Frequência</span>
              </button>
            </div>
          </div>
        </div>

        {/* MODAL BODY */}
        <div className="evolution-modal-body p-4 sm:p-5 overflow-y-auto space-y-4 flex-1">
          {loading ? (
            <div className="py-20 text-center text-slate-400">
              <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm font-medium">Carregando dados da trajetória escolar...</p>
            </div>
          ) : students.length === 0 ? (
            <div className="py-16 text-center text-slate-400">
              <Info className="w-10 h-10 mx-auto text-slate-300 mb-2" />
              <p className="text-sm font-medium">Nenhum aluno cadastrado nesta turma.</p>
            </div>
          ) : (
            <>
              {/* TAB 1: ⭐ GRÁFICO DE TODOS OS ALUNOS (COLETIVO JÁ MONTADO) */}
              {activeTab === 'coletivo' && (
                <div className="space-y-4">
                  {/* CLASS SUMMARY METRICS BANNER */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
                    <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3">
                      <span className="text-[11px] font-semibold text-slate-500 block">Total de Alunos</span>
                      <div className="flex items-baseline gap-1 mt-0.5">
                        <span className="text-xl font-black text-slate-800">{classSummary.total}</span>
                        <span className="text-[10px] text-slate-400">na turma</span>
                      </div>
                    </div>

                    <div className="bg-indigo-50/70 border border-indigo-200/80 rounded-xl p-3">
                      <span className="text-[11px] font-semibold text-indigo-700 block">Média da Turma</span>
                      <div className="flex items-baseline gap-1 mt-0.5">
                        <span className="text-xl font-black text-indigo-900">
                          {classSummary.overallAverage !== null ? classSummary.overallAverage.toFixed(1) : '-'}
                        </span>
                        <span className="text-[10px] text-indigo-600">/ 10</span>
                      </div>
                    </div>

                    <div className="bg-emerald-50/70 border border-emerald-200/80 rounded-xl p-3">
                      <span className="text-[11px] font-semibold text-emerald-700 block">↗️ Evolutivos</span>
                      <div className="flex items-baseline gap-1 mt-0.5">
                        <span className="text-xl font-black text-emerald-800">{classSummary.evolutivos}</span>
                        <span className="text-[10px] text-emerald-600">
                          ({classSummary.total ? Math.round((classSummary.evolutivos / classSummary.total) * 100) : 0}%)
                        </span>
                      </div>
                    </div>

                    <div className="bg-rose-50/70 border border-rose-200/80 rounded-xl p-3">
                      <span className="text-[11px] font-semibold text-rose-700 block">↘️ Em Queda</span>
                      <div className="flex items-baseline gap-1 mt-0.5">
                        <span className="text-xl font-black text-rose-800">{classSummary.quedas}</span>
                        <span className="text-[10px] text-rose-600">
                          ({classSummary.total ? Math.round((classSummary.quedas / classSummary.total) * 100) : 0}%)
                        </span>
                      </div>
                    </div>

                    <div className="bg-blue-50/70 border border-blue-200/80 rounded-xl p-3">
                      <span className="text-[11px] font-semibold text-blue-700 block">➡️ Estáveis</span>
                      <div className="flex items-baseline gap-1 mt-0.5">
                        <span className="text-xl font-black text-blue-800">{classSummary.estaveis}</span>
                        <span className="text-[10px] text-blue-600">
                          ({classSummary.total ? Math.round((classSummary.estaveis / classSummary.total) * 100) : 0}%)
                        </span>
                      </div>
                    </div>

                    <div className="bg-amber-50/70 border border-amber-200/80 rounded-xl p-3">
                      <span className="text-[11px] font-semibold text-amber-700 block">⚠️ Abaixo de 5.0</span>
                      <div className="flex items-baseline gap-1 mt-0.5">
                        <span className="text-xl font-black text-amber-800">{classSummary.abaixoCorte}</span>
                        <span className="text-[10px] text-amber-600">alunos</span>
                      </div>
                    </div>
                  </div>

                  {/* COLLECTIVE CHART MAIN CONTAINER */}
                  <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-xs space-y-3">
                    {/* SUB-VIEW CONTROLS & COLOR SCHEME TOGGLE */}
                    <div className="flex items-center justify-between flex-wrap gap-2.5 pb-2.5 border-b border-slate-100">
                      {/* Left: View Tabs for Collective Mode */}
                      <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl text-xs font-semibold flex-wrap">
                        <button
                          type="button"
                          onClick={() => setCollectiveSubView('linha_aluno')}
                          className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
                            collectiveSubView === 'linha_aluno'
                              ? 'bg-white text-indigo-700 shadow-xs font-bold'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                          title="Aluno à esquerda com seus dados e a linha do gráfico à frente de cada um"
                        >
                          <BarChart3 className="w-3.5 h-3.5 text-indigo-600" />
                          <span>Aluno & Gráfico à Frente (Turma Toda)</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setCollectiveSubView('linhas')}
                          className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
                            collectiveSubView === 'linhas'
                              ? 'bg-white text-indigo-700 shadow-xs font-bold'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          <TrendingUp className="w-3.5 h-3.5" />
                          <span>Curvas Sobrepostas</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setCollectiveSubView('ranking')}
                          className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
                            collectiveSubView === 'ranking'
                              ? 'bg-white text-indigo-700 shadow-xs font-bold'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          <Award className="w-3.5 h-3.5" />
                          <span>Ranking & Barras</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setCollectiveSubView('distribuicao')}
                          className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
                            collectiveSubView === 'distribuicao'
                              ? 'bg-white text-indigo-700 shadow-xs font-bold'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          <Layers className="w-3.5 h-3.5" />
                          <span>Comparativo Bimestral</span>
                        </button>
                      </div>

                      {/* Right: Color Scheme & Filter Pills */}
                      <div className="flex items-center gap-2 flex-wrap">
                        {collectiveSubView === 'linhas' && (
                          <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-xl p-1 text-xs font-semibold">
                            <span className="text-[11px] text-slate-400 px-1.5">Cores:</span>
                            <button
                              type="button"
                              onClick={() => setCollectiveColorMode('tendencia')}
                              className={`px-2 py-0.5 rounded-md transition-colors cursor-pointer ${
                                collectiveColorMode === 'tendencia'
                                  ? 'bg-indigo-600 text-white'
                                  : 'text-slate-600 hover:text-slate-900'
                              }`}
                            >
                              Por Tendência
                            </button>
                            <button
                              type="button"
                              onClick={() => setCollectiveColorMode('aluno')}
                              className={`px-2 py-0.5 rounded-md transition-colors cursor-pointer ${
                                collectiveColorMode === 'aluno'
                                  ? 'bg-indigo-600 text-white'
                                  : 'text-slate-600 hover:text-slate-900'
                              }`}
                            >
                              Multicor
                            </button>
                          </div>
                        )}

                        {/* Search in Collective View */}
                        <div className="relative">
                          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                          <input
                            type="text"
                            value={collectiveSearch}
                            onChange={(e) => setCollectiveSearch(e.target.value)}
                            placeholder="Buscar aluno na turma..."
                            className="pl-8 pr-3 py-1 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500 w-44"
                          />
                        </div>
                      </div>
                    </div>

                    {/* FILTER CHIPS ROW & SORTING */}
                    <div className="flex items-center justify-between flex-wrap gap-2 text-xs">
                      {/* Left: Trend Filter Chips */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[11px] text-slate-400 font-medium">Filtrar:</span>
                        <button
                          type="button"
                          onClick={() => setCollectiveTrendFilter('todos')}
                          className={`px-2.5 py-1 rounded-lg font-semibold transition-colors cursor-pointer ${
                            collectiveTrendFilter === 'todos'
                              ? 'bg-indigo-600 text-white'
                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                          }`}
                        >
                          Todos ({classStudentsTrajectory.length})
                        </button>
                        <button
                          type="button"
                          onClick={() => setCollectiveTrendFilter('Evolutivo')}
                          className={`px-2.5 py-1 rounded-lg font-semibold transition-colors cursor-pointer ${
                            collectiveTrendFilter === 'Evolutivo'
                              ? 'bg-emerald-600 text-white'
                              : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                          }`}
                        >
                          ↗️ Evolutivos ({classSummary.evolutivos})
                        </button>
                        <button
                          type="button"
                          onClick={() => setCollectiveTrendFilter('Em Queda')}
                          className={`px-2.5 py-1 rounded-lg font-semibold transition-colors cursor-pointer ${
                            collectiveTrendFilter === 'Em Queda'
                              ? 'bg-rose-600 text-white'
                              : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
                          }`}
                        >
                          ↘️ Em Queda ({classSummary.quedas})
                        </button>
                        <button
                          type="button"
                          onClick={() => setCollectiveTrendFilter('Estável')}
                          className={`px-2.5 py-1 rounded-lg font-semibold transition-colors cursor-pointer ${
                            collectiveTrendFilter === 'Estável'
                              ? 'bg-indigo-100 text-indigo-800'
                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                          }`}
                        >
                          ➡️ Estáveis ({classSummary.estaveis})
                        </button>
                        <button
                          type="button"
                          onClick={() => setCollectiveTrendFilter('abaixo_corte')}
                          className={`px-2.5 py-1 rounded-lg font-semibold transition-colors cursor-pointer ${
                            collectiveTrendFilter === 'abaixo_corte'
                              ? 'bg-amber-600 text-white'
                              : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                          }`}
                        >
                          ⚠️ Abaixo do Corte ({classSummary.abaixoCorte})
                        </button>
                      </div>

                      {/* Right: Sort controls & Legend */}
                      <div className="flex items-center gap-3 flex-wrap">
                        {/* Sort Selector: Chamada (default) vs Ranking vs Nome */}
                        <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg text-xs font-semibold">
                          <span className="text-[11px] text-slate-500 px-1 font-medium">Ordem:</span>
                          <button
                            type="button"
                            onClick={() => setCollectiveSortBy('chamada')}
                            className={`px-2 py-0.5 rounded-md transition-colors cursor-pointer ${
                              collectiveSortBy === 'chamada'
                                ? 'bg-indigo-600 text-white font-bold shadow-xs'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                            title="Ordenar por número de chamada (padrão)"
                          >
                            Nº Chamada
                          </button>
                          <button
                            type="button"
                            onClick={() => setCollectiveSortBy('ranking')}
                            className={`px-2 py-0.5 rounded-md transition-colors cursor-pointer flex items-center gap-1 ${
                              collectiveSortBy === 'ranking'
                                ? 'bg-indigo-600 text-white font-bold shadow-xs'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                            title="Ordenar por maior média anual (ranking)"
                          >
                            <Award className="w-3 h-3 text-amber-500" />
                            <span>Ranking</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setCollectiveSortBy('nome')}
                            className={`px-2 py-0.5 rounded-md transition-colors cursor-pointer ${
                              collectiveSortBy === 'nome'
                                ? 'bg-indigo-600 text-white font-bold shadow-xs'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                            title="Ordenar alfabeticamente de A a Z"
                          >
                            A-Z
                          </button>
                        </div>

                        {/* Legend indicators */}
                        <div className="flex items-center gap-3 text-[11px] font-semibold text-slate-500">
                          <div className="flex items-center gap-1">
                            <span className="w-3.5 h-1 rounded-full bg-amber-500 inline-block shadow-xs" />
                            <span className="text-amber-800 font-bold">Média Turma ({classSummary.overallAverage?.toFixed(1) || '-'})</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="w-3.5 h-0.5 border-b-2 border-dashed border-amber-400 inline-block" />
                            <span className="text-amber-600">Corte 5.0</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* SUB-VIEW 0 (PADRÃO): ALUNO À ESQUERDA (DADOS) + LINHA DO GRÁFICO À FRENTE (TURMA TODA) */}
                    {collectiveSubView === 'linha_aluno' && (
                      <div className="space-y-3.5">
                        <div className="flex items-center justify-between text-xs text-slate-500 pb-1 flex-wrap gap-2">
                          <div className="flex items-center gap-2">
                            <span>
                              Listagem de todos os alunos com dados à esquerda e linha da evolução à frente:
                            </span>
                            <span className="font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md">
                              {collectiveSortedStudents.length} aluno(s) listado(s)
                            </span>
                          </div>

                          <div className="flex items-center gap-2 no-print">
                            <button
                              type="button"
                              onClick={handlePrint}
                              className="inline-flex items-center gap-1.5 px-3 py-1 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-lg text-xs font-bold shadow-2xs transition-colors cursor-pointer"
                              title="Imprimir gráfico e visualização da turma em documento limpo"
                            >
                              <Printer className="w-3.5 h-3.5 text-indigo-600" />
                              <span>Imprimir Gráfico da Turma</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleExportXLSX(false)}
                              className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 rounded-lg text-xs font-bold shadow-2xs transition-colors cursor-pointer"
                              title="Exportar planilha Excel com fórmulas dinâmicas e gráfico da turma"
                            >
                              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                              <span>Exportar XLSX</span>
                            </button>
                            <button
                              type="button"
                              onClick={handleExportFullClassPDF}
                              className="inline-flex items-center gap-1.5 px-3 py-1 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 rounded-lg text-xs font-bold shadow-2xs transition-colors cursor-pointer"
                              title="Gerar e baixar relatório completo da turma em PDF com gráficos"
                            >
                              <FileText className="w-3.5 h-3.5 text-indigo-600" />
                              <span>Relatório da Turma (PDF)</span>
                            </button>
                          </div>
                        </div>

                        {collectiveSortedStudents.length === 0 ? (
                          <div className="py-12 text-center text-slate-400 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                            <p className="text-sm font-semibold">Nenhum aluno encontrado com os filtros aplicados.</p>
                            <p className="text-xs text-slate-400 mt-1">Tente ajustar a busca ou o filtro de tendência.</p>
                          </div>
                        ) : (
                          <div className="evolution-modal-scroll space-y-3.5 max-h-[640px] overflow-y-auto pr-1">
                            {collectiveSortedStudents.map((row, idx) => (
                              <StudentEvolutionRowCard
                                key={row.student.id || idx}
                                row={row}
                                turmaNome={turma ? `${turma.year}º ${turma.letter} (${turma.shift})` : undefined}
                                currentYear={currentYear}
                                overallAverage={classSummary.overallAverage}
                                bAverages={classSummary.bAverages}
                                selectedSubjectName={
                                  selectedSubject === 'todas'
                                    ? '⭐ Média Geral (Todas as Matérias)'
                                    : availableSubjects.find((s) => s.id === selectedSubject)?.name || 'Disciplina'
                                }
                                onOpenDetail={() => {
                                  setSelectedStudentId(row.student.id || '');
                                  setActiveTab('curva');
                                }}
                                index={idx}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* ACTIVE STUDENT HOVER/PINNED BANNER (OVERLAY ON TOP OF GRAPH IN LINHAS VIEW) */}
                    {collectiveSubView === 'linhas' && activeCollectiveRow && (
                      <div className="bg-indigo-50/90 border border-indigo-200/90 rounded-xl p-2.5 flex items-center justify-between flex-wrap gap-2 transition-all">
                        <div className="flex items-center gap-2.5">
                          <span className="w-7 h-7 rounded-lg bg-indigo-600 text-white font-extrabold text-xs flex items-center justify-center shrink-0">
                            {activeCollectiveRow.student.number}
                          </span>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-900 text-xs sm:text-sm">
                                {activeCollectiveRow.student.name}
                              </span>
                              <span
                                className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                  activeCollectiveRow.trend === 'Evolutivo'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : activeCollectiveRow.trend === 'Em Queda'
                                    ? 'bg-rose-100 text-rose-800'
                                    : 'bg-slate-200 text-slate-700'
                                }`}
                              >
                                {activeCollectiveRow.trend} ({activeCollectiveRow.diff > 0 ? `+${activeCollectiveRow.diff}` : activeCollectiveRow.diff} pts)
                              </span>
                            </div>
                            <div className="flex items-center gap-3 text-[11px] text-slate-600 mt-0.5">
                              <span>1º Bim: <strong>{activeCollectiveRow.grades[0] ?? '-'}</strong></span>
                              <span>2º Bim: <strong>{activeCollectiveRow.grades[1] ?? '-'}</strong></span>
                              <span>3º Bim: <strong>{activeCollectiveRow.grades[2] ?? '-'}</strong></span>
                              <span>4º Bim: <strong>{activeCollectiveRow.grades[3] ?? '-'}</strong></span>
                              <span className="text-indigo-800 font-bold">
                                Média Anual: {activeCollectiveRow.annualAverage ?? '-'}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedStudentId(activeCollectiveRow.student.id || '');
                              setActiveTab('curva');
                            }}
                            className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition shadow-xs cursor-pointer flex items-center gap-1"
                          >
                            <Eye className="w-3 h-3" />
                            <span>Ver Gráfico Individual</span>
                          </button>
                          {collectivePinnedStudentId && (
                            <button
                              type="button"
                              onClick={() => setCollectivePinnedStudentId(null)}
                              className="px-2 py-1 bg-white hover:bg-slate-100 text-slate-600 border border-slate-200 rounded-lg text-xs font-semibold cursor-pointer"
                              title="Limpar seleção fixa"
                            >
                              Desafixar
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {/* SUB-VIEW 1: MULTI-LINE OVERLAID CHART (TODOS OS ALUNOS) */}
                    <div className={collectiveSubView === 'linhas' ? 'block' : 'hidden'} aria-hidden={collectiveSubView !== 'linhas'}>
                      <div className="w-full overflow-x-auto">
                        <svg
                          ref={collectiveSvgRef}
                          viewBox={`0 0 ${cSvgWidth} ${cSvgHeight}`}
                          className="w-full h-auto min-w-[680px]"
                          style={{ userSelect: 'none' }}
                        >
                          <defs>
                            <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                              <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#000000" floodOpacity="0.25" />
                            </filter>
                          </defs>

                          {/* Horizontal Grid lines */}
                          {[0, 2.5, 5.0, 7.5, 10.0].map((val) => {
                            const y = getCY(val);
                            return (
                              <g key={val}>
                                <line
                                  x1={cPaddingLeft}
                                  y1={y}
                                  x2={cSvgWidth - cPaddingRight}
                                  y2={y}
                                  stroke="#f1f5f9"
                                  strokeWidth="1.2"
                                />
                                <text
                                  x={cPaddingLeft - 10}
                                  y={y + 3.5}
                                  textAnchor="end"
                                  fontSize="10"
                                  fill="#94a3b8"
                                  fontWeight="600"
                                >
                                  {val.toFixed(1)}
                                </text>
                              </g>
                            );
                          })}

                          {/* Reference Line at 5.0 (Passing Grade) */}
                          <line
                            x1={cPaddingLeft}
                            y1={getCY(5.0)}
                            x2={cSvgWidth - cPaddingRight}
                            y2={getCY(5.0)}
                            stroke="#f59e0b"
                            strokeWidth="1.5"
                            strokeDasharray="4 4"
                            opacity="0.85"
                          />
                          <text
                            x={cSvgWidth - cPaddingRight - 4}
                            y={getCY(5.0) - 5}
                            textAnchor="end"
                            fontSize="9"
                            fill="#d97706"
                            fontWeight="bold"
                          >
                            Corte 5.0
                          </text>

                          {/* Vertical Bimester Ticks and hover bands */}
                          {[1, 2, 3, 4].map((b) => {
                            const x = getCX(b);
                            return (
                              <g key={b}>
                                <line
                                  x1={x}
                                  y1={cPaddingTop}
                                  x2={x}
                                  y2={cPaddingTop + cChartHeight}
                                  stroke="#e2e8f0"
                                  strokeWidth="1"
                                />
                                <text
                                  x={x}
                                  y={cPaddingTop + cChartHeight + 20}
                                  textAnchor="middle"
                                  fontSize="11"
                                  fontWeight="bold"
                                  fill="#475569"
                                >
                                  {b}º Bimestre
                                </text>
                              </g>
                            );
                          })}

                          {/* ALL STUDENT TRAJECTORY LINES (Plotted from comparison selection, all plotted by default) */}
                          {plottedStudents.map((row, idx) => {
                            const validPoints = row.grades
                              .map((g, i) => (g !== null ? { x: getCX(i + 1), y: getCY(g), bimester: i + 1, grade: g } : null))
                              .filter((p): p is { x: number; y: number; bimester: number; grade: number } => p !== null);

                            if (validPoints.length === 0) return null;

                            const lineD = validPoints.reduce((acc, pt, i) => {
                              return i === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`;
                            }, '');

                            const isHovered = collectiveHoveredStudentId === row.student.id;
                            const isPinned = collectivePinnedStudentId === row.student.id;
                            const isHighlighted = isHovered || isPinned;
                            const isAnyActive = !!activeCollectiveStudentId;

                            // Determine line color
                            let strokeColor = '#6366f1';
                            if (collectiveColorMode === 'tendencia') {
                              strokeColor =
                                row.trend === 'Evolutivo'
                                  ? '#10b981'
                                  : row.trend === 'Em Queda'
                                  ? '#ef4444'
                                  : row.trend === 'Estável'
                                  ? '#6366f1'
                                  : '#94a3b8';
                            } else {
                              strokeColor = studentColorMap.get(row.student.id || '') || STUDENT_PALETTE[idx % STUDENT_PALETTE.length];
                            }

                            // Dynamic opacity & width
                            const opacity = isHighlighted ? 1 : isAnyActive ? 0.2 : 0.75;
                            const strokeWidth = isHighlighted ? 4.5 : plottedStudents.length <= 6 ? 3 : 2;

                            return (
                              <g
                                key={row.student.id || idx}
                                className="transition-all duration-150"
                                style={{ zIndex: isHighlighted ? 30 : 10 }}
                              >
                                {/* Invisible wide stroke for easier hovering and clicking */}
                                {lineD && (
                                  <path
                                    d={lineD}
                                    fill="none"
                                    stroke="transparent"
                                    strokeWidth="14"
                                    className="cursor-pointer"
                                    onMouseEnter={() => setCollectiveHoveredStudentId(row.student.id || '')}
                                    onMouseLeave={() => setCollectiveHoveredStudentId(null)}
                                    onClick={() => {
                                      setSelectedStudentId(row.student.id || '');
                                      setCollectivePinnedStudentId((prev) =>
                                        prev === row.student.id ? null : row.student.id || null
                                      );
                                    }}
                                  />
                                )}

                                {/* Visible Line */}
                                {lineD && (
                                  <path
                                    d={lineD}
                                    fill="none"
                                    stroke={strokeColor}
                                    strokeWidth={strokeWidth}
                                    strokeOpacity={opacity}
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    filter={isHighlighted ? 'url(#glow)' : undefined}
                                  />
                                )}

                                {/* Points on each bimester */}
                                {validPoints.map((pt) => (
                                  <circle
                                    key={pt.bimester}
                                    cx={pt.x}
                                    cy={pt.y}
                                    r={isHighlighted ? 5.5 : 3}
                                    fill={strokeColor}
                                    fillOpacity={opacity}
                                    stroke={isHighlighted ? '#ffffff' : 'transparent'}
                                    strokeWidth={isHighlighted ? 2 : 0}
                                    className="cursor-pointer"
                                    onMouseEnter={() => setCollectiveHoveredStudentId(row.student.id || '')}
                                    onMouseLeave={() => setCollectiveHoveredStudentId(null)}
                                    onClick={() => {
                                      setSelectedStudentId(row.student.id || '');
                                      setCollectivePinnedStudentId((prev) =>
                                        prev === row.student.id ? null : row.student.id || null
                                      );
                                    }}
                                  />
                                ))}

                                {/* Highlighted callout label at the last valid point */}
                                {isHighlighted && validPoints.length > 0 && (
                                  <g>
                                    <rect
                                      x={validPoints[validPoints.length - 1].x + 8}
                                      y={validPoints[validPoints.length - 1].y - 12}
                                      width={String(row.student.name || '').length * 6 + 48}
                                      height="20"
                                      rx="5"
                                      fill="#1e1b4b"
                                      opacity="0.95"
                                    />
                                    <text
                                      x={validPoints[validPoints.length - 1].x + 14}
                                      y={validPoints[validPoints.length - 1].y + 2}
                                      fontSize="9.5"
                                      fill="#ffffff"
                                      fontWeight="bold"
                                    >
                                      Nº {row.student.number} {row.student.name.split(' ')[0]} ({row.annualAverage?.toFixed(1) || '-'})
                                    </text>
                                  </g>
                                )}
                              </g>
                            );
                          })}

                          {/* CLASS AVERAGE PROMINENT OVERLAY LINE */}
                          {collectiveClassAveragePath && (
                            <g style={{ zIndex: 40 }}>
                              {/* Halo line */}
                              <path
                                d={collectiveClassAveragePath}
                                fill="none"
                                stroke="#fef3c7"
                                strokeWidth="7"
                                strokeOpacity="0.8"
                                strokeLinecap="round"
                              />
                              {/* Main Class Average Line */}
                              <path
                                d={collectiveClassAveragePath}
                                fill="none"
                                stroke="#d97706"
                                strokeWidth="3.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                              {/* Class Average Points with Diamond Markers */}
                              {collectiveClassAveragePoints.map((pt) => (
                                <g key={`class-avg-${pt.bimester}`}>
                                  <rect
                                    x={pt.x - 4.5}
                                    y={pt.y - 4.5}
                                    width="9"
                                    height="9"
                                    transform={`rotate(45 ${pt.x} ${pt.y})`}
                                    fill="#f59e0b"
                                    stroke="#78350f"
                                    strokeWidth="1.5"
                                  />
                                  <text
                                    x={pt.x}
                                    y={pt.y - 10}
                                    textAnchor="middle"
                                    fontSize="9.5"
                                    fill="#78350f"
                                    fontWeight="bold"
                                  >
                                    {pt.avg.toFixed(1)}
                                  </text>
                                </g>
                              ))}
                              {/* Label at the right end */}
                              {collectiveClassAveragePoints.length > 0 && (
                                <text
                                  x={collectiveClassAveragePoints[collectiveClassAveragePoints.length - 1].x + 10}
                                  y={collectiveClassAveragePoints[collectiveClassAveragePoints.length - 1].y + 3}
                                  fontSize="10"
                                  fill="#b45309"
                                  fontWeight="bold"
                                >
                                  Média Turma
                                </text>
                              )}
                            </g>
                          )}
                        </svg>

                        {/* CONTROLS & FULL INTERACTIVE STUDENT TABLE FOR COMPARISON (1x1 ou 1xN) & SORTING (CHAMADA OU RANKING) */}
                        <div className="mt-5 pt-4 border-t border-slate-200/90 space-y-3">
                          {/* TOP BAR: SELECTION STATUS, QUICK ACTION BUTTONS AND SORT TOGGLE */}
                          <div className="flex items-center justify-between flex-wrap gap-2.5 bg-slate-50 p-3 rounded-xl border border-slate-200/80">
                            {/* Comparison Plotting Status & Quick Actions */}
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                                <Users className="w-4 h-4 text-indigo-600" />
                                <span>Plotando no Gráfico:</span>
                                <span className="bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded-full text-[11px] font-black">
                                  {plottedStudents.length} de {classStudentsTrajectory.length} alunos
                                </span>
                              </span>

                              <div className="flex items-center gap-1.5 text-xs">
                                <button
                                  type="button"
                                  onClick={handleSelectAllComparison}
                                  className="px-2.5 py-1 bg-white hover:bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg font-semibold transition cursor-pointer flex items-center gap-1 shadow-xs"
                                  title="Plotar todas as curvas dos alunos no gráfico simultaneamente"
                                >
                                  <Check className="w-3.5 h-3.5 text-indigo-600" />
                                  <span>Todos os Alunos (Padrão)</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={handleClearComparison}
                                  className="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-600 border border-slate-200 rounded-lg font-semibold transition cursor-pointer flex items-center gap-1 shadow-xs"
                                  title="Desmarcar todos para selecionar manualmente 1x1 ou 1xN"
                                >
                                  <Minus className="w-3.5 h-3.5 text-slate-400" />
                                  <span>Desmarcar Todos</span>
                                </button>
                              </div>
                            </div>

                            {/* Sorting Mode: Nº de Chamada (Padrão) vs Ranking vs Alfabética */}
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-slate-500 font-semibold flex items-center gap-1">
                                <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
                                <span>Ordenar lista por:</span>
                              </span>
                              <div className="flex items-center p-0.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold shadow-xs">
                                <button
                                  type="button"
                                  onClick={() => setCollectiveSortBy('chamada')}
                                  className={`px-3 py-1 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
                                    collectiveSortBy === 'chamada'
                                      ? 'bg-indigo-600 text-white font-bold shadow-xs'
                                      : 'text-slate-600 hover:text-slate-900'
                                  }`}
                                  title="Ordenar pelo número oficial de chamada do diário de classe"
                                >
                                  <span>Nº de Chamada</span>
                                  {collectiveSortBy === 'chamada' && <span className="text-[10px] bg-indigo-500 text-white px-1 rounded-sm">1, 2, 3</span>}
                                </button>

                                <button
                                  type="button"
                                  onClick={() => setCollectiveSortBy('ranking')}
                                  className={`px-3 py-1 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
                                    collectiveSortBy === 'ranking'
                                      ? 'bg-indigo-600 text-white font-bold shadow-xs'
                                      : 'text-slate-600 hover:text-slate-900'
                                  }`}
                                  title="Ordenar pelo ranking de média anual (maior nota para a menor)"
                                >
                                  <Award className="w-3.5 h-3.5" />
                                  <span>Ranking (Média)</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => setCollectiveSortBy('nome')}
                                  className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                                    collectiveSortBy === 'nome'
                                      ? 'bg-indigo-600 text-white font-bold shadow-xs'
                                      : 'text-slate-600 hover:text-slate-900'
                                  }`}
                                  title="Ordenar em ordem alfabética de A a Z"
                                >
                                  <span>A-Z</span>
                                </button>
                              </div>
                            </div>
                          </div>

                          {/* FULL STUDENTS TABLE WITH CHECKBOX COMPARISON, BIMESTER GRADES, AVERAGE AND ACTIONS */}
                          <div className="border border-slate-200 rounded-xl overflow-hidden shadow-xs">
                            <div className="max-h-[380px] overflow-y-auto overflow-x-auto">
                              <table className="w-full text-left border-collapse text-xs">
                                <thead className="bg-slate-100 text-slate-700 font-bold sticky top-0 z-20 border-b border-slate-200">
                                  <tr>
                                    <th className="py-2.5 px-3 w-10 text-center">
                                      <input
                                        type="checkbox"
                                        checked={
                                          collectiveSortedStudents.length > 0 &&
                                          collectiveSortedStudents.every((r) =>
                                            comparisonStudentIds.includes(r.student.id || '')
                                          )
                                        }
                                        onChange={(e) => {
                                          if (e.target.checked) {
                                            handleSelectAllComparison();
                                          } else {
                                            handleClearComparison();
                                          }
                                        }}
                                        className="rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                        title="Marcar / Desmarcar todos no gráfico"
                                      />
                                    </th>
                                    <th className="py-2.5 px-2 w-12 text-center">Nº</th>
                                    <th className="py-2.5 px-3 min-w-[180px]">Aluno</th>
                                    <th className="py-2.5 px-2 text-center w-14">1º Bim</th>
                                    <th className="py-2.5 px-2 text-center w-14">2º Bim</th>
                                    <th className="py-2.5 px-2 text-center w-14">3º Bim</th>
                                    <th className="py-2.5 px-2 text-center w-14">4º Bim</th>
                                    <th className="py-2.5 px-2 text-center w-16">Média</th>
                                    <th className="py-2.5 px-3 w-28">Tendência</th>
                                    <th className="py-2.5 px-2 text-center w-16">Freq.</th>
                                    <th className="py-2.5 px-3 text-right min-w-[160px]">Comparar / Detalhes</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 bg-white">
                                  {collectiveSortedStudents.map((row, idx) => {
                                    const stId = row.student.id || '';
                                    const isPlotted = comparisonStudentIds.includes(stId);
                                    const isHovered = collectiveHoveredStudentId === stId;
                                    const isPinned = collectivePinnedStudentId === stId;
                                    const isRowActive = isHovered || isPinned;

                                    const studentColor =
                                      collectiveColorMode === 'tendencia'
                                        ? row.trend === 'Evolutivo'
                                          ? '#10b981'
                                          : row.trend === 'Em Queda'
                                          ? '#ef4444'
                                          : row.trend === 'Estável'
                                          ? '#6366f1'
                                          : '#94a3b8'
                                        : studentColorMap.get(stId) || STUDENT_PALETTE[idx % STUDENT_PALETTE.length];

                                    return (
                                      <tr
                                        key={stId || idx}
                                        onMouseEnter={() => setCollectiveHoveredStudentId(stId)}
                                        onMouseLeave={() => setCollectiveHoveredStudentId(null)}
                                        className={`transition-colors ${
                                          isRowActive
                                            ? 'bg-indigo-50/80 font-medium'
                                            : isPlotted
                                            ? 'hover:bg-slate-50'
                                            : 'opacity-50 hover:opacity-80 bg-slate-50/40'
                                        }`}
                                      >
                                        {/* Checkbox for plotted inclusion */}
                                        <td className="py-2 px-3 text-center">
                                          <input
                                            type="checkbox"
                                            checked={isPlotted}
                                            onChange={() => handleToggleStudentComparison(stId)}
                                            className="rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                            title={isPlotted ? 'Desmarcar do gráfico' : 'Plotar no gráfico'}
                                          />
                                        </td>

                                        {/* Call Number */}
                                        <td className="py-2 px-2 text-center">
                                          <span className="font-extrabold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded-md text-[11px]">
                                            {row.student.number || '-'}
                                          </span>
                                        </td>

                                        {/* Student Name & Color Indicator */}
                                        <td className="py-2 px-3">
                                          <div className="flex items-center gap-2">
                                            <span
                                              className="w-2.5 h-2.5 rounded-full inline-block shrink-0 ring-1 ring-black/10"
                                              style={{ backgroundColor: studentColor }}
                                              title={`Cor do aluno no gráfico: ${studentColor}`}
                                            />
                                            <div className="truncate">
                                              <span
                                                className="font-semibold text-slate-800 hover:text-indigo-600 cursor-pointer"
                                                onClick={() => {
                                                  setSelectedStudentId(stId);
                                                  setCollectivePinnedStudentId((prev) => (prev === stId ? null : stId));
                                                }}
                                              >
                                                {row.student.name}
                                              </span>
                                              {row.student.ra && (
                                                <span className="text-[10px] text-slate-400 block font-mono">
                                                  RA: {row.student.ra}
                                                </span>
                                              )}
                                            </div>
                                          </div>
                                        </td>

                                        {/* Grades 1º to 4º Bim */}
                                        {[0, 1, 2, 3].map((bIdx) => (
                                          <td key={bIdx} className="py-2 px-2 text-center font-mono">
                                            {row.grades[bIdx] !== null ? (
                                              <span
                                                className={`font-bold ${
                                                  row.grades[bIdx]! >= 6.0
                                                    ? 'text-emerald-700'
                                                    : row.grades[bIdx]! >= 5.0
                                                    ? 'text-amber-700'
                                                    : 'text-rose-700'
                                                }`}
                                              >
                                                {row.grades[bIdx]!.toFixed(1)}
                                              </span>
                                            ) : (
                                              <span className="text-slate-300">-</span>
                                            )}
                                          </td>
                                        ))}

                                        {/* Annual Average */}
                                        <td className="py-2 px-2 text-center">
                                          {row.annualAverage !== null ? (
                                            <span
                                              className={`inline-block px-1.5 py-0.5 rounded-md font-black text-xs ${
                                                row.annualAverage >= 6.0
                                                  ? 'bg-emerald-100 text-emerald-800'
                                                  : row.annualAverage >= 5.0
                                                  ? 'bg-amber-100 text-amber-800'
                                                  : 'bg-rose-100 text-rose-800'
                                              }`}
                                            >
                                              {row.annualAverage.toFixed(1)}
                                            </span>
                                          ) : (
                                            <span className="text-slate-300 font-mono">-</span>
                                          )}
                                        </td>

                                        {/* Trend & Sparkline */}
                                        <td className="py-2 px-3">
                                          <div className="flex items-center gap-1.5">
                                            <Sparkline grades={row.grades} trend={row.trend} />
                                            <span
                                              className={`text-[10px] font-bold ${
                                                row.trend === 'Evolutivo'
                                                  ? 'text-emerald-700'
                                                  : row.trend === 'Em Queda'
                                                  ? 'text-rose-700'
                                                  : row.trend === 'Estável'
                                                  ? 'text-blue-700'
                                                  : 'text-slate-400'
                                              }`}
                                            >
                                              {row.trend === 'Evolutivo'
                                                ? '↗️ Evol.'
                                                : row.trend === 'Em Queda'
                                                ? '↘️ Queda'
                                                : row.trend === 'Estável'
                                                ? '➡️ Estável'
                                                : '-'}
                                            </span>
                                          </div>
                                        </td>

                                        {/* Attendance */}
                                        <td className="py-2 px-2 text-center font-mono">
                                          {row.attendanceRate !== null ? (
                                            <span
                                              className={`font-semibold ${
                                                row.attendanceRate >= 75 ? 'text-slate-700' : 'text-rose-600 font-bold'
                                              }`}
                                            >
                                              {row.attendanceRate.toFixed(0)}%
                                            </span>
                                          ) : (
                                            <span className="text-slate-300">-</span>
                                          )}
                                        </td>

                                        {/* Actions: Compare 1x1 or Individual Detail */}
                                        <td className="py-2 px-3 text-right">
                                          <div className="flex items-center justify-end gap-1.5">
                                            <button
                                              type="button"
                                              onClick={() => handleCompareOneOnOne(stId)}
                                              className={`px-2 py-1 rounded-md text-[11px] font-bold transition cursor-pointer flex items-center gap-1 ${
                                                comparisonStudentIds.length === 1 && comparisonStudentIds[0] === stId
                                                  ? 'bg-amber-500 text-white shadow-xs'
                                                  : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700'
                                              }`}
                                              title="Comparar individualmente este aluno (1x1) contra a média da turma"
                                            >
                                              <span>1 × 1</span>
                                            </button>

                                            <button
                                              type="button"
                                              onClick={() => {
                                                setSelectedStudentId(stId);
                                                setActiveTab('curva');
                                              }}
                                              className="p-1 text-slate-500 hover:text-indigo-700 hover:bg-slate-100 rounded-md transition cursor-pointer"
                                              title="Ver gráfico detalhado individual deste aluno"
                                            >
                                              <Eye className="w-3.5 h-3.5" />
                                            </button>
                                          </div>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* SUB-VIEW 2: RANKING & BARRAS DE TODOS OS ALUNOS */}
                    {collectiveSubView === 'ranking' && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between text-xs text-slate-500 pb-1">
                          <span>
                            Todos os alunos ordenados por rendimento anual escolar:
                          </span>
                          <span className="font-semibold text-amber-600">
                            Linha de Corte: 5.0
                          </span>
                        </div>

                        <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
                          {[...collectiveFilteredStudents]
                            .sort((a, b) => (b.annualAverage ?? -1) - (a.annualAverage ?? -1))
                            .map((row, rankIdx) => {
                              const avg = row.annualAverage;
                              const isGood = avg !== null && avg >= 6.0;
                              const isWarning = avg !== null && avg >= 5.0 && avg < 6.0;
                              const isDanger = avg !== null && avg < 5.0;

                              const barWidth = avg !== null ? Math.min(100, (avg / 10) * 100) : 0;
                              const barColor = isGood
                                ? 'bg-emerald-500'
                                : isWarning
                                ? 'bg-amber-500'
                                : isDanger
                                ? 'bg-rose-500'
                                : 'bg-slate-300';

                              return (
                                <div
                                  key={row.student.id || rankIdx}
                                  className="bg-slate-50 hover:bg-indigo-50/50 p-2.5 rounded-xl border border-slate-200 transition-colors flex items-center justify-between gap-3"
                                >
                                  <div className="flex items-center gap-2.5 min-w-[200px] max-w-xs">
                                    <span className="w-6 h-6 rounded-md bg-slate-200 text-slate-700 font-extrabold text-[11px] flex items-center justify-center shrink-0">
                                      #{rankIdx + 1}
                                    </span>
                                    <div>
                                      <div className="font-bold text-slate-800 text-xs">
                                        Nº {row.student.number} — {row.student.name}
                                      </div>
                                      <div className="text-[10px] text-slate-500 flex items-center gap-1.5 mt-0.5">
                                        <span>1ºB: {row.grades[0] ?? '-'}</span>
                                        <span>2ºB: {row.grades[1] ?? '-'}</span>
                                        <span>3ºB: {row.grades[2] ?? '-'}</span>
                                        <span>4ºB: {row.grades[3] ?? '-'}</span>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Progress bar representing 0 to 10 */}
                                  <div className="flex-1 max-w-sm hidden sm:block">
                                    <div className="relative w-full h-3 bg-slate-200/90 rounded-full overflow-hidden">
                                      {/* Cutoff marker at 50% */}
                                      <div className="absolute top-0 bottom-0 left-1/2 w-0.5 bg-amber-400 z-10" />
                                      <div
                                        className={`h-full rounded-full transition-all duration-300 ${barColor}`}
                                        style={{ width: `${barWidth}%` }}
                                      />
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-3 shrink-0">
                                    <div className="text-right">
                                      <span className="font-black text-slate-900 text-sm block">
                                        {avg !== null ? avg.toFixed(1) : '-'}
                                      </span>
                                      <span
                                        className={`text-[9.5px] font-bold ${
                                          row.trend === 'Evolutivo'
                                            ? 'text-emerald-700'
                                            : row.trend === 'Em Queda'
                                            ? 'text-rose-700'
                                            : 'text-indigo-600'
                                        }`}
                                      >
                                        {row.trend === 'Evolutivo'
                                          ? '↗️ Evolutivo'
                                          : row.trend === 'Em Queda'
                                          ? '↘️ Em Queda'
                                          : '➡️ Estável'}
                                      </span>
                                    </div>

                                    <button
                                      type="button"
                                      onClick={() => {
                                        setSelectedStudentId(row.student.id || '');
                                        setActiveTab('curva');
                                      }}
                                      className="p-1.5 bg-white hover:bg-indigo-600 hover:text-white border border-slate-200 text-slate-600 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                                      title="Ver gráfico detalhado deste aluno"
                                    >
                                      <Eye className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                        </div>
                      </div>
                    )}

                    {/* SUB-VIEW 3: COMPARATIVO BIMESTRAL DA TURMA */}
                    {collectiveSubView === 'distribuicao' && (
                      <div className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                          {[1, 2, 3, 4].map((b) => {
                            const bAvg = classSummary.bAverages[b - 1];
                            const studentGradesInBim = classStudentsTrajectory
                              .map((r) => r.grades[b - 1])
                              .filter((g): g is number => g !== null);

                            const abovePassing = studentGradesInBim.filter((g) => g >= 5.0).length;
                            const totalEvaluated = studentGradesInBim.length;
                            const approvalRate =
                              totalEvaluated > 0 ? Math.round((abovePassing / totalEvaluated) * 100) : 0;

                            const highGrades = studentGradesInBim.filter((g) => g >= 7.0).length;
                            const lowGrades = studentGradesInBim.filter((g) => g < 5.0).length;

                            return (
                              <div
                                key={b}
                                className="bg-slate-50 rounded-xl p-4 border border-slate-200/90 shadow-xs flex flex-col justify-between"
                              >
                                <div>
                                  <div className="flex items-center justify-between mb-2">
                                    <span className="font-bold text-slate-800 text-sm">
                                      {b}º Bimestre
                                    </span>
                                    <span className="text-[10px] font-semibold text-slate-500 bg-white px-2 py-0.5 rounded-md border border-slate-200">
                                      {totalEvaluated} avaliados
                                    </span>
                                  </div>

                                  <div className="flex items-baseline gap-1.5 mb-3">
                                    <span className="text-3xl font-black text-slate-900">
                                      {bAvg !== null ? bAvg.toFixed(1) : '-'}
                                    </span>
                                    <span className="text-xs text-slate-400">média bimestral</span>
                                  </div>

                                  <div className="space-y-2 text-xs">
                                    <div>
                                      <div className="flex justify-between text-[11px] text-slate-600 mb-1">
                                        <span>Aprovação no bimestre:</span>
                                        <strong>{approvalRate}%</strong>
                                      </div>
                                      <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                                        <div
                                          className="h-full bg-emerald-500 rounded-full"
                                          style={{ width: `${approvalRate}%` }}
                                        />
                                      </div>
                                    </div>

                                    <div className="flex items-center justify-between text-[11px] pt-2 border-t border-slate-200/60">
                                      <span className="text-emerald-700 font-semibold">
                                        Altas (≥ 7.0): {highGrades}
                                      </span>
                                      <span className="text-rose-700 font-semibold">
                                        Abaixo (&lt; 5.0): {lowGrades}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        <div className="bg-indigo-50/70 border border-indigo-200 rounded-xl p-3 text-xs text-indigo-900 font-medium flex items-center gap-2">
                          <Sparkles className="w-4 h-4 text-indigo-600 shrink-0" />
                          <span>
                            A visão comparativa bimestral permite analisar a aderência pedagógica do plano de ensino em cada etapa do ano letivo.
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 2: LISTAGEM COMPLETA DA TURMA COM GRÁFICO INTEGRADO */}
              {activeTab === 'panorama' && (
                <div className="space-y-4">
                  {/* CURRENT STUDENT SUMMARY STRIP */}
                  {currentStudent && (
                    <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50/80 rounded-xl p-3 border border-slate-200/80">
                      <div className="flex items-center gap-3">
                        <span className="w-9 h-9 rounded-xl bg-indigo-600 text-white font-extrabold text-xs flex items-center justify-center shrink-0 shadow-xs">
                          {currentStudent.number}
                        </span>
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="font-bold text-slate-800 text-sm">
                              {currentStudent.name}
                            </h4>
                            <span className="text-[10px] font-semibold text-indigo-700 bg-indigo-100/60 px-2 py-0.5 rounded-full">
                              Em Foco no Gráfico
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5">
                            RA: {currentStudent.ra || 'N/D'} · Nascimento: {currentStudent.birthdate || 'N/D'}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2.5">
                        <div className="text-right">
                          <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
                            Média Anual
                          </span>
                          <span className="text-base font-black text-indigo-700">
                            {stats.annualAverage !== null ? stats.annualAverage.toFixed(1) : '-'}
                          </span>
                        </div>
                        <div className="w-px h-7 bg-slate-200 mx-1" />
                        <div className="text-right">
                          <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
                            Tendência
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 text-xs font-extrabold px-2 py-0.5 rounded-md ${
                              stats.trend === 'Evolutivo'
                                ? 'bg-emerald-100 text-emerald-800'
                                : stats.trend === 'Em Queda'
                                ? 'bg-rose-100 text-rose-800'
                                : 'bg-slate-200 text-slate-800'
                            }`}
                          >
                            {stats.trend === 'Evolutivo' && <TrendingUp className="w-3 h-3" />}
                            {stats.trend === 'Em Queda' && <TrendingDown className="w-3 h-3" />}
                            {stats.trend === 'Estável' && <Minus className="w-3 h-3" />}
                            <span>{stats.trend}</span>
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* INTEGRATED GRAPH CARD */}
                  <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
                    <div className="flex items-center justify-between flex-wrap gap-2 mb-2 pb-2 border-b border-slate-100 text-xs">
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="font-bold text-slate-700 flex items-center gap-1.5">
                          <BarChart3 className="w-4 h-4 text-indigo-600" />
                          Curva de Rendimento Escolar do Aluno em Foco
                        </span>
                        <div className="flex items-center gap-1 font-semibold text-indigo-700">
                          <span className="w-3 h-1 rounded-full bg-indigo-600 inline-block" />
                          <span>Aluno (Nº {currentStudent?.number})</span>
                        </div>
                        <div className="flex items-center gap-1 font-semibold text-slate-500">
                          <span className="w-3 h-0.5 border-b-2 border-dashed border-slate-400 inline-block" />
                          <span>Média da Turma</span>
                        </div>
                        <div className="flex items-center gap-1 font-semibold text-amber-600">
                          <span className="w-3 h-0.5 border-b-2 border-dotted border-amber-400 inline-block" />
                          <span>Corte (5.0)</span>
                        </div>
                      </div>

                      <div className="text-[11px] text-slate-400">
                        {selectedSubject === 'todas'
                          ? 'Média geral ponderada de todas as disciplinas'
                          : `Disciplina: ${availableSubjects.find((s) => s.id === selectedSubject)?.name}`}
                      </div>
                    </div>

                    {/* SVG Chart */}
                    <div className="w-full overflow-x-auto">
                      <svg
                        ref={svgRef}
                        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                        className="w-full h-auto min-w-[500px]"
                        style={{ userSelect: 'none' }}
                      >
                        <defs>
                          <linearGradient id="studentGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#4f46e5" stopOpacity="0.22" />
                            <stop offset="100%" stopColor="#4f46e5" stopOpacity="0.0" />
                          </linearGradient>
                        </defs>

                        {/* Horizontal Grid lines */}
                        {[0, 2.5, 5.0, 7.5, 10.0].map((val) => {
                          const y = getY(val);
                          return (
                            <g key={val}>
                              <line
                                x1={paddingLeft}
                                y1={y}
                                x2={svgWidth - paddingRight}
                                y2={y}
                                stroke="#f1f5f9"
                                strokeWidth="1"
                              />
                              <text
                                x={paddingLeft - 8}
                                y={y + 3.5}
                                textAnchor="end"
                                fontSize="9.5"
                                fill="#94a3b8"
                                fontWeight="600"
                              >
                                {val.toFixed(1)}
                              </text>
                            </g>
                          );
                        })}

                        {/* Reference Line at 5.0 (Passing Grade) */}
                        <line
                          x1={paddingLeft}
                          y1={getY(5.0)}
                          x2={svgWidth - paddingRight}
                          y2={getY(5.0)}
                          stroke="#f59e0b"
                          strokeWidth="1.2"
                          strokeDasharray="4 4"
                          opacity="0.8"
                        />
                        <text
                          x={svgWidth - paddingRight - 4}
                          y={getY(5.0) - 4}
                          textAnchor="end"
                          fontSize="8.5"
                          fill="#d97706"
                          fontWeight="bold"
                        >
                          Corte 5.0
                        </text>

                        {/* Vertical Bimester Ticks */}
                        {bimesterData.map((d) => {
                          const x = getX(d.bimester);
                          const isHovered = hoveredBimester === d.bimester;
                          return (
                            <g key={d.bimester}>
                              <rect
                                x={x - 45}
                                y={paddingTop}
                                width="90"
                                height={chartHeight}
                                fill={isHovered ? '#f8fafc' : 'transparent'}
                                className="cursor-pointer transition-colors"
                                onMouseEnter={() => setHoveredBimester(d.bimester)}
                                onMouseLeave={() => setHoveredBimester(null)}
                              />
                              <line
                                x1={x}
                                y1={paddingTop}
                                x2={x}
                                y2={paddingTop + chartHeight}
                                stroke={isHovered ? '#cbd5e1' : '#f1f5f9'}
                                strokeWidth="1"
                              />
                              <text
                                x={x}
                                y={paddingTop + chartHeight + 18}
                                textAnchor="middle"
                                fontSize="10.5"
                                fontWeight={isHovered ? 'bold' : '600'}
                                fill={isHovered ? '#1e293b' : '#64748b'}
                              >
                                {d.label}
                              </text>
                            </g>
                          );
                        })}

                        {/* Class Average Dashed Line */}
                        {classLinePath && (
                          <path
                            d={classLinePath}
                            fill="none"
                            stroke="#94a3b8"
                            strokeWidth="2"
                            strokeDasharray="5 4"
                          />
                        )}

                        {/* Class Average Points */}
                        {classValidPoints.map((pt) => (
                          <circle
                            key={`class-${pt.bimester}`}
                            cx={pt.x}
                            cy={pt.y}
                            r="3"
                            fill="#94a3b8"
                          />
                        ))}

                        {/* Area under Student Curve */}
                        {studentAreaPath && (
                          <path d={studentAreaPath} fill="url(#studentGradient)" />
                        )}

                        {/* Student Performance Line */}
                        {studentLinePath && (
                          <path
                            d={studentLinePath}
                            fill="none"
                            stroke="#4f46e5"
                            strokeWidth="3.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        )}

                        {/* Student Points with Callouts */}
                        {studentValidPoints.map((pt) => {
                          const isGood = pt.grade >= 6.0;
                          const isPassing = pt.grade >= 5.0 && pt.grade < 6.0;
                          const color = isGood ? '#10b981' : isPassing ? '#f59e0b' : '#ef4444';

                          return (
                            <g key={`student-${pt.bimester}`}>
                              <circle
                                cx={pt.x}
                                cy={pt.y}
                                r="6"
                                fill="#ffffff"
                                stroke="#4f46e5"
                                strokeWidth="2.5"
                              />
                              <circle
                                cx={pt.x}
                                cy={pt.y}
                                r="2.8"
                                fill={color}
                              />

                              {/* Grade Callout */}
                              <rect
                                x={pt.x - 16}
                                y={pt.y - 23}
                                width="32"
                                height="17"
                                rx="4"
                                fill="#1e1b4b"
                                opacity="0.9"
                              />
                              <text
                                x={pt.x}
                                y={pt.y - 11}
                                textAnchor="middle"
                                fontSize="10"
                                fill="#ffffff"
                                fontWeight="bold"
                              >
                                {pt.grade.toFixed(1)}
                              </text>
                            </g>
                          );
                        })}
                      </svg>
                    </div>

                    {/* Quick diagnostic badge */}
                    <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
                      <div className="flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                        <span className="font-medium">{stats.diagnostic}</span>
                      </div>
                      {stats.highest !== null && (
                        <span className="text-[11px] font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md shrink-0">
                          Pico: {stats.highest.toFixed(1)} ({stats.highestBim}º Bim)
                        </span>
                      )}
                    </div>
                  </div>

                  {/* FULL CLASS STUDENTS LISTING (COMO NO RELATÓRIO) */}
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
                    {/* Table Header Controls */}
                    <div className="p-3.5 border-b border-slate-100 bg-slate-50/70 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Users className="w-4 h-4 text-indigo-600" />
                        <h4 className="font-bold text-slate-800 text-sm">
                          Listagem da Turma — Trajetória de Notas
                        </h4>
                        <span className="text-xs text-slate-400">
                          ({filteredStudentsList.length} de {classStudentsTrajectory.length} alunos)
                        </span>
                      </div>

                      {/* Filter Chips & Search Bar */}
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* Trend Chips */}
                        <div className="flex items-center bg-slate-100 rounded-lg p-0.5 text-xs font-semibold text-slate-600">
                          <button
                            type="button"
                            onClick={() => setTrendFilter('todos')}
                            className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                              trendFilter === 'todos' ? 'bg-white text-indigo-700 shadow-xs' : 'hover:text-slate-900'
                            }`}
                          >
                            Todos ({classSummary.total})
                          </button>
                          <button
                            type="button"
                            onClick={() => setTrendFilter('Evolutivo')}
                            className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                              trendFilter === 'Evolutivo' ? 'bg-white text-emerald-700 shadow-xs' : 'hover:text-slate-900'
                            }`}
                          >
                            ↗️ Evolutivo ({classSummary.evolutivos})
                          </button>
                          <button
                            type="button"
                            onClick={() => setTrendFilter('Em Queda')}
                            className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                              trendFilter === 'Em Queda' ? 'bg-white text-rose-700 shadow-xs' : 'hover:text-slate-900'
                            }`}
                          >
                            ↘️ Em Queda ({classSummary.quedas})
                          </button>
                          <button
                            type="button"
                            onClick={() => setTrendFilter('Estável')}
                            className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                              trendFilter === 'Estável' ? 'bg-white text-indigo-700 shadow-xs' : 'hover:text-slate-900'
                            }`}
                          >
                            ➡️ Estável ({classSummary.estaveis})
                          </button>
                        </div>

                        {/* Search Input */}
                        <div className="relative">
                          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                          <input
                            type="text"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder="Buscar aluno por nome..."
                            className="pl-8 pr-3 py-1 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 w-40 sm:w-48"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Table of Students */}
                    <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
                      <table className="w-full text-xs text-left border-collapse">
                        <thead className="bg-slate-50 text-slate-600 font-semibold uppercase text-[10px] tracking-wider sticky top-0 z-10 border-b border-slate-200">
                          <tr>
                            <th className="py-2.5 px-3 w-12 text-center">Nº</th>
                            <th className="py-2.5 px-3 min-w-[180px]">Aluno</th>
                            <th className="py-2.5 px-2 text-center w-16">1º Bim</th>
                            <th className="py-2.5 px-2 text-center w-16">2º Bim</th>
                            <th className="py-2.5 px-2 text-center w-16">3º Bim</th>
                            <th className="py-2.5 px-2 text-center w-16">4º Bim</th>
                            <th className="py-2.5 px-3 text-center w-20">Média Anual</th>
                            <th className="py-2.5 px-2 text-center w-20">Curva</th>
                            <th className="py-2.5 px-3 text-center w-28">Tendência</th>
                            <th className="py-2.5 px-2 text-center w-14">Ação</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-slate-700">
                          {filteredStudentsList.length === 0 ? (
                            <tr>
                              <td colSpan={10} className="py-8 text-center text-slate-400">
                                Nenhum aluno encontrado com os filtros aplicados.
                              </td>
                            </tr>
                          ) : (
                            filteredStudentsList.map((row) => {
                              const isSelected = currentStudent && row.student.id === currentStudent.id;
                              return (
                                <tr
                                  key={row.student.id}
                                  onClick={() => setSelectedStudentId(row.student.id || '')}
                                  className={`hover:bg-indigo-50/60 transition-colors cursor-pointer ${
                                    isSelected ? 'bg-indigo-50/80 font-medium' : ''
                                  }`}
                                >
                                  <td className="py-2 px-3 text-center font-bold text-slate-500">
                                    {row.student.number}
                                  </td>
                                  <td className="py-2 px-3">
                                    <div className="flex items-center gap-1.5">
                                      <span className="font-semibold text-slate-800">
                                        {row.student.name}
                                      </span>
                                      {isSelected && (
                                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 inline-block" />
                                      )}
                                    </div>
                                  </td>
                                  {row.grades.map((g, idx) => (
                                    <td
                                      key={idx}
                                      className={`py-2 px-2 text-center font-semibold ${
                                        g === null
                                          ? 'text-slate-300'
                                          : g >= 6.0
                                          ? 'text-emerald-700'
                                          : g >= 5.0
                                          ? 'text-amber-700'
                                          : 'text-rose-700 font-bold'
                                      }`}
                                    >
                                      {g !== null ? g.toFixed(1) : '-'}
                                    </td>
                                  ))}
                                  <td className="py-2 px-3 text-center font-black text-slate-900">
                                    {row.annualAverage !== null ? row.annualAverage.toFixed(1) : '-'}
                                  </td>
                                  <td className="py-2 px-2 text-center">
                                    <Sparkline grades={row.grades} trend={row.trend} />
                                  </td>
                                  <td className="py-2 px-3 text-center">
                                    <span
                                      className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md ${
                                        row.trend === 'Evolutivo'
                                          ? 'bg-emerald-100 text-emerald-800'
                                          : row.trend === 'Em Queda'
                                          ? 'bg-rose-100 text-rose-800'
                                          : row.trend === 'Estável'
                                          ? 'bg-indigo-50 text-indigo-700'
                                          : 'bg-slate-100 text-slate-400'
                                      }`}
                                    >
                                      {row.trend === 'Evolutivo' && <TrendingUp className="w-3 h-3" />}
                                      {row.trend === 'Em Queda' && <TrendingDown className="w-3 h-3" />}
                                      {row.trend === 'Estável' && <Minus className="w-3 h-3" />}
                                      <span>{row.trend}</span>
                                    </span>
                                  </td>
                                  <td className="py-2 px-2 text-center">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedStudentId(row.student.id || '');
                                      }}
                                      className={`p-1 px-2 rounded-md text-[10px] font-bold transition-colors cursor-pointer flex items-center justify-center gap-1 mx-auto ${
                                        isSelected
                                          ? 'bg-indigo-600 text-white shadow-xs'
                                          : 'bg-slate-100 hover:bg-indigo-100 text-slate-700 hover:text-indigo-800'
                                      }`}
                                    >
                                      <TrendingUp className="w-3 h-3" />
                                      <span>{isSelected ? 'Ativo' : 'Montar'}</span>
                                    </button>
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>

                        {/* Class Average Footer */}
                        <tfoot className="bg-slate-100/95 font-bold text-slate-800 border-t-2 border-slate-200 sticky bottom-0 z-10">
                          <tr>
                            <td colSpan={2} className="py-2.5 px-3 text-left uppercase text-[11px] tracking-wider text-slate-600">
                              📊 Média Geral da Turma:
                            </td>
                            {classSummary.bAverages.map((avg, i) => (
                              <td key={i} className="py-2.5 px-2 text-center font-black text-slate-900">
                                {avg !== null ? avg.toFixed(1) : '-'}
                              </td>
                            ))}
                            <td className="py-2.5 px-3 text-center font-black text-indigo-700">
                              {classSummary.overallAverage !== null ? classSummary.overallAverage.toFixed(1) : '-'}
                            </td>
                            <td colSpan={3} className="py-2.5 px-3 text-center text-[11px] text-slate-500">
                              {classSummary.evolutivos} evolutivos · {classSummary.quedas} em queda · {classSummary.estaveis} estáveis
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 3: CURVA GRÁFICA DETALHADA DO ALUNO */}
              {activeTab === 'curva' && (
                <div className="space-y-4">
                  {/* SVG Chart Container */}
                  <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
                    <div className="flex items-center justify-between flex-wrap gap-2 mb-3 pb-2 border-b border-slate-100 text-xs">
                      <div className="flex items-center gap-4 flex-wrap">
                        <div className="flex items-center gap-1.5 font-semibold text-indigo-700">
                          <span className="w-3.5 h-1 rounded-full bg-indigo-600 inline-block" />
                          <span>Desempenho de {currentStudent?.name}</span>
                        </div>
                        <div className="flex items-center gap-1.5 font-semibold text-slate-500">
                          <span className="w-3.5 h-0.5 border-b-2 border-dashed border-slate-400 inline-block" />
                          <span>Média da Turma</span>
                        </div>
                        <div className="flex items-center gap-1.5 font-semibold text-amber-600">
                          <span className="w-3.5 h-0.5 border-b-2 border-dotted border-amber-400 inline-block" />
                          <span>Média de Corte (5.0)</span>
                        </div>
                      </div>

                      <div className="text-[11px] text-slate-400">
                        {selectedSubject === 'todas'
                          ? 'Média geral ponderada de todas as disciplinas'
                          : `Notas específicas em ${availableSubjects.find((s) => s.id === selectedSubject)?.name}`}
                      </div>
                    </div>

                    {/* SVG Element */}
                    <div className="w-full overflow-x-auto">
                      <svg
                        ref={svgRef}
                        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                        className="w-full h-auto min-w-[500px]"
                        style={{ userSelect: 'none' }}
                      >
                        <defs>
                          <linearGradient id="studentGradientDetailed" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#4f46e5" stopOpacity="0.25" />
                            <stop offset="100%" stopColor="#4f46e5" stopOpacity="0.0" />
                          </linearGradient>
                        </defs>

                        {/* Horizontal Grid lines */}
                        {[0, 2.5, 5.0, 7.5, 10.0].map((val) => {
                          const y = getY(val);
                          return (
                            <g key={val}>
                              <line
                                x1={paddingLeft}
                                y1={y}
                                x2={svgWidth - paddingRight}
                                y2={y}
                                stroke="#f1f5f9"
                                strokeWidth="1"
                              />
                              <text
                                x={paddingLeft - 8}
                                y={y + 3.5}
                                textAnchor="end"
                                fontSize="10"
                                fill="#94a3b8"
                                fontWeight="600"
                              >
                                {val.toFixed(1)}
                              </text>
                            </g>
                          );
                        })}

                        {/* Reference Line at 5.0 (Passing Grade) */}
                        <line
                          x1={paddingLeft}
                          y1={getY(5.0)}
                          x2={svgWidth - paddingRight}
                          y2={getY(5.0)}
                          stroke="#f59e0b"
                          strokeWidth="1.2"
                          strokeDasharray="4 4"
                          opacity="0.8"
                        />
                        <text
                          x={svgWidth - paddingRight - 4}
                          y={getY(5.0) - 4}
                          textAnchor="end"
                          fontSize="9"
                          fill="#d97706"
                          fontWeight="bold"
                        >
                          Corte 5.0
                        </text>

                        {/* Vertical Bimester Ticks */}
                        {bimesterData.map((d) => {
                          const x = getX(d.bimester);
                          const isHovered = hoveredBimester === d.bimester;
                          return (
                            <g key={d.bimester}>
                              <rect
                                x={x - 45}
                                y={paddingTop}
                                width="90"
                                height={chartHeight}
                                fill={isHovered ? '#f8fafc' : 'transparent'}
                                className="cursor-pointer transition-colors"
                                onMouseEnter={() => setHoveredBimester(d.bimester)}
                                onMouseLeave={() => setHoveredBimester(null)}
                              />
                              <line
                                x1={x}
                                y1={paddingTop}
                                x2={x}
                                y2={paddingTop + chartHeight}
                                stroke={isHovered ? '#cbd5e1' : '#f1f5f9'}
                                strokeWidth="1"
                              />
                              <text
                                x={x}
                                y={paddingTop + chartHeight + 18}
                                textAnchor="middle"
                                fontSize="11"
                                fontWeight={isHovered ? 'bold' : '600'}
                                fill={isHovered ? '#1e293b' : '#64748b'}
                              >
                                {d.label}
                              </text>
                            </g>
                          );
                        })}

                        {/* Class Average Dashed Line */}
                        {classLinePath && (
                          <path
                            d={classLinePath}
                            fill="none"
                            stroke="#94a3b8"
                            strokeWidth="2"
                            strokeDasharray="5 4"
                          />
                        )}

                        {/* Class Average Points */}
                        {classValidPoints.map((pt) => (
                          <circle
                            key={`class-${pt.bimester}`}
                            cx={pt.x}
                            cy={pt.y}
                            r="3.5"
                            fill="#94a3b8"
                          />
                        ))}

                        {/* Area under Student Curve */}
                        {studentAreaPath && (
                          <path d={studentAreaPath} fill="url(#studentGradientDetailed)" />
                        )}

                        {/* Student Performance Line */}
                        {studentLinePath && (
                          <path
                            d={studentLinePath}
                            fill="none"
                            stroke="#4f46e5"
                            strokeWidth="3.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        )}

                        {/* Student Points with Callouts */}
                        {studentValidPoints.map((pt) => {
                          const isGood = pt.grade >= 6.0;
                          const isPassing = pt.grade >= 5.0 && pt.grade < 6.0;
                          const color = isGood ? '#10b981' : isPassing ? '#f59e0b' : '#ef4444';

                          return (
                            <g key={`student-${pt.bimester}`}>
                              <circle
                                cx={pt.x}
                                cy={pt.y}
                                r="6.5"
                                fill="#ffffff"
                                stroke="#4f46e5"
                                strokeWidth="2.5"
                              />
                              <circle
                                cx={pt.x}
                                cy={pt.y}
                                r="3"
                                fill={color}
                              />

                              {/* Grade Callout */}
                              <rect
                                x={pt.x - 17}
                                y={pt.y - 25}
                                width="34"
                                height="18"
                                rx="4"
                                fill="#1e1b4b"
                                opacity="0.9"
                              />
                              <text
                                x={pt.x}
                                y={pt.y - 12}
                                textAnchor="middle"
                                fontSize="10.5"
                                fill="#ffffff"
                                fontWeight="bold"
                              >
                                {pt.grade.toFixed(1)}
                              </text>
                            </g>
                          );
                        })}
                      </svg>
                    </div>
                  </div>

                  {/* 4 Bimester Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                    {bimesterData.map((d) => {
                      const grade = d.studentGrade;
                      const isGood = grade !== null && grade >= 6.0;
                      const isPassing = grade !== null && grade >= 5.0 && grade < 6.0;
                      const colorClass =
                        grade === null
                          ? 'text-slate-300'
                          : isGood
                          ? 'text-emerald-700'
                          : isPassing
                          ? 'text-amber-700'
                          : 'text-rose-700';

                      return (
                        <div
                          key={d.bimester}
                          className="bg-white rounded-xl p-3.5 border border-slate-200 shadow-xs flex flex-col justify-between"
                        >
                          <div>
                            <span className="text-xs font-semibold text-slate-500 block mb-1">
                              {d.label}
                            </span>
                            <div className="flex items-baseline gap-1">
                              <span className={`text-2xl font-black ${colorClass}`}>
                                {grade !== null ? grade.toFixed(1) : '-'}
                              </span>
                              <span className="text-[10px] text-slate-400">/ 10</span>
                            </div>
                          </div>

                          <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                            <span>Média Turma:</span>
                            <span className="font-semibold text-slate-700">
                              {d.classAverage !== null ? d.classAverage.toFixed(1) : '-'}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Diagnostic Card */}
                  <div className="bg-indigo-50/70 border border-indigo-200/80 rounded-2xl p-4 flex items-start gap-3">
                    <Sparkles className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <h5 className="font-bold text-slate-900 text-xs uppercase tracking-wider">
                        Diagnóstico Pedagógico de Trajetória
                      </h5>
                      <p className="text-xs text-slate-700 leading-relaxed">
                        {stats.diagnostic}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 4: DESEMPENHO POR DISCIPLINA */}
              {activeTab === 'disciplinas' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h5 className="font-bold text-slate-800 text-xs uppercase tracking-wider">
                      Desempenho Componente por Componente — {currentStudent?.name}
                    </h5>
                    <span className="text-xs text-slate-400">
                      {subjectBreakdown.length} componentes avaliados
                    </span>
                  </div>

                  <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
                    <table className="w-full text-xs text-left border-collapse">
                      <thead className="bg-slate-50 text-slate-600 font-semibold uppercase text-[10px] tracking-wider border-b border-slate-200">
                        <tr>
                          <th className="py-2.5 px-3">Componente Curricular</th>
                          <th className="py-2.5 px-2 text-center w-20">1º Bim</th>
                          <th className="py-2.5 px-2 text-center w-20">2º Bim</th>
                          <th className="py-2.5 px-2 text-center w-20">3º Bim</th>
                          <th className="py-2.5 px-2 text-center w-20">4º Bim</th>
                          <th className="py-2.5 px-3 text-center w-24">Média Anual</th>
                          <th className="py-2.5 px-3 text-center w-28">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-slate-700">
                        {subjectBreakdown.map((row) => {
                          const avg = row.average;
                          const isGood = avg !== null && avg >= 6.0;
                          const isPassing = avg !== null && avg >= 5.0 && avg < 6.0;

                          return (
                            <tr key={row.subject.id} className="hover:bg-slate-50/70 transition-colors">
                              <td className="py-2 px-3 font-semibold text-slate-800">
                                {row.subject.name}
                              </td>
                              {row.grades.map((g, idx) => (
                                <td
                                  key={idx}
                                  className={`py-2 px-2 text-center font-semibold ${
                                    g === null
                                      ? 'text-slate-300'
                                      : g >= 6.0
                                      ? 'text-emerald-700'
                                      : g >= 5.0
                                      ? 'text-amber-700'
                                      : 'text-rose-700 font-bold'
                                  }`}
                                >
                                  {g !== null ? g.toFixed(1) : '-'}
                                </td>
                              ))}
                              <td className="py-2 px-3 text-center font-black text-slate-900">
                                {avg !== null ? avg.toFixed(1) : '-'}
                              </td>
                              <td className="py-2 px-3 text-center">
                                {avg === null ? (
                                  <span className="text-[10px] text-slate-300">Sem nota</span>
                                ) : isGood ? (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-md">
                                    <CheckCircle2 className="w-3 h-3" />
                                    <span>Consolidado</span>
                                  </span>
                                ) : isPassing ? (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-md">
                                    <span>Regular</span>
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-800 bg-rose-100 px-2 py-0.5 rounded-md">
                                    <AlertTriangle className="w-3 h-3" />
                                    <span>Reforço</span>
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB 5: FREQUÊNCIA BIMESTRAL */}
              {activeTab === 'frequencia' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h5 className="font-bold text-slate-800 text-xs uppercase tracking-wider">
                      Trajetória de Frequência e Assiduidade — {currentStudent?.name}
                    </h5>
                    <span className="text-xs text-slate-400">
                      Mínimo legal de 75% exigido
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                    {bimesterData.map((d) => {
                      const rate = d.attendanceRate;
                      const isGood = rate !== null && rate >= 75;

                      return (
                        <div
                          key={d.bimester}
                          className="bg-white rounded-xl p-4 border border-slate-200 shadow-xs flex flex-col justify-between"
                        >
                          <div>
                            <span className="text-xs font-semibold text-slate-500 block mb-1">
                              {d.label}
                            </span>
                            <div className="flex items-baseline gap-1">
                              <span
                                className={`text-2xl font-black ${
                                  rate === null
                                    ? 'text-slate-300'
                                    : isGood
                                    ? 'text-emerald-700'
                                    : 'text-rose-700'
                                }`}
                              >
                                {rate !== null ? `${rate.toFixed(0)}%` : '-'}
                              </span>
                            </div>
                          </div>

                          <div className="mt-3">
                            <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${
                                  rate === null
                                    ? 'bg-slate-200'
                                    : isGood
                                    ? 'bg-emerald-500'
                                    : 'bg-rose-500'
                                }`}
                                style={{ width: `${Math.min(100, rate || 0)}%` }}
                              />
                            </div>
                            <div className="flex items-center justify-between text-[11px] text-slate-500 mt-2 font-medium">
                              <span>Presenças: {d.totalPresences}</span>
                              <span className="text-rose-600 font-semibold">
                                Faltas: {d.totalAbsences}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="bg-amber-50/60 rounded-xl p-3.5 border border-amber-200 text-xs text-amber-900 leading-relaxed font-medium">
                    💡 <strong>Observação Pedagógica:</strong> A correlação entre oscilações de notas e ausências no mesmo bimestre permite identificar se a defasagem decorre de infrequência ou de dificuldades conceituais na disciplina.
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* FOOTER ACTIONS */}
        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/70 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 text-xs text-slate-500 font-medium">
            <span>
              {activeTab === 'coletivo'
                ? 'Dica: Passe o mouse nas linhas do gráfico para destacar cada aluno individualmente'
                : 'Dica: Clique em qualquer aluno na listagem para montar o gráfico instantaneamente'}
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap no-print">
            <button
              type="button"
              onClick={handleExportPNG}
              className="inline-flex items-center gap-1.5 py-1.5 px-3 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-colors shadow-xs cursor-pointer"
              title="Salvar imagem PNG em alta resolução do gráfico da turma completa"
            >
              <Download className="w-3.5 h-3.5 text-slate-500" />
              <span>Salvar Gráfico da Turma (PNG)</span>
            </button>

            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 py-1.5 px-3 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-colors shadow-xs cursor-pointer"
              title="Imprimir gráfico da turma em documento formatado e salvar PDF oficial"
            >
              <Printer className="w-3.5 h-3.5 text-slate-600" />
              <span>Imprimir Gráfico da Turma</span>
            </button>

            <button
              type="button"
              onClick={() => handleExportXLSX(false)}
              className="inline-flex items-center gap-1.5 py-1.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-colors shadow-xs cursor-pointer"
              title="Baixar planilha Excel com fórmulas dinâmicas de trajetória e gráfico da turma embutido"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Exportar XLSX</span>
            </button>

            <button
              type="button"
              onClick={handleExportFullClassPDF}
              className="inline-flex items-center gap-1.5 py-1.5 px-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-colors shadow-xs cursor-pointer"
              title="Gerar relatório impresso da turma completa em PDF com todos os alunos"
            >
              <FileText className="w-3.5 h-3.5 text-indigo-200" />
              <span>Relatório da Turma Completa (PDF)</span>
            </button>

            {currentStudent && (activeTab === 'curva' || activeTab === 'panorama' || activeTab === 'disciplinas' || activeTab === 'frequencia') && (
              <button
                type="button"
                onClick={handleExportSingleStudentPDF}
                className="inline-flex items-center gap-1.5 py-1.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-colors shadow-xs cursor-pointer"
                title={`Gerar relatório individual exclusivo de ${currentStudent.name}`}
              >
                <FileText className="w-3.5 h-3.5 text-slate-500" />
                <span>Relatório deste Aluno (PDF)</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
