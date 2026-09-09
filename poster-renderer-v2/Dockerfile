FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./

EXPOSE 8080
CMD ["npm", "start"]
