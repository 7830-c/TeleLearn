import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api';
import { 
  Bookmark, 
  BookmarkCheck, 
  Play, 
  Pause,
  FileText, 
  Download, 
  ChevronDown, 
  Gauge, 
  Layers,
  ArrowLeft,
  Maximize,
  Minimize,
  SlidersHorizontal,
  Sun,
  Moon,
  Volume2,
  VolumeX,
  SkipForward,
  SkipBack,
} from 'lucide-react';
import clsx from 'clsx';

// ─── Utility ────────────────────────────────────────────────────────────────
function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ─── Spinner ─────────────────────────────────────────────────────────────────
function Spinner() {
  return (
    <div className="w-14 h-14 rounded-full border-4 border-white/20 border-t-white animate-spin" />
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────
export default function VideoPlayer() {
  const { courseId, lessonId } = useParams();
  const navigate = useNavigate();
  const phone = localStorage.getItem('phone');

  // ── Data state ─────────────────────────────────────────────────────────────
  const [course, setCourse] = useState<any>(null);
  const [bookmarks, setBookmarks] = useState<number[]>([]);
  const [progressSummary, setProgressSummary] = useState<any>(null);
  const [selectedModuleId, setSelectedModuleId] = useState<number | null>(null);
  const [isModuleDropdownOpen, setIsModuleDropdownOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'video' | 'notes'>('video');
  const [darkMode, setDarkMode] = useState<boolean>(() => localStorage.getItem('theme') === 'dark');

  // ── Video state ────────────────────────────────────────────────────────────
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressSaveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const savedTimeRef = useRef<number>(0);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0); // 0-1
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [videoQuality, setVideoQuality] = useState<'medium' | 'high' | 'low'>('medium');
  const [showControls, setShowControls] = useState(true);
  const [bufferMode, setBufferMode] = useState<'slow' | 'fast' | 'auto'>('auto');
  
  // videoQuality controls backend parallelism: low=2×, medium=4×, high=6× concurrent Telegram requests
  const [networkLabel, setNetworkLabel] = useState<string>('Auto');
  const [isAutoMode, setIsAutoMode] = useState(true); // false when user overrides manually

  // Auto-play intent: set true when user clicks a lesson from the sidebar
  const autoPlayRef = useRef(true); // true by default — always autoplay on navigate

  // ── Theme ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [darkMode]);

  // ── Network speed auto-detection (like YouTube adaptive quality) ────────────
  useEffect(() => {
    const detectAndSet = () => {
      if (!isAutoMode) return; // user has overridden manually
      const conn = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
      if (conn && conn.downlink) {
        const mbps: number = conn.downlink;
        if (mbps < 4) {
          setBufferMode('slow');
          setNetworkLabel(`Slow (${mbps.toFixed(1)} Mbps)`);
        } else if (mbps >= 15) {
          setBufferMode('fast');
          setNetworkLabel(`Fast (${mbps.toFixed(1)} Mbps)`);
        } else {
          setBufferMode('auto');
          setNetworkLabel(`Auto (${mbps.toFixed(1)} Mbps)`);
        }
      }
    };
    detectAndSet();
    const conn = (navigator as any).connection;
    conn?.addEventListener('change', detectAndSet);
    return () => conn?.removeEventListener('change', detectAndSet);
  }, [isAutoMode]);

  // ── Stall monitor: if video keeps buffering, auto-upgrade parallelism ─────
  useEffect(() => {
    if (!isAutoMode) return;
    let stallCount = 0;
    const id = setInterval(() => {
      const v = videoRef.current;
      if (!v || v.paused || v.ended) { stallCount = 0; return; }
      if (v.readyState < 3) { // HAVE_FUTURE_DATA
        stallCount++;
        if (stallCount >= 2) {
          setBufferMode(prev => {
            if (prev === 'slow') return 'auto';
            if (prev === 'auto') return 'fast';
            return prev;
          });
          stallCount = 0;
        }
      } else {
        stallCount = Math.max(0, stallCount - 1);
      }
    }, 2500);
    return () => clearInterval(id);
  }, [isAutoMode]);

  // ── Data fetching ──────────────────────────────────────────────────────────
  useEffect(() => {
    fetchCourse();
    fetchBookmarks();
    fetchProgressSummary();
  }, [courseId]);

  const fetchCourse = async () => {
    try {
      const res = await api.get(`/courses/${courseId}`);
      setCourse(res.data);
    } catch (err) {
      console.error('Error fetching course:', err);
    }
  };

  const fetchBookmarks = async () => {
    try {
      const res = await api.get(`/progress/bookmarks/${encodeURIComponent(phone || '')}`);
      setBookmarks(res.data.bookmarks.map((b: any) => b.lesson_id));
    } catch (err) {
      console.error('Error fetching bookmarks:', err);
    }
  };

  const fetchProgressSummary = async () => {
    try {
      const res = await api.get(`/progress/summary/${encodeURIComponent(phone || '')}/${courseId}`);
      setProgressSummary(res.data);
    } catch (err) {
      console.error('Error fetching progress summary:', err);
    }
  };

  // ── Sync selected module with current lesson ───────────────────────────────
  useEffect(() => {
    if (course?.modules) {
      const currentLessonIdNum = parseInt(lessonId || '0');
      const mod = course.modules.find((m: any) =>
        (m.lessons || []).some((l: any) => l.id === currentLessonIdNum)
      );
      if (mod) setSelectedModuleId(mod.id);
      else if (course.modules.length > 0 && selectedModuleId === null)
        setSelectedModuleId(course.modules[0].id);
    }
  }, [course, lessonId]);

  // ── Reset video state when lesson changes ─────────────────────────────────
  useEffect(() => {
    setIsPlaying(false);
    setIsBuffering(true);
    setCurrentTime(0);
    setDuration(0);
    setBuffered(0);
  }, [lessonId]);

  // ── Auto-play: trigger when video is ready ─────────────────────────────────
  const handleCanPlay = useCallback(() => {
    setIsBuffering(false);
    if (autoPlayRef.current && videoRef.current) {
      videoRef.current.play().catch(() => {});
    }
  }, []);

  // ── Periodic progress save ────────────────────────────────────────────────
  useEffect(() => {
    progressSaveTimerRef.current = setInterval(() => {
      const v = videoRef.current;
      if (v && !v.paused && v.duration > 0) {
        saveProgress(v.currentTime, v.duration);
      }
    }, 15000); // save every 15s while playing
    return () => {
      if (progressSaveTimerRef.current) clearInterval(progressSaveTimerRef.current);
    };
  }, [lessonId]);

  // ── Fullscreen change listener ─────────────────────────────────────────────
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  // ── Controls auto-hide ────────────────────────────────────────────────────
  const resetControlsTimer = useCallback(() => {
    setShowControls(true);
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) setShowControls(false);
    }, 3000);
  }, []);

  // ── Video event handlers ───────────────────────────────────────────────────
  const handlePlay = () => { setIsPlaying(true); setIsBuffering(false); };
  const handlePause = () => {
    setIsPlaying(false);
    setShowControls(true);
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    const v = videoRef.current;
    if (v && v.duration > 0) saveProgress(v.currentTime, v.duration);
  };
  const handleWaiting = () => setIsBuffering(true);
  const handlePlaying = () => setIsBuffering(false);
  const handleEnded = () => {
    setIsPlaying(false);
    setIsBuffering(false);
    setShowControls(true);
    const v = videoRef.current;
    if (v) saveProgress(v.currentTime, v.duration);
  };
  const handleTimeUpdate = () => {
    const v = videoRef.current;
    if (!v) return;
    setCurrentTime(v.currentTime);
    // Update buffered range
    if (v.buffered.length > 0) {
      const bufferedEnd = v.buffered.end(v.buffered.length - 1);
      setBuffered(v.duration > 0 ? bufferedEnd / v.duration : 0);
    }
  };
  const handleDurationChange = () => {
    if (videoRef.current) setDuration(videoRef.current.duration);
  };

  // ── Actions ────────────────────────────────────────────────────────────────
  const togglePlayPause = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play().catch(() => {});
    } else {
      v.pause();
    }
    resetControlsTimer();
  }, [resetControlsTimer]);

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    const t = (parseFloat(e.target.value) / 100) * v.duration;
    v.currentTime = t;
    setCurrentTime(t);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    setIsMuted(val === 0);
    if (videoRef.current) {
      videoRef.current.volume = val;
      videoRef.current.muted = val === 0;
    }
  };

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    const muted = !isMuted;
    setIsMuted(muted);
    v.muted = muted;
    if (!muted && volume === 0) {
      setVolume(1);
      v.volume = 1;
    }
  };

  const handleSpeedChange = (speed: number) => {
    setPlaybackSpeed(speed);
    if (videoRef.current) videoRef.current.playbackRate = speed;
  };

  const skipSeconds = (sec: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + sec));
    resetControlsTimer();
  };

  const toggleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  };

  const lastSavedSecondsRef = React.useRef<number>(0);

  const saveProgress = async (seconds: number, dur: number) => {
    if (!dur || dur <= 0) return;
    try {
      const isCompleted = seconds / dur >= 0.85;
      
      let delta = 0;
      if (seconds > lastSavedSecondsRef.current) {
        delta = Math.floor(seconds - lastSavedSecondsRef.current);
      }
      if (delta > 30) delta = 15;
      lastSavedSecondsRef.current = seconds;

      await api.post('/progress/update', {
        phone,
        course_id: courseId,
        lesson_id: parseInt(lessonId || '0'),
        progress_seconds: Math.floor(seconds),
        duration_seconds: Math.floor(dur),
        is_completed: isCompleted,
        delta_seconds: delta
      });
      fetchProgressSummary();
    } catch (err) {
      console.error('Error saving progress:', err);
    }
  };

  const toggleBookmark = async (id: number, title: string) => {
    try {
      await api.post('/progress/bookmark', { phone, lesson_id: id, title });
      fetchBookmarks();
    } catch (err) {
      console.error('Error toggling bookmark:', err);
    }
  };

  const handleDownloadVideo = () => {
    if (!course) return;
    window.open(
      `http://localhost:8000/api/courses/download/${encodeURIComponent(phone || '')}/${course.channel_id}/${lessonId}`,
      '_blank'
    );
  };

  const handleDownloadNote = (msgId: number) => {
    if (!course) return;
    window.open(
      `http://localhost:8000/api/courses/download/${encodeURIComponent(phone || '')}/${course.channel_id}/${msgId}`,
      '_blank'
    );
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === ' ' || e.key === 'k') { e.preventDefault(); togglePlayPause(); }
      if (e.key === 'ArrowRight') skipSeconds(10);
      if (e.key === 'ArrowLeft') skipSeconds(-10);
      if (e.key === 'f') toggleFullscreen();
      if (e.key === 'm') toggleMute();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [togglePlayPause]);

  // ── Loading screen ─────────────────────────────────────────────────────────
  if (!course) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="font-medium text-sm text-slate-500 dark:text-slate-400">Loading course...</p>
        </div>
      </div>
    );
  }

  // ── Derived values ─────────────────────────────────────────────────────────
  const activeModule =
    course.modules?.find((m: any) => m.id === selectedModuleId) ||
    course.modules?.[0] || { lessons: [], notes: [], title: 'Module' };
  const currentLessonIdNum = parseInt(lessonId || '0');
  const currentLesson = course.modules
    ?.flatMap((m: any) => m.lessons || [])
    .find((l: any) => l.id === currentLessonIdNum);
  const isBookmarked = bookmarks.includes(currentLessonIdNum);

  // videoQuality controls parallel Telegram chunk fetches
  const streamUrl = `http://localhost:8000/api/courses/stream/${encodeURIComponent(phone || '')}/${course.channel_id}/${lessonId}?quality=${videoQuality}`;
  const posterUrl = `http://localhost:8000/api/courses/thumbnail/${encodeURIComponent(phone || '')}/${course.channel_id}/${lessonId}`;

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferedPct = buffered * 100;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col lg:flex-row h-full bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 overflow-hidden font-sans transition-colors">

      {/* ── SIDEBAR ───────────────────────────────────────────────────────── */}
      <aside className="w-full lg:w-88 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col h-[50vh] lg:h-full shrink-0 shadow-sm z-20">

        {/* Header */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between gap-3">
          <button
            onClick={() => navigate(`/course/${courseId}`)}
            className="flex items-center gap-2 text-slate-900 dark:text-slate-100 hover:text-primary font-semibold text-sm transition-colors truncate"
            title="Return to Sub-Modules"
          >
            <ArrowLeft className="w-4 h-4 text-primary shrink-0" />
            <span className="truncate">{course.title}</span>
          </button>
        </div>

        {/* Module dropdown */}
        <div className="p-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 relative">
          <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-primary" />
            Sub-Module
          </label>
          <button
            onClick={() => setIsModuleDropdownOpen(!isModuleDropdownOpen)}
            className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-2.5 flex items-center justify-between text-left shadow-xs hover:border-primary transition-all text-xs font-semibold text-slate-900 dark:text-white"
          >
            <span className="truncate">{activeModule.title}</span>
            <ChevronDown className={clsx('w-4 h-4 text-slate-400 transition-transform', isModuleDropdownOpen && 'rotate-180')} />
          </button>
          {isModuleDropdownOpen && (
            <div className="absolute top-full left-3 right-3 mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-30 max-h-60 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700">
              {course.modules?.map((mod: any) => (
                <div
                  key={mod.id}
                  onClick={() => {
                    setSelectedModuleId(mod.id);
                    setIsModuleDropdownOpen(false);
                    if (mod.lessons?.length > 0 && !mod.lessons.some((l: any) => l.id === currentLessonIdNum)) {
                      autoPlayRef.current = true;
                      navigate(`/course/${courseId}/video/${mod.lessons[0].id}`);
                    }
                  }}
                  className={clsx(
                    'p-2.5 text-xs flex items-center justify-between cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors',
                    activeModule.id === mod.id
                      ? 'bg-primary/10 dark:bg-primary/20 font-bold text-primary'
                      : 'text-slate-700 dark:text-slate-200'
                  )}
                >
                  <span className="truncate">{mod.title}</span>
                  <span className="text-[10px] text-slate-500 bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded ml-2 shrink-0">
                    {mod.lessons?.length || 0} vids
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Video counter */}
        <div className="px-4 py-2.5 bg-slate-100/60 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
          <span className="font-semibold text-slate-500 dark:text-slate-400">Lectures in this Module</span>
          <span className="bg-primary/10 text-primary font-bold px-2 py-0.5 rounded-full text-[11px]">
            {activeModule.lessons?.length || 0} Videos
          </span>
        </div>

        {/* Lesson list */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {(!activeModule.lessons || activeModule.lessons.length === 0) ? (
            <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
              No video lectures found in this sub-module.
            </div>
          ) : (
            activeModule.lessons.map((lesson: any, idx: number) => {
              const isActive = lesson.id === currentLessonIdNum;
              return (
                <div
                  key={lesson.id}
                  onClick={() => {
                    if (isActive) return;
                    autoPlayRef.current = true;
                    navigate(`/course/${courseId}/video/${lesson.id}`);
                  }}
                  className={clsx(
                    'p-3 rounded-xl cursor-pointer flex items-start gap-3 transition-all border text-xs',
                    isActive
                      ? 'bg-primary text-white border-primary shadow-md font-medium cursor-default'
                      : 'bg-white dark:bg-slate-800/80 border-slate-200/80 dark:border-slate-800 hover:border-primary text-slate-800 dark:text-slate-100'
                  )}
                >
                  <div className={clsx(
                    'w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5',
                    isActive ? 'bg-white/20 text-white' : 'bg-slate-100 dark:bg-slate-700 text-primary'
                  )}>
                    {isActive && isPlaying
                      ? <Pause className="w-3.5 h-3.5 fill-current" />
                      : <Play className="w-3.5 h-3.5 fill-current" />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                      <span className={clsx('text-[10px] font-semibold uppercase tracking-wider', isActive ? 'text-white/80' : 'text-primary')}>
                        Lecture {idx + 1}
                      </span>
                      {isActive && (
                        <span className="bg-white text-primary text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-tighter shadow-xs">
                          {isBuffering ? 'Loading…' : isPlaying ? 'Playing' : 'Paused'}
                        </span>
                      )}
                    </div>
                    <p className="truncate font-medium leading-snug">{lesson.text}</p>
                    <p className={clsx('text-[10px] mt-1', isActive ? 'text-white/70' : 'text-slate-400 dark:text-slate-500')}>
                      {lesson.duration
                        ? (() => {
                            const totalSeconds = lesson.duration || 0;
                            const h = Math.floor(totalSeconds / 3600);
                            const m = Math.floor((totalSeconds % 3600) / 60);
                            const s = Math.floor(totalSeconds % 60);
                            if (h > 0) {
                              return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
                            }
                            return `${m}:${s.toString().padStart(2, '0')}`;
                          })()
                        : 'Video Lesson'}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Progress tracker */}
        {progressSummary && (
          <div className="p-3 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 space-y-1.5">
            <div className="flex justify-between items-center">
              <span>Overall Completed:</span>
              <span className="font-semibold text-primary">{progressSummary.completed_videos} lessons</span>
            </div>
            <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
              <div
                className="bg-primary h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.min(100, (progressSummary.completed_videos / Math.max(1, course.modules?.flatMap((m: any) => m.lessons || []).length || 1)) * 100)}%`
                }}
              />
            </div>
          </div>
        )}
      </aside>

      {/* ── MAIN CONTENT ──────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col h-full overflow-y-auto bg-slate-50 dark:bg-slate-950">
        <div className="flex-1 p-6 lg:p-8 max-w-5xl mx-auto w-full space-y-6">

          {/* Tabs */}
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
            <div className="flex gap-6">
              <button
                onClick={() => setActiveTab('video')}
                className={clsx(
                  'pb-2 font-semibold text-sm transition-all relative flex items-center gap-2',
                  activeTab === 'video'
                    ? 'text-primary'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                )}
              >
                <Play className="w-4 h-4" />
                Video Lecture
                {activeTab === 'video' && <div className="absolute bottom-[-13px] left-0 w-full h-0.5 bg-primary" />}
              </button>
              <button
                onClick={() => setActiveTab('notes')}
                className={clsx(
                  'pb-2 font-semibold text-sm transition-all relative flex items-center gap-2',
                  activeTab === 'notes'
                    ? 'text-primary'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                )}
              >
                <FileText className="w-4 h-4" />
                Notes &amp; Documents ({activeModule.notes?.length || 0})
                {activeTab === 'notes' && <div className="absolute bottom-[-13px] left-0 w-full h-0.5 bg-primary" />}
              </button>
            </div>
          </div>

          <div className={clsx("space-y-6", activeTab !== 'video' && 'hidden')}>

            {/* ── VIDEO PLAYER ─────────────────────────────────────────── */}
            <div
              ref={containerRef}
              onMouseMove={resetControlsTimer}
              onMouseLeave={() => { if (isPlaying) setShowControls(false); }}
              onClick={togglePlayPause}
              className="bg-black rounded-2xl overflow-hidden shadow-xl aspect-video relative border border-slate-800 cursor-pointer select-none"
            >
              <video
                key={lessonId}
                ref={videoRef}
                playsInline
                preload="auto"
                poster={posterUrl}
                src={streamUrl}
                onPlay={handlePlay}
                onPause={handlePause}
                onWaiting={handleWaiting}
                onPlaying={handlePlaying}
                onCanPlay={handleCanPlay}
                onCanPlayThrough={handleCanPlay}
                onEnded={handleEnded}
                onTimeUpdate={handleTimeUpdate}
                onDurationChange={handleDurationChange}
                onLoadedMetadata={handleDurationChange}
                className="w-full h-full object-contain"
              />

              {isBuffering && (
                <div className="absolute inset-0 flex items-center justify-center z-20 bg-black/30 pointer-events-none">
                  <Spinner />
                </div>
              )}

              {!isPlaying && !isBuffering && (
                <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
                  <div className="w-16 h-16 rounded-full bg-black/60 text-white flex items-center justify-center backdrop-blur-sm shadow-xl transition-all">
                    <Play className="w-8 h-8 fill-current ml-1" />
                  </div>
                </div>
              )}

              <div
                onClick={(e) => e.stopPropagation()}
                className={clsx(
                  'absolute bottom-0 left-0 right-0 z-30 transition-opacity duration-300',
                  showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
                )}
              >
                <div className="h-20 bg-gradient-to-t from-black/90 via-black/50 to-transparent absolute bottom-0 left-0 right-0 pointer-events-none" />

                <div className="relative px-4 pb-4 pt-8 space-y-2">
                  <div className="relative h-1 group/seek">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={0.01}
                      value={progressPct}
                      onChange={handleSeek}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                      title="Seek"
                    />
                    <div className="absolute inset-0 bg-white/20 rounded-full" />
                    <div
                      className="absolute top-0 left-0 h-full bg-white/35 rounded-full transition-all"
                      style={{ width: `${bufferedPct}%` }}
                    />
                    <div
                      className="absolute top-0 left-0 h-full bg-primary rounded-full transition-all"
                      style={{ width: `${progressPct}%` }}
                    />
                    <div
                      className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-lg opacity-0 group-hover/seek:opacity-100 transition-all pointer-events-none"
                      style={{ left: `calc(${progressPct}% - 6px)` }}
                    />
                  </div>

                  <div className="flex items-center justify-between gap-3 text-white">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => skipSeconds(-10)}
                        className="p-1 rounded-lg hover:bg-white/15 transition-colors"
                        title="Rewind 10s (←)"
                      >
                        <SkipBack className="w-4 h-4" />
                      </button>
                      <button
                        onClick={togglePlayPause}
                        className="w-9 h-9 rounded-full bg-white/15 hover:bg-primary flex items-center justify-center transition-all shadow"
                        title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
                      >
                        {isBuffering
                          ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                          : isPlaying
                            ? <Pause className="w-4 h-4 fill-current" />
                            : <Play className="w-4 h-4 fill-current ml-0.5" />
                        }
                      </button>
                      <button
                        onClick={() => skipSeconds(10)}
                        className="p-1 rounded-lg hover:bg-white/15 transition-colors"
                        title="Forward 10s (→)"
                      >
                        <SkipForward className="w-4 h-4" />
                      </button>
                      <button onClick={toggleMute} className="p-1 rounded-lg hover:bg-white/15 transition-colors" title="Mute (M)">
                        {isMuted || volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                      </button>
                      <input
                        type="range" min={0} max={1} step={0.05}
                        value={isMuted ? 0 : volume}
                        onChange={handleVolumeChange}
                        className="w-16 accent-primary cursor-pointer"
                        title="Volume"
                      />
                      <span className="text-xs font-mono text-white/80 ml-1 select-none">
                        {formatTime(currentTime)}
                        <span className="text-white/40 mx-1">/</span>
                        {formatTime(duration)}
                      </span>
                    </div>

                    {/* RIGHT: Speed + Quality + Fullscreen */}
                    <div className="flex items-center gap-2">
                      {/* Speed */}
                      <div className="flex items-center gap-1 bg-white/10 rounded-lg px-2 py-1">
                        <Gauge className="w-3 h-3 text-primary shrink-0" />
                        {[0.75, 1, 1.25, 1.5, 2].map((spd) => (
                          <button
                            key={spd}
                            onClick={() => handleSpeedChange(spd)}
                            className={clsx(
                              'px-1.5 py-0.5 rounded text-[11px] font-semibold transition-all',
                              playbackSpeed === spd ? 'bg-primary text-white' : 'text-white/70 hover:text-white'
                            )}
                          >
                            {spd}x
                          </button>
                        ))}
                      </div>

                      {/* Quality */}
                      <div className="flex items-center gap-1 bg-white/10 rounded-lg px-2 py-1">
                        <SlidersHorizontal className="w-3 h-3 text-primary" />
                        <select
                          value={videoQuality}
                          onChange={(e) => {
                            if (videoRef.current) {
                              savedTimeRef.current = videoRef.current.currentTime;
                            }
                            setVideoQuality(e.target.value as 'medium' | 'high' | 'low');
                            setIsBuffering(true);
                            setIsPlaying(false);
                          }}
                          className="bg-transparent text-white text-[11px] font-semibold focus:outline-none cursor-pointer"
                        >
                          <option value="low" className="bg-neutral-900">Low</option>
                          <option value="medium" className="bg-neutral-900">Medium</option>
                          <option value="high" className="bg-neutral-900">High</option>
                        </select>
                      </div>

                      {/* Fullscreen */}
                      <button
                        onClick={toggleFullscreen}
                        className="p-1.5 rounded-lg hover:bg-white/15 transition-colors"
                        title="Fullscreen (F)"
                      >
                        {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
                      </button>
                    </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* ── LESSON DETAILS ──────────────────────────────────────── */}
              <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-sm border border-slate-200 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-primary uppercase tracking-wider bg-primary/10 dark:bg-primary/20 px-2.5 py-0.5 rounded-full">
                      {activeModule.title}
                    </span>
                  </div>
                  <h1 className="text-xl md:text-2xl font-bold text-slate-900 dark:text-white truncate">
                    {currentLesson?.text || `Lesson ${lessonId}`}
                  </h1>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Telegram Media Document &bull;{' '}
                    {currentLesson?.date ? new Date(currentLesson.date).toLocaleDateString() : 'Active'}
                    {duration > 0 && (
                      <span className="ml-2 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full font-medium">
                        {formatTime(duration)}
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    onClick={() => toggleBookmark(currentLessonIdNum, currentLesson?.text || '')}
                    className={clsx(
                      'flex items-center gap-2 px-5 py-2.5 rounded-xl transition-all border font-semibold text-sm shadow-xs',
                      isBookmarked
                        ? 'bg-primary/10 dark:bg-primary/20 border-primary text-primary'
                        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
                    )}
                  >
                    {isBookmarked ? <BookmarkCheck className="w-4 h-4 text-primary" /> : <Bookmark className="w-4 h-4" />}
                    {isBookmarked ? 'Bookmarked' : 'Save Lesson'}
                  </button>
                  <button
                    onClick={handleDownloadVideo}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary hover:bg-blue-700 text-white font-semibold text-sm transition-all shadow-xs"
                  >
                    <Download className="w-4 h-4" />
                    Download Video
                  </button>
                </div>
              </div>
            </div>
          </div>


          {/* ── NOTES TAB ──────────────────────────────────────────────── */}
          <div className={activeTab !== 'notes' ? 'hidden' : ''}>
            <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-sm border border-slate-200 dark:border-slate-800 space-y-6">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <FileText className="w-5 h-5 text-primary" />
                    {activeModule.title} Notes &amp; Study Material
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Download lecture notes, practice sheets, and PDF materials attached to this sub-module.
                  </p>
                </div>
                <span className="text-xs font-semibold bg-slate-100 dark:bg-slate-800 px-3 py-1 rounded-full text-slate-600 dark:text-slate-300">
                  {activeModule.notes?.length || 0} Files
                </span>
              </div>

              {(!activeModule.notes || activeModule.notes.length === 0) ? (
                <div className="p-12 text-center text-slate-500 dark:text-slate-400 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl space-y-2">
                  <FileText className="w-10 h-10 mx-auto text-slate-400 dark:text-slate-600 opacity-60" />
                  <p className="font-medium text-sm">No notes or PDF attachments in this sub-module.</p>
                  <p className="text-xs">When study materials are shared in this Telegram topic, they will appear here automatically.</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {activeModule.notes.map((note: any) => (
                    <div key={note.id} className="py-4 flex items-center justify-between gap-4 hover:bg-slate-50 dark:hover:bg-slate-800/40 px-2 rounded-xl transition-colors">
                      <div className="flex items-center gap-3.5 min-w-0">
                        <div className="bg-primary/10 dark:bg-primary/20 p-3 rounded-xl text-primary shrink-0">
                          <FileText className="w-6 h-6" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-sm text-slate-900 dark:text-white truncate">{note.file_name || 'Document'}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">{note.text}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDownloadNote(note.id)}
                        className="flex items-center gap-2 text-primary bg-primary/10 hover:bg-primary hover:text-white px-4 py-2.5 rounded-xl transition-all font-semibold text-xs border border-primary/20 shrink-0 shadow-xs"
                      >
                        <Download className="w-4 h-4" /> Download
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
      </main>
    </div>
  );
}
