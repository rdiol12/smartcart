import api, { setAccessToken } from "../api";
import socket from "../socket";


export async function clearSession({ setUser, navigate, callServer = true }) {
  if (callServer) {
    try {
      await api.post("/api/logout");
    } catch (_err) {
    }
  }
  setAccessToken(null);
  setUser(null);
  if (socket.connected) socket.disconnect();
  navigate("/login");
}
