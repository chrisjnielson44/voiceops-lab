FROM node:20-slim

ENV NODE_ENV=production \
    AUTH_PORT=3000

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY auth.mjs server.mjs migrate.mjs ./

EXPOSE 3000
CMD ["node", "server.mjs"]
