/** PM2 ecosystem – ikkalasi birga: pm2 start ecosystem.config.cjs */
module.exports = {
  apps: [
    {
      name: "BOOKON",
      script: "dist/server.js",
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "400M",
      env: {
        NODE_ENV: "development",
        PORT: 3003,
      },
      env_production: {
        NODE_ENV: "production",
        PORT: 3003,
      },
    },
    {
      name: "BOOKON2",
      script: "dist/server.js",
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "400M",
      env: {
        NODE_ENV: "development",
        PORT: 3004,
      },
      env_production: {
        NODE_ENV: "production",
        PORT: 3004,
      },
    },
  ],
};
