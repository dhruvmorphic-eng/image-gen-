FROM node:24-bookworm-slim
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && mkdir -p /data && chown node:node /data
USER node
ENV NODE_ENV=production DATABASE_PATH=/data/studio.sqlite
EXPOSE 3000
CMD ["npm", "start"]
