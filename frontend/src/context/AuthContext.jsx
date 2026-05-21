import { createContext, useEffect, useState, useRef } from "react";
import axios from "axios";
import api, { setAccessToken, API_URL } from "../api";
import socket from "../socket";
import { useNotify } from "./NotifyContext";

export const AuthContext = createContext();

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

        socket.auth = { token };
        socket.connect();
      } catch (err) {
        // 401/403 just means no active session — guest visit, not an error.
        // Anything else is a real failure (network, server down) and the user
        // deserves to know why they're being shown the guest UI.
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
