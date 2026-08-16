import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { PlayCircle, Bookmark as BookmarkIcon, Trash2 } from 'lucide-react';

export default function BookmarksView() {
  const [bookmarks, setBookmarks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const phone = localStorage.getItem('phone');
  const navigate = useNavigate();

  useEffect(() => {
    fetchBookmarks();
  }, []);

  const fetchBookmarks = async () => {
    try {
      const res = await api.get(`/progress/bookmarks/${encodeURIComponent(phone || '')}`);
      setBookmarks(res.data.bookmarks || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const removeBookmark = async (e: React.MouseEvent, lessonId: number, title: string) => {
    e.stopPropagation();
    try {
      await api.post('/progress/bookmark', { phone, lesson_id: lessonId, title });
      fetchBookmarks();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-3">
          <BookmarkIcon className="w-8 h-8 text-primary" />
          Your Bookmarks
        </h1>
        <p className="text-slate-500 dark:text-slate-400 mt-2">Quickly access your saved lessons and documents.</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : bookmarks.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-12 border border-dashed border-slate-200 dark:border-slate-800 text-center space-y-3">
          <BookmarkIcon className="w-12 h-12 mx-auto text-slate-300 dark:text-slate-700" />
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">No bookmarks yet</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">Save lessons from the course explorer to quickly access them later.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {bookmarks.map((b) => (
            <div 
              key={b._id}
              className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md hover:border-primary transition-all cursor-pointer group flex flex-col justify-between"
              onClick={() => {
                // We'd ideally need the courseId as well to route directly to it.
                // Currently bookmarks don't store course_id. We'll add a note or navigate generically if possible.
                // For now, this is a placeholder navigation.
                alert(`Routing to lesson ${b.lesson_id} is incomplete because course_id is missing from Bookmark model.`);
              }}
            >
              <div className="flex justify-between items-start mb-4">
                <div className="bg-primary/10 dark:bg-primary/20 p-2.5 rounded-xl">
                  <PlayCircle className="w-5 h-5 text-primary" />
                </div>
                <button 
                  onClick={(e) => removeBookmark(e, b.lesson_id, b.title)}
                  className="p-1.5 text-slate-400 hover:text-red-500 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                  title="Remove bookmark"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              
              <h3 className="font-semibold text-slate-900 dark:text-white line-clamp-2 mb-2 group-hover:text-primary transition-colors">
                {b.title}
              </h3>
              
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Lesson ID: {b.lesson_id}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
