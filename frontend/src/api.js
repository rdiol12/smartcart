import axios from "axios";

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

    // Exact match — substring matching would also skip retry for any
    // future endpoint with "refresh" in its name (e.g. /api/refresh-feed).
    if (originalRequest.url === "/api/refresh") {
      return Promise.reject(error);
    }

    // Only TOKEN_EXPIRED is recoverable via refresh. TOKEN_INVALID (bad
    // signature, wrong type, tampered) and TOKEN_MISSING mean a fresh access
    // token won't fix anything — don't burn a refresh round-trip on them.
    // 403 means "authenticated but forbidden", also not refresh-recoverable.
    const status = error.response?.status;
    const code = error.response?.data?.code;
    const isExpired =
      status === 401 && (code === "TOKEN_EXPIRED" || code === undefined);
    if (isExpired && !originalRequest._retry) {
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
