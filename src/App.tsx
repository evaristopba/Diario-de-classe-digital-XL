import React, { useState } from 'react';
import {
  School,
  ClassRoom,
  Student,
  Category,
  EventType,
  BNCCSkill,
  AttendanceRecord,
  GradeRecord,
  LessonPlan,
  EventOccurrence,
  Teacher,
  TeacherAssignment,
  ModalConfig,
  ScreenType
} from './types';
import {
  auth,
  signOut,
  migrarParaEstruturaCompartilhada,
  onAuthStateChanged,
  setCurrentAuthUid,
  User
} from './lib/firebase';
import { Navbar } from './components/Navbar';
import { Modal } from './components/Modal';
import { LoginScreen } from './components/LoginScreen';
import { Dashboard } from './components/Dashboard';
import { SchoolsScreen } from './components/SchoolsScreen';
import { ClassesScreen } from './components/ClassesScreen';
import { StudentsScreen } from './components/StudentsScreen';
import { TeachersScreen } from './components/TeachersScreen';
import { AssignmentsScreen } from './components/AssignmentsScreen';
import { AttendanceScreen } from './components/AttendanceScreen';
import { LessonPlanScreen } from './components/LessonPlanScreen';
import { EventsScreen } from './components/EventsScreen';
import { EventTypesScreen } from './components/EventTypesScreen';
import { BNCCScreen } from './components/BNCCScreen';
import { GradesScreen } from './components/GradesScreen';
import { ReportsScreen } from './components/ReportsScreen';
import { CategoriesScreen } from './components/CategoriesScreen';
import { SubjectsScreen } from './components/SubjectsScreen';
import { LibraryScreen } from './components/LibraryScreen';
import { BackupScreen } from './components/BackupScreen';

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [currentScreen, setCurrentScreen] = useState<ScreenType>('dashboard');
  const [currentYear, setCurrentYear] = useState<string>(
    () => localStorage.getItem('dc_current_year') || new Date().getFullYear().toString()
  );
  const [teacherName, setTeacherName] = useState<string>(
    () => localStorage.getItem('dc_teacher_name') || ''
  );
  const [selectedTeacherForAssignment, setSelectedTeacherForAssignment] = useState<string | null>(null);
  const [selectedClassForStudents, setSelectedClassForStudents] = useState<string | null>(null);

  const [modal, setModal] = useState<ModalConfig>({
    isOpen: false,
    type: 'alert',
    title: '',
    message: ''
  });

  React.useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setCurrentAuthUid(currentUser?.uid || null);
      if (currentUser?.displayName && !teacherName) {
        setTeacherName(currentUser.displayName);
      }
      setAuthLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleYearChange = (year: string) => {
    setCurrentYear(year);
    localStorage.setItem('dc_current_year', year);
  };

  const handleTeacherNameChange = (name: string) => {
    setTeacherName(name);
    localStorage.setItem('dc_teacher_name', name);
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setUser(null);
      setCurrentAuthUid(null);
      setCurrentScreen('dashboard');
    } catch (err: any) {
      setModal({
        isOpen: true,
        type: 'alert',
        title: 'Erro ao sair',
        message: err.message,
        icon: '❌'
      });
    }
  };

  const getEffectiveTeacherName = () => {
    if (teacherName.trim()) return teacherName.trim();
    if (user?.displayName) return user.displayName;
    if (user?.email) return user.email.split('@')[0];
    return 'Professor(a)';
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white font-medium">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="text-sm text-slate-400">Carregando Diário de Classe...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <>
        <LoginScreen
          currentYear={currentYear}
          setCurrentYear={handleYearChange}
          teacherName={teacherName}
          setTeacherName={handleTeacherNameChange}
          setModal={setModal}
        />
        <Modal config={modal} onClose={() => setModal((prev) => ({ ...prev, isOpen: false }))} />
      </>
    );
  }

  const effectiveTeacher = getEffectiveTeacherName();

  return (
    <div className="min-h-screen flex flex-col bg-slate-100/70 text-slate-800 antialiased font-sans">
      <Navbar
        currentScreen={currentScreen}
        onNavigate={setCurrentScreen}
        teacherName={effectiveTeacher}
        currentYear={currentYear}
        onLogout={handleLogout}
      />

      <main className="flex-1 pb-16">
        {currentScreen === 'dashboard' && (
          <Dashboard onNavigate={setCurrentScreen} />
        )}

        {(currentScreen === 'schools-screen' || currentScreen === 'schools') && (
          <SchoolsScreen setModal={setModal} />
        )}

        {(currentScreen === 'classes-screen' || currentScreen === 'classes') && (
          <ClassesScreen
            currentYear={currentYear}
            setModal={setModal}
            onNavigateToStudents={(classId) => {
              setSelectedClassForStudents(classId);
              setCurrentScreen('students-screen');
            }}
          />
        )}

        {(currentScreen === 'students-screen' || currentScreen === 'students') && (
          <StudentsScreen
            currentYear={currentYear}
            setModal={setModal}
            initialClassId={selectedClassForStudents || undefined}
          />
        )}

        {(currentScreen === 'teachers-screen' || currentScreen === 'teachers') && (
          <TeachersScreen
            setModal={setModal}
            onNavigateToAssignments={(tId) => {
              setSelectedTeacherForAssignment(tId);
              setCurrentScreen('assignments-screen');
            }}
          />
        )}

        {(currentScreen === 'assignments-screen' || currentScreen === 'assignments') && (
          <AssignmentsScreen
            currentYear={currentYear}
            setModal={setModal}
            initialTeacherId={selectedTeacherForAssignment || undefined}
          />
        )}

        {(currentScreen === 'attendance-screen' || currentScreen === 'attendance') && (
          <AttendanceScreen
            currentTeacher={effectiveTeacher}
            currentYear={currentYear}
            setModal={setModal}
          />
        )}

        {(currentScreen === 'lesson-plan-screen' || currentScreen === 'lessonPlan') && (
          <LessonPlanScreen
            currentTeacher={effectiveTeacher}
            currentYear={currentYear}
            setModal={setModal}
          />
        )}

        {(currentScreen === 'events-screen' || currentScreen === 'events') && (
          <EventsScreen
            currentTeacher={effectiveTeacher}
            currentYear={currentYear}
            setModal={setModal}
          />
        )}

        {(currentScreen === 'event-types-screen' || currentScreen === 'eventTypes') && (
          <EventTypesScreen setModal={setModal} />
        )}

        {(currentScreen === 'bncc-screen' || currentScreen === 'bncc') && (
          <BNCCScreen setModal={setModal} />
        )}

        {(currentScreen === 'grades-screen' || currentScreen === 'grades') && (
          <GradesScreen
            currentTeacher={effectiveTeacher}
            currentYear={currentYear}
            setModal={setModal}
          />
        )}

        {(currentScreen === 'reports-screen' || currentScreen === 'reports') && (
          <ReportsScreen
            currentTeacher={effectiveTeacher}
            currentYear={currentYear}
            setModal={setModal}
          />
        )}

        {(currentScreen === 'categories-screen' || currentScreen === 'categories') && (
          <CategoriesScreen setModal={setModal} />
        )}

        {(currentScreen === 'subjects-screen' || currentScreen === 'subjects') && (
          <SubjectsScreen setModal={setModal} />
        )}

        {(currentScreen === 'library-screen' || currentScreen === 'library') && (
          <LibraryScreen
            currentYear={currentYear}
            setModal={setModal}
          />
        )}

        {(currentScreen === 'backup-screen' || currentScreen === 'backup') && (
          <BackupScreen setModal={setModal} onNavigate={setCurrentScreen} />
        )}
      </main>

      {/* Global Application Modal */}
      <Modal config={modal} onClose={() => setModal((prev) => ({ ...prev, isOpen: false }))} />
    </div>
  );
}
export default App;
