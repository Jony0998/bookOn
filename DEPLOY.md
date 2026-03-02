# BOOKON – Deployment Guide

## 1. Environment variables (.env)

Create a `.env` file on the server and set the following (or copy from `.env.example`):

```env
# Server
NODE_ENV=production
PORT=3003

# MongoDB (e.g. MongoDB Atlas connection string)
MONGO_URL=mongodb+srv://user:password@cluster.mongodb.net/bookon?retryWrites=true&w=majority

# Session (use a random string)
SESSION_SECRET=your-session-secret-key-min-32-chars

# JWT (for API login/signup)
SECRET_TOKEN=your-jwt-secret-key
```

**Admin UI (EJS):** Served from this backend at `/admin`. The build script copies `src/views` and `src/public` into `dist/`.

**React frontend:** Separate app (see `BookOn- React` / DEPLOY-FRONTEND.md). Deploy it to Vercel, Netlify, or your server; set `REACT_APP_API_URL` to this backend URL. Optional: set `FRONTEND_URL` in backend `.env` for CORS.

## 2. Local build and test

```bash
# Load env (create .env from .env.example if needed)
cp .env.example .env

# Install dependencies
npm install

# Production build (TypeScript → dist, copy public/views)
npm run build

# Run in production mode
npm run start:prod
```

Open in browser: `http://localhost:3003/admin`

## 3. Deploy on server (VPS / VM)

### 3.1 Clone the repo

```bash
git clone <your-repo-url> bookon
cd bookon
```

### 3.2 Configure .env

```bash
nano .env
# or
echo "PORT=3003" >> .env
echo "MONGO_URL=..." >> .env
echo "SESSION_SECRET=..." >> .env
echo "SECRET_TOKEN=..." >> .env
```

### 3.3 Build and run

```bash
npm install
npm run build
npm run start:prod
```

### 3.4 Keep running with PM2

```bash
npm install -g pm2
NODE_ENV=production pm2 start dist/server.js --name bookon
pm2 save
pm2 startup
```

Or use the included PM2 config (sets `NODE_ENV=production` automatically):

```bash
pm2 start ecosystem.config.cjs --env production
pm2 save
pm2 startup
```

## 4. Nginx (optional)

Example Nginx reverse proxy for a domain:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3003;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## 5. Checklist

- [ ] Copy `.env.example` to `.env` and set `MONGO_URL`, `SESSION_SECRET`, `SECRET_TOKEN`
- [ ] Set `NODE_ENV=production` when running (for static caching and production behavior)
- [ ] `npm run build` completes without errors (backend + frontend assets in `dist/`)
- [ ] `uploads/` folders are created automatically on first run
- [ ] MongoDB connection works (for Atlas: check IP/network access)
- [ ] Firewall allows your `PORT` (e.g. 3003) or you use Nginx on 80/443

## 6. Scripts (package.json)

| Script              | Description                              |
|---------------------|------------------------------------------|
| `npm start`         | Development: run with `ts-node`          |
| `npm run start:dev` | Development with nodemon (auto reload)  |
| `npm run build`     | Compile TS and copy public/views to dist|
| `npm run start:prod`| Production: run `node dist/server.js`   |

## 7. React frontend (optional)

The React app (`BookOn- React`) talks to this backend via `REACT_APP_API_URL`. After deploying this backend:

1. In the React project set `.env`: `REACT_APP_API_URL=https://your-backend-domain.com` (no trailing slash).
2. Deploy the React build to Vercel, Netlify, or static hosting.
3. In this backend `.env` you can set `FRONTEND_URL=https://your-react-app-url.com` so CORS only allows that origin.
