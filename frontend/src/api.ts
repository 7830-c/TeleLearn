import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:8000/api',
});

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Cache only specific heavy endpoints
const shouldCache = (url: string | undefined) => {
  if (!url) return false;
  // Cache course list, individual course structures, and channels
  return url.startsWith('/courses') && !url.includes('/sync') && !url.includes('/download') && !url.includes('/stream');
};

api.interceptors.request.use((config) => {
  if (config.method?.toLowerCase() === 'get' && shouldCache(config.url)) {
    const key = `api_cache_${config.url}`;
    const cached = localStorage.getItem(key);
    if (cached) {
      try {
        const { data, timestamp } = JSON.parse(cached);
        if (Date.now() - timestamp < CACHE_TTL) {
          // Serve from cache by short-circuiting adapter
          config.adapter = function (config) {
            return Promise.resolve({
              data,
              status: 200,
              statusText: 'OK',
              headers: {},
              config,
              request: {}
            });
          };
        }
      } catch (e) {
        localStorage.removeItem(key);
      }
    }
  }
  return config;
});

api.interceptors.response.use((response) => {
  if (response.config.method?.toLowerCase() === 'get' && shouldCache(response.config.url)) {
    const key = `api_cache_${response.config.url}`;
    localStorage.setItem(key, JSON.stringify({
      data: response.data,
      timestamp: Date.now()
    }));
  }
  return response;
});

export default api;
