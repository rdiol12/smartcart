import React, { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { API_URL } from "../api";
import axios from "axios";

function ResetPassword() {
  const navigate = useNavigate();

  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage("");
    setError("");

    if (!token) {
      setError("קישור איפוס הסיסמה חסר או פגום");
      return;
    }

    if (newPassword !== confirmNewPassword) {
      setError("הסיסמאות אינן תואמות");
      return;
    }

    if (newPassword.length < 8) {
      setError("הסיסמה חייבת להיות באורך 8 תווים לפחות");
      return;
    }

    setSaving(true);
    try {
      const response = await axios.post(`${API_URL}/api/reset-password`, {
        token,
        newPassword,
        confirmNewPassword,
      });
      // Show the success state for a moment so the user actually sees it
      // before we kick them to /login. Previously navigate ran synchronously
      // right after setMessage, so the success alert never rendered.
      setMessage(response.data?.message || "הסיסמה אופסה בהצלחה");
      setError("");
      setTimeout(() => navigate("/login"), 1500);
    } catch (err) {
      // err.response can be undefined on network errors / CORS / server down.
      // Optional-chaining + fallback message — accessing
      // err.response.data.message directly used to throw and leave the page
      // hung with no feedback.
      setError(err.response?.data?.message || "אירעה שגיאה. נסה שוב מאוחר יותר.");
      setMessage("");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="reset-password-page" dir="rtl">
      <div className="container py-5">
        <div className="row justify-content-center">
          <div className="col-md-6">
            <div className="card shadow">
              <div className="card-body p-5">
                <h2 className="card-title text-center mb-4">איפוס סיסמה</h2>
                <form onSubmit={handleSubmit}>
                  <div className="mb-3">
                    <label htmlFor="newPassword" className="form-label">
                      סיסמה חדשה
                    </label>
                    <input
                      type="password"
                      className="form-control"
                      id="newPassword"
                      placeholder="הזן סיסמה חדשה"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      required
                      name="newPassword"
                      dir="ltr"
                    />
                  </div>
                  <div className="mb-3">
                    <label htmlFor="confirmNewPassword" className="form-label">
                      אישור סיסמה חדשה
                    </label>
                    <input
                      type="password"
                      className="form-control"
                      id="confirmNewPassword"
                      placeholder="הזן שוב את הסיסמה החדשה"
                      value={confirmNewPassword}
                      onChange={(e) => setConfirmNewPassword(e.target.value)}
                      required
                      name="confirmNewPassword"
                      dir="ltr"
                    />
                  </div>
                  <button
                    type="submit"
                    className="btn btn-primary w-100 mb-3"
                    disabled={saving}
                  >
                    {saving ? "מאפס..." : "איפוס סיסמה"}
                  </button>
                </form>
                {message && (
                  <div className="alert alert-success">{message}</div>
                )}
                {error && <div className="alert alert-danger">{error}</div>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ResetPassword;
