import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { BookOpen, PlayCircle, RefreshCw, Trash2, Flame, Clock, CalendarDays } from 'lucide-react';

export default function Dashboard() {
  const [courses, setCourses] = useState<any[]>([]);
  const [channels, setChannels] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncingId, setSyncingId] = useState<number | null>(null);
  const [metrics, setMetrics] = useState({ total_hours: 0, hours_today: 0, streak_days: 0 });
  const [continueWatching, setContinueWatching] = useState<any>(null);
  
  const phone = localStorage.getItem('phone');
  const navigate = useNavigate();

  useEffect(() => {
    fetchCourses();
    fetchChannels();
    fetchMetrics();
    fetchContinueWatching();
  }, []);

  const fetchMetrics = async () => {
    try {
      const res = await api.get(`/progress/metrics/${encodeURIComponent(phone || '')}`);
      setMetrics(res.data);
    } catch (err) {
      console.error("Failed to fetch metrics", err);
    }
  };

  const fetchContinueWatching = async () => {
    try {
      const res = await api.get(`/progress/continue-watching/${encodeURIComponent(phone || '')}`);
      setContinueWatching(res.data);
    } catch (err) {
      console.error("Failed to fetch continue watching", err);
    }
  };

  const fetchCourses = async () => {
    try {
      const res = await api.get('/courses/');
      setCourses(res.data.courses);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchChannels = async () => {
    try {
      const res = await api.get(`/courses/channels?phone=${encodeURIComponent(phone || '')}`);
      setChannels(res.data.channels);
    } catch (err) {
      console.error(err);
    }
  };

  const handleSync = async (channelId: number) => {
    setSyncingId(channelId);
    setLoading(true);
    try {
      await api.post('/courses/sync', { phone, channel_id: channelId });
      // Invalidate cache before fetching
      localStorage.removeItem('api_cache_/courses/');
      fetchCourses();
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
      setSyncingId(null);
    }
  };

  const handleRefresh = () => {
    localStorage.removeItem('api_cache_/courses/');
    fetchCourses();
  };

  const handleDeleteCourse = async (e: React.MouseEvent, courseId: string, title: string) => {
    e.stopPropagation();
    if (!window.confirm(`Are you sure you want to delete "${title}"?`)) return;
    try {
      await api.delete(`/courses/${courseId}`);
      fetchCourses();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-12 pb-24">
      {/* Study Metrics Dashboard */}
      <section>
        <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">Your Dashboard</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex items-center gap-5">
            <div className="bg-primary/10 dark:bg-primary/20 p-4 rounded-full text-primary">
              <Clock className="w-8 h-8" />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-500 dark:text-slate-400">Total Study Hours</div>
              <div className="text-3xl font-black text-slate-900 dark:text-white mt-1">{metrics.total_hours}</div>
            </div>
          </div>
          
          <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex items-center gap-5">
            <div className="bg-blue-500/10 dark:bg-blue-500/20 p-4 rounded-full text-blue-500">
              <CalendarDays className="w-8 h-8" />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-500 dark:text-slate-400">Hours Today</div>
              <div className="text-3xl font-black text-slate-900 dark:text-white mt-1">{metrics.hours_today}</div>
            </div>
          </div>
          
          <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex items-center gap-5">
            <div className="bg-orange-500/10 dark:bg-orange-500/20 p-4 rounded-full text-orange-500">
              <Flame className="w-8 h-8" />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-500 dark:text-slate-400">Active Streak</div>
              <div className="text-3xl font-black text-slate-900 dark:text-white mt-1">{metrics.streak_days} <span className="text-lg font-medium text-slate-500">days</span></div>
            </div>
          </div>
        </div>
      </section>

      {/* Synced Courses */}
      <section>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-primary" />
            Your Courses
          </h2>
          <button 
            onClick={handleRefresh} 
            className="text-xs text-primary flex items-center gap-1 font-semibold hover:underline"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh List
          </button>
        </div>

        {courses.length === 0 ? (
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-8 border border-dashed border-slate-200 dark:border-slate-800 text-center space-y-2">
            <BookOpen className="w-10 h-10 mx-auto text-slate-400 dark:text-slate-600 opacity-50" />
            <p className="font-medium text-sm text-slate-800 dark:text-slate-200">No synced courses found.</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">Go to Add Course to sync a Telegram channel and begin learning.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {courses.map((course: any, i: number) => {
              // Generate a pseudo-random gradient based on course ID for thumbnail
              const gradients = [
                'from-blue-500 to-cyan-500',
                'from-purple-500 to-indigo-500',
                'from-emerald-500 to-teal-500',
                'from-orange-500 to-red-500',
              ];
              const gradient = gradients[i % gradients.length];
              const initial = course.title ? course.title.charAt(0).toUpperCase() : 'C';

              return (
                <div 
                  key={course._id} 
                  className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 flex flex-col cursor-pointer hover:shadow-md hover:border-primary transition-all group overflow-hidden" 
                  onClick={() => navigate(`/course/${course._id}`)}
                >
                  {/* Thumbnail */}
                  <div className={`h-32 bg-gradient-to-br ${gradient} flex items-center justify-center relative`}>
                    <div className="text-4xl font-black text-white/30">{initial}</div>
                    
                    <div className="absolute top-3 right-3 flex gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleSync(course.channel_id); }}
                        className="p-1.5 bg-white/20 backdrop-blur-md rounded-lg text-white hover:bg-white/40 transition-colors"
                      >
                        <RefreshCw className={`w-4 h-4 ${syncingId === course.channel_id ? 'animate-spin' : ''}`} />
                      </button>
                      <button
                        onClick={(e) => handleDeleteCourse(e, course._id, course.title)}
                        className="p-1.5 bg-black/20 backdrop-blur-md rounded-lg text-white hover:bg-red-500/80 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="p-5">
                    <h3 className="font-bold text-lg text-slate-900 dark:text-white leading-snug line-clamp-2 mb-4 group-hover:text-primary transition-colors">{course.title}</h3>
                    
                    <div className="flex justify-between items-center text-xs text-slate-500 dark:text-slate-400 font-medium">
                      <span>{course.modules?.length || 0} Modules</span>
                      <span>{course.modules?.reduce((acc: number, m: any) => acc + (m.lessons?.length || 0), 0)} Lessons</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Continue Watching Shelf */}
      {continueWatching && (
        <section>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">Continue Watching</h2>
          <div 
            onClick={() => navigate(`/course/${continueWatching.course_id}/video/${continueWatching.lesson_id}`)}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 flex gap-6 items-center shadow-sm hover:shadow-md hover:border-primary transition-all cursor-pointer group max-w-2xl"
          >
            <div className="w-48 h-28 bg-slate-100 dark:bg-slate-800 rounded-xl flex items-center justify-center relative overflow-hidden shrink-0">
              <PlayCircle className="w-10 h-10 text-primary opacity-80 group-hover:scale-110 transition-transform" />
              <div className="absolute bottom-0 left-0 h-1 bg-primary" style={{ width: `${(continueWatching.progress_seconds / continueWatching.duration_seconds) * 100 || 0}%` }} />
            </div>
            <div>
              <div className="text-xs font-bold text-primary mb-1 uppercase tracking-wider">Jump Back In</div>
              <h3 className="font-bold text-lg text-slate-900 dark:text-white mb-2">Lesson {continueWatching.lesson_id}</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">
                {Math.floor(continueWatching.progress_seconds / 60)} / {Math.floor(continueWatching.duration_seconds / 60)} mins watched
              </p>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
