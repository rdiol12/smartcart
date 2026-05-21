import React, { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";

// Public landing page after /api/verify-email succeeds. Two things this
// fixes from the previous version:
//   1. The whole rest of the auth flow is Hebrew (Register, Login,
//      ResetPassword, the verification email itself). This page used to
//      flip to English at the last step of the funnel — out of place.
//   2. The page is NOT wrapped in <PrivateRoute> anymore. The verify-email
//      backend redirect sets a refresh cookie but the SPA still has to
//      bootstrap a session via AuthContext's /api/refresh call; if that
//      call hits a transient network blip in the moments after the
//      redirect (very plausible: tap link in mail app on mobile), the
//      previous PrivateRoute saw !user and bounced to /login, leaving the
//      user with no signal that verification just succeeded. The success
//      message doesn't depend on a session — render it unconditionally.
const VerificationConfirmed = () => {
  const navigate = useNavigate();

  useEffect(() => {
    // Soft redirect to the user's lists once they've had a chance to read
    // the success message. Cleanup so navigating away mid-timeout doesn't
    // also fire the redirect.
    const t = setTimeout(() => navigate("/list"), 2500);
    return () => clearTimeout(t);
  }, [navigate]);

  return (
    <div className="verification-page" dir="rtl">
      <div className="container py-5">
        <div className="row justify-content-center">
          <div className="col-md-6">
            <div className="card shadow text-center">
              <div className="card-body p-5">
                <h2 className="card-title text-success mb-3">
                  המייל אומת בהצלחה
                </h2>
                <p className="lead mb-4">
                  החשבון שלך מאומת ופעיל. נעביר אותך לרשימות שלך תוך רגע…
                </p>
                <Link to="/list" className="btn btn-primary">
                  כניסה לרשימות שלי
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VerificationConfirmed;
