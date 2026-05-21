import React, { useState, useContext } from "react";
import { Link, useNavigate } from "react-router-dom";
import api, { setAccessToken } from "../api";
import { AuthContext } from "../context/AuthContext";

const Login = () => {
  const { setUser } = useContext(AuthContext);
  const navigate = useNavigate();

  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!loginId.trim()) {
      setError("יש להזין אימייל או שם משתמש");
      return;
    }
    if (!password) {
      setError("יש להזין סיסמה");
      return;
    }
    // Backend's minimum is 8. The client-side guard used to say `< 6` and
    // returned "wrong password" on 6-7 char attempts, which is a lie — the
    // request would never reach the server. Match the backend and tell the
    // user what's actually wrong.
    if (password.length < 8) {
      setError("הסיסמה חייבת להיות באורך 8 תווים לפחות");
      return;
    }

    setLoading(true);
    try {
      // Route by full-shape email check, not .includes("@"). The schema
      // doesn't forbid `@` in usernames, so "joe@home" used to land on the
      // email branch and get rejected by the server-side isEmail validator
      // — login impossible for that user. Simple HTML5-ish pattern is
      // enough to distinguish "looks like an email" from "is a username".
      const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginId);
      const body = looksLikeEmail
        ? { email: loginId, password }
        : { username: loginId, password };
      const res = await api.post("/api/login", body);
      setAccessToken(res.data.accessToken);
      // setUser triggers AuthContext's [user] effect which attaches socket.auth
      // and connects. Don't duplicate that here; previously this page set
      // socket.auth + socket.connect inline, contradicting AuthContext's
      // comment that it's the single source of truth for the socket lifecycle.
      setUser(res.data.user);
      navigate("/");
    } catch (err) {
      const message = err.response?.data?.message;
      setError(message || "ההתחברות נכשלה. נסה שוב.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="sc-auth-page" dir="rtl">
      <div className="sc-auth-card page-fade-in">
        <div className="text-center mb-4">
          <Link to="/" style={{ textDecoration: "none" }}>
            <span
              className="sc-text-gradient"
              style={{ fontSize: "2rem", fontWeight: 800 }}
            >
              <i className="bi bi-cart3"></i> SmartCart
            </span>
          </Link>
        </div>

        <h2>ברוכים השבים</h2>
        <p className="sc-auth-subtitle">התחבר כדי לנהל את הרשימות שלך</p>

        {error && (
          <div
            className="alert alert-danger py-2 text-center"
            style={{ borderRadius: "10px", fontSize: "0.9rem" }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="mb-3">
            <label
              className="form-label fw-semibold"
              style={{ fontSize: "0.9rem" }}
            >
              אימייל או שם משתמש
            </label>
            <input
              type="text"
              className="form-control sc-input"
              placeholder="אימייל או שם משתמש"
              value={loginId}
              onChange={(e) => setLoginId(e.target.value)}
              required
              dir="ltr"
            />
          </div>

          <div className="mb-4">
            <div className="d-flex justify-content-between align-items-center">
              <label
                className="form-label fw-semibold mb-0"
                style={{ fontSize: "0.9rem" }}
              >
                סיסמה
              </label>
              <Link
                to="/forgot-password"
                style={{ fontSize: "0.8rem", color: "var(--sc-primary)" }}
              >
                שכחת סיסמה?
              </Link>
            </div>
            <input
              type="password"
              className="form-control sc-input mt-1"
              placeholder="הכנס סיסמה"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              dir="ltr"
            />
          </div>

          <button
            type="submit"
            className="sc-btn sc-btn-primary w-100"
            disabled={loading}
            style={{ padding: "12px", fontSize: "1rem" }}
          >
            {loading && (
              <span className="spinner-border spinner-border-sm me-2"></span>
            )}
            {loading ? "מתחבר..." : "התחברות"}
          </button>
        </form>

        <p
          className="text-center mt-4 mb-0"
          style={{ fontSize: "0.9rem", color: "var(--sc-text-muted)" }}
        >
          אין לך חשבון?{" "}
          <Link
            to="/register"
            style={{ color: "var(--sc-primary)", fontWeight: 600 }}
          >
            הרשם כאן
          </Link>
        </p>
      </div>
    </div>
  );
};

export default Login;
