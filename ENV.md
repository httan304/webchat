# Environment Variables Guide

## Overview

This guide explains all environment variables used in the Chat Room application.

## Files Provided

1. **`.env`** - Local development (default)
2. **`.env.docker`** - Docker Compose deployment
3. **`.env.production`** - Production deployment template

## Quick Setup

### For Local Development

```bash
# Copy the .env file to your project root
cp .env chat-room-app/.env

# Or create it manually
cd chat-room-app
cat > .env << EOF
NODE_ENV=development
PORT=3000
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_USER=chatapp
DATABASE_PASSWORD=chatapp_password
DATABASE_NAME=chatapp_db
EOF
```

### For Docker

```bash
# Copy Docker env file
cp .env.docker chat-room-app/.env

# Or use the default .env.example that's already in the project
```

## Environment Variables Reference

### Application Settings

#### `NODE_ENV`
- **Description**: Application environment
- **Values**: `development`, `production`, `test`
- **Default**: `development`
- **Required**: No
- **Example**: `NODE_ENV=production`

#### `PORT`
- **Description**: Port the application listens on
- **Values**: Any valid port number (1-65535)
- **Default**: `3000`
- **Required**: No
- **Example**: `PORT=3000`

### Database Settings

#### `DATABASE_HOST`
- **Description**: PostgreSQL server hostname
- **Values**:
    - `localhost` - Local development
    - `postgres` - Docker Compose (service name)
    - Any hostname/IP
- **Default**: `localhost`
- **Required**: Yes
- **Example**:
  ```bash
  DATABASE_HOST=localhost              # Local
  DATABASE_HOST=postgres               # Docker
  DATABASE_HOST=db.example.com         # Production
  ```

#### `DATABASE_PORT`
- **Description**: PostgreSQL server port
- **Values**: Valid port number
- **Default**: `5432`
- **Required**: No
- **Example**: `DATABASE_PORT=5432`

#### `DATABASE_USER`
- **Description**: Database username
- **Values**: Valid PostgreSQL username
- **Default**: `chatapp`
- **Required**: Yes
- **Example**: `DATABASE_USER=chatapp`

#### `DATABASE_PASSWORD`
- **Description**: Database password
- **Values**: Any string
- **Default**: `chatapp_password`
- **Required**: Yes
- **Security**:
    - ⚠️ Change in production!
    - Use strong passwords (16+ chars, mixed case, numbers, symbols)
    - Never commit to git
- **Example**: `DATABASE_PASSWORD=MyStr0ngP@ssw0rd!2024`

#### `DATABASE_NAME`
- **Description**: Database name
- **Values**: Valid PostgreSQL database name
- **Default**: `chatapp_db`
- **Required**: Yes
- **Example**: `DATABASE_NAME=chatapp_db`

### Server Configuration (Optional)

#### `CORS_ORIGIN`
- **Description**: Allowed CORS origins (comma-separated)
- **Values**:
    - `*` - Allow all origins (development only)
    - Specific URLs
- **Default**: `*` (allow all)
- **Required**: No
- **Production**: Always specify allowed origins
- **Example**:
  ```bash
  CORS_ORIGIN=*                                    # Allow all (dev only)
  CORS_ORIGIN=https://example.com                  # Single origin
  CORS_ORIGIN=https://example.com,https://app.example.com  # Multiple
  ```

#### `LOG_LEVEL`
- **Description**: Logging verbosity
- **Values**: `debug`, `info`, `warn`, `error`
- **Default**: Based on NODE_ENV
- **Required**: No
- **Example**:
  ```bash
  LOG_LEVEL=debug    # Development
  LOG_LEVEL=warn     # Production
  ```

## Environment-Specific Configurations

### Development (.env)

```env
NODE_ENV=development
PORT=3000
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_USER=chatapp
DATABASE_PASSWORD=chatapp_password
DATABASE_NAME=chatapp_db
```

**Use when:**
- Running locally without Docker
- Using local PostgreSQL installation
- Active development and debugging

### Docker (.env.docker)

```env
NODE_ENV=production
PORT=3000
DATABASE_HOST=postgres
DATABASE_PORT=5432
DATABASE_USER=chatapp
DATABASE_PASSWORD=chatapp_password
DATABASE_NAME=chatapp_db
```

**Use when:**
- Running with `docker-compose up`
- Using Docker containers
- Local testing of production build

