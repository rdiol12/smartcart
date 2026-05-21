import { createContext, useEffect, useState, useRef } from "react";
import axios from "axios";
import api, { setAccessToken, getAccessToken, API_URL } from "../api";
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
        // Socket connection is handled by the [user] effect below — it
        // reads the current access token via getAccessToken() and connects
        // exactly once when user transitions to non-null, regardless of
        // whether we got here via initAuth or via the Login page.
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

  // Single source of truth for socket lifecycle. On user → non-null:
  // attach the current access token, connect (idempotent if already
  // connected), then register for notifications. On user → null:
  // disconnect. Previously both initAuth and Login.jsx called
  // socket.connect() themselves and an explicit transition (Login →
  // setUser without an initAuth pass) relied on socket.io-client's
  // emit buffering to deliver register_user. Now the connect is
  // bound to user state, not the path that produced it.
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
