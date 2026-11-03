FROM node:22-bookworm-slim

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV NODE_EXTRA_CA_CERTS=/app/certs/russian-trusted.pem

EXPOSE 3000

CMD ["sh", "-c", "npm run db:seed && exec npm start"]
