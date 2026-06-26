import { google } from 'googleapis';
import prisma from './prisma/client.js';
import dotenv from 'dotenv';

dotenv.config();

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

export const getAuthUrl = (state) => {
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.metadata.readonly',
      'https://www.googleapis.com/auth/userinfo.email'
    ],
    prompt: 'consent',
    state: state // usually the ownerLoginId
  });
};

export const handleCallback = async (code, ownerLoginId) => {
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  // Get user info to get the google email
  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
  const userInfo = await oauth2.userinfo.get();

  const googleEmail = userInfo.data.email;

  // Save or update tokens in DB
  const data = {
    owner_login_id: ownerLoginId,
    google_email: googleEmail,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token, // only provided on first auth or with prompt=consent
    expiry: new Date(tokens.expiry_date),
    scope: tokens.scope
  };

  // If refresh_token is missing (already authorized), we might need to prompt again
  // but for simplicity, we assume we get it or have it.
  
  await prisma.googleOAuthToken.upsert({
    where: { owner_login_id: ownerLoginId },
    update: {
      access_token: tokens.access_token,
      ...(tokens.refresh_token && { refresh_token: tokens.refresh_token }),
      expiry: new Date(tokens.expiry_date),
      updated_at: new Date()
    },
    create: {
      owner_login_id: ownerLoginId,
      google_email: googleEmail,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || '',
      iv: '',
      expiry: new Date(tokens.expiry_date),
      scope: tokens.scope
    }
  });

  return { googleEmail };
};

export const getAuthorizedClient = async (ownerLoginId) => {
  const tokenRecord = await prisma.googleOAuthToken.findUnique({
    where: { owner_login_id: ownerLoginId }
  });

  if (!tokenRecord) return null;

  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  client.setCredentials({
    access_token: tokenRecord.access_token,
    refresh_token: tokenRecord.refresh_token,
    expiry_date: tokenRecord.expiry.getTime()
  });

  // Check if token is expired
  if (tokenRecord.expiry.getTime() <= Date.now()) {
    const { credentials } = await client.refreshAccessToken();
    await prisma.googleOAuthToken.update({
      where: { owner_login_id: ownerLoginId },
      data: {
        access_token: credentials.access_token,
        expiry: new Date(credentials.expiry_date),
        updated_at: new Date()
      }
    });
  }

  return google.sheets({ version: 'v4', auth: client });
};
