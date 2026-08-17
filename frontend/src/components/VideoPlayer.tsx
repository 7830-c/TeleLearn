import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api, { API_BASE } from '../api';
import useCache, { invalidateCache } from '../hooks/useCache';
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
  Zap, 
  Volume2, 
  VolumeX, 
  SkipForward, 
  SkipBack, 
  CheckCircle2, 
  Check,
  AlertCircle,
  Pencil,
  X
} from 'lucide-react';
import clsx from 'clsx';

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatDurationHoursMins(seconds: number): string {
  if (!seconds || seconds <= 0 || !isFinite(seconds)) return '0 mins';
  const totalMinutes = Math.round(seconds / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h} hr${h > 1 ? 's' : ''}`;
  return `${m} min${m > 1 ? 's' : ''}`;
}

function Spinner() {
  return (
    <div className="w-10 h-10 rounded-full border-4 border-blue-500/30 border-t-blue-500 animate-spin" />
  );
}

export default function VideoPlayer() {
  const { courseId, lessonId } = useParams();
  const navigate = useNavigate();
  const phone = localStorage.getItem('phone') || '';

  const [editingModule, setEditingModule] = useState<{ id: number; title: string } | null>(null);
  const [renameInput, setRenameInput] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);

  const { data: course, isLoading: isCourseLoading, refresh: refreshCourse } = useCache<any>(
    courseId ? `/courses/${courseId}` : null,
    { ttl: 15 * 60 * 1000 }
  );

  const { data: bookmarksData } = useCache<{ bookmarks: any[] }>(
    phone ? `/progress/bookmarks/${encodeURIComponent(phone)}` : null,
    { ttl: 2 * 60 * 1000 }
  );

  const { data: progressSummary, refresh: refreshProgress } = useCache<any>(
    courseId && phone ? `/progress/summary/${encodeURIComponent(phone)}/${courseId}` : null,
    { ttl: 2 * 60 * 1000 }
  );

  const [localBookmarks, setLocalBookmarks] = useState<number[]>([]);

  useEffect(() => {
    if (bookmarksData?.bookmarks) {
      setLocalBookmarks(bookmarksData.bookmarks.map((b: any) => b.lesson_id));
    }
  }, [bookmarksData]);

  const bookmarks: number[] = localBookmarks;
  const progressList: any[] = progressSummary?.progress || [];

  const [selectedModuleId, setSelectedModuleId] = useState<number | null>(null);
  const [isModuleDropdownOpen, setIsModuleDropdownOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'video' | 'notes'>('video');

  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressSaveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prefetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefetchVideoRef = useRef<HTMLVideoElement | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [downloadToast, setDownloadToast] = useState<string | null>(null);

  const [bufferSpeed, setBufferSpeed] = useState<'low' | 'medium' | 'high'>('medium');

  const isSeeking = useRef(false);
  const wasPlayingBeforeSeek = useRef(false);
  const prevLessonIdRef = useRef<string | undefined>(lessonId);
  const autoPlayRef = useRef(true);
  const lastSavedSecondsRef = useRef<number>(0);

  const currentLessonIdNum = parseInt(lessonId || '0');
  const currentProgress = progressList.find((p: any) => p.lesson_id === currentLessonIdNum);
  const isCurrentlyCompleted = currentProgress?.is_completed || false;

  useEffect(() => {
    if (course?.modules) {
      const mod = course.modules.find((m: any) =>
        (m.lessons || []).some((l: any) => l.id === currentLessonIdNum)
      );
      if (mod) setSelectedModuleId(mod.id);
      else if (course.modules.length > 0 && selectedModuleId === null)
        setSelectedModuleId(course.modules[0].id);
    }
  }, [course, lessonId, currentLessonIdNum, selectedModuleId]);

  const [videoError, setVideoError] = useState<string | null>(null);

  const hasRestoredProgressRef = useRef(false);
  const pendingSeekPositionRef = useRef<number | null>(null);
  const pendingPlayRef = useRef<boolean>(false);

  // Auto-scroll to top when a new video/lesson is selected on mobile
  useEffect(() => {
    if (prevLessonIdRef.current !== lessonId) {
      hasRestoredProgressRef.current = false;
      pendingSeekPositionRef.current = null;
      setVideoError(null);
      setIsPlaying(false);
      setIsBuffering(true);
      setCurrentTime(0);
      setDuration(0);
      setBuffered(0);
      isSeeking.current = false;
      wasPlayingBeforeSeek.current = false;
      prevLessonIdRef.current = lessonId;

      // Scroll view to top so user immediately sees the new video
      scrollAreaRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [lessonId]);

  const restoreSavedProgress = useCallback(() => {
    if (hasRestoredProgressRef.current) return;
    const v = videoRef.current;
    if (!v) return;

    const urlParams = new URLSearchParams(window.location.search);
    const urlTimestamp = parseInt(urlParams.get('t') || '0', 10);
    const savedSeconds = urlTimestamp > 0 ? urlTimestamp : (currentProgress?.progress_seconds || 0);

    if (savedSeconds > 5 && !currentProgress?.is_completed) {
      if (!v.duration || savedSeconds < v.duration - 5) {
        v.currentTime = savedSeconds;
        setCurrentTime(savedSeconds);
        lastSavedSecondsRef.current = savedSeconds;
      }
    }
    hasRestoredProgressRef.current = true;
  }, [currentProgress]);

  const handleToggleBufferSpeed = () => {
    const v = videoRef.current;
    const currentPos = v ? v.currentTime : currentTime;
    const wasPlaying = v ? !v.paused : isPlaying;

    // Preserve exact playback timestamp and playing state when changing buffer parallelism
    pendingSeekPositionRef.current = currentPos;
    pendingPlayRef.current = wasPlaying;

    setBufferSpeed(prev => (prev === 'low' ? 'medium' : prev === 'medium' ? 'high' : 'low'));
  };

  const handleCanPlay = useCallback(() => {
    setIsBuffering(false);
    const v = videoRef.current;
    if (v) {
      if (playbackSpeed !== 1) {
        v.playbackRate = playbackSpeed;
      }
      if (pendingSeekPositionRef.current !== null) {
        const target = pendingSeekPositionRef.current;
        pendingSeekPositionRef.current = null;
        if (target > 0) {
          v.currentTime = target;
          setCurrentTime(target);
        }
        if (pendingPlayRef.current) {
          v.play().catch(() => { });
          setIsPlaying(true);
        }
      } else {
        restoreSavedProgress();
      }
      if (autoPlayRef.current) {
        v.play().catch(() => { });
        setIsPlaying(true);
      }
      if (isSeeking.current && wasPlayingBeforeSeek.current) {
        v.play().catch(() => { });
        setIsPlaying(true);
        isSeeking.current = false;
        wasPlayingBeforeSeek.current = false;
      }
    }
  }, [restoreSavedProgress, playbackSpeed]);

  const saveProgress = async (seconds: number, dur: number, forceCompleted?: boolean) => {
    if (!dur || dur <= 0) return;
    try {
      const isCompleted = forceCompleted !== undefined ? forceCompleted : (seconds / dur >= 0.90 || isCurrentlyCompleted);
      let delta = 0;
      if (seconds > lastSavedSecondsRef.current) {
        delta = Math.floor(seconds - lastSavedSecondsRef.current);
      }
      if (delta > 30) delta = 15;
      lastSavedSecondsRef.current = seconds;

      await api.post('/progress/update', {
        phone,
        course_id: courseId,
        lesson_id: currentLessonIdNum,
        progress_seconds: Math.floor(seconds),
        duration_seconds: Math.floor(dur),
        is_completed: isCompleted,
        delta_seconds: delta
      });
      invalidateCache('/dashboard');
      invalidateCache('/progress/summary');
      refreshProgress();
    } catch (err) {
      console.error('Error saving progress:', err);
    }
  };

  const handleToggleComplete = async () => {
    const v = videoRef.current;
    const dur = v?.duration || duration || 100;
    const cur = v?.currentTime || currentTime || dur;
    await saveProgress(cur, dur, !isCurrentlyCompleted);
  };

  useEffect(() => {
    progressSaveTimerRef.current = setInterval(() => {
      const v = videoRef.current;
      if (v && !v.paused && v.duration > 0) {
        saveProgress(v.currentTime, v.duration);
      }
    }, 15000);
    return () => {
      if (progressSaveTimerRef.current) clearInterval(progressSaveTimerRef.current);
    };
  }, [lessonId, isCurrentlyCompleted]);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  // Initialize background prefetch video for instant seeking
  useEffect(() => {
    const v = document.createElement('video');
    v.preload = 'auto';
    v.muted = true;
    prefetchVideoRef.current = v;
    return () => {
      if (prefetchTimeoutRef.current) clearTimeout(prefetchTimeoutRef.current);
      prefetchVideoRef.current = null;
    };
  }, []);

  const resetControlsTimer = useCallback(() => {
    setShowControls(true);
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) {
        setShowControls(false);
      }
    }, 3500);
  }, []);

  const handlePlay = () => { setIsPlaying(true); setIsBuffering(false); };
  const handlePause = () => {
    if (isSeeking.current) return;
    setIsPlaying(false);
    setShowControls(true);
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    const v = videoRef.current;
    if (v && v.duration > 0) saveProgress(v.currentTime, v.duration);
  };
  const handleWaiting = () => setIsBuffering(true);
  const handlePlaying = () => {
    setIsBuffering(false);
    setIsPlaying(true);
    if (isSeeking.current) {
      isSeeking.current = false;
      wasPlayingBeforeSeek.current = false;
    }
  };
  const handleEnded = () => {
    setIsPlaying(false);
    setIsBuffering(false);
    setShowControls(true);
    const v = videoRef.current;
    if (v && v.duration > 0) {
      saveProgress(v.duration, v.duration, true);
    }
  };
  const handleTimeUpdate = () => {
    const v = videoRef.current;
    if (!v) return;
    setCurrentTime(v.currentTime);
    if (v.buffered.length > 0) {
      let maxBuffered = 0;
      for (let i = 0; i < v.buffered.length; i++) {
        const end = v.buffered.end(i);
        if (end > maxBuffered) maxBuffered = end;
      }
      setBuffered(v.duration > 0 ? maxBuffered / v.duration : 0);
    }
    if (v.duration > 0 && v.currentTime / v.duration >= 0.95 && !isCurrentlyCompleted) {
      saveProgress(v.currentTime, v.duration, true);
    }
  };
  const handleDurationChange = () => {
    const v = videoRef.current;
    if (v) {
      setDuration(v.duration);
      if (pendingSeekPositionRef.current !== null) {
        const target = pendingSeekPositionRef.current;
        pendingSeekPositionRef.current = null;
        if (target > 0 && target < v.duration) {
          v.currentTime = target;
          setCurrentTime(target);
        }
        if (pendingPlayRef.current) {
          v.play().catch(() => { });
          setIsPlaying(true);
        }
      }
    }
  };

  const handleVideoError = async (e: any) => {
    console.error('Video error event:', e);
    setIsBuffering(false);
    setIsPlaying(false);

    try {
      const res = await fetch(streamUrl);
      if (res.status === 401) {
        setVideoError('Telegram session expired or used on another device. Please log in again to re-authenticate.');
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setVideoError(data?.detail || 'Unable to stream video chunks from Telegram.');
        return;
      }
    } catch {}

    const err = videoRef.current?.error;
    let msg = 'Failed to load video stream from Telegram.';
    if (err?.code === 4) {
      msg = 'The browser could not decode this video container/format. You can download the full video for offline playback below.';
    } else if (err?.code === 2) {
      msg = 'Network connection issue while downloading stream chunks.';
    }
    setVideoError(msg);
  };

  const handleSeeking = () => {
    isSeeking.current = true;
    setIsBuffering(true);
  };

  const handleSeeked = () => {
    setIsBuffering(false);
    if (wasPlayingBeforeSeek.current && videoRef.current) {
      videoRef.current.play().catch(() => { });
      setIsPlaying(true);
    }
    isSeeking.current = false;
    wasPlayingBeforeSeek.current = false;
  };

  // Robust play/pause toggle that handles initial loading & buffering state reliably
  const togglePlayPause = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;

    if (isPlaying) {
      // Pause immediately
      autoPlayRef.current = false;
      v.pause();
      setIsPlaying(false);
      setIsBuffering(false);
    } else {
      // Play
      autoPlayRef.current = true;
      v.play().catch(() => { });
      setIsPlaying(true);
    }
    resetControlsTimer();
  }, [isPlaying, resetControlsTimer]);

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    wasPlayingBeforeSeek.current = !v.paused;
    isSeeking.current = true;
    const t = (parseFloat(e.target.value) / 100) * v.duration;
    v.currentTime = t;
    setCurrentTime(t);
  };

  const handleScrubberMouseMove = (e: React.MouseEvent<HTMLInputElement>) => {
    if (!duration || duration <= 0 || !streamUrl) return;

    // Calculate hover percentage
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    const targetTime = Math.max(0, Math.min(1, pct)) * duration;

    // Debounce the prefetch to avoid spamming the network while moving mouse fast
    if (prefetchTimeoutRef.current) clearTimeout(prefetchTimeoutRef.current);
    prefetchTimeoutRef.current = setTimeout(() => {
      const pVideo = prefetchVideoRef.current;
      if (pVideo) {
        // If src isn't set yet, set it
        if (!pVideo.src || pVideo.src !== streamUrl) {
          pVideo.src = streamUrl;
        }
        // Seeking the hidden video triggers the browser to cache that byte range!
        pVideo.currentTime = targetTime;
      }
    }, 150);
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
    wasPlayingBeforeSeek.current = !v.paused;
    isSeeking.current = true;
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

  const toggleBookmark = async (id: number, title: string) => {
    // 1. Optimistic instant UI update on single click
    const willBookmark = !localBookmarks.includes(id);
    setLocalBookmarks(prev =>
      willBookmark ? [...prev, id] : prev.filter(bId => bId !== id)
    );

    try {
      const res = await api.post('/progress/bookmark', { phone, lesson_id: id, course_id: courseId, title });
      invalidateCache('/progress/bookmarks');
      invalidateCache('/dashboard');
      if (res.data && typeof res.data.bookmarked === 'boolean') {
        const isServerBookmarked = res.data.bookmarked;
        setLocalBookmarks(prev =>
          isServerBookmarked ? (prev.includes(id) ? prev : [...prev, id]) : prev.filter(bId => bId !== id)
        );
      }
    } catch (err) {
      console.error('Error toggling bookmark:', err);
      // Revert on error
      setLocalBookmarks(prev =>
        willBookmark ? prev.filter(bId => bId !== id) : [...prev, id]
      );
    }
  };

  // Download with file size prompt and instant background download trigger
  const handleDownloadVideo = (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (!course) return;

    // Compute file size display
    let sizeText = 'Full Video';
    if (currentLesson?.size) {
      const mb = (currentLesson.size / (1024 * 1024)).toFixed(1);
      sizeText = `${mb} MB`;
    } else if (duration > 0) {
      const estMb = Math.round(duration * 0.18);
      sizeText = `~${estMb} MB`;
    }

    const lessonName = currentLesson?.file_name || currentLesson?.text || `Lesson ${lessonId}`;
    const proceed = window.confirm(
      `Download "${lessonName}"?\n\nFile Size: ${sizeText}\n\nDo you want to download this video for offline playback?`
    );

    if (!proceed) return;

    setDownloadToast(`Starting download: "${lessonName}" (${sizeText})... Check your browser's download manager.`);
    setTimeout(() => setDownloadToast(null), 6000);

    const url = `${API_BASE}/courses/download/${encodeURIComponent(phone)}/${course.channel_id}/${lessonId}`;

    // Non-scrolling background download trigger
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = url;
    document.body.appendChild(iframe);
    setTimeout(() => {
      try { document.body.removeChild(iframe); } catch { }
    }, 60000);
  };

  const handleDownloadNote = (note: any, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (!course) return;
    const noteName = note.file_name || note.text || 'Study Document';
    let sizeText = note.size ? `${(note.size / 1024 / 1024).toFixed(1)} MB` : 'PDF Document';

    const proceed = window.confirm(
      `Download "${noteName}"?\n\nFile Size: ${sizeText}\n\nDo you want to download this study note?`
    );
    if (!proceed) return;

    setDownloadToast(`Starting download: "${noteName}" (${sizeText})... Check your browser's download manager.`);
    setTimeout(() => setDownloadToast(null), 6000);

    const url = `${API_BASE}/courses/download/${encodeURIComponent(phone)}/${course.channel_id}/${note.id}`;
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = url;
    document.body.appendChild(iframe);
    setTimeout(() => {
      try { document.body.removeChild(iframe); } catch { }
    }, 60000);
  };

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

  if (isCourseLoading && !course) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-100 dark:bg-[#0b1120] text-slate-900 dark:text-slate-100">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="font-semibold text-xs text-slate-500">Loading course player...</p>
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
          Back to Dashboard
        </button>
      </div>
    );
  }

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
      if (course && course.modules) {
        const targetMod = course.modules.find((m: any) => m.id === editingModule.id);
        if (targetMod) targetMod.title = newTitle;
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

  const activeModule =
    course.modules?.find((m: any) => m.id === selectedModuleId) ||
    course.modules?.[0] || { lessons: [], notes: [], title: 'Module' };

  const currentLesson = course.modules
    ?.flatMap((m: any) => m.lessons || [])
    .find((l: any) => l.id === currentLessonIdNum);

  const isBookmarked = bookmarks.includes(currentLessonIdNum);

  const moduleLessons = activeModule.lessons || [];
  const totalModuleLessonsCount = moduleLessons.length;
  const completedModuleLessonsCount = moduleLessons.filter((lesson: any) =>
    progressList.some((p: any) => p.lesson_id === lesson.id && p.is_completed)
  ).length;
  const moduleCompletionPercentage = totalModuleLessonsCount > 0
    ? Math.round((completedModuleLessonsCount / totalModuleLessonsCount) * 100)
    : 0;

  // Calculate total module video content hours
  const totalModuleSeconds = moduleLessons.reduce((acc: number, l: any) => acc + (l.duration || 0), 0);
  const moduleTotalHoursStr = totalModuleSeconds >= 3600
    ? `${(totalModuleSeconds / 3600).toFixed(1)} hrs`
    : totalModuleSeconds > 0
    ? `${Math.round(totalModuleSeconds / 60)} mins`
    : null;

  const streamUrl = `${API_BASE}/courses/stream/${encodeURIComponent(phone)}/${course.channel_id}/${lessonId}?quality=${bufferSpeed}`;
  const posterUrl = `${API_BASE}/courses/thumbnail/${encodeURIComponent(phone)}/${course.channel_id}/${lessonId}`;

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferedPct = buffered * 100;

  // Reusable Playlist & Progress Section (Progress is placed AT THE TOP above Sub-Module selector!)
  const renderPlaylistItems = () => (
    <div className="flex flex-col h-full space-y-3">

      {/* ── SUB-MODULE PROGRESS AT THE TOP ─────────────────────────────────── */}
      <div className="p-3 bg-blue-50/60 dark:bg-blue-950/40 rounded-xl border border-blue-200 dark:border-blue-900/60 text-[11px] text-slate-700 dark:text-slate-300 space-y-1.5 shrink-0">
        <div className="flex justify-between items-center font-bold text-xs">
          <span className="truncate pr-2 flex items-center gap-1.5">
            <span>Module Progress</span>
            {moduleTotalHoursStr && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/80 text-blue-700 dark:text-blue-300">
                {moduleTotalHoursStr}
              </span>
            )}
          </span>
          <span className="text-blue-600 dark:text-blue-400 shrink-0">
            {completedModuleLessonsCount} / {totalModuleLessonsCount} ({moduleCompletionPercentage}%)
          </span>
        </div>
        <div className="w-full bg-slate-200 dark:bg-slate-700 h-2 rounded-full overflow-hidden">
          <div
            className="bg-blue-600 dark:bg-blue-500 h-full rounded-full transition-all duration-300"
            style={{ width: `${moduleCompletionPercentage}%` }}
          />
        </div>
      </div>

      {/* ── SUB-MODULE SELECTOR ───────────────────────────────────────────── */}
      <div className="p-2.5 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-800 relative shrink-0">
        <div className="flex items-center justify-between mb-1">
          <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <Layers className="w-3 h-3 text-blue-600 dark:text-blue-400" />
            <span>Sub-Module</span>
          </label>
          <button
            onClick={(e) => handleStartRename(activeModule, e)}
            className="p-1 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/60 dark:hover:text-blue-400 transition-colors cursor-pointer"
            title="Rename active module"
          >
            <Pencil className="w-3 h-3" />
          </button>
        </div>
        <button
          onClick={() => setIsModuleDropdownOpen(!isModuleDropdownOpen)}
          className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg p-2 flex items-center justify-between text-left text-xs font-semibold text-slate-900 dark:text-white shadow-xs cursor-pointer"
        >
          <span className="truncate">{activeModule.title}</span>
          <ChevronDown className={clsx('w-3.5 h-3.5 text-slate-400 transition-transform', isModuleDropdownOpen && 'rotate-180')} />
        </button>

        {isModuleDropdownOpen && (
          <div className="absolute top-full left-2.5 right-2.5 sm:left-3 sm:right-3 mt-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl shadow-xl z-40 max-h-56 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700">
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
                  'p-2.5 text-xs flex items-center justify-between cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/60 transition-colors',
                  activeModule.id === mod.id
                    ? 'bg-blue-50 dark:bg-blue-950/60 font-bold text-blue-600 dark:text-blue-400'
                    : 'text-slate-700 dark:text-slate-200'
                )}
              >
                <span className="truncate">{mod.title}</span>
                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                  <span className="text-[10px] text-slate-400 bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded">
                    {mod.lessons?.length || 0} vids
                  </span>
                  <button
                    onClick={(e) => handleStartRename(mod, e)}
                    className="p-1 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-100 dark:hover:bg-blue-900/60 transition-colors cursor-pointer"
                    title="Rename module"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── VIDEO LECTURES LIST ───────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto space-y-1.5 pr-0.5">
        {(!activeModule.lessons || activeModule.lessons.length === 0) ? (
          <div className="p-6 text-center text-xs text-slate-400 font-medium">
            No video lectures in this sub-module.
          </div>
        ) : (
          activeModule.lessons.map((lesson: any, idx: number) => {
            const isActive = lesson.id === currentLessonIdNum;
            const isLessonDone = progressList.some((p: any) => p.lesson_id === lesson.id && p.is_completed);

            return (
              <div
                key={lesson.id}
                onClick={() => {
                  if (isActive) return;
                  autoPlayRef.current = true;
                  navigate(`/course/${courseId}/video/${lesson.id}`);
                }}
                className={clsx(
                  'p-2.5 rounded-xl cursor-pointer flex items-center gap-2.5 transition-all border text-xs',
                  isActive
                    ? 'bg-blue-600 text-white border-blue-600 shadow-xs font-semibold'
                    : 'bg-white dark:bg-slate-800/60 border-slate-200 dark:border-slate-800 hover:border-blue-400 dark:hover:border-blue-600 text-slate-800 dark:text-slate-200'
                )}
              >
                <div className={clsx(
                  'w-6 h-6 rounded-lg flex items-center justify-center shrink-0 text-xs font-bold',
                  isActive ? 'bg-white/20 text-white' : isLessonDone ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60' : 'bg-slate-100 dark:bg-slate-700 text-slate-500'
                )}>
                  {isLessonDone ? <Check className="w-3.5 h-3.5" /> : idx + 1}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="truncate font-medium leading-snug">{lesson.text || `Lecture ${idx + 1}`}</p>
                  <p className={clsx('text-[10px]', isActive ? 'text-white/70' : 'text-slate-400')}>
                    {lesson.duration ? formatDurationHoursMins(lesson.duration) : 'Video'}
                  </p>
                </div>

                {isActive && (
                  <span className="bg-white text-blue-600 text-[9px] font-bold px-1.5 py-0.5 rounded uppercase shrink-0">
                    Playing
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col lg:flex-row h-full w-full bg-slate-100 dark:bg-[#0b1120] text-slate-900 dark:text-slate-100 overflow-hidden font-sans transition-colors relative">

      {/* Download Alert Toast */}
      {downloadToast && (
        <div className="fixed bottom-20 sm:bottom-6 right-4 sm:right-6 z-50 bg-slate-900 dark:bg-blue-600 text-white px-4 py-3 rounded-2xl shadow-2xl border border-slate-700 flex items-center gap-2.5 text-xs font-semibold max-w-sm">
          <Download className="w-4 h-4 shrink-0 text-blue-400 dark:text-white animate-bounce" />
          <span className="truncate">{downloadToast}</span>
        </div>
      )}

      {/* ── DESKTOP SIDEBAR (Visible on Desktop lg+) ──────────────────────── */}
      <aside className="hidden lg:flex w-88 bg-white dark:bg-[#131d31] border-r border-slate-300 dark:border-slate-800 flex-col h-full shrink-0 shadow-xs z-20 p-4">
        <div className="pb-3 mb-1 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 shrink-0">
          <button
            onClick={() => navigate(`/course/${courseId}`)}
            className="flex items-center gap-2 text-slate-800 dark:text-slate-200 hover:text-blue-600 dark:hover:text-blue-400 font-semibold text-xs transition-colors truncate cursor-pointer"
            title="Return to Course Modules"
          >
            <ArrowLeft className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
            <span className="truncate">{course.title}</span>
          </button>
        </div>

        {renderPlaylistItems()}
      </aside>

      {/* ── MAIN CONTENT AREA (Scrolls naturally & smoothly, auto-scrolls to top on video change) ── */}
      <main
        ref={scrollAreaRef}
        className="flex-1 flex flex-col h-full overflow-y-auto bg-slate-100 dark:bg-[#0b1120]"
      >

        {/* Mobile Top Navigation Header */}
        <div className="flex lg:hidden items-center justify-between px-4 py-2.5 bg-white dark:bg-[#131d31] border-b border-slate-300 dark:border-slate-800 shrink-0 z-20">
          <button
            onClick={() => navigate(`/course/${courseId}`)}
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200"
          >
            <ArrowLeft className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <span className="truncate max-w-[200px]">{course.title}</span>
          </button>
          <span className="text-[11px] font-bold text-blue-600 dark:text-blue-400">
            {completedModuleLessonsCount}/{totalModuleLessonsCount} Done
          </span>
        </div>

        {/* Unified Scrollable Container */}
        <div className="p-3 sm:p-6 lg:p-8 max-w-5xl mx-auto w-full space-y-4 sm:space-y-6 pb-36">

          {/* ── CURVED VIDEO PLAYER FRAME (Elegant rounded curves & clean borders) ── */}
          <div
            ref={containerRef}
            onMouseMove={resetControlsTimer}
            onMouseLeave={() => { if (isPlaying) setShowControls(false); }}
            onClick={togglePlayPause}
            className="bg-black rounded-2xl sm:rounded-3xl overflow-hidden shadow-lg aspect-video relative border border-slate-800/80 cursor-pointer select-none group w-full"
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
              onSeeking={handleSeeking}
              onSeeked={handleSeeked}
              onEnded={handleEnded}
              onError={handleVideoError}
              onTimeUpdate={handleTimeUpdate}
              onDurationChange={handleDurationChange}
              onLoadedMetadata={handleDurationChange}
              className="w-full h-full object-contain"
            />

            {/* Playback Error Overlay */}
            {videoError && (
              <div 
                onClick={(e) => e.stopPropagation()}
                className="absolute inset-0 z-40 bg-black/90 flex flex-col items-center justify-center p-6 text-center space-y-3 cursor-default"
              >
                <div className="w-12 h-12 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center">
                  <AlertCircle className="w-6 h-6" />
                </div>
                <div className="max-w-md space-y-1">
                  <h4 className="text-sm font-bold text-white">Playback Notice</h4>
                  <p className="text-xs text-slate-400">{videoError}</p>
                </div>
                <div className="flex items-center gap-3 pt-2 flex-wrap justify-center">
                  {videoError.toLowerCase().includes('log in') || videoError.toLowerCase().includes('session') ? (
                    <button
                      onClick={() => navigate('/login')}
                      className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs transition-colors cursor-pointer shadow-xs"
                    >
                      Log In Again
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        setVideoError(null);
                        setIsBuffering(true);
                        if (videoRef.current) {
                          videoRef.current.load();
                          videoRef.current.play().catch(() => {});
                        }
                      }}
                      className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs transition-colors cursor-pointer shadow-xs"
                    >
                      Retry Playback
                    </button>
                  )}
                  <button
                    onClick={handleDownloadVideo}
                    className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs transition-colors cursor-pointer border border-slate-700"
                  >
                    Download Video
                  </button>
                </div>
              </div>
            )}

            {/* Buffering Spinner */}
            {isBuffering && !videoError && (
              <div className="absolute inset-0 flex items-center justify-center z-20 bg-black/40 pointer-events-none">
                <Spinner />
              </div>
            )}

            {/* Center Play Button when Paused */}
            {!isPlaying && !isBuffering && !videoError && (
              <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
                <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-full bg-blue-600/90 text-white flex items-center justify-center shadow-xl transition-transform scale-100 group-hover:scale-105">
                  <Play className="w-6 h-6 sm:w-8 sm:h-8 fill-current ml-0.5" />
                </div>
              </div>
            )}

            {/* Controls Bar Overlay */}
            <div
              onClick={(e) => e.stopPropagation()}
              className={clsx(
                'absolute bottom-0 left-0 right-0 z-30 transition-opacity duration-300',
                showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
              )}
            >
              <div className="h-20 bg-gradient-to-t from-black/95 via-black/60 to-transparent absolute bottom-0 left-0 right-0 pointer-events-none" />

              <div className="relative px-3 sm:px-4 pb-2.5 sm:pb-3.5 pt-4 space-y-1.5 sm:space-y-2">

                {/* Scrub Bar */}
                <div className="relative h-2 group/seek flex items-center">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={0.01}
                    value={progressPct}
                    onChange={handleSeek}
                    onMouseMove={handleScrubberMouseMove}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    title="Seek"
                  />
                  <div className="absolute inset-x-0 h-1 bg-white/20 rounded-full" />
                  <div
                    className="absolute top-0.5 left-0 h-1 bg-white/40 rounded-full transition-all"
                    style={{ width: `${bufferedPct}%` }}
                  />
                  <div
                    className="absolute top-0.5 left-0 h-1 bg-blue-500 rounded-full transition-all"
                    style={{ width: `${progressPct}%` }}
                  />
                  <div
                    className="absolute w-3.5 h-3.5 bg-white rounded-full shadow-md pointer-events-none"
                    style={{ left: `calc(${progressPct}% - 7px)` }}
                  />
                </div>

                {/* Controls Row */}
                <div className="flex items-center justify-between text-white gap-2">

                  {/* Left: Play, Skips, Time */}
                  <div className="flex items-center gap-1 sm:gap-2">
                    <button
                      onClick={() => skipSeconds(-10)}
                      className="p-1 sm:p-1.5 rounded-lg hover:bg-white/20 transition-colors"
                      title="Rewind 10s"
                    >
                      <SkipBack className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    </button>

                    <button
                      onClick={togglePlayPause}
                      className="w-7 h-7 sm:w-9 sm:h-9 rounded-full bg-blue-600 hover:bg-blue-500 flex items-center justify-center transition-colors shadow-sm"
                      title={isPlaying ? 'Pause' : 'Play'}
                    >
                      {isBuffering ? (
                        <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                      ) : isPlaying ? (
                        <Pause className="w-3.5 h-3.5 sm:w-4 sm:h-4 fill-current" />
                      ) : (
                        <Play className="w-3.5 h-3.5 sm:w-4 sm:h-4 fill-current ml-0.5" />
                      )}
                    </button>

                    <button
                      onClick={() => skipSeconds(10)}
                      className="p-1 sm:p-1.5 rounded-lg hover:bg-white/20 transition-colors"
                      title="Forward 10s"
                    >
                      <SkipForward className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    </button>

                    {/* Volume Slider on Desktop */}
                    <div className="hidden md:flex items-center gap-1">
                      <button onClick={toggleMute} className="p-1 rounded-lg hover:bg-white/20">
                        {isMuted || volume === 0 ? <VolumeX className="w-3.5 h-3.5 text-red-400" /> : <Volume2 className="w-3.5 h-3.5" />}
                      </button>
                      <input
                        type="range" min={0} max={1} step={0.05}
                        value={isMuted ? 0 : volume}
                        onChange={handleVolumeChange}
                        className="w-14 accent-blue-500 cursor-pointer"
                      />
                    </div>

                    {/* Time Text */}
                    <span className="text-[10px] sm:text-xs font-mono text-white/90 select-none font-medium ml-1">
                      {formatTime(currentTime)} <span className="text-white/40">/ {formatTime(duration)}</span>
                    </span>
                  </div>

                  {/* Right: Speed, Buffer Quality, Fullscreen */}
                  <div className="flex items-center gap-1 sm:gap-2">
                    <div className="flex items-center bg-white/15 rounded-lg px-1 sm:px-1.5 py-0.5">
                      <Gauge className="w-3 h-3 text-blue-400 mr-1 hidden sm:block" />
                      {[1, 1.25, 1.5, 2].map((spd) => (
                        <button
                          key={spd}
                          onClick={() => handleSpeedChange(spd)}
                          className={clsx(
                            'px-1 sm:px-1.5 py-0.5 rounded text-[9px] sm:text-[10px] font-bold transition-colors',
                            playbackSpeed === spd ? 'bg-blue-600 text-white' : 'text-white/70 hover:text-white'
                          )}
                        >
                          {spd}x
                        </button>
                      ))}
                    </div>

                    <button
                      onClick={handleToggleBufferSpeed}
                      className="bg-white/15 hover:bg-white/25 px-1.5 py-0.5 rounded-lg text-[9px] sm:text-[10px] font-bold text-amber-400 flex items-center gap-0.5 cursor-pointer"
                      title={`Buffer parallelism: ${bufferSpeed === 'low' ? '1x' : bufferSpeed === 'medium' ? '2x' : '3x'}`}
                    >
                      <Zap className="w-2.5 h-2.5" />
                      <span>{bufferSpeed === 'low' ? '1x' : bufferSpeed === 'medium' ? '2x' : '3x'}</span>
                    </button>

                    <button
                      onClick={toggleFullscreen}
                      className="p-1 sm:p-1.5 rounded-lg hover:bg-white/20 transition-colors"
                      title="Fullscreen"
                    >
                      {isFullscreen ? <Minimize className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> : <Maximize className="w-3.5 h-3.5 sm:w-4 sm:h-4" />}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── LESSON DETAILS & 3 ACTION BUTTONS IN A SINGLE ROW ─────────── */}
          <div className="bg-white dark:bg-[#131d31] rounded-2xl p-4 sm:p-5 border border-slate-300 dark:border-slate-800 shadow-xs space-y-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-block px-2.5 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 text-[11px] font-semibold">
                  {activeModule.title}
                </span>
                {isCurrentlyCompleted && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 text-[11px] font-bold border border-emerald-200 dark:border-emerald-800">
                    <CheckCircle2 className="w-3 h-3" />
                    <span>Finished</span>
                  </span>
                )}
              </div>

              <h1 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white leading-snug">
                {currentLesson?.file_name || currentLesson?.text || `Lesson ${lessonId}`}
              </h1>

              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                Telegram Media • {currentLesson?.date ? new Date(currentLesson.date).toLocaleDateString() : 'Active Lecture'} • {duration > 0 ? formatDurationHoursMins(duration) : 'Video'}
              </p>
            </div>

            {/* 3 Buttons in a Single Crisp Horizontal Row */}
            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">

              {/* Button 1: Mark Complete */}
              <button
                onClick={handleToggleComplete}
                className={clsx(
                  'flex items-center justify-center gap-1 sm:gap-1.5 py-2 px-1 sm:px-3 rounded-xl font-semibold text-[11px] sm:text-xs transition-colors cursor-pointer border shadow-xs text-center truncate',
                  isCurrentlyCompleted
                    ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                    : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-emerald-500 hover:text-emerald-600'
                )}
              >
                <CheckCircle2 className={clsx("w-3.5 h-3.5 shrink-0", isCurrentlyCompleted ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400")} />
                <span className="truncate">{isCurrentlyCompleted ? 'Finished' : 'Mark Done'}</span>
              </button>

              {/* Button 2: Save / Bookmark */}
              <button
                onClick={() => toggleBookmark(currentLessonIdNum, currentLesson?.text || currentLesson?.file_name || '')}
                className={clsx(
                  'flex items-center justify-center gap-1 sm:gap-1.5 py-2 px-1 sm:px-3 rounded-xl font-semibold text-[11px] sm:text-xs transition-colors cursor-pointer border shadow-xs text-center truncate',
                  isBookmarked
                    ? 'bg-blue-50 dark:bg-blue-950/60 border-blue-200 dark:border-blue-900/60 text-blue-600 dark:text-blue-400'
                    : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-blue-400'
                )}
              >
                {isBookmarked ? <BookmarkCheck className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" /> : <Bookmark className="w-3.5 h-3.5 shrink-0" />}
                <span className="truncate">{isBookmarked ? 'Bookmarked' : 'Save'}</span>
              </button>

              {/* Button 3: Download (Shows confirmation with size) */}
              <button
                onClick={handleDownloadVideo}
                className="flex items-center justify-center gap-1 sm:gap-1.5 py-2 px-1 sm:px-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-[11px] sm:text-xs transition-colors cursor-pointer shadow-xs text-center truncate"
                title="Download lecture video"
              >
                <Download className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">Download</span>
              </button>
            </div>
          </div>

          {/* ── MOBILE PLAYLIST & NOTES SECTION (Visible on Phone/Tablet < lg) ── */}
          <div className="block lg:hidden bg-white dark:bg-[#131d31] rounded-2xl p-4 border border-slate-300 dark:border-slate-800 shadow-xs space-y-3">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2">
              <div className="flex gap-4">
                <button
                  onClick={() => setActiveTab('video')}
                  className={clsx(
                    'pb-1 font-bold text-xs transition-colors relative flex items-center gap-1.5',
                    activeTab === 'video' ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500'
                  )}
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>Lectures ({activeModule.lessons?.length || 0})</span>
                  {activeTab === 'video' && <div className="absolute -bottom-2 left-0 right-0 h-0.5 bg-blue-600" />}
                </button>

                <button
                  onClick={() => setActiveTab('notes')}
                  className={clsx(
                    'pb-1 font-bold text-xs transition-colors relative flex items-center gap-1.5',
                    activeTab === 'notes' ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500'
                  )}
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Notes ({activeModule.notes?.length || 0})</span>
                  {activeTab === 'notes' && <div className="absolute -bottom-2 left-0 right-0 h-0.5 bg-blue-600" />}
                </button>
              </div>
            </div>

            {activeTab === 'video' ? renderPlaylistItems() : (
              <div className="space-y-2">
                {(!activeModule.notes || activeModule.notes.length === 0) ? (
                  <p className="text-center py-6 text-xs text-slate-400">No notes in this sub-module.</p>
                ) : (
                  activeModule.notes.map((note: any) => (
                    <div key={note.id} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 flex items-center justify-between gap-3 border border-slate-200 dark:border-slate-800">
                      <div className="min-w-0">
                        <p className="font-semibold text-xs text-slate-900 dark:text-white truncate">{note.file_name || 'Note Document'}</p>
                        <p className="text-[10px] text-slate-400">{note.size > 0 ? `${(note.size / 1024 / 1024).toFixed(1)} MB` : 'PDF'}</p>
                      </div>
                      <button
                        onClick={() => handleDownloadNote(note)}
                        className="px-3 py-1 rounded-lg bg-blue-600 text-white font-semibold text-[11px] flex items-center gap-1 shrink-0 cursor-pointer"
                      >
                        <Download className="w-3 h-3" />
                        <span>Download</span>
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* ── DESKTOP NOTES SECTION (Visible on Desktop lg+) ─────────────── */}
          <div className="hidden lg:block">
            <div className="bg-white dark:bg-[#131d31] rounded-2xl p-5 border border-slate-300 dark:border-slate-800 shadow-xs space-y-3">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2.5">
                <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <FileText className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <span>{activeModule.title} &bull; Study Notes &amp; PDFs</span>
                </h2>
                <span className="text-xs font-semibold bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded text-slate-600 dark:text-slate-300">
                  {activeModule.notes?.length || 0} Files
                </span>
              </div>

              {(!activeModule.notes || activeModule.notes.length === 0) ? (
                <div className="p-6 text-center text-slate-400 text-xs font-medium border border-slate-200 dark:border-slate-800 rounded-xl">
                  No notes or PDF attachments in this sub-module.
                </div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {activeModule.notes.map((note: any) => (
                    <div key={note.id} className="py-2.5 flex items-center justify-between gap-4">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 flex items-center justify-center shrink-0 border border-sky-100 dark:border-sky-900/40">
                          <FileText className="w-3.5 h-3.5" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-xs md:text-sm text-slate-900 dark:text-white truncate">
                            {note.file_name || 'Study Document'}
                          </p>
                          <p className="text-[10px] text-slate-400 truncate">
                            {note.size > 0 ? `${(note.size / 1024 / 1024).toFixed(1)} MB` : 'PDF Document'}
                          </p>
                        </div>
                      </div>

                      <button
                        onClick={() => handleDownloadNote(note)}
                        className="flex items-center gap-1 px-3 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-600 text-blue-600 dark:text-blue-400 hover:text-white font-semibold text-xs transition-colors cursor-pointer shrink-0 border border-blue-200 dark:border-blue-900/60"
                      >
                        <Download className="w-3 h-3" />
                        <span>Download</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

        </div>
      </main>

      {/* Rename Module Modal */}
      {editingModule && (
        <div 
          onClick={(e) => e.stopPropagation()}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fadeIn"
        >
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
