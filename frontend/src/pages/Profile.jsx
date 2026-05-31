import React, { useState, useContext } from "react";
import { AuthContext } from "../context/AuthContext";
import api from "../api";
import { useNavigate, Link } from "react-router-dom";
import { useNotify } from "../context/NotifyContext";
import { clearSession } from "../auth/logoutSession";

const Profile = () => {
  const { setUser, loading, isLinkedChild } = useContext(AuthContext);
  const navigate = useNavigate();
  const notify = useNotify();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [saving, setSaving] = useState(false);

  // Delete-account state
  const [showDelete, setShowDelete] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleting, setDeleting] = useState(false);

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (newPassword !== confirmNewPassword) {
      notify("הסיסמאות החדשות אינן תואמות");
      return;
    }
    if (newPassword.length < 8) {
      notify("הסיסמה החדשה חייבת להיות באורך 8 תווים לפחות");
      return;
    }
    if (currentPassword === newPassword) {
      notify("הסיסמה החדשה חייבת להיות שונה מהסיסמה הנוכחית");
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.put("/api/user/password", {
        currentPassword,
        newPassword,
        confirmNewPassword,
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
      if (data?.loggedOut) {
        await clearSession({ setUser, navigate, callServer: false });
      } else {
        notify.success("הסיסמה שונתה בהצלחה");
      }
    } catch (err) {
      notify(err.response?.data?.message || "שינוי הסיסמה נכשל");
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = () => clearSession({ setUser, navigate });

  const handleLogoutAllDevices = async () => {
    try {
      await api.post("/api/logout-all");
      await clearSession({ setUser, navigate, callServer: false });
    } catch (err) {
      notify(err.response?.data?.message || "שגיאה בהתנתקות מכל המכשירים");
    }
  };

  const handleDeleteAccount = async (e) => {
    e.preventDefault();
    if (!deletePassword) {
      notify("יש להזין את הסיסמה כדי לאשר מחיקה");
      return;
    }
    setDeleting(true);
    try {
      await api.delete("/api/user", { data: { password: deletePassword } });
      await clearSession({ setUser, navigate, callServer: false });
    } catch (err) {
      notify(err.response?.data?.message || "מחיקת החשבון נכשלה");
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="sc-loading-page">
        <div className="sc-spinner"></div>
      </div>
    );
  }

  return (
    <div className="page-fade-in" dir="rtl">
      <div className="container py-4">
        <div className="row justify-content-center">
          <div className="col-lg-10">
            <h2 className="fw-bold mb-1">הגדרות חשבון</h2>
            <p
              className="mb-4"
              style={{ color: "var(--sc-text-muted)", fontSize: "0.9rem" }}
            >
              נהל את הפרטים והאבטחה של החשבון שלך
            </p>

            <div className="row g-4 justify-content-center">
              <div className="col-md-8 col-lg-6">
                <div className="sc-glass p-4 mb-4">
                  <h5 className="fw-bold mb-3">
                    <i
                      className="bi bi-shield-lock me-2"
                      style={{ color: "var(--sc-primary)" }}
                    ></i>
                    אבטחה
                  </h5>
                  <form onSubmit={handleChangePassword}>
                    <div className="mb-3">
                      <label
                        className="form-label fw-semibold"
                        style={{ fontSize: "0.85rem" }}
                      >
                        סיסמה נוכחית
                      </label>
                      <input
                        type="password"
                        className="form-control sc-input"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        autoComplete="current-password"
                        dir="ltr"
                      />
                    </div>
                    <div className="mb-3">
                      <label
                        className="form-label fw-semibold"
                        style={{ fontSize: "0.85rem" }}
                      >
                        סיסמה חדשה
                      </label>
                      <input
                        type="password"
                        className="form-control sc-input"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        autoComplete="new-password"
                        dir="ltr"
                      />
                    </div>
                    <div className="mb-4">
                      <label
                        className="form-label fw-semibold"
                        style={{ fontSize: "0.85rem" }}
                      >
                        אישור סיסמה חדשה
                      </label>
                      <input
                        type="password"
                        className="form-control sc-input"
                        value={confirmNewPassword}
                        onChange={(e) => setConfirmNewPassword(e.target.value)}
                        autoComplete="new-password"
                        dir="ltr"
                      />
                    </div>
                    <button
                      type="submit"
                      className="sc-btn sc-btn-ghost w-100"
                      disabled={saving}
                      style={{ padding: "10px" }}
                    >
                      עדכן סיסמה
                    </button>
                  </form>
                </div>

                {/* Family - only for parents */}
                {!isLinkedChild && (
                  <div className="sc-glass p-4 mb-4">
                    <h5 className="fw-bold mb-3">
                      <i
                        className="bi bi-people me-2"
                        style={{ color: "var(--sc-primary)" }}
                      ></i>
                      ניהול משפחה
                    </h5>
                    <p
                      style={{
                        fontSize: "0.85rem",
                        color: "var(--sc-text-muted)",
                      }}
                    >
                      צור חשבונות לילדים כדי לאשר מוצרים שהם מוסיפים
                    </p>
                    <Link
                      to="/family"
                      className="sc-btn sc-btn-primary w-100"
                      style={{
                        padding: "10px",
                        textDecoration: "none",
                        display: "block",
                        textAlign: "center",
                      }}
                    >
                      <i className="bi bi-people me-1"></i> נהל ילדים
                    </Link>
                  </div>
                )}

                {/* Session */}
                <div
                  className="sc-glass p-4 mb-4"
                  style={{ borderColor: "rgba(239, 68, 68, 0.2)" }}
                >
                  <h5
                    className="fw-bold mb-3"
                    style={{ color: "var(--sc-danger)" }}
                  >
                    <i className="bi bi-box-arrow-right me-2"></i>
                    ניהול הפעלה
                  </h5>
                  <div className="d-grid gap-2">
                    <button
                      className="sc-btn sc-btn-danger w-100"
                      onClick={handleLogout}
                      style={{ padding: "10px" }}
                    >
                      <i className="bi bi-box-arrow-right me-2"></i> התנתק
                    </button>
                    <button
                      className="sc-btn sc-btn-ghost w-100"
                      onClick={handleLogoutAllDevices}
                      style={{
                        padding: "10px",
                        color: "var(--sc-danger)",
                        borderColor: "rgba(239, 68, 68, 0.3)",
                      }}
                    >
                      <i className="bi bi-shield-exclamation me-2"></i> התנתק
                      מכל המכשירים
                    </button>
                  </div>
                </div>

                {/* Delete account — destructive, gated behind expand + password */}
                <div
                  className="sc-glass p-4"
                  style={{ borderColor: "rgba(239, 68, 68, 0.35)" }}
                >
                  <h5
                    className="fw-bold mb-3"
                    style={{ color: "var(--sc-danger)" }}
                  >
                    <i className="bi bi-trash me-2"></i>
                    מחיקת חשבון
                  </h5>
                  <p
                    style={{
                      fontSize: "0.85rem",
                      color: "var(--sc-text-muted)",
                    }}
                  >
                    מחיקת החשבון תסיר את הפרטים שלך, את חשבונות הילדים המקושרים
                    ואת כל המידע הפרטי. הפעולה אינה הפיכה.
                  </p>
                  {!showDelete ? (
                    <button
                      className="sc-btn sc-btn-ghost w-100"
                      onClick={() => setShowDelete(true)}
                      style={{
                        padding: "10px",
                        color: "var(--sc-danger)",
                        borderColor: "rgba(239, 68, 68, 0.3)",
                      }}
                    >
                      <i className="bi bi-trash me-2"></i> מחק את החשבון שלי
                    </button>
                  ) : (
                    <form onSubmit={handleDeleteAccount}>
                      <div className="mb-3">
                        <label
                          className="form-label fw-semibold"
                          style={{ fontSize: "0.85rem" }}
                        >
                          הזן סיסמה לאישור
                        </label>
                        <input
                          type="password"
                          className="form-control sc-input"
                          value={deletePassword}
                          onChange={(e) => setDeletePassword(e.target.value)}
                          autoComplete="current-password"
                          autoFocus
                          dir="ltr"
                        />
                      </div>
                      <div className="d-grid gap-2">
                        <button
                          type="submit"
                          className="sc-btn sc-btn-danger w-100"
                          disabled={deleting}
                          style={{ padding: "10px" }}
                        >
                          <i className="bi bi-exclamation-triangle me-2"></i>
                          {deleting ? "מוחק…" : "אישור מחיקת חשבון"}
                        </button>
                        <button
                          type="button"
                          className="sc-btn sc-btn-ghost w-100"
                          onClick={() => {
                            setShowDelete(false);
                            setDeletePassword("");
                          }}
                          disabled={deleting}
                          style={{ padding: "10px" }}
                        >
                          ביטול
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Profile;
