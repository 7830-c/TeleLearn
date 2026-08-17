import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import useCache, { invalidateCache } from '../hooks/useCache';
import api, { API_BASE } from '../api';
import { 
  ChevronLeft, 
  Folder, 
  PlayCircle, 
  FileText, 
  Download, 
  Clock, 
  CheckCircle2, 
  ChevronRight,
  Pencil,
  X
} from 'lucide-react';
import clsx from 'clsx';

function formatDurationHoursMins(seconds: number): string {
  if (!seconds || seconds <= 0 || !isFinite(seconds)) return '0 mins';
  const totalMinutes = Math.round(seconds / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h} hr${h > 1 ? 's' : ''}`;
  return `${m} min${m > 1 ? 's' : ''}`;
}

export default function CourseExplorer() {
  const { courseId } = useParams();
  const navigate = useNavigate();
  const phone = localStorage.getItem('phone') || '';

  const [activeModule, setActiveModule] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'videos' | 'notes'>('videos');
  const [editingModule, setEditingModule] = useState<{ id: number; title: string } | null>(null);
  const [renameInput, setRenameInput] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);

  const { data: course, isLoading: isCourseLoading, refresh: refreshCourse } = useCache<any>(
    courseId ? `/courses/${courseId}` : null,
    { ttl: 15 * 60 * 1000 }
  );

  const { data: progressSummary } = useCache<any>(
    courseId && phone ? `/progress/summary/${encodeURIComponent(phone)}/${courseId}` : null,
    { ttl: 2 * 60 * 1000 }
  );

  const progressData: any[] = progressSummary?.progress || [];

  const handleStartRename = (mod: any, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setEditingModule({ id: mod.id, title: mod.title });
    setRenameInput(mod.title);
  };

  const handleSaveRename = async () => {
    if (!editingModule || !renameInput.trim() || !courseId) return;
    const newTitle = renameInput.trim();
    setIsRenaming(true);
    try {
      // Optimistically update local course data
      if (course && course.modules) {
        const targetMod = course.modules.find((m: any) => m.id === editingModule.id);
        if (targetMod) targetMod.title = newTitle;
      }
      if (activeModule && activeModule.id === editingModule.id) {
        setActiveModule({ ...activeModule, title: newTitle });
      }

      await api.put(`/courses/${courseId}/modules/${editingModule.id}/rename`, {
        phone,
        new_title: newTitle,
      });

      invalidateCache(`/courses/${courseId}`);
      invalidateCache('/dashboard');
      refreshCourse();
      setEditingModule(null);
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Failed to rename module');
    } finally {
      setIsRenaming(false);
    }
  };

  const handleDownloadNote = (note: any) => {
    if (!course) return;
    const noteName = note.file_name || note.text || 'Study Document';
    const sizeText = note.size ? `${(note.size / 1024 / 1024).toFixed(1)} MB` : 'PDF Document';

    const proceed = window.confirm(
      `Download "${noteName}"?\n\nFile Size: ${sizeText}\n\nDo you want to download this study note?`
    );
    if (!proceed) return;

    const url = `${API_BASE}/courses/download/${encodeURIComponent(phone)}/${course.channel_id}/${note.id}`;
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = url;
    document.body.appendChild(iframe);
    setTimeout(() => {
      try { document.body.removeChild(iframe); } catch {}
    }, 60000);
  };

  if (isCourseLoading && !course) {
    return (
      <div className="p-6 md:p-10 max-w-6xl mx-auto space-y-8 w-full animate-fadeIn">
        <div className="h-8 w-48 rounded-xl skeleton" />
        <div className="h-12 w-96 rounded-2xl skeleton" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-44 rounded-2xl skeleton" />
          ))}
        </div>
      </div>
    );
  }

  if (!course) {
    return (
      <div className="p-12 text-center space-y-4">
        <p className="text-sm font-semibold text-slate-500">Course not found.</p>
        <button
          onClick={() => navigate('/dashboard')}
          className="px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-semibold"
        >
          Return to Dashboard
        </button>
      </div>
    );
  }

  const currentModule = activeModule
    ? (course.modules || []).find((m: any) => m.id === activeModule.id) || activeModule
    : null;

  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto space-y-8 w-full pb-28">
      
      {/* Header & Breadcrumb */}
      <div className="space-y-3">
        <button 
          onClick={() => currentModule ? setActiveModule(null) : navigate('/dashboard')}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline transition-colors cursor-pointer px-3 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-900/60"
        >
          <ChevronLeft className="w-4 h-4" />
          <span>{currentModule ? "Back to All Modules" : "Back to Dashboard"}</span>
        </button>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                {currentModule ? currentModule.title : course.title}
              </h1>
              {currentModule && (
                <button
                  onClick={() => handleStartRename(currentModule)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/60 dark:hover:text-blue-400 transition-colors cursor-pointer"
                  title="Rename this module"
                >
                  <Pencil className="w-4 h-4" />
                </button>
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-medium flex items-center gap-1.5 flex-wrap">
              {currentModule ? (
                <>
                  <span>{currentModule.lessons?.length || 0} Video Lessons</span>
                  {(() => {
                    const dur = (currentModule.lessons || []).reduce((acc: number, l: any) => acc + (l.duration || 0), 0);
                    return dur > 0 ? (
                      <>
                        <span>&bull;</span>
                        <span className="font-semibold text-blue-600 dark:text-blue-400">{formatDurationHoursMins(dur)} Content</span>
                      </>
                    ) : null;
                  })()}
                  <span>&bull;</span>
                  <span>{currentModule.notes?.length || 0} Notes</span>
                </>
              ) : (
                `${course.modules?.length || 0} Sub-modules organized for learning.`
              )}
            </p>
          </div>

          {currentModule && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Switch module:</span>
              <select
                value={currentModule.id}
                onChange={(e) => {
                  const mod = course.modules?.find((m: any) => m.id === parseInt(e.target.value));
                  if (mod) setActiveModule(mod);
                }}
                className="bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200 outline-none"
              >
                {course.modules?.map((m: any) => (
                  <option key={m.id} value={m.id}>{m.title}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* View 1: Module Grid View */}
      {!currentModule ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {course.modules?.map((module: any) => {
            const lessonCount = module.lessons?.length || 0;
            const noteCount = module.notes?.length || 0;
            const moduleDuration = (module.lessons || []).reduce((acc: number, l: any) => acc + (l.duration || 0), 0);
            
            const completedCount = (module.lessons || []).filter((l: any) => 
              progressData.some((p: any) => p.lesson_id === l.id && p.is_completed)
            ).length;
            const completionPct = lessonCount > 0 ? Math.round((completedCount / lessonCount) * 100) : 0;

            return (
              <div 
                key={module.id}
                onClick={() => setActiveModule(module)}
                className="bg-white dark:bg-[#131d31] rounded-2xl p-5 cursor-pointer group flex flex-col justify-between h-44 border border-slate-300 dark:border-slate-800 hover:border-blue-400 dark:hover:border-blue-600 transition-all shadow-xs"
              >
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/60 border border-blue-100 dark:border-blue-900/40 flex items-center justify-center text-blue-600 dark:text-blue-400">
                      <Folder className="w-5 h-5" />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={(e) => handleStartRename(module, e)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/60 dark:hover:text-blue-400 transition-colors"
                        title="Rename Module"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      {completionPct > 0 && (
                        <span className={clsx(
                          "text-[10px] font-bold px-2 py-0.5 rounded-md",
                          completionPct === 100 
                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                            : "bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800"
                        )}>
                          {completionPct === 100 ? 'Completed' : `${completionPct}%`}
                        </span>
                      )}
                    </div>
                  </div>

                  <h3 className="font-bold text-sm md:text-base text-slate-900 dark:text-white leading-snug line-clamp-2 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                    {module.title}
                  </h3>
                </div>

                <div className="pt-2.5 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-600 dark:text-slate-400 font-medium">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
                      <PlayCircle className="w-3.5 h-3.5" />
                      <span>{lessonCount} Lessons</span>
                      {moduleDuration > 0 && (
                        <span className="text-slate-400 font-normal">({formatDurationHoursMins(moduleDuration)})</span>
                      )}
                    </span>
                    {noteCount > 0 && (
                      <span className="flex items-center gap-1">
                        <FileText className="w-3.5 h-3.5 text-slate-400" />
                        {noteCount} Notes
                      </span>
                    )}
                  </div>
                  <ChevronRight className="w-4 h-4 text-blue-600 dark:text-blue-400 group-hover:translate-x-0.5 transition-transform shrink-0" />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* View 2: Module Drill-down */
        <div className="space-y-5">
          {/* Tabs */}
          <div className="flex items-center gap-4 border-b border-slate-300 dark:border-slate-800">
            <button
              className={clsx(
                "pb-2.5 font-semibold text-xs md:text-sm transition-colors flex items-center gap-1.5 relative cursor-pointer",
                activeTab === 'videos'
                  ? "text-blue-600 dark:text-blue-400"
                  : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              )}
              onClick={() => setActiveTab('videos')}
            >
              <PlayCircle className="w-4 h-4" />
              <span>Video Lessons ({currentModule.lessons?.length || 0})</span>
              {activeTab === 'videos' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 dark:bg-blue-400 rounded-full" />
              )}
            </button>
            <button
              className={clsx(
                "pb-2.5 font-semibold text-xs md:text-sm transition-colors flex items-center gap-1.5 relative cursor-pointer",
                activeTab === 'notes'
                  ? "text-blue-600 dark:text-blue-400"
                  : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              )}
              onClick={() => setActiveTab('notes')}
            >
              <FileText className="w-4 h-4" />
              <span>Notes & Documents ({currentModule.notes?.length || 0})</span>
              {activeTab === 'notes' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 dark:bg-blue-400 rounded-full" />
              )}
            </button>
          </div>

          {/* Tab 1: Video Lessons */}
          {activeTab === 'videos' && (
            (!currentModule.lessons || currentModule.lessons.length === 0) ? (
              <div className="bg-white dark:bg-[#131d31] p-10 rounded-2xl text-center text-slate-500 text-xs font-medium border border-slate-300 dark:border-slate-800">
                No video lessons found in this module.
              </div>
            ) : (
              <div className="space-y-2.5">
                {currentModule.lessons.map((lesson: any, index: number) => {
                  const prog = progressData.find((p: any) => p.lesson_id === lesson.id);
                  const isCompleted = prog?.is_completed;
                  const progressPct = prog && prog.duration_seconds > 0
                    ? Math.min(100, Math.round((prog.progress_seconds / prog.duration_seconds) * 100))
                    : 0;

                  return (
                    <div 
                      key={lesson.id} 
                      onClick={() => navigate(`/course/${courseId}/video/${lesson.id}`)}
                      className="bg-white dark:bg-[#131d31] p-4 rounded-xl flex items-center justify-between gap-4 cursor-pointer group border border-slate-300 dark:border-slate-800 hover:border-blue-400 dark:hover:border-blue-600 transition-colors shadow-xs"
                    >
                      <div className="flex items-center gap-3.5 min-w-0 flex-1">
                        <div className={clsx(
                          "w-9 h-9 rounded-lg flex items-center justify-center shrink-0 font-bold text-xs transition-colors",
                          isCompleted
                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                            : "bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 group-hover:bg-blue-600 group-hover:text-white"
                        )}>
                          {isCompleted ? <CheckCircle2 className="w-4 h-4" /> : index + 1}
                        </div>

                        <div className="min-w-0 flex-1 space-y-0.5">
                          <h4 className="font-semibold text-xs md:text-sm text-slate-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors truncate">
                            {lesson.file_name || lesson.text || `Lesson ${index + 1}`}
                          </h4>
                          
                          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 font-medium">
                            {lesson.duration ? (
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                <span>{formatDurationHoursMins(lesson.duration)}</span>
                              </span>
                            ) : (
                              <span>Video Lecture</span>
                            )}

                            {progressPct > 0 && (
                              <span className={clsx("font-bold text-[11px]", isCompleted ? "text-emerald-600 dark:text-emerald-400" : "text-blue-600 dark:text-blue-400")}>
                                • {isCompleted ? 'Finished' : `${progressPct}% watched`}
                              </span>
                            )}
                          </div>

                          {progressPct > 0 && (
                            <div className="w-32 h-1 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden mt-1">
                              <div 
                                className={clsx("h-full rounded-full", isCompleted ? "bg-emerald-500" : "bg-blue-600")}
                                style={{ width: `${progressPct}%` }}
                              />
                            </div>
                          )}
                        </div>
                      </div>

                      <button className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 group-hover:bg-blue-600 group-hover:text-white flex items-center justify-center transition-colors shrink-0">
                        <PlayCircle className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )
          )}

          {/* Tab 2: Notes */}
          {activeTab === 'notes' && (
            (!currentModule.notes || currentModule.notes.length === 0) ? (
              <div className="bg-white dark:bg-[#131d31] p-10 rounded-2xl text-center text-slate-500 text-xs font-medium border border-slate-300 dark:border-slate-800">
                No notes or PDF attachments in this module.
              </div>
            ) : (
              <div className="space-y-2.5">
                {currentModule.notes.map((note: any) => (
                  <div 
                    key={note.id} 
                    className="bg-white dark:bg-[#131d31] p-4 rounded-xl flex items-center justify-between gap-4 border border-slate-300 dark:border-slate-800 shadow-xs"
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 flex items-center justify-center shrink-0 border border-sky-100 dark:border-sky-900/40">
                        <FileText className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <h4 className="font-semibold text-xs md:text-sm text-slate-900 dark:text-white truncate">
                          {note.file_name || note.text || 'Study Document'}
                        </h4>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                          {note.size > 0 ? `${(note.size / 1024 / 1024).toFixed(1)} MB` : 'PDF Document'}
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={() => handleDownloadNote(note)}
                      className="px-3.5 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-600 text-blue-600 dark:text-blue-400 hover:text-white font-semibold text-xs flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 border border-blue-200 dark:border-blue-800"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download</span>
                    </button>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      )}

      {/* Rename Module Modal */}
      {editingModule && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fadeIn">
          <div className="bg-white dark:bg-[#131d31] rounded-2xl p-5 sm:p-6 max-w-md w-full border border-slate-300 dark:border-slate-800 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-base text-slate-900 dark:text-white">Rename Module</h3>
              <button
                onClick={() => setEditingModule(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">Module Name</label>
              <input
                type="text"
                value={renameInput}
                onChange={(e) => setRenameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveRename();
                  if (e.key === 'Escape') setEditingModule(null);
                }}
                autoFocus
                placeholder="Enter module name"
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm font-medium text-slate-900 dark:text-white outline-none focus:border-blue-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                onClick={() => setEditingModule(null)}
                disabled={isRenaming}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveRename}
                disabled={isRenaming || !renameInput.trim()}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white transition-colors cursor-pointer shadow-xs"
              >
                {isRenaming ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
