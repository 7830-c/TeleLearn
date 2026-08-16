import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { invalidateAllCache } from '../hooks/useCache';
import { Send, KeyRound, Smartphone, Sun, Moon, ArrowRight, CheckCircle2, ShieldCheck, Lock, AlertCircle } from 'lucide-react';

export default function Login() {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [phoneCodeHash, setPhoneCodeHash] = useState('');
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [loginCodeSent, setLoginCodeSent] = useState(false);
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    return localStorage.getItem('theme') !== 'light';
  });
  
  const navigate = useNavigate();

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [darkMode]);

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    if (!phone.trim()) {
      setErrorMsg('Please enter your Telegram phone number');
      return;
    }
    setLoading(true);
    try {
      const res = await api.post('/auth/send-code', { phone: phone.trim() });
      setPhoneCodeHash(res.data.phone_code_hash);
      setLoginCodeSent(true);
      setTimeout(() => {
        setStep(2);
        setLoginCodeSent(false);
      }, 900);
    } catch (err: any) {
      console.error(err);
      const msg = err.response?.data?.detail || err.message || 'Failed to send OTP code. Verify your phone number with country code (e.g. +91...)';
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    if (!code.trim()) {
      setErrorMsg('Please enter the verification code');
      return;
    }
    setLoading(true);
    try {
      const res = await api.post('/auth/verify-code', { 
        phone: phone.trim(), 
        code: code.trim(), 
        phone_code_hash: phoneCodeHash 
      });
      if (res.data.success) {
        invalidateAllCache();
        localStorage.setItem('phone', phone.trim());
        navigate('/dashboard');
      } else if (res.data.requires_password) {
        setStep(3);
      } else {
        setErrorMsg('Verification failed. Please check the code and try again.');
      }
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.response?.data?.detail || 'Invalid verification code.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    if (!password) {
      setErrorMsg('Please enter your Telegram 2FA cloud password');
      return;
    }
    setLoading(true);
    try {
      const res = await api.post('/auth/verify-password', {
        phone: phone.trim(),
        password: password
      });
      if (res.data.success) {
        invalidateAllCache();
        localStorage.setItem('phone', phone.trim());
        navigate('/dashboard');
      }
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.response?.data?.detail || 'Invalid 2FA password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen w-screen flex items-center justify-center p-4 bg-slate-100 dark:bg-[#0b1120] text-slate-900 dark:text-slate-100 transition-colors duration-200">
      
      {/* Subtle Background Accent */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-blue-600/10 dark:bg-blue-600/15 rounded-full blur-3xl pointer-events-none" />

      {/* Top Header Theme Toggle */}
      <div className="absolute top-6 right-6 flex items-center gap-3 z-20">
        <button 
          onClick={() => setDarkMode(!darkMode)} 
          className="p-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors shadow-xs cursor-pointer"
          title="Toggle Theme"
        >
          {darkMode ? <Sun className="w-5 h-5 text-amber-400" /> : <Moon className="w-5 h-5 text-slate-700" />}
        </button>
      </div>

      {/* Main Card */}
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#131d31] p-8 md:p-10 shadow-lg border border-slate-300 dark:border-slate-800 relative z-10 space-y-7">
        
        {/* Branding */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-600 text-white shadow-md shadow-blue-600/20">
            <Send className="w-7 h-7 transform -rotate-12 translate-x-0.5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Tele<span className="text-blue-600 dark:text-blue-400">Learn</span>
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-medium">
              High-speed learning platform synced with your Telegram courses
            </p>
          </div>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center justify-center gap-2">
          <div className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-lg transition-colors ${step === 1 ? 'bg-blue-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>
            <Smartphone className="w-3.5 h-3.5" /> Phone
          </div>
          <div className="w-4 h-0.5 bg-slate-300 dark:bg-slate-700" />
          <div className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-lg transition-colors ${step === 2 ? 'bg-blue-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>
            <KeyRound className="w-3.5 h-3.5" /> Code
          </div>
          {step === 3 && (
            <>
              <div className="w-4 h-0.5 bg-slate-300 dark:bg-slate-700" />
              <div className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-lg bg-blue-600 text-white">
                <Lock className="w-3.5 h-3.5" /> 2FA
              </div>
            </>
          )}
        </div>

        {/* Error Notification */}
        {errorMsg && (
          <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/60 text-red-600 dark:text-red-400 text-xs font-medium">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <p className="flex-1 leading-relaxed">{errorMsg}</p>
          </div>
        )}

        {/* Step 1: Phone */}
        {step === 1 && (
          <form onSubmit={handleSendCode} className="space-y-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                Telegram Phone Number
              </label>
              <div className="relative">
                <input
                  type="tel"
                  placeholder="+91 98XXX XXXXX"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 px-4 py-3 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 outline-none transition-colors"
                  required
                  autoFocus
                />
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Include country code (e.g. +91 for India, +1 for US)
              </p>
            </div>

            <button
              type="submit"
              disabled={loading || loginCodeSent}
              className={`w-full rounded-xl px-5 py-3 text-sm font-semibold text-white transition-colors flex items-center justify-center gap-2 cursor-pointer ${
                loginCodeSent 
                  ? 'bg-emerald-600' 
                  : 'bg-blue-600 hover:bg-blue-700 shadow-sm'
              } disabled:opacity-50`}
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Connecting to Telegram...</span>
                </>
              ) : loginCodeSent ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Code Sent!</span>
                </>
              ) : (
                <>
                  <span>Send Login Code</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        )}

        {/* Step 2: OTP Code */}
        {step === 2 && (
          <form onSubmit={handleVerifyCode} className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                  Telegram Login Code
                </label>
                <button 
                  type="button" 
                  onClick={() => { setStep(1); setErrorMsg(''); }} 
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-medium cursor-pointer"
                >
                  Change Phone
                </button>
              </div>
              <input
                type="text"
                placeholder="•••••"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                maxLength={6}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 px-4 py-3 text-center tracking-[0.4em] font-mono text-xl font-bold text-slate-900 dark:text-white placeholder-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 outline-none transition-colors"
                required
                autoFocus
              />
              <p className="text-[11px] text-center text-slate-500 dark:text-slate-400">
                Enter the code sent to your Telegram app
              </p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-blue-600 hover:bg-blue-700 px-5 py-3 text-sm font-semibold text-white shadow-sm disabled:opacity-50 transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Verifying...</span>
                </>
              ) : (
                <>
                  <span>Verify & Enter Dashboard</span>
                  <CheckCircle2 className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        )}

        {/* Step 3: 2FA Password */}
        {step === 3 && (
          <form onSubmit={handleVerifyPassword} className="space-y-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                Two-Step Verification Password
              </label>
              <input
                type="password"
                placeholder="Enter your Telegram 2FA password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 px-4 py-3 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 outline-none transition-colors"
                required
                autoFocus
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-blue-600 hover:bg-blue-700 px-5 py-3 text-sm font-semibold text-white shadow-sm disabled:opacity-50 transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Authenticating...</span>
                </>
              ) : (
                <>
                  <Lock className="w-4 h-4" />
                  <span>Unlock Workspace</span>
                </>
              )}
            </button>
          </form>
        )}

        {/* Security badge */}
        <div className="pt-2 flex items-center justify-center gap-2 text-xs text-slate-500 font-medium">
          <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <span>Encrypted Telegram MTProto Session</span>
        </div>
      </div>
    </div>
  );
}
