import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { PlusCircle, Search, Layers } from 'lucide-react';

export default function AddCourseView() {
  const [channels, setChannels] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncingId, setSyncingId] = useState<number | null>(null);
  
  const phone = localStorage.getItem('phone');
  const navigate = useNavigate();

  useEffect(() => {
    fetchChannels();
  }, []);

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
      localStorage.removeItem('api_cache_/courses/');
      navigate('/dashboard');
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
      setSyncingId(null);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8 pb-24 h-full flex flex-col">
      <div className="space-y-2">
        <h2 className="text-3xl font-bold text-slate-900 dark:text-white flex items-center gap-3">
          <PlusCircle className="w-8 h-8 text-primary" />
          Add a New Course
        </h2>
        <p className="text-slate-500 dark:text-slate-400">Import a Telegram channel or group to track progress and organize your learning.</p>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 flex-1 flex flex-col overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 flex items-center gap-4">
          <div className="relative flex-1">
            <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search your Telegram channels..." 
              className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl py-2.5 pl-10 pr-4 text-sm focus:ring-2 focus:ring-primary/50 outline-none transition-all dark:text-slate-200 placeholder:text-slate-500"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
          {channels.length === 0 ? (
            <div className="p-12 text-center text-slate-500 dark:text-slate-400 space-y-3">
              <Layers className="w-12 h-12 mx-auto text-slate-300 dark:text-slate-700" />
              <p className="font-medium text-lg">No channels found</p>
              <p className="text-sm">Make sure you are a member of the Telegram channels you want to import.</p>
            </div>
          ) : (
            channels.map((channel: any) => (
              <div key={channel.id} className="p-5 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-primary/10 dark:bg-primary/20 rounded-xl flex items-center justify-center text-primary font-bold text-lg">
                    {channel.name ? channel.name.charAt(0).toUpperCase() : '#'}
                  </div>
                  <div>
                    <h4 className="font-bold text-base text-slate-900 dark:text-white group-hover:text-primary transition-colors">{channel.name}</h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{channel.is_channel ? 'Telegram Channel' : 'Telegram Group'}</p>
                  </div>
                </div>
                <button 
                  onClick={() => handleSync(channel.id)}
                  disabled={loading && syncingId === channel.id}
                  className="bg-primary text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-all shadow-sm flex items-center gap-2"
                >
                  {loading && syncingId === channel.id ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Syncing...
                    </>
                  ) : (
                    'Import Course'
                  )}
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
