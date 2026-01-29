# Database Setup

This document explains **how to set up the local database** for this project and the **correct order of commands** to avoid common TypeORM migration errors (e.g. `relation already exists`).

---

## 1. Prerequisites

* Docker & Docker Compose
* Node.js >= 18
* npm

---

## 2. Start PostgreSQL with Docker

```bash
docker-compose up -d
```

PostgreSQL will be exposed locally with the following settings:

* Host: `localhost`
* Port: `5433`
* Database: `chatapp_db`
* Username: `chatapp`
* Password: `chatapp_password`

> ⚠️ If port `5433` is already in use, update it in `docker-compose.yml`.

---

## 3. Do NOT create tables manually

❌ Do **not** create tables by hand
❌ Do **not** enable `synchronize: true`
❌ Do **not** use `init.sql` to create schema objects

👉 **All tables must be created via migrations only.**

---

## 4. TypeORM Migration Commands

### 4.1 Generate migration (DOES NOT create tables)

```bash
npm run typeorm:migration:generate
```

* Compares Entities ↔ Database schema
* Generates a migration file in `src/migrations/`
* ❌ Does NOT execute SQL

---

### 4.2 Run migration (CREATES / UPDATES tables)

```bash
npm run typeorm:migration:run
```

* Executes the `up()` method in migration files
* Runs `CREATE TABLE`, `ALTER TABLE`, etc.
* ✅ **This is the ONLY command that creates tables**

---

### 4.3 Revert migration (ROLLBACK)

```bash
npm run typeorm:migration:revert
```

* Executes the `down()` method
* Rolls back the latest migration

---

## 5. Recommended Local Development Flow

```bash
# 1. Reset database (LOCAL ONLY)
docker-compose down -v

# 2. Start database
docker-compose up -d

# 3. Apply migrations
npm run typeorm:migration:run
```

---

## 6. Common Errors

### ❌ `relation \"xxx\" already exists`

**Cause:**

* Tables were created earlier (manual SQL, `synchronize`, or `init.sql`)

**Fix:**

* Reset the database and re-run migrations

---

## 7. Production Notes

* ❌ Never use `synchronize`
* ❌ Never reset the database
* ✅ Only run:

```bash
npm run typeorm:migration:run
```

before starting the application.

---

## 8. Quick Summary

| Command            | Purpose                    |
| ------------------ | -------------------------- |
| migration:generate | Generate migration files   |
| migration:run      | **Create / update tables** |
| migration:revert   | Rollback last migration    |

---

✅ If you encounter issues, always check
