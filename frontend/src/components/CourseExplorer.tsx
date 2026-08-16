import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api';
import { ChevronLeft, Folder, PlayCircle, FileText, Download, Clock } from 'lucide-react';
import clsx from 'clsx';

export default function CourseExplorer() {
  const { courseId } = useParams();
  const navigate = useNavigate();
  const phone = localStorage.getItem('phone');
  const [course, setCourse] = useState<any>(null);
  const [activeModule, setActiveModule] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'videos' | 'notes'>('videos');
  const [progressData, setProgressData] = useState<any[]>([]);

  const fetchData = async () => {
    try {
      const [courseRes, progressRes] = await Promise.all([
        api.get(`/courses/${courseId}`),
        api.get(`/progress/summary/${encodeURIComponent(phone || '')}/${courseId}`)
      ]);
      setCourse(courseRes.data);
      setProgressData(progressRes.data.progress || []);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchData();
  }, [courseId]);

  if (!course) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="font-medium text-sm text-slate-500 dark:text-slate-400">Loading course modules...</p>
        </div>
      </div>
    );
  }

  const handleDownloadNote = (msgId: number) => {
    window.open(`http://localhost:8000/api/courses/download/${encodeURIComponent(phone || '')}/${course.channel_id}/${msgId}`, '_blank');
  };

  return (
    <div className="min-h-full p-8 max-w-6xl mx-auto bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans pb-24">
      {/* Header */}
      <div className="mb-8">
        <button 
          onClick={() => activeModule ? setActiveModule(null) : navigate('/dashboard')}
          className="flex items-center gap-2 text-primary font-semibold mb-4 hover:underline text-sm"
        >
          <ChevronLeft className="w-4 h-4" />
          {activeModule ? "Back to Modules" : "Back to Dashboard"}
        </button>
        <h1 className="text-3xl font-bold tracking-tight">{activeModule ? activeModule.title : course.title}</h1>
        {!activeModule && (
          <p className="text-slate-500 dark:text-slate-400 mt-2">Select a module to explore its lessons and notes.</p>
        )}
      </div>

      {!activeModule ? (
        /* Modules Grid */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {course.modules?.map((module: any) => (
            <div 
              key={module.id}
              onClick={() => setActiveModule(module)}
              className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md hover:border-primary transition-all cursor-pointer group flex flex-col justify-between h-40"
            >
              <div className="flex items-start gap-4">
                <div className="bg-primary/10 dark:bg-primary/20 p-3 rounded-xl shrink-0">
                  <Folder className="w-6 h-6 text-primary" />
                </div>
                <h3 className="font-bold text-lg leading-snug line-clamp-2 group-hover:text-primary transition-colors">{module.title}</h3>
              </div>
              
              <div className="flex items-center gap-4 text-xs font-medium text-slate-500 dark:text-slate-400">
                <span className="flex items-center gap-1">
                  <PlayCircle className="w-4 h-4 text-primary" /> {module.lessons?.length || 0} Lessons
                </span>
                <span className="flex items-center gap-1">
                  <FileText className="w-4 h-4 text-slate-400" /> {module.notes?.length || 0} Notes
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Drill-down View (Lessons/Notes) */
        <div className="flex flex-col mt-4">
          <div className="flex items-center gap-8 border-b border-slate-200 dark:border-slate-800 mb-6">
            <button
              className={clsx(
                "py-4 px-2 font-bold text-sm transition-colors border-b-2",
                activeTab === 'videos' 
                  ? "border-primary text-primary" 
                  : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
              )}
              onClick={() => setActiveTab('videos')}
            >
              Video Lessons ({activeModule.lessons.length})
            </button>
            <button
              className={clsx(
                "py-4 px-2 font-bold text-sm transition-colors border-b-2",
                activeTab === 'notes' 
                  ? "border-primary text-primary" 
                  : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
              )}
              onClick={() => setActiveTab('notes')}
            >
              Notes & PDFs ({activeModule.notes.length})
            </button>
          </div>

          <div className="w-full">
            {activeTab === 'videos' && (
              activeModule.lessons.length === 0 ? (
                <div className="text-center py-10 text-slate-500 dark:text-slate-400 text-sm">No video lessons available in this module.</div>
              ) : (
                <div className="flex flex-col gap-4 w-full">
                  {activeModule.lessons.map((lesson: any, index: number) => {
                    const prog = progressData.find((p: any) => p.lesson_id === lesson.id);
                    const isCompleted = prog?.is_completed;
                    const progressPct = prog && prog.duration_seconds > 0 
                      ? Math.min(100, Math.round((prog.progress_seconds / prog.duration_seconds) * 100))
                      : 0;

                    return (
                      <div 
                        key={lesson.id} 
                        className="group flex items-center justify-between p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl hover:shadow-md hover:border-primary/50 transition-all cursor-pointer"
                        onClick={() => navigate(`/course/${courseId}/video/${lesson.id}`)}
                      >
                        <div className="flex items-center gap-5 overflow-hidden w-full">
                          {/* Thumbnail */}
                          <div className="relative w-40 aspect-video bg-slate-200 dark:bg-slate-800 rounded-xl overflow-hidden shrink-0 shadow-sm">
                            {lesson.thumb_url ? (
                              <img src={lesson.thumb_url} alt="thumbnail" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <PlayCircle className="w-8 h-8 text-slate-400 dark:text-slate-600 opacity-50" />
                              </div>
                            )}
                            
                            {/* Duration */}
                            <div className="absolute bottom-1.5 right-1.5 bg-black/80 backdrop-blur-md text-white text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1 z-10">
                              <Clock className="w-3 h-3" />
                              {(() => {
                                const totalSeconds = lesson.duration || 0;
                                const h = Math.floor(totalSeconds / 3600);
                                const m = Math.floor((totalSeconds % 3600) / 60);
                                const s = Math.floor(totalSeconds % 60);
                                if (h > 0) {
                                  return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
                                }
                                return `${m}:${s.toString().padStart(2, '0')}`;
                              })()}
                            </div>

                            {/* Progress bar */}
                            {progressPct > 0 && (
                              <div className="absolute bottom-0 left-0 w-full h-1 bg-black/50 z-10">
                                <div 
                                  className={clsx("h-full", isCompleted ? "bg-green-500" : "bg-primary")} 
                                  style={{ width: `${progressPct}%` }} 
                                />
                              </div>
                            )}

                            {/* Hover overlay */}
                            <div className="absolute inset-0 bg-black/20 group-hover:bg-black/10 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                              <div className="w-10 h-10 bg-white/90 backdrop-blur-sm rounded-full flex items-center justify-center transform scale-75 group-hover:scale-100 transition-all shadow-xl">
                                <PlayCircle className="w-5 h-5 text-primary fill-primary" />
                              </div>
                            </div>
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0 pr-4">
                            <h4 className="font-bold text-base text-slate-900 dark:text-slate-100 group-hover:text-primary transition-colors truncate">
                              {lesson.title || `Lesson ${index + 1}`}
                            </h4>
                            <div className="flex items-center gap-3 mt-1.5 text-sm">
                              <span className="text-slate-500 dark:text-slate-400 font-medium whitespace-nowrap">Lesson {index + 1}</span>
                              {progressPct > 0 && (
                                <>
                                  <span className="w-1 h-1 rounded-full bg-slate-300 dark:bg-slate-700 shrink-0"></span>
                                  <span className={clsx("font-semibold whitespace-nowrap", isCompleted ? "text-green-600 dark:text-green-400" : "text-primary")}>
                                    {isCompleted ? 'Completed' : `${progressPct}% watched`}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Play Icon Right */}
                        <div className="hidden sm:flex p-3 text-slate-400 group-hover:text-primary group-hover:bg-primary/10 rounded-xl transition-colors shrink-0">
                          <PlayCircle className="w-6 h-6" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )
            )}

            {activeTab === 'notes' && (
              activeModule.notes.length === 0 ? (
                <div className="text-center py-10 text-slate-500 dark:text-slate-400 text-sm">No notes available in this module.</div>
              ) : (
                <div className="space-y-4">
                  {activeModule.notes.map((note: any) => (
                    <div 
                      key={note.id} 
                      className="flex items-center justify-between p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl hover:shadow-md transition-all"
                    >
                      <div className="flex items-center gap-5 overflow-hidden">
                        <div className="bg-blue-100 dark:bg-blue-900/30 p-3 rounded-xl shrink-0">
                          <FileText className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                        </div>
                        <div className="truncate">
                          <h4 className="font-bold text-base text-slate-900 dark:text-slate-100 truncate">{note.file_name || note.text}</h4>
                          <span className="text-sm font-medium text-slate-500 dark:text-slate-400">
                            {note.size > 0 ? `${(note.size / 1024 / 1024).toFixed(1)} MB` : 'Unknown size'}
                          </span>
                        </div>
                      </div>
                      <button 
                        onClick={() => handleDownloadNote(note.id)}
                        className="p-3 text-primary hover:bg-primary/10 rounded-xl transition-colors shrink-0"
                        title="Download Note"
                      >
                        <Download className="w-6 h-6" />
                      </button>
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}
