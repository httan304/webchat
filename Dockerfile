FROM node:18-alpine AS app

WORKDIR /app

# Copy lock files first (cache friendly)
COPY package.json package-lock.json ./

RUN npm ci

# Copy source code
COPY . .

RUN npm run build

CMD ["node", "dist/main.js"]
