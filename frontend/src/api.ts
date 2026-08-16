import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:8000/api',
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
