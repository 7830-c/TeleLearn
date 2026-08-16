import React, { useState, useEffect } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { Home, Library, Bookmark, Settings, Search, Sun, Moon, LogOut, PlusCircle } from 'lucide-react';
import api from '../api';

export default function Layout({ children }: { children: React.ReactNode }) {
  const [darkMode, setDarkMode] = useState<boolean>(() => localStorage.getItem('theme') === 'dark');
  const navigate = useNavigate();
  const location = useLocation();
  const phone = localStorage.getItem('phone');

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [darkMode]);

  useEffect(() => {
    // Prefetch all courses data so the UI is instantaneous when the user clicks them.
    // The api interceptor will automatically cache these GET responses.
    const prefetchData = async () => {
      try {
        const res = await api.get('/courses/');
        if (res.data && res.data.courses) {
          res.data.courses.forEach((course: any) => {
            // Background prefetch for individual course details
            api.get(`/courses/${course._id}`).catch(() => {});
          });
        }
      } catch (err) {
        console.error("Prefetch failed", err);
      }
    };
    
    // Small delay to ensure the main UI renders first
    const timer = setTimeout(prefetchData, 1000);
    return () => clearTimeout(timer);
  }, []);

  const navItems = [
    { name: 'Dashboard', icon: Home, path: '/dashboard' },
    { name: 'Add Course', icon: PlusCircle, path: '/add-course' },
    { name: 'Bookmarks', icon: Bookmark, path: '/bookmarks' },
  ];

  return (
    <div className="flex flex-col h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans transition-colors overflow-hidden">
      
      {/* Top Navigation - Desktop */}
      <header className="hidden md:flex bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 px-6 py-4 items-center justify-between z-10 shrink-0 shadow-sm">
        <div className="flex items-center gap-8">
          <h1 
            className="text-2xl font-black text-primary tracking-tight cursor-pointer"
            onClick={() => navigate('/dashboard')}
          >
            TeleLearn
          </h1>
          
          <nav className="flex items-center gap-2">
            {navItems.map((item) => (
              <NavLink
                key={item.name}
                to={item.path}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-4 py-2 rounded-xl font-medium transition-colors text-sm ${
                    isActive
                      ? 'bg-primary/10 dark:bg-primary/20 text-primary'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`
                }
              >
                <item.icon className="w-4 h-4" />
                {item.name}
              </NavLink>
            ))}
          </nav>
        </div>

        <div className="flex flex-1 max-w-md mx-6 items-center relative">
          <Search className="w-4 h-4 absolute left-3 text-slate-400" />
          <input 
            type="text" 
            placeholder="Search courses and lessons..." 
            className="w-full bg-slate-100 dark:bg-slate-800 border-none rounded-full py-2 pl-10 pr-4 text-sm focus:ring-2 focus:ring-primary/50 outline-none transition-all dark:text-slate-200 placeholder:text-slate-500"
          />
        </div>

        <div className="flex items-center gap-4">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{phone}</span>
          <button 
            onClick={() => setDarkMode(!darkMode)} 
            className="p-2 rounded-full border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-primary hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title="Toggle Theme"
          >
            {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <button 
            onClick={() => { localStorage.removeItem('phone'); navigate('/login'); }}
            className="p-2 rounded-full text-slate-400 hover:text-error hover:bg-error/10 transition-colors"
            title="Logout"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto relative w-full h-full flex flex-col">
        {children}
      </main>

      {/* Bottom Navigation - Mobile */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex justify-around p-3 z-50 safe-area-bottom shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
        {navItems.map((item) => (
          <NavLink
            key={item.name}
            to={item.path}
            className={({ isActive }) =>
              `flex flex-col items-center gap-1 p-2 rounded-xl transition-colors ${
                isActive ? 'text-primary' : 'text-slate-500 dark:text-slate-400'
              }`
            }
          >
            <item.icon className="w-5 h-5" />
            <span className="text-[10px] font-medium">{item.name}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
