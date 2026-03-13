#!/bin/bash
set -e

# PRODUCTION
git reset --hard
git checkout master
git pull origin master

npm install
node node_modules/typescript/bin/tsc
node scripts/copy-assets.js
node extra.js
pm2 start process.config.js --env production



 # DEVELOPMENT
#  git reset --hard
#  git checkout development
#  git pull origin development

# #  npm install
# #  pm2  start "npm run start:dev" --name=BOOKON
