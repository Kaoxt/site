FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

# Sharp/librsvg needs an installed font for SVG text overlays.
# Without this, the badge shapes render but their text can be missing.
RUN apt-get update \
    && apt-get install -y --no-install-recommends fonts-dejavu-core fontconfig \
    && fc-cache -f \
    && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./

EXPOSE 8080
CMD ["npm", "start"]
