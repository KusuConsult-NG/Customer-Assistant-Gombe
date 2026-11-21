/**
 * PM2 Ecosystem — GOHEALTH Customer Assistant
 * Start:    pm2 start ecosystem.config.js
 * Restart:  pm2 restart all
 * Logs:     pm2 logs
 * Status:   pm2 status
 * On boot:  pm2 save && pm2 startup
 */
module.exports = {
  apps: [
    {
      name: 'gohealth-api',
      script: './apps/api/dist/main.js',
      cwd: '/Users/mac/Customer Assistance',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      log_file: '/tmp/gohealth-api.log',
      error_file: '/tmp/gohealth-api-err.log',
      out_file: '/tmp/gohealth-api-out.log',
    },
    {
      name: 'gohealth-qdrant',
      script: './data/qdrant/qdrant',
      args: '--uri http://localhost:6333',
      cwd: '/Users/mac/Customer Assistance',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      log_file: '/tmp/gohealth-qdrant.log',
      error_file: '/tmp/gohealth-qdrant-err.log',
      out_file: '/tmp/gohealth-qdrant-out.log',
    },
    {
      name: 'gohealth-web',
      script: 'npm',
      args: 'run start',
      cwd: '/Users/mac/Customer Assistance/apps/web',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      log_file: '/tmp/gohealth-web.log',
      error_file: '/tmp/gohealth-web-err.log',
      out_file: '/tmp/gohealth-web-out.log',
    },
  ],
};
