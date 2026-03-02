# BookOn – Full-stack deploy (backend + React frontend)

Short guide to deploy both the Node backend and the React frontend.

---

## Order

1. **Backend first** – API must be live so the frontend can use it.
2. **Frontend second** – Build with production API URL and deploy.

---

## 1. Backend (BookOn)

- **Repo/folder:** `BookOn` (this project).
- **Details:** See [DEPLOY.md](./DEPLOY.md).

```bash
cd BookOn
cp .env.example .env
# Edit .env: MONGO_URL, SESSION_SECRET, SECRET_TOKEN, PORT; optional: FRONTEND_URL
npm install
npm run build
pm2 start ecosystem.config.cjs --env production
pm2 save && pm2 startup
```

- **Result:** API + admin EJS at `http://your-server:3003` (and `/admin`).
- **Optional:** Put Nginx in front and use a domain (e.g. `https://api.yourdomain.com`).

---

## 2. Frontend (BookOn- React)

- **Repo/folder:** `BookOn- React` (separate project).
- **Details:** See [BookOn- React/DEPLOY-FRONTEND.md](../BookOn-%20React/DEPLOY-FRONTEND.md) (or open the React project and read `DEPLOY-FRONTEND.md`).

```bash
cd "BookOn- React"
cp .env.example .env
# Set REACT_APP_API_URL to your backend URL (e.g. https://api.yourdomain.com)
npm install
npm run build
```

Then either:

- **Vercel / Netlify:** Connect the repo, set `REACT_APP_API_URL`, deploy (they run `npm run build`).
- **Your server:** Upload the `build/` folder and serve it with Nginx (see DEPLOY-FRONTEND.md).

---

## 3. Env summary

| Where        | Variable             | Example / note                          |
|-------------|----------------------|-----------------------------------------|
| Backend     | `MONGO_URL`          | MongoDB connection string               |
| Backend     | `SESSION_SECRET`     | Random string                           |
| Backend     | `SECRET_TOKEN`       | JWT secret                              |
| Backend     | `FRONTEND_URL` (opt) | `https://your-app.vercel.app` (CORS)    |
| Frontend    | `REACT_APP_API_URL`  | `https://api.yourdomain.com` (no slash)|

---

## 4. Quick check

- Backend: open `https://api.yourdomain.com` (or `http://server:3003`) – health/API responds.
- Admin: open `https://api.yourdomain.com/admin` – EJS admin panel.
- Frontend: open the deployed React URL – app loads and API calls go to backend (check network tab).
