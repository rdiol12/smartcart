import api, { setAccessToken } from "../api";
import socket from "../socket";

// Single source for "tear down the session and go to /login". Used by
// NavBar.handleLogout, Profile.handleLogout, handleLogoutAllDevices,
// handleDeleteAccount. callServer=false when the caller already invoked a
// server endpoint that invalidates refresh tokens (logout-all, delete user).
export async function clearSession({ setUser, navigate, callServer = true }) {
  if (callServer) {
    try {
      await api.post("/api/logout");
    } catch (_err) {
      // Server-side failure isn't user-actionable; we still clear local.
    }
  }
  setAccessToken(null);
  setUser(null);
  if (socket.connected) socket.disconnect();
  navigate("/login");
}
