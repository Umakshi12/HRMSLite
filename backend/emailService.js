import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

const APP_NAME = process.env.APP_NAME || 'SheetSync Pro';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || null;

const isMockMode = () =>
  !process.env.SMTP_USER ||
  process.env.SMTP_USER.includes('your-email') ||
  !process.env.SMTP_PASS ||
  process.env.SMTP_PASS.includes('your-app-password');

const getTransporter = () =>
  nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

export const getServiceAccountEmail = () => SERVICE_ACCOUNT_EMAIL;

export const sendWelcomeEmail = async (userEmail, loginId, password, name = '') => {
  const sharingSection = SERVICE_ACCOUNT_EMAIL
    ? `
      <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:14px 18px;margin:20px 0;">
        <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#0369a1;">📋 To connect a Google Sheet to ${APP_NAME}:</p>
        <p style="margin:0 0 4px;font-size:13px;color:#0c4a6e;">Share your spreadsheet with the email below as <strong>Editor</strong>:</p>
        <p style="margin:6px 0;font-size:13px;font-family:monospace;background:#e0f2fe;padding:6px 10px;border-radius:5px;word-break:break-all;">${SERVICE_ACCOUNT_EMAIL}</p>
        <p style="margin:6px 0 0;font-size:11px;color:#64748b;">Then paste the Spreadsheet ID or link in the Spreadsheet Manager inside the app.</p>
      </div>`
    : '';

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:auto;border:1px solid #e2e8f0;padding:30px;border-radius:12px;">
      <div style="text-align:center;margin-bottom:24px;">
        <div style="display:inline-block;background:#2563eb;border-radius:12px;padding:12px 20px;">
          <span style="color:white;font-size:18px;font-weight:800;">${APP_NAME}</span>
        </div>
      </div>

      <h2 style="color:#1e293b;margin:0 0 8px;">Welcome${name ? `, ${name}` : ''}! 👋</h2>
      <p style="color:#475569;margin:0 0 20px;">Your account has been created. Use the credentials below to sign in.</p>

      <div style="background:#f8fafc;border:1px solid #e2e8f0;padding:18px;border-radius:8px;margin:0 0 20px;">
        <p style="margin:0 0 8px;font-size:13px;color:#64748b;">🔑 <strong>Your login credentials</strong></p>
        <p style="margin:4px 0;font-size:14px;color:#1e293b;"><strong>Login ID:</strong> <span style="font-family:monospace;background:#e2e8f0;padding:2px 6px;border-radius:4px;">${loginId}</span></p>
        <p style="margin:4px 0;font-size:14px;color:#1e293b;"><strong>Password:</strong> <span style="font-family:monospace;background:#e2e8f0;padding:2px 6px;border-radius:4px;">${password}</span></p>
        <p style="margin:4px 0;font-size:12px;color:#94a3b8;">(You can also use your email address to sign in)</p>
      </div>

      <p style="color:#ef4444;font-size:13px;margin:0 0 20px;">⚠️ Please change your password immediately after signing in.</p>

      ${sharingSection}

      <div style="text-align:center;margin:24px 0;">
        <a href="${FRONTEND_URL}" style="display:inline-block;background:#2563eb;color:white;padding:12px 28px;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px;">
          Sign In Now →
        </a>
      </div>

      <p style="font-size:11px;color:#94a3b8;text-align:center;margin:0;">
        This is an automated message from ${APP_NAME}. Do not reply to this email.
      </p>
    </div>`;

  if (isMockMode()) {
    console.log('\n======== MOCK WELCOME EMAIL ========');
    console.log(`To: ${userEmail}`);
    console.log(`Name: ${name}`);
    console.log(`Login ID: ${loginId}`);
    console.log(`Password: ${password}`);
    console.log(`Login URL: ${FRONTEND_URL}`);
    if (SERVICE_ACCOUNT_EMAIL) console.log(`Service Account: ${SERVICE_ACCOUNT_EMAIL}`);
    console.log('=====================================\n');
    return { sent: false, mock: true };
  }

  try {
    const info = await getTransporter().sendMail({
      from: process.env.EMAIL_FROM || process.env.SMTP_USER,
      to: userEmail,
      subject: `Your ${APP_NAME} access has been granted`,
      html,
    });
    console.log(`[Email] Welcome email sent to ${userEmail}: ${info.response}`);
    return { sent: true };
  } catch (error) {
    console.error('[Email] Send failed:', error.message);
    return { sent: false, error: error.message };
  }
};
