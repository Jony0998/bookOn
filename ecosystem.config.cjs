/** PM2 ecosystem – run with: pm2 start ecosystem.config.cjs */
module.exports = {
  apps: [
    {
      name: "bookon",
      script: "dist/server.js",
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "400M",
      env: {
        NODE_ENV: "development",
      },
      env_production: {
        NODE_ENV: "production",
      },
    },
  ],
};
