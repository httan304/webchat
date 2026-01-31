# Database Schema Overview – ChatApp

This document describes the **logical database schema**, relationships, and indexing strategy derived from the TypeORM migration `CreateOptimizedTables1769668085712`.

The schema is optimized for **real-time chat**, **room-based messaging**, and **high read throughput**.

---

## 1. Design Principles

- UUID v4 as primary keys (distributed-safe, no sequence bottleneck)
- Nickname-based identity for chat UX simplicity
- Read-optimized indexes for:
    - Recent messages per room
    - Online users
    - Room membership lookups
- Strong referential integrity with cascading deletes

---

## 2. Entity Relationship Diagram (Conceptual)

```
users (nickname)
   ▲        ▲
   │        │
   │        └────────── messages.senderNickname
   │
   └────────── room_participants.nickname

rooms (id)
   ▲        ▲
   │        │
   │        └────────── messages.roomId
   │
   └────────── room_participants.roomId
```

---

## 3. Tables

### 3.1 users

Stores chat users identified by **unique nickname**.

| Column | Type | Description |
|------|------|------------|
| id | UUID (PK) | Internal user identifier |
| nickname | varchar(50) | Public unique username |
| isConnected | boolean | Online/offline state |
| lastSeen | timestamp | Last disconnect time |
| createdAt | timestamp | Account creation |
| updatedAt | timestamp | Last update |

**Constraints**
- `UNIQUE (nickname)`

**Indexes**
- `IDX_users_nickname` (unique lookup)
- `IDX_users_isConnected` (online users query)
- `IDX_users_createdAt` (sorting / analytics)

---

### 3.2 rooms

Represents chat rooms.

| Column | Type | Description |
|------|------|------------|
| id | UUID (PK) | Room identifier |
| name | varchar(255) | Room name |
| description | text | Optional description |
| creatorNickname | varchar(50) | Room creator |
| createdAt | timestamp | Creation time |
| updatedAt | timestamp | Last update |

**Indexes**
- `IDX_rooms_creatorNickname` (rooms by creator)
- `IDX_rooms_createdAt` (recent rooms)

**Foreign Keys**
- `creatorNickname → users.nickname (CASCADE)`

---

### 3.3 room_participants

Join table tracking **user membership per room**.

| Column | Type | Description |
|------|------|------------|
| id | UUID (PK) | Internal identifier |
| roomId | UUID | Room reference |
| nickname | varchar(50) | User nickname |
| joinedAt | timestamp | Join time |

**Constraints**
- `UNIQUE (roomId, nickname)` – user can join room once

**Indexes**
- `IDX_room_participants_roomId` (list room members)
- `IDX_room_participants_nickname` (list user rooms)

**Foreign Keys**
- `roomId → rooms.id (CASCADE)`
- `nickname → users.nickname (CASCADE)`

---

### 3.4 messages

Stores chat messages.

| Column | Type | Description |
|------|------|------------|
| id | UUID (PK) | Message ID |
| roomId | UUID | Room reference |
| senderNickname | varchar(50) | Sender |
| content | text | Message body |
| edited | boolean | Edit flag |
| createdAt | timestamp | Sent time |
| updatedAt | timestamp | Edit time |

**Indexes (Read Optimized)**

- `IDX_messages_roomId_createdAt`
    - Fetch latest messages per room
- `IDX_messages_senderNickname_createdAt`
    - User message history
- `IDX_messages_createdAt`
    - Global ordering / moderation

**Foreign Keys**
- `roomId → rooms.id (CASCADE)`
- `senderNickname → users.nickname (CASCADE)`

---

## 4. Cascade Delete Behavior

| Deleting | Effect |
|--------|--------|
| user | removes rooms created, messages sent, room memberships |
| room | removes messages & participants |
| participant | no side effects |

This ensures **no orphaned records**.

---

## 5. Query Patterns & Optimization

### Fetch latest messages in a room

- Uses: `IDX_messages_roomId_createdAt`
- Efficient for pagination (cursor / offset)

### List online users

- Uses: `IDX_users_isConnected`

### Get user rooms

- Uses: `IDX_room_participants_nickname`

---

## 6. Known Trade-offs

- Using `nickname` as FK simplifies UX but:
    - Nickname changes are expensive
    - Requires immutability policy

- UUID PKs trade index size for scalability

---

## 7. Migration Notes

- Requires Postgres extension: `uuid-ossp`
- Migration is **idempotent-safe** for extension only
- Rollback drops data (local/dev only)

---

## 8. Future Improvements (Optional)

- Add `messages(roomId, id)` index for cursor pagination
- Introduce `users.status` enum instead of boolean
- Add soft-delete (`deletedAt`) for moderation
- Partition `messages` by `roomId` or time if scale grows

---

## 9. Ownership

- Schema owner: Backend team
- Migration source: TypeORM
- Target DB: PostgreSQL 15+
