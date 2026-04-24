# HRMSLite

HRMSLite is a modern, full-stack Human Resources Management System designed to seamlessly synchronize candidate and staffing data between a robust React frontend and a Google Sheets database.

## 🚀 Features
- **Real-Time Google Sheets Sync:** Add, edit, and remove candidates with instantaneous updates to Google Sheets.
- **Cross-Sheet Migrations:** Move candidates between different staffing categories seamlessly.
- **Admin Dashboard:** Granular user control, including password generation and sheet-level access permissions.
- **Advanced Filtering & AI Search:** Search candidates rapidly across thousands of rows.

## 🏗️ Architecture
- **Frontend:** React + Vite, Zustand (State Management), TanStack Query (Caching & Server State), Tailwind CSS (Styling)
- **Backend:** Node.js, Express, `googleapis` (Sheet integration), Zod (Validation)

## 🛠️ Getting Started

### Prerequisites
- Node.js (v18+)
- A Google Service Account with `credentials.json` (Needs Google Sheets API enabled and the Service Account email must have "Editor" access to your target spreadsheet)

### Backend Setup
1. Navigate to the backend directory:
   ```bash
   cd backend
   npm install
   ```
2. Create a `.env` file in the `backend` folder:
   ```env
   PORT=3000
   SPREADSHEET_ID=your_spreadsheet_id_here
   GOOGLE_CREDENTIALS_PATH=./credentials.json
   JWT_SECRET=super_secure_secret
   FRONTEND_URL=http://localhost:5173
   ```
3. Start the backend:
   ```bash
   npm run dev
   ```

### Frontend Setup
1. Navigate to the frontend directory:
   ```bash
   cd frontend
   npm install
   ```
2. Configure your Environment Variables in `frontend/.env`:
   ```env
   VITE_API_URL=http://localhost:3000/api
   ```
3. Start the development server:
   ```bash
   npm run dev
   ```

## 🌍 Deployment

### Deploying the Backend (Render / Railway)
1. Commit the code to GitHub.
2. Link the repository to your chosen PaaS (e.g., Render).
3. Set the Root Directory to `backend`.
4. Ensure the `.env` variables are added to the environment configuration on the platform.

### Deploying the Frontend (GitHub Pages / Vercel)
A GitHub action workflow is included in `.github/workflows/deploy-frontend.yml` to automatically deploy the frontend to GitHub Pages upon pushing to the `main` or `master` branch.
*Note: Ensure your `vite.config.js` sets the `base` property to your GitHub repository name if using GitHub Pages.*
