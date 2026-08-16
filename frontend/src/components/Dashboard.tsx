import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import useCache, { invalidateCache } from '../hooks/useCache';
import { 
  BookOpen, 
  Play, 
  RefreshCw, 
  Trash2, 
  Flame, 
  Clock, 
  CalendarDays, 
  PlusCircle, 
  Bookmark, 
  Search, 
  ChevronRight,
  GraduationCap
} from 'lucide-react';

export default function Dashboard() {
  const phone = localStorage.getItem('phone') || '';
  const navigate = useNavigate();
  
  const [searchQuery, setSearchQuery] = useState('');
  const [syncingId, setSyncingId] = useState<number | null>(null);

  const learnerTitle = useMemo(() => {
    const titles = ['Learner', 'Scholar', 'Future Achiever', 'Knowledge Seeker', 'Champion'];
    return titles[Math.floor(Math.random() * titles.length)];
  }, []);

  const { data: dashboardData, isLoading, refresh } = useCache<{
    courses: any[];
    metrics: { total_hours: number; hours_today: number; streak_days: number };
    continue_watching: any;
    bookmarks_count: number;
  }>(`/dashboard?phone=${encodeURIComponent(phone)}`, {
    ttl: 2 * 60 * 1000
  });

  const courses = dashboardData?.courses || [];
  const metrics = dashboardData?.metrics || { total_hours: 0, hours_today: 0, streak_days: 0 };
  const continueWatching = dashboardData?.continue_watching;
  const bookmarksCount = dashboardData?.bookmarks_count || 0;

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  };

  const handleSyncCourse = async (e: React.MouseEvent, channelId: number) => {
    e.stopPropagation();
    setSyncingId(channelId);
    try {
      await api.post('/courses/sync', { phone, channel_id: channelId });
      invalidateCache('/dashboard');
      invalidateCache('/courses');
      await refresh();
    } catch (err) {
      console.error('Failed to sync course:', err);
    } finally {
      setSyncingId(null);
    }
  };

  const handleDeleteCourse = async (e: React.MouseEvent, courseId: string, title: string) => {
    e.stopPropagation();
    if (!window.confirm(`Are you sure you want to remove "${title}"?`)) return;
    try {
      await api.delete(`/courses/${courseId}`);
      invalidateCache('/dashboard');
      invalidateCache('/courses');
      await refresh();
    } catch (err) {
      console.error('Failed to delete course:', err);
    }
  };

  const filteredCourses = courses.filter((c: any) => 
    (c.title || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const cardThemes = [
    'from-blue-700 to-indigo-800',
    'from-slate-700 to-slate-900',
    'from-sky-700 to-blue-900',
    'from-teal-700 to-emerald-900',
    'from-indigo-700 to-slate-900',
    'from-blue-800 to-slate-800',
  ];

  return (
    <div className="p-3.5 sm:p-6 md:p-10 max-w-7xl mx-auto space-y-6 sm:space-y-8 pb-32 w-full">
      
      {/* Welcome Banner */}
      <section className="relative overflow-hidden rounded-2xl bg-white dark:bg-[#131d31] p-4 sm:p-6 md:p-8 border border-slate-300 dark:border-slate-800 shadow-xs">
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800/80 text-blue-700 dark:text-blue-300 text-[10px] sm:text-xs font-semibold uppercase tracking-wider">
              <span>Study Workspace</span>
            </div>
            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-slate-900 dark:text-white tracking-tight">
              {getGreeting()}, <span className="text-blue-600 dark:text-blue-400">{learnerTitle}</span>
            </h1>
            <p className="text-[11px] sm:text-xs md:text-sm text-slate-600 dark:text-slate-400 max-w-xl font-normal">
              Track your daily study streak, resume lectures, and manage synced Telegram courses.
            </p>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <button
              onClick={() => navigate('/add-course')}
              className="flex items-center gap-1.5 px-3.5 py-2 sm:px-4 sm:py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs sm:text-sm shadow-xs transition-colors cursor-pointer"
            >
              <PlusCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span>Import Channel</span>
            </button>
            <button
              onClick={() => refresh()}
              className="p-2 sm:p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors shadow-xs cursor-pointer"
              title="Refresh Dashboard"
            >
              <RefreshCw className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${isLoading ? 'animate-spin text-blue-600' : ''}`} />
            </button>
          </div>
        </div>
      </section>

      {/* Analytics Row (Responsive Grid & No Text Overflow on Mobile) */}
      <section className="space-y-2.5 sm:space-y-3">
        <h2 className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Study Progress Overview
        </h2>

        {isLoading && !dashboardData ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-20 sm:h-24 rounded-2xl skeleton" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {/* Total Hours */}
            <div className="bg-white dark:bg-[#131d31] p-3 sm:p-4 rounded-xl sm:rounded-2xl border border-slate-300 dark:border-slate-800 shadow-xs flex items-center gap-2.5 sm:gap-3.5 min-w-0">
              <div className="w-9 h-9 sm:w-11 sm:h-11 rounded-xl bg-blue-50 dark:bg-blue-950/60 border border-blue-100 dark:border-blue-900/40 flex items-center justify-center text-blue-600 dark:text-blue-400 shrink-0">
                <Clock className="w-4 h-4 sm:w-5 sm:h-5" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 truncate">Total Hours</p>
                <p className="text-base sm:text-xl font-bold text-slate-900 dark:text-white mt-0.5 truncate">{metrics.total_hours}<span className="text-[10px] sm:text-xs font-normal text-slate-400 ml-1">hrs</span></p>
              </div>
            </div>

            {/* Hours Today */}
            <div className="bg-white dark:bg-[#131d31] p-3 sm:p-4 rounded-xl sm:rounded-2xl border border-slate-300 dark:border-slate-800 shadow-xs flex items-center gap-2.5 sm:gap-3.5 min-w-0">
              <div className="w-9 h-9 sm:w-11 sm:h-11 rounded-xl bg-sky-50 dark:bg-sky-950/60 border border-sky-100 dark:border-sky-900/40 flex items-center justify-center text-sky-600 dark:text-sky-400 shrink-0">
                <CalendarDays className="w-4 h-4 sm:w-5 sm:h-5" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 truncate">Today</p>
                <p className="text-base sm:text-xl font-bold text-slate-900 dark:text-white mt-0.5 truncate">{metrics.hours_today}<span className="text-[10px] sm:text-xs font-normal text-slate-400 ml-1">hrs</span></p>
              </div>
            </div>

            {/* Streak */}
            <div className="bg-white dark:bg-[#131d31] p-3 sm:p-4 rounded-xl sm:rounded-2xl border border-slate-300 dark:border-slate-800 shadow-xs flex items-center gap-2.5 sm:gap-3.5 min-w-0">
              <div className="w-9 h-9 sm:w-11 sm:h-11 rounded-xl bg-amber-50 dark:bg-amber-950/60 border border-amber-100 dark:border-amber-900/40 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
                <Flame className="w-4 h-4 sm:w-5 sm:h-5" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 truncate">Active Streak</p>
                <p className="text-base sm:text-xl font-bold text-slate-900 dark:text-white mt-0.5 truncate">{metrics.streak_days}<span className="text-[10px] sm:text-xs font-normal text-slate-400 ml-1">days</span></p>
              </div>
            </div>

            {/* Saved Bookmarks */}
            <div 
              onClick={() => navigate('/bookmarks')}
              className="bg-white dark:bg-[#131d31] p-3 sm:p-4 rounded-xl sm:rounded-2xl border border-slate-300 dark:border-slate-800 shadow-xs flex items-center gap-2.5 sm:gap-3.5 min-w-0 cursor-pointer hover:border-blue-400 transition-colors"
            >
              <div className="w-9 h-9 sm:w-11 sm:h-11 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-100 dark:border-indigo-900/40 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shrink-0">
                <Bookmark className="w-4 h-4 sm:w-5 sm:h-5" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 truncate">Bookmarks</p>
                <p className="text-base sm:text-xl font-bold text-slate-900 dark:text-white mt-0.5 truncate">{bookmarksCount}<span className="text-[10px] sm:text-xs font-normal text-slate-400 ml-1">saved</span></p>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Continue Watching Shelf */}
      {continueWatching && (
        <section className="space-y-2.5 sm:space-y-3">
          <h2 className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
            <Play className="w-3.5 h-3.5 text-blue-600 fill-blue-600" />
            <span>Continue Watching</span>
          </h2>

          <div 
            onClick={() => navigate(`/course/${continueWatching.course_id}/video/${continueWatching.lesson_id}`)}
            className="bg-white dark:bg-[#131d31] rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row items-center gap-4 border border-slate-300 dark:border-slate-800 hover:border-blue-400 dark:hover:border-blue-600 transition-colors cursor-pointer group shadow-xs"
          >
            {/* Visual Frame */}
            <div className="relative w-full sm:w-48 aspect-video bg-slate-900 rounded-xl overflow-hidden shrink-0 flex items-center justify-center">
              <div className="w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center shadow-md group-hover:scale-110 transition-transform">
                <Play className="w-4.5 h-4.5 fill-current ml-0.5" />
              </div>
              <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-black/60">
                <div 
                  className="h-full bg-blue-500 rounded-r-full"
                  style={{ 
                    width: `${Math.min(100, Math.round((continueWatching.progress_seconds / Math.max(1, continueWatching.duration_seconds)) * 100))}%` 
                  }}
                />
              </div>
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0 space-y-1 text-center sm:text-left w-full">
              <div className="flex items-center justify-center sm:justify-start gap-2 flex-wrap">
                <span className="inline-block px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 text-[10px] sm:text-[11px] font-bold uppercase tracking-wider">
                  {continueWatching.module_title || 'Sub-Module'}
                </span>
                {continueWatching.course_title && (
                  <span className="text-[10px] sm:text-[11px] text-slate-400 dark:text-slate-500 font-medium">
                    &bull; {continueWatching.course_title}
                  </span>
                )}
              </div>

              <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors truncate">
                {continueWatching.lesson_title || `Lecture #${continueWatching.lesson_id}`}
              </h3>

              <p className="text-[11px] sm:text-xs text-slate-400 dark:text-slate-500 font-normal">
                {Math.floor(continueWatching.progress_seconds / 60)} / {Math.floor(continueWatching.duration_seconds / 60)} mins watched ({Math.min(100, Math.round((continueWatching.progress_seconds / Math.max(1, continueWatching.duration_seconds)) * 100))}%)
              </p>
            </div>

            <button className="w-full sm:w-auto px-4 py-2 rounded-xl bg-blue-600 group-hover:bg-blue-700 text-white font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors shrink-0">
              <span>Resume</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </section>
      )}

      {/* Courses Section */}
      <section className="space-y-3 sm:space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base sm:text-lg md:text-xl font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
              <BookOpen className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600 dark:text-blue-400" />
              <span>Your Synced Courses</span>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                {courses.length}
              </span>
            </h2>
          </div>

          {/* Search Filter */}
          {courses.length > 0 && (
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input 
                type="text"
                placeholder="Search courses..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl py-2 pl-8 pr-3 text-xs font-medium focus:border-blue-600 focus:ring-2 focus:ring-blue-600/15 outline-none transition-colors dark:text-white placeholder-slate-400"
              />
            </div>
          )}
        </div>

        {/* Course Cards Grid */}
        {isLoading && !dashboardData ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-48 sm:h-56 rounded-2xl skeleton" />
            ))}
          </div>
        ) : filteredCourses.length === 0 ? (
          <div className="bg-white dark:bg-[#131d31] rounded-2xl p-8 sm:p-10 text-center space-y-3 border border-slate-300 dark:border-slate-800">
            <div className="w-11 h-11 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center mx-auto">
              <GraduationCap className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-200">
                {searchQuery ? 'No matching courses found' : 'No courses imported yet'}
              </h3>
              <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto mt-1">
                {searchQuery ? 'Try a different keyword or clear search.' : 'Import your Telegram channels to access organized video lectures and notes.'}
              </p>
            </div>
            {!searchQuery && (
              <button
                onClick={() => navigate('/add-course')}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-colors cursor-pointer"
              >
                <PlusCircle className="w-4 h-4" />
                <span>Import Course</span>
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
            {filteredCourses.map((course: any, idx: number) => {
              const theme = cardThemes[idx % cardThemes.length];
              const initial = (course.title || 'C').charAt(0).toUpperCase();
              const totalLessons = (course.modules || []).reduce(
                (acc: number, m: any) => acc + (m.lessons?.length || 0), 
                0
              );
              const totalNotes = (course.modules || []).reduce(
                (acc: number, m: any) => acc + (m.notes?.length || 0), 
                0
              );

              return (
                <div
                  key={course._id}
                  onClick={() => navigate(`/course/${course._id}`)}
                  className="bg-white dark:bg-[#131d31] rounded-2xl overflow-hidden flex flex-col justify-between cursor-pointer group border border-slate-300 dark:border-slate-800 hover:border-blue-400 dark:hover:border-blue-600 transition-all shadow-xs"
                >
                  {/* Card Header Banner */}
                  <div className={`h-28 sm:h-32 bg-gradient-to-r ${theme} p-3.5 sm:p-4 flex flex-col justify-between relative overflow-hidden`}>
                    <div className="absolute right-3 bottom-1 text-5xl sm:text-6xl font-black text-white/10 pointer-events-none select-none">
                      {initial}
                    </div>

                    <div className="flex items-center justify-between z-10">
                      <span className="px-2 py-0.5 rounded-md bg-black/30 backdrop-blur-xs text-white text-[10px] font-semibold">
                        Channel {course.channel_id}
                      </span>

                      {/* Card Actions */}
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={(e) => handleSyncCourse(e, course.channel_id)}
                          className="p-1.5 rounded-lg bg-black/30 hover:bg-black/50 text-white transition-colors cursor-pointer"
                          title="Sync/Re-fetch Channel"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${syncingId === course.channel_id ? 'animate-spin' : ''}`} />
                        </button>
                        <button
                          onClick={(e) => handleDeleteCourse(e, course._id, course.title)}
                          className="p-1.5 rounded-lg bg-black/30 hover:bg-red-600 text-white transition-colors cursor-pointer"
                          title="Delete Course"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="z-10">
                      <h3 className="text-sm sm:text-base font-bold text-white leading-snug line-clamp-1 break-words">
                        {course.title || 'Untitled Course'}
                      </h3>
                    </div>
                  </div>

                  {/* Body Stats */}
                  <div className="p-3.5 sm:p-4 space-y-2.5">
                    <div className="flex items-center justify-between text-[11px] sm:text-xs text-slate-600 dark:text-slate-400 font-medium">
                      <span>{course.modules?.length || 0} Modules</span>
                      <span>{totalLessons} Lessons</span>
                      {totalNotes > 0 && <span>{totalNotes} Notes</span>}
                    </div>

                    <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs font-semibold text-blue-600 dark:text-blue-400 group-hover:translate-x-0.5 transition-transform">
                      <span>Open Course</span>
                      <ChevronRight className="w-4 h-4" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
