import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import useCache, { invalidateCache } from '../hooks/useCache';
import { PlusCircle, Search, Layers, ChevronRight, CheckCircle, ArrowLeft } from 'lucide-react';

export default function AddCourseView() {
  const phone = localStorage.getItem('phone') || '';
  const navigate = useNavigate();

  const [searchQuery, setSearchQuery] = useState('');
  const [syncingId, setSyncingId] = useState<number | null>(null);
  const [syncedIds, setSyncedIds] = useState<number[]>([]);

  const { data: channelsData, isLoading } = useCache<{ channels: any[] }>(
    phone ? `/courses/channels?phone=${encodeURIComponent(phone)}` : null,
    { ttl: 5 * 60 * 1000 }
  );

  const channels = channelsData?.channels || [];

  const handleSync = async (channelId: number) => {
    setSyncingId(channelId);
    try {
      await api.post('/courses/sync', { phone, channel_id: channelId });
      invalidateCache('/dashboard');
      invalidateCache('/courses');
      setSyncedIds((prev) => [...prev, channelId]);
      setTimeout(() => {
        navigate('/dashboard');
      }, 700);
    } catch (err) {
      console.error('Failed to sync channel:', err);
    } finally {
      setSyncingId(null);
    }
  };

  const filteredChannels = channels.filter((c: any) => 
    (c.name || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="p-6 md:p-10 max-w-4xl mx-auto space-y-8 w-full pb-28">
      
      {/* Header */}
      <div className="space-y-3">
        <button
          onClick={() => navigate('/dashboard')}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline transition-colors cursor-pointer px-3 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-900/60"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Dashboard</span>
        </button>

        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2.5">
            <PlusCircle className="w-7 h-7 text-blue-600 dark:text-blue-400" />
            <span>Import Telegram Courses</span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-medium">
            Select any Telegram channel or forum group you have access to. TeleLearn will automatically structure lessons, video topics, and PDFs.
          </p>
        </div>
      </div>

      {/* Main Card */}
      <div className="bg-white dark:bg-[#131d31] rounded-2xl border border-slate-300 dark:border-slate-800 shadow-sm p-6 space-y-4">
        
        {/* Search Bar */}
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input 
            type="text"
            placeholder="Search your Telegram channels..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl py-2.5 pl-10 pr-4 text-xs md:text-sm font-medium focus:border-blue-600 focus:ring-2 focus:ring-blue-600/15 outline-none transition-colors dark:text-white placeholder-slate-400"
          />
        </div>

        {/* Channel List */}
        <div className="space-y-2.5 pt-1">
          {isLoading && !channelsData ? (
            <div className="space-y-2.5">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-16 rounded-xl skeleton" />
              ))}
            </div>
          ) : filteredChannels.length === 0 ? (
            <div className="p-10 text-center text-slate-500 space-y-2">
              <Layers className="w-10 h-10 mx-auto text-slate-400 opacity-50" />
              <p className="font-semibold text-xs text-slate-700 dark:text-slate-300">
                {searchQuery ? 'No matching channels found' : 'No Telegram channels found'}
              </p>
              <p className="text-[11px] text-slate-400">
                Ensure you are an active member of the Telegram channels you want to import.
              </p>
            </div>
          ) : (
            filteredChannels.map((channel: any) => {
              const isSyncing = syncingId === channel.id;
              const isSynced = syncedIds.includes(channel.id);

              return (
                <div
                  key={channel.id}
                  className="p-4 rounded-xl flex items-center justify-between gap-4 border border-slate-300 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 hover:border-blue-400 dark:hover:border-blue-600 transition-colors"
                >
                  <div className="flex items-center gap-3.5 min-w-0 flex-1">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold text-base shrink-0 border border-blue-200 dark:border-blue-900/60">
                      {channel.name ? channel.name.charAt(0).toUpperCase() : '#'}
                    </div>

                    <div className="min-w-0 space-y-0.5">
                      <h4 className="font-semibold text-xs md:text-sm text-slate-900 dark:text-white truncate">
                        {channel.name || 'Untitled Channel'}
                      </h4>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                        {channel.is_channel ? 'Broadcast Channel' : 'Group / Forum'} • ID: {channel.id}
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => handleSync(channel.id)}
                    disabled={isSyncing || isSynced}
                    className={`px-4 py-2 rounded-xl font-semibold text-xs flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer shrink-0 ${
                      isSynced
                        ? 'bg-emerald-600 text-white'
                        : 'bg-blue-600 hover:bg-blue-700 text-white'
                    } disabled:opacity-50`}
                  >
                    {isSyncing ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span>Importing...</span>
                      </>
                    ) : isSynced ? (
                      <>
                        <CheckCircle className="w-3.5 h-3.5" />
                        <span>Imported</span>
                      </>
                    ) : (
                      <>
                        <span>Import Course</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </>
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
