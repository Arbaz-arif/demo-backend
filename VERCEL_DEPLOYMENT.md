# Vercel Deployment Guide

## Prerequisites
1. Vercel account (sign up at vercel.com)
2. Vercel CLI installed (`npm i -g vercel`)

## Environment Variables
Set these in your Vercel dashboard under Project Settings > Environment Variables:

```
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/database-name
JWT_SECRET=your-super-secret-jwt-key-here
NODE_ENV=production
CORS_ORIGIN=https://your-frontend-domain.vercel.app
```

## Deployment Steps

### Method 1: Using Vercel CLI
1. Navigate to the backend directory:
   ```bash
   cd attendance-backend
   ```

2. Login to Vercel:
   ```bash
   vercel login
   ```

3. Deploy:
   ```bash
   vercel
   ```

4. Follow the prompts:
   - Set up and deploy? Yes
   - Which scope? (select your account)
   - Link to existing project? No
   - Project name: attendance-backend
   - Directory: ./
   - Override settings? No

### Method 2: Using Vercel Dashboard
1. Go to vercel.com/dashboard
2. Click "New Project"
3. Import your Git repository
4. Set the root directory to `attendance-backend`
5. Add environment variables
6. Deploy

## Important Notes
- Make sure your MongoDB Atlas cluster allows connections from Vercel's IP ranges
- Update your frontend API URLs to point to the Vercel deployment URL
- The backend will be available at: `https://your-project-name.vercel.app`

## File Structure
```
attendance-backend/
├── index.js (main entry point)
├── vercel.json (Vercel configuration)
├── .vercelignore (files to ignore)
├── package.json (with start script)
└── ... (other files)
```
