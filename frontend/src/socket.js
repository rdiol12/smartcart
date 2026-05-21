import { io } from "socket.io-client";

// REST goes through Vercel rewrites so cookies stay first-party (Safari ITP),
// but socket.io can't ride the same proxy: Vercel Hobby kills long-polling at
// ~10s while engine.io holds polls open for ~25s, so emits die silently with
// no error. Socket talks straight to Render — cross-origin is fine because
// it authenticates via socket.auth.token, not the cookie.
const SOCKET_URL =
  import.meta.env.VITE_SOCKET_URL ||
  import.meta.env.VITE_API_URL ||
  "http://localhost:8000";

const socket = io(SOCKET_URL, {
  autoConnect: false,
  withCredentials: true,
});

export default socket;
