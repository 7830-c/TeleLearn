import React, { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, PlusCircle, Bookmark, Sun, Moon, LogOut, Send, User } from 'lucide-react';
import { invalidateAllCache } from '../hooks/useCache';

export default function Layout({ children }: { children: React.ReactNode }) {
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    return localStorage.getItem('theme') !== 'light';
  });
  const navigate = useNavigate();
  const phone = localStorage.getItem('phone') || 'User';

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [darkMode]);

  const navItems = [
    { name: 'Dashboard', icon: LayoutDashboard, path: '/dashboard' },
    { name: 'Add Course', icon: PlusCircle, path: '/add-course' },
    { name: 'Bookmarks', icon: Bookmark, path: '/bookmarks' },
  ];

  const handleLogout = () => {
    if (window.confirm('Are you sure you want to log out of TeleLearn?')) {
      const savedTheme = localStorage.getItem('theme');
      // Purge all memory cache and localStorage cache
      invalidateAllCache();
      localStorage.clear();
      if (savedTheme) localStorage.setItem('theme', savedTheme);
      sessionStorage.clear();
      navigate('/login');
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-100 dark:bg-[#0b1120] text-slate-900 dark:text-slate-100 font-sans transition-colors duration-200 overflow-hidden">
      
      {/* Top Header (Visible on ALL screen sizes) */}
      <header className="flex glass-nav px-4 sm:px-6 lg:px-8 py-2.5 sm:py-3 items-center justify-between z-30 shrink-0 border-b border-slate-300 dark:border-slate-800">
        
        {/* Brand Logo & Name */}
        <div className="flex items-center gap-4 sm:gap-8">
          <div 
            className="flex items-center gap-2 cursor-pointer group shrink-0"
            onClick={() => navigate('/dashboard')}
          >
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-blue-600 flex items-center justify-center shadow-sm">
              <Send className="w-4 h-4 sm:w-4.5 sm:h-4.5 text-white transform -rotate-12 translate-x-0.5" />
            </div>
            <div>
              <span className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-white">
                Tele<span className="text-blue-600 dark:text-blue-400">Learn</span>
              </span>
            </div>
          </div>
          
          {/* Desktop Nav Items */}
          <nav className="hidden md:flex items-center gap-1 bg-slate-200/80 dark:bg-slate-800/80 p-1 rounded-xl border border-slate-300 dark:border-slate-700/80">
            {navItems.map((item) => (
              <NavLink
                key={item.name}
                to={item.path}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    isActive
                      ? 'bg-white dark:bg-blue-600 text-blue-600 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-300/50 dark:hover:bg-slate-700/50'
                  }`
                }
              >
                <item.icon className="w-4 h-4" />
                <span>{item.name}</span>
              </NavLink>
            ))}
          </nav>
        </div>

        {/* User Account & Actions */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* User Account Chip */}
          <div className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg bg-slate-200/70 dark:bg-slate-800/90 border border-slate-300 dark:border-slate-700 text-[11px] sm:text-xs font-medium text-slate-700 dark:text-slate-300 max-w-[130px] sm:max-w-none truncate">
            <User className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 shrink-0" />
            <span className="truncate">{phone}</span>
          </div>

          {/* Theme Toggle */}
          <button 
            onClick={() => setDarkMode(!darkMode)} 
            className="p-1.5 sm:p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors shadow-xs cursor-pointer"
            title={darkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
          >
            {darkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-700" />}
          </button>

          {/* Desktop Logout Button */}
          <button 
            onClick={handleLogout}
            className="hidden md:flex p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-500 hover:text-red-600 hover:border-red-300 dark:hover:border-red-800/60 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors shadow-xs cursor-pointer"
            title="Log Out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main View Area */}
      <main className="flex-1 overflow-y-auto relative w-full h-full flex flex-col">
        {children}
      </main>

      {/* Bottom Navigation (Mobile Only) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 glass-nav border-t border-slate-300 dark:border-slate-800 flex justify-around py-2 px-2 z-50 shadow-md">
        {navItems.map((item) => (
          <NavLink
            key={item.name}
            to={item.path}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 px-3 py-1 rounded-xl transition-all ${
                isActive 
                  ? 'text-blue-600 dark:text-blue-400 font-bold bg-blue-50 dark:bg-blue-950/40' 
                  : 'text-slate-500 dark:text-slate-400 font-medium'
              }`
            }
          >
            <item.icon className="w-4 h-4" />
            <span className="text-[10px]">{item.name}</span>
          </NavLink>
        ))}
        <button
          onClick={handleLogout}
          className="flex flex-col items-center gap-0.5 px-3 py-1 rounded-xl text-slate-500 hover:text-red-600 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          <span className="text-[10px]">Logout</span>
        </button>
      </nav>
    </div>
  );
}
