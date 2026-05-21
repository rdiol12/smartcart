import { useEffect, useState, useRef } from "react";
import axios from "axios";
import api, { setAccessToken, getAccessToken, API_URL } from "../api";
import socket from "../socket";
import { useNotify } from "./NotifyContext";
import { AuthContext } from "./AuthContext";

export const AuthProvider = ({ children }) => {
  const notify = useNotify();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isLinkedChild, setIsLinkedChild] = useState(false);
  const hasInitialized = useRef(false);

  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;

    const initAuth = async () => {
      try {
        const res = await axios.post(
          `${API_URL.replace(/\/$/, "")}/api/refresh`,
          {},
          { withCredentials: true },
        );
        const token = res.data.accessToken;
        setAccessToken(token);

        const userRes = await api.get("/api/me");
        setUser(userRes.data.user);
      } catch (err) {
        // 401/403 = guest visit, not an error.
        if (err.response?.status !== 401 && err.response?.status !== 403) {
          notify("לא ניתן להתחבר לשרת. נסה שוב מאוחר יותר.");
        }
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    initAuth();
  }, [notify]);

  useEffect(() => {
    if (user) {
      setIsLinkedChild(!!user.parent_id);
      const token = getAccessToken();
      if (token) socket.auth = { token };
      if (!socket.connected) socket.connect();
      socket.emit("register_user");
    } else if (socket.connected) {
      setIsLinkedChild(false);
      socket.disconnect();
    }
  }, [user]);

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100vh",
        }}
      >
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ user, setUser, loading, isLinkedChild }}>
      {children}
    </AuthContext.Provider>
  );
};
