# Chat Room Backend – Docker Setup

This README explains **how to run the Chat Room Backend using Docker Compose**. It is intended as a **quick start entry point** and references detailed documents for database, schema, and API usage.

---

## 1. Prerequisites

Make sure you have the following installed:

- Docker >= 20.x
- Docker Compose v2

Verify:

```bash
docker -v
docker compose version
```

---

## 2. Start Application with Docker (Recommended)

From the project root directory:

```bash
docker compose up --build
```

This command will automatically:

1. Start PostgreSQL
2. Start Redis
3. Run database migrations (one-time)
4. Start the NestJS backend server

---

## 3. Exposed Services

After startup, the following services are available:

| Service | URL / Port |
|------|------------|
| HTTP API | http://localhost:3000 |
| WebSocket | ws://localhost:3000 |
| PostgreSQL | localhost:5433 |
| Redis | localhost:6379 |

---

## 4. Stop Application

```bash
docker compose down
```

To fully reset data (⚠️ deletes database data):

```bash
docker compose down -v
docker compose up --build
```

---

## 5. Database & Migration Notes

- Database: PostgreSQL 15
- ORM: TypeORM
- Migrations run automatically before the app starts
- Application will **not start** if migration fails

📘 See: **DATABASE_SCHEMA.md**

---

## 6. Reference Documentation

For detailed information, refer to the following documents:

- 📄 **DATABASE_SCHEMA.md** – Database tables, relationships, indexes
- 📄 **CHAT_APP_API_DOCUMENTATION.md** – REST & WebSocket APIs
- 📄 **UNIT_TEST.md** – Unit and integration testing guide

---

## 7. Notes for Developers

- Do not use `localhost` inside Docker containers
- Database and Redis are accessed via service names (`postgres`, `redis`)
- Use Docker setup to avoid local environment inconsistencies

---

## 8. License

MIT
