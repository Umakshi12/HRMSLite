import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export const sendWelcomeEmail = async (userEmail, loginId, password) => {
  const isMock = !process.env.SMTP_USER || 
                 process.env.SMTP_USER.includes('your-email') || 
                 !process.env.SMTP_PASS || 
                 process.env.SMTP_PASS.includes('your-app-password');
  
  if (isMock) {
    console.log('\n=================== MOCK EMAIL SENT ===================');
    console.log(`To: ${userEmail}`);
    console.log('Subject: Welcome to SheetSync Pro - Your Access Has Been Granted');
    console.log(`Login ID: ${loginId}`);
    console.log(`Password: ${password}`);
    console.log('========================================================\n');
    return true;
  }

  const mailOptions = {
    from: process.env.EMAIL_FROM,
    to: userEmail,
    subject: 'Welcome to SheetSync Pro - Your Access Has Been Granted',
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: auto; border: 1px solid #eee; padding: 20px; border-radius: 10px;">
        <h2 style="color: #2563eb;">Welcome to SheetSync Pro</h2>
        <p>Hello,</p>
        <p>Your access to the SheetSync Pro platform has been granted successfully. You can now log in using the credentials below:</p>
        <div style="background-color: #f8fafc; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 5px 0;"><strong>Login ID:</strong> ${loginId}</p>
          <p style="margin: 5px 0;"><strong>Password:</strong> ${password}</p>
        </div>
        <p>Please log in and change your password immediately for security purposes.</p>
        <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}" style="display: inline-block; background-color: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">Login Now</a>
        <p style="margin-top: 30px; font-size: 12px; color: #64748b;">This is an automated system email. Please do not reply.</p>
      </div>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent: ' + info.response);
    return true;
  } catch (error) {
    console.error('Email Error:', error);
    return false;
  }
};
