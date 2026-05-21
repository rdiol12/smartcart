/**
 * Branded HTML + plain-text email template using SmartCart's actual
 * design tokens (see frontend/src/App.css :root).
 *
 *   --sc-primary:   #4f46e5
 *   --sc-bg:        #f0f2f5
 *   --sc-surface:   #ffffff
 *   --sc-text:      #1e293b
 *   --sc-text-muted:#64748b
 *   --sc-border:    #e2e8f0
 *   --sc-radius:    12px
 *   --sc-gradient:  linear-gradient(135deg, #4f46e5 0%, #7c3aed 50%, #06b6d4 100%)
 *
 * Inline styles only (most email clients strip <style> tags),
 * <table> layout for Outlook/Gmail/Apple Mail compatibility.
 */
export function renderEmail({
  title,
  intro,
  ctaText,
  ctaUrl,
  footerNote = "אם לא ביקשת זאת, אפשר להתעלם מהמייל הזה.",
}) {
  const html = `<!DOCTYPE html>
<html dir="rtl" lang="he">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="color-scheme" content="light only" />
    <meta name="supported-color-schemes" content="light only" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body dir="rtl" style="margin:0;padding:0;background:#f0f2f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Tahoma,Arial,sans-serif;color:#1e293b;direction:rtl;text-align:right;">
    <table dir="rtl" role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f0f2f5;padding:32px 16px;direction:rtl;">
      <tr>
        <td align="center" dir="rtl" style="direction:rtl;">
          <table dir="rtl" role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.08);direction:rtl;">
            <tr>
              <td dir="rtl" style="padding:36px 32px;background-color:#4f46e5;background-image:linear-gradient(135deg,#4f46e5 0%,#7c3aed 50%,#06b6d4 100%);text-align:center;direction:rtl;">
                <div style="font-size:34px;line-height:1;">🛒</div>
                <h1 style="margin:10px 0 0 0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.01em;">SmartCart</h1>
              </td>
            </tr>
            <tr>
              <td dir="rtl" style="padding:36px 32px 24px 32px;direction:rtl;text-align:right;">
                <h2 dir="rtl" style="margin:0 0 14px 0;font-size:20px;font-weight:700;color:#1e293b;letter-spacing:-0.01em;direction:rtl;text-align:right;">${escapeHtml(title)}</h2>
                <p dir="rtl" style="margin:0 0 28px 0;font-size:15px;line-height:1.65;color:#475569;direction:rtl;text-align:right;">${escapeHtml(intro)}</p>
                <table dir="rtl" role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="direction:rtl;">
                  <tr>
                    <td align="center" dir="rtl" style="direction:rtl;text-align:center;">
                      <a href="${ctaUrl}" style="display:inline-block;background-color:#4f46e5;background-image:linear-gradient(135deg,#4f46e5 0%,#6366f1 100%);color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:12px;font-weight:600;font-size:15px;box-shadow:0 4px 12px rgba(79,70,229,0.25);">${escapeHtml(ctaText)}</a>
                    </td>
                  </tr>
                </table>
                <p dir="rtl" style="margin:32px 0 0 0;font-size:13px;line-height:1.65;color:#64748b;direction:rtl;text-align:right;">
                  אם הכפתור לא עובד, הדבק את הקישור הבא בדפדפן:<br/>
                  <a href="${ctaUrl}" dir="ltr" style="color:#4f46e5;word-break:break-all;direction:ltr;unicode-bidi:embed;">${ctaUrl}</a>
                </p>
              </td>
            </tr>
            <tr>
              <td dir="rtl" style="padding:18px 32px;border-top:1px solid #e2e8f0;background:#f8fafc;text-align:center;direction:rtl;">
                <p dir="rtl" style="margin:0;font-size:12px;color:#94a3b8;line-height:1.5;direction:rtl;">SmartCart · ${escapeHtml(footerNote)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = `${title}

${intro}

${ctaText}: ${ctaUrl}

${footerNote}
— SmartCart`;

  return { html, text };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
