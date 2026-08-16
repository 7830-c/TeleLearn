# TeleLearn Deployment Guide (Render + Vercel)

This guide shows how to deploy your unified GitHub repository:
- **Backend**: [Render.com](https://render.com/) (Free Web Service)
- **Frontend**: [Vercel.com](https://vercel.com/) (Free SPA Hosting)

---

## Part 1: Deploy Backend on Render (Free Tier)

### Option A: 1-Click Blueprint (Recommended)
1. Go to your [Render Dashboard](https://dashboard.render.com/).
2. Click **New +** $\rightarrow$ **Blueprint**.
3. Connect your GitHub repository (`TeleLearn`).
4. Render will automatically detect `render.yaml`.
5. Enter the values for the secrets when prompted:
   - `DATABASE_URL`: Your Supabase async connection string (`postgresql+asyncpg://...`)
   - `ENCRYPTION_KEY`: Your Fernet key from `backend/.env`
6. Click **Apply**.

---

### Option B: Manual Web Service Setup
1. On [Render](https://dashboard.render.com/), click **New +** $\rightarrow$ **Web Service**.
2. Connect your GitHub repository.
3. Configure the service settings:
   - **Name**: `telelearn-backend`
   - **Language**: `Python 3`
   - **Root Directory**: `backend`
   - **Build Command**: `pip install --upgrade pip && pip install -r requirements.txt`
   - **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
   - **Instance Type**: **Free**
4. Under **Environment Variables**, add:
   - `PYTHON_VERSION`: `3.12.0`
   - `DATABASE_URL`: `postgresql+asyncpg://postgres.drevurcsxsjssbtjipoh:ac435002Telelearn@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`
   - `ENCRYPTION_KEY`: `bSHtwD22ewQx70FxoKXPTobfkh-FgDcL2jlsxIDNbBM=`
   - `TELEGRAM_API_ID`: `34979954`
   - `TELEGRAM_API_HASH`: `55a2f5c696725c26d9b2373e7c1ba1ad`
5. Click **Create Web Service**.

> **Your Backend URL will look like**:
> `https://telelearn-backend.onrender.com`

---

## Part 2: Deploy Frontend on Vercel

1. Go to your [Vercel Dashboard](https://vercel.com/).
2. Click **Add New...** $\rightarrow$ **Project** $\rightarrow$ Import your GitHub repository.
3. In **Project Configuration**:
   - **Root Directory**: Click *Edit* and choose **`frontend`**.
   - **Framework Preset**: Vite (auto-detected).
4. Under **Environment Variables**, add:
   - `VITE_API_HOST`: `https://telelearn-backend.onrender.com` *(your Render URL, no trailing slash)*
5. Click **Deploy**.

---

## Summary Checklist
- [x] `render.yaml` created for automatic Render deployment.
- [x] `backend/requirements.txt` contains all necessary dependencies.
- [x] `frontend/vercel.json` configured for SPA routing.
- [x] `.gitignore` protecting secrets, virtualenvs, sessions, and builds.
- [x] Zero-disk streaming and automated 24h thumbnail pruning ready for free cloud limits.
