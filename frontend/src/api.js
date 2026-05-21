import axios from "axios";

// `??` so an explicitly-empty VITE_API_URL keeps API_URL as ""
// (root-relative — same-origin requests via the nginx reverse proxy).
export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

const api = axios.create({
  baseURL: API_URL,
  withCredentials: true,
});

let accessToken = null;

export const setAccessToken = (token) => {
  accessToken = token;
};
export const getAccessToken = () => accessToken;

api.interceptors.request.use(
  (config) => {
    const token = getAccessToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// Concurrent 401s on a fresh page load all want to refresh at once. Without
// dedup, each one posts to /api/refresh with the same cookie, only the first
// rotation succeeds, and every other request trips the server's reuse-detection
// branch — which nukes all refresh tokens and logs the user out. Hold a single
// in-flight promise so queued callers share the result.
let refreshPromise = null;

async function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = axios
      .post(
        `${API_URL.replace(/\/$/, "")}/api/refresh`,
        {},
        { withCredentials: true },
      )
      .then((res) => res.data.accessToken)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (originalRequest.url.includes("/api/refresh")) {
      return Promise.reject(error);
    }

    // Only 401 ("token expired / invalid") is recoverable via refresh.
    // 403 means "authenticated but forbidden" — a fresh token won't change
    // that, retrying would just double the work and obscure the real error.
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      try {
        const newToken = await refreshAccessToken();
        setAccessToken(newToken);
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        setAccessToken(null);
        return Promise.reject(refreshError);
      }
    }
    return Promise.reject(error);
  },
);

export default api;
