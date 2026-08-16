import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import useCache, { invalidateCache } from '../hooks/useCache';
import { Bookmark as BookmarkIcon, PlayCircle, Trash2, ArrowLeft, BookOpen, Play, RefreshCw } from 'lucide-react';
import clsx from 'clsx';

export default function BookmarksView() {
  const phone = localStorage.getItem('phone') || '';
  const navigate = useNavigate();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { data: bookmarksData, isLoading, refresh } = useCache<{ bookmarks: any[] }>(
    phone ? `/progress/bookmarks/${encodeURIComponent(phone)}` : null,
    { ttl: 2 * 60 * 1000 }
  );

  const { data: coursesData } = useCache<{ courses: any[] }>(
    '/courses/',
    { ttl: 15 * 60 * 1000 }
  );

  const bookmarks = bookmarksData?.bookmarks || [];
  const courses = coursesData?.courses || [];

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    invalidateCache('/progress/bookmarks');
    invalidateCache('/dashboard');
    try {
      await refresh();
    } finally {
      setTimeout(() => setIsRefreshing(false), 500);
    }
  };

  const handlePlayBookmark = async (b: any) => {
    if (b.course_id) {
      navigate(`/course/${b.course_id}/video/${b.lesson_id}`);
      return;
    }

    let allCourses = courses;
    if (!allCourses || allCourses.length === 0) {
      try {
        const res = await api.get('/courses/');
        allCourses = res.data?.courses || [];
      } catch (err) {
        console.error('Error fetching courses fallback:', err);
      }
    }

    const lessonIdNum = parseInt(b.lesson_id);
    const matchedCourse = allCourses.find((c: any) => 
      (c.modules || []).some((m: any) => 
        (m.lessons || []).some((l: any) => l.id === lessonIdNum)
      )
    );

    if (matchedCourse) {
      navigate(`/course/${matchedCourse._id}/video/${b.lesson_id}`);
    } else if (allCourses.length > 0) {
      navigate(`/course/${allCourses[0]._id}/video/${b.lesson_id}`);
    } else {
      navigate(`/course/1/video/${b.lesson_id}`);
    }
  };

  const handleRemoveBookmark = async (e: React.MouseEvent, lessonId: number, title: string) => {
    e.stopPropagation();
    try {
      await api.post('/progress/bookmark', { phone, lesson_id: lessonId, title });
      invalidateCache('/progress/bookmarks');
      invalidateCache('/dashboard');
      await refresh();
    } catch (err) {
      console.error('Failed to remove bookmark:', err);
    }
  };

  return (
    <div className="p-4 sm:p-6 md:p-10 max-w-5xl mx-auto space-y-6 sm:space-y-8 w-full pb-32">
      
      {/* Header */}
      <div className="space-y-3">
        <button
          onClick={() => navigate('/dashboard')}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline transition-colors cursor-pointer px-3 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-900/60"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Dashboard</span>
        </button>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2.5">
              <BookmarkIcon className="w-6 h-6 sm:w-7 sm:h-7 text-blue-600 dark:text-blue-400" />
              <span>Saved Bookmarks</span>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                {bookmarks.length}
              </span>
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-medium">
              Click on any bookmarked lecture to play it instantly.
            </p>
          </div>

          <button
            onClick={handleManualRefresh}
            disabled={isRefreshing}
            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/60 border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-all shadow-xs cursor-pointer disabled:opacity-60 shrink-0 self-start sm:self-auto"
            title="Reload latest bookmarks from server"
          >
            <RefreshCw className={clsx("w-3.5 h-3.5 text-blue-600 dark:text-blue-400", isRefreshing && "animate-spin")} />
            <span>{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* Bookmarks Grid */}
      {isLoading && !bookmarksData ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-40 rounded-2xl skeleton" />
          ))}
        </div>
      ) : bookmarks.length === 0 ? (
        <div className="bg-white dark:bg-[#131d31] rounded-2xl p-8 sm:p-10 text-center space-y-3 border border-slate-300 dark:border-slate-800">
          <div className="w-12 h-12 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center mx-auto">
            <BookmarkIcon className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">
              No bookmarks saved yet
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto mt-1">
              While watching a video lecture, click "Save Lesson" to pin it here.
            </p>
          </div>
          <button
            onClick={() => navigate('/dashboard')}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-colors cursor-pointer"
          >
            <BookOpen className="w-4 h-4" />
            <span>Browse Courses</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
          {bookmarks.map((b: any) => (
            <div
              key={b._id || b.id}
              onClick={() => handlePlayBookmark(b)}
              className="bg-white dark:bg-[#131d31] p-4 sm:p-5 rounded-2xl flex flex-col justify-between h-44 border border-slate-300 dark:border-slate-800 hover:border-blue-400 dark:hover:border-blue-600 transition-all shadow-xs cursor-pointer group"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0 border border-blue-100 dark:border-blue-900/40 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                    <Play className="w-4 h-4 fill-current ml-0.5" />
                  </div>
                  {b.module_title && (
                    <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[10px] font-bold uppercase truncate max-w-[150px]">
                      {b.module_title}
                    </span>
                  )}
                </div>

                <button
                  onClick={(e) => handleRemoveBookmark(e, b.lesson_id, b.title)}
                  className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/40 text-slate-400 hover:text-red-600 transition-colors cursor-pointer shrink-0"
                  title="Remove Bookmark"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-1">
                <h3 className="font-semibold text-xs sm:text-sm text-slate-900 dark:text-white line-clamp-2 leading-snug group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                  {b.title || `Lesson ${b.lesson_id}`}
                </h3>
                <p className="text-[10px] sm:text-[11px] text-slate-400 font-normal truncate">
                  {b.course_title ? `${b.course_title} • ` : ''}Lesson #{b.lesson_id}
                </p>
              </div>

              <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs font-semibold text-blue-600 dark:text-blue-400">
                <span className="flex items-center gap-1 group-hover:underline">
                  <PlayCircle className="w-3.5 h-3.5" />
                  <span>Play Lecture</span>
                </span>
                <BookmarkIcon className="w-3.5 h-3.5 fill-blue-600 text-blue-600 dark:fill-blue-400 dark:text-blue-400" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
