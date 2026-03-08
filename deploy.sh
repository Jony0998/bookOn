#! xshell

# PRODUCTION

 git reset --hard
 git checkout master
 git pull origin master

 npm install
 npm run build
 pm2  start process.config.js --env production



 # DEVELOPMENT
#  git reset --hard
#  git checkout development
#  git pull origin development

# #  npm install
# #  pm2  start "npm run start:dev" --name=BOOKON
