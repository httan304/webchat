# Dockerfile
FROM node:18-alpine

WORKDIR /app

# Install dependencies first (cache friendly)
COPY package*.json ./
RUN npm ci

# Copy source
COPY . .

# Build nếu là NestJS
RUN npm run build

# Default command (override ở docker-compose)
CMD ["node", "dist/main.js"]
