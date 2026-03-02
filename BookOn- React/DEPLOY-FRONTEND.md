# BookOn React – Frontend deploy

## 1. Environment

Create `.env` from `.env.example` and set the backend API URL:

```env
# Local development
REACT_APP_API_URL=http://localhost:3003

# Production (after backend is deployed)
# REACT_APP_API_URL=https://api.yourdomain.com
```

Use the **exact** backend URL (no trailing slash). The app uses this in `MemberService`, `ProductService`, `OrderService`.

## 2. Local

```bash
cp .env.example .env
npm install
npm start          # dev: http://localhost:3000
# or
npm run build      # production build → build/
```

## 3. Deploy (choose one)

### A. Vercel

1. Push the React project to GitHub.
2. [vercel.com](https://vercel.com) → Import project → select repo.
3. Root directory: project root (where `package.json` is).
4. Environment variable: `REACT_APP_API_URL` = your backend URL (e.g. `https://api.yourdomain.com`).
5. Deploy. Frontend will be at `https://your-project.vercel.app`.

### B. Netlify

1. Push to GitHub.
2. [netlify.com](https://netlify.com) → Add new site → Import from Git.
3. Build command: `npm run build`, Publish directory: `build`.
4. Add env var: `REACT_APP_API_URL` = backend URL.
5. Deploy.

### C. Your server (Nginx)

1. On your machine: `npm run build`.
2. Upload the contents of the `build/` folder to the server (e.g. `/var/www/bookon-frontend`).
3. Nginx example:

```nginx
server {
    listen 80;
    server_name your-frontend-domain.com;
    root /var/www/bookon-frontend;
    index index.html;
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

4. Set `REACT_APP_API_URL` to your backend URL **before** running `npm run build` (env is baked into the build).

## 4. Backend CORS

On the backend (BookOn), set in `.env` so only your frontend can call the API:

```env
FRONTEND_URL=https://your-frontend-domain.com
```

(Optional; if not set, backend allows all origins.)

## 5. Checklist

- [ ] Backend is deployed and reachable (e.g. `https://api.yourdomain.com`).
- [ ] `.env` has `REACT_APP_API_URL` pointing to that backend (for production build).
- [ ] `npm run build` runs without errors.
- [ ] Backend `.env` has `FRONTEND_URL` set to this frontend URL (recommended for production).
