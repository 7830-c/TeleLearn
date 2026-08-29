import axios from 'axios';

// Detect environment: use localhost for local dev, Render URL for production
const isLocalDev = typeof window !== 'undefined' && 
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

export const API_HOST = import.meta.env.VITE_API_HOST || (
  isLocalDev ? 'http://localhost:8000' : 'https://telelearn.onrender.com'
);

export const API_BASE = `${API_HOST}/api`;

const api = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
});

// Simple request interceptor — just passes through.
// Caching is now handled by the useCache hook (SWR pattern).
api.interceptors.request.use((config) => {
  return config;
});

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Log but don't swallow errors — let components handle them
    if (error.response?.status === 401) {
      // Session expired — redirect to login
      localStorage.removeItem('phone');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;
