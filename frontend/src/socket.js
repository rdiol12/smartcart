import { io } from "socket.io-client";

// Match api.js's fallback so the socket connects to the same host the REST
// client does. Previously this passed `undefined` to io() when VITE_API_URL
// was unset, which makes socket.io-client default to window.location.origin
// — fine for production behind the nginx reverse proxy, silently broken
// during plain `npm run dev` against a backend on a different port.
const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

const socket = io(API_URL, {
  autoConnect: false,
});

export default socket;