**Key difference:** `DATABASE_HOST=postgres` (matches service name in docker-compose.yml)

### Production (.env.production)

```env
NODE_ENV=production
PORT=3000
DATABASE_HOST=your-production-db.amazonaws.com
DATABASE_PORT=5432
DATABASE_USER=chatapp
DATABASE_PASSWORD=super-secure-password-here
DATABASE_NAME=chatapp_db
CORS_ORIGIN=https://yourdomain.com
LOG_LEVEL=warn
```

**Use when:**
- Deploying to production servers
- Cloud deployments (AWS, Azure, GCP, etc.)
- Live environment

**Security checklist:**
- [ ] Change all default passwords
- [ ] Use environment-specific credentials
- [ ] Restrict CORS origins
- [ ] Use secrets management (AWS Secrets Manager, etc.)
- [ ] Never commit to version control

## Usage Examples

### Local Development

```bash
# Start local PostgreSQL
# (Already running from init-db.sh)

# Copy env file
cp .env chat-room-app/.env

# Install dependencies
cd chat-room-app
npm install

# Run development server
npm run start:dev

# Application runs on http://localhost:3000
```

### Docker Compose

```bash
# Docker Compose reads .env automatically
cd chat-room-app

# Start with Docker
docker-compose up --build

# Application runs on http://localhost:3000
```

### Production Deployment

```bash
# Create production env file
cp .env.production /var/www/chatapp/.env

# Edit with production values
nano /var/www/chatapp/.env

# Build application
npm run build

# Start production server
npm run start:prod

# Or use PM2
pm2 start dist/main.js --name chatapp
```

## Security Best Practices

### 1. Never Commit .env Files

Add to `.gitignore` (already done):
```gitignore
.env
.env.local
.env.*.local
```

### 2. Use Strong Passwords

```bash
# Generate strong password
openssl rand -base64 32

# Or
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### 3. Use Secrets Management in Production

**AWS:**
```bash
# Store in AWS Secrets Manager
aws secretsmanager create-secret \
  --name chatapp/database \
  --secret-string '{"password":"your-password"}'
```

**Docker Secrets:**
```yaml
# docker-compose.yml
secrets:
  db_password:
    external: true

services:
  app:
    secrets:
      - db_password
```

### 4. Restrict Database Access

```sql
-- Create read-only user for reporting
CREATE USER chatapp_readonly WITH PASSWORD 'password';
GRANT CONNECT ON DATABASE chatapp_db TO chatapp_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO chatapp_readonly;
```

## Troubleshooting

### Error: "Cannot find module 'dotenv'"

The app uses `@nestjs/config` which handles environment variables automatically. No action needed.

### Error: "Database connection failed"

Check these:
```bash
# 1. Verify database is running
pg_isready -h localhost -p 5432

# 2. Test connection manually
psql -h localhost -U chatapp -d chatapp_db

# 3. Check .env file exists
ls -la .env

# 4. Verify DATABASE_HOST matches your setup
cat .env | grep DATABASE_HOST
```

### Error: "Port 3000 already in use"

Change the port:
```env
PORT=3001  # or any available port
```

### Docker: "Connection refused"

Make sure using correct host:
```env
# For Docker, use service name from docker-compose.yml
DATABASE_HOST=postgres

# NOT localhost when running in Docker
```

## Environment Variables Checklist

Before deploying, verify:

- [ ] `.env` file exists in project root
- [ ] `DATABASE_HOST` matches your setup
- [ ] `DATABASE_PASSWORD` is secure (production)
- [ ] `CORS_ORIGIN` is restricted (production)
- [ ] `.env` is in `.gitignore`
- [ ] Sensitive values are not committed to git
- [ ] Production values are in secrets manager

## Additional Resources

- [NestJS Configuration](https://docs.nestjs.com/techniques/configuration)
- [PostgreSQL Connection](https://node-postgres.com/)
- [Docker Environment Variables](https://docs.docker.com/compose/environment-variables/)

## Summary

**Development:**
```bash
cp .env chat-room-app/.env
npm run start:dev
```

**Docker:**
```bash
# .env already configured for Docker
docker-compose up --build
```

**Production:**
```bash
cp .env.production .env
# Edit with production values
npm run build
npm run start:prod
```

Your application is now configured and ready to run!
