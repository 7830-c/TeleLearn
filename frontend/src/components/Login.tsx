import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { Send, KeyRound, Smartphone, Sun, Moon, ArrowRight, CheckCircle, ShieldCheck } from 'lucide-react';

export default function Login() {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [phoneCodeHash, setPhoneCodeHash] = useState('');
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    return localStorage.getItem('theme') === 'dark';
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

  const [loginCodeSent, setLoginCodeSent] = useState(false);

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api.post('/auth/send-code', { phone });
      setPhoneCodeHash(res.data.phone_code_hash);
      setLoginCodeSent(true);
      setTimeout(() => {
        setStep(2);
        setLoginCodeSent(false);
      }, 1500);
    } catch (err: any) {
      console.error(err);
      const errorMessage = err.response?.data?.detail || err.message || "Unknown error";
      alert(`Error sending OTP code: ${errorMessage}. Please check your phone number.`);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api.post('/auth/verify-code', { phone, code, phone_code_hash: phoneCodeHash });
      if (res.data.success) {
        localStorage.setItem('phone', phone);
        navigate('/dashboard');
      } else {
        alert("Verification failed. Please check the code.");
      }
    } catch (err) {
      console.error(err);
      alert("Error verifying code.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen w-screen items-center justify-center bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors p-4 relative overflow-hidden font-sans">
      
      {/* Background Decorative Gradients */}
      <div className="absolute -top-40 -left-40 w-96 h-96 bg-primary/20 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-blue-600/20 rounded-full blur-3xl pointer-events-none" />

      {/* Top Bar Theme Toggle */}
      <button 
        onClick={() => setDarkMode(!darkMode)} 
        className="absolute top-6 right-6 p-2.5 rounded-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:text-primary transition-all shadow-sm z-20"
        title="Toggle Theme"
      >
        {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
      </button>

      {/* Main Login Card */}
      <div className="w-full max-w-md rounded-2xl bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl p-8 shadow-xl border border-slate-200/80 dark:border-slate-800/80 relative z-10 space-y-6">
        
        {/* Branding & Logo */}
        <div className="text-center space-y-2">
          <div className="w-14 h-14 bg-gradient-to-tr from-primary to-blue-500 rounded-2xl flex items-center justify-center mx-auto shadow-md text-white">
            <Send className="w-7 h-7 fill-current" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Welcome to TeleLearn</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Sign in with your Telegram account to access your courses & lectures.
          </p>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center justify-center gap-2 pt-2">
          <div className={`flex items-center gap-1 text-xs font-semibold px-3 py-1 rounded-full transition-all ${step === 1 ? 'bg-primary text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>
            <Smartphone className="w-3.5 h-3.5" /> 1. Phone
          </div>
          <div className="w-6 h-0.5 bg-slate-200 dark:bg-slate-800" />
          <div className={`flex items-center gap-1 text-xs font-semibold px-3 py-1 rounded-full transition-all ${step === 2 ? 'bg-primary text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>
            <KeyRound className="w-3.5 h-3.5" /> 2. Verify Code
          </div>
        </div>

        {step === 1 ? (
          <form onSubmit={handleSendCode} className="space-y-4 pt-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 uppercase tracking-wider">
                Telegram Phone Number
              </label>
              <div className="relative">
                <input
                  type="text"
                  placeholder="+1234567890"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || loginCodeSent}
              className={`w-full rounded-xl px-4 py-3 text-sm font-semibold text-white transition-all flex items-center justify-center gap-2 shadow-sm ${
                loginCodeSent ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-primary hover:bg-blue-700'
              } disabled:opacity-50`}
            >
              {loading ? 'Sending Code...' : loginCodeSent ? 'Login Code Sent!' : 'Send Login Code'}
              {!loading && !loginCodeSent && <ArrowRight className="w-4 h-4" />}
              {loginCodeSent && <CheckCircle className="w-4 h-4" />}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyCode} className="space-y-4 pt-2">
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                  Telegram Login Code
                </label>
                <button 
                  type="button" 
                  onClick={() => setStep(1)} 
                  className="text-xs text-primary hover:underline font-medium"
                >
                  Change Phone
                </button>
              </div>
              <input
                type="text"
                placeholder="Enter 5-digit code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 text-sm text-slate-900 dark:text-white placeholder-slate-400 text-center tracking-widest font-mono text-lg focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-all flex items-center justify-center gap-2 shadow-sm"
            >
              {loading ? 'Verifying...' : 'Verify & Enter Workspace'}
              {!loading && <CheckCircle className="w-4 h-4" />}
            </button>
          </form>
        )}

        <div className="pt-2 text-center flex items-center justify-center gap-1.5 text-xs text-slate-400 dark:text-slate-500">
          <ShieldCheck className="w-4 h-4 text-emerald-500" />
          <span>Secure MTProto Authentication</span>
        </div>
      </div>
    </div>
  );
}
