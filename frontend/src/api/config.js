export const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export const getPhotoUrl = (url) => {
  if (!url) return null;
  if (url.startsWith('http')) return url;
  return `${BASE_URL}${url}`;
};
