# BOOKON – Deploy qilish qo'llanmasi

## 1. Muhit o'zgaruvchilari (.env)

Serverda `.env` fayl yarating va quyidagilarni to'ldiring:

```env
# Server
PORT=3003

# MongoDB (masalan: MongoDB Atlas connection string)
MONGO_URL=mongodb+srv://user:password@cluster.mongodb.net/bookon?retryWrites=true&w=majority

# Session (ixtiyoriy tasodifiy string)
SESSION_SECRET=your-session-secret-key-min-32-chars

# JWT (SPA login/signup uchun)
SECRET_TOKEN=your-jwt-secret-key
```

## 2. Lokal build va test

```bash
# O'zgaruvchilarni yuklash
cp .env.example .env   # yoki .env yarating

# Dependency o'rnatish
npm install

# Production build (TypeScript → dist, public/views nusxalash)
npm run build

# Production rejimida ishga tushirish
npm run start:prod
```

Brauzerda: `http://localhost:3003/admin`

## 3. Serverda deploy (VPS / VM)

### 3.1 Kodni yuklash

```bash
git clone <your-repo-url> bookon
cd bookon
```

### 3.2 .env sozlash

```bash
nano .env
# yoki
echo "PORT=3003" >> .env
echo "MONGO_URL=..." >> .env
echo "SESSION_SECRET=..." >> .env
echo "SECRET_TOKEN=..." >> .env
```

### 3.3 Build va ishga tushirish

```bash
npm install
npm run build
npm run start:prod
```

### 3.4 Doimiy ishlashi uchun (PM2)

```bash
npm install -g pm2
pm2 start dist/server.js --name bookon
pm2 save
pm2 startup
```

## 4. Nginx orqali (ixtiyoriy)

Domain orqali ishlatish uchun Nginx reverse proxy:

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

## 5. Tekshirish ro'yxati

- [ ] `.env` da `MONGO_URL`, `SESSION_SECRET`, `SECRET_TOKEN` to'g'ri
- [ ] `npm run build` xatosiz tugaydi
- [ ] `uploads/`, `uploads/members/`, `uploads/products/` serverda yoki avtomatik yaratiladi
- [ ] MongoDB ulanishi ishlaydi (Atlas bo'lsa IP/network ruxsati)
- [ ] Firewall da `PORT` (masalan 3003) ochiq yoki Nginx orqali 80/443 ishlatiladi

## 6. Skriptlar (package.json)

| Skript         | Vazifasi                                      |
|----------------|-----------------------------------------------|
| `npm start`    | Development: `ts-node` bilan ishga tushirish  |
| `npm run start:dev` | Nodemon bilan qayta ishga tushirish     |
| `npm run build`     | `tsc` + public/views ni `dist/` ga nusxalash |
| `npm run start:prod`| Production: `node dist/server.js`            |
