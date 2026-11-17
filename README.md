# BookOn - Backend (Express + TypeScript)

Backend and admin panel for **[BookOn](https://bookon.sale)**, a live online bookstore: catalog, search, cart and orders for customers, plus an admin panel for managing books, stock and orders.

**Live:** https://bookon.sale | **Frontend repo:** [bookon-react1](https://github.com/Jony0998/bookon-react1)

## Tech stack

- **Node.js + Express** (TypeScript)
- **MongoDB** with Mongoose schemas
- **EJS** server-rendered admin panel
- Cookie-based auth for users and admins
- Deployed on a Linux VPS with **PM2** and Nginx (`deploy.sh`, `ecosystem.config.cjs`)

## Structure

```
src/
  controllers/    # request handlers (shop + admin)
  models/         # business logic / services
  schema/         # Mongoose schemas
  views/          # EJS templates for the admin panel
  router.ts       # public REST API for the React client
  router-admin.ts # admin panel routes
  app.ts, server.ts
```

## Run locally

```bash
npm install
npm run dev
```

Create a `.env` with your MongoDB connection string and session secret before starting.

## Deploy

```bash
npm run build
./deploy.sh   # builds and restarts the app with PM2
```

## Author

**Janobiddin Bozorov (Jony)** - Full-Stack Developer
[GitHub](https://github.com/Jony0998) | [LinkedIn](https://www.linkedin.com/in/janobiddin-bozorov-a03429412)
