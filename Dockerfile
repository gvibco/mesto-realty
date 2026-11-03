FROM node:22-bookworm-slim

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production

EXPOSE 3000

CMD ["sh", "-c", "npm run db:seed && exec npm start"]
