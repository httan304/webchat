# Chat App API Documentation

Base URL: `http://localhost:3000`

Swagger UI: `http://localhost:3000/api`

---

## Users API

### Create User
**POST** `/users`

**Request Body**
```json
{
  "nickname": "alice"
}
```

**Rules**
- 3–50 characters
- Only letters, numbers, `_` and `-`

**Response – 201**
```json
{
  "id": "uuid",
  "nickname": "alice",
  "isConnected": false,
  "createdAt": "2026-01-01T00:00:00.000Z"
}
```

---

### Get Users (Pagination & Search)
**GET** `/users`

**Query Params**
| Name | Type | Default | Description |
|----|----|----|----|
| page | number | 1 | Page number |
| limit | number | 20 | Items per page |
| search | string | - | Search by nickname |

**Response – 200**
```json
{
  "data": [User],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 100
  }
}
```

---

### Get User by Nickname
**GET** `/users/{nickname}`

**Response – 200**
```json
{
  "nickname": "alice",
  "isConnected": true
}
```

---

### Get User Connection Status
**GET** `/users/{nickname}/status`

**Response – 200**
```json
{
  "nickname": "alice",
  "isConnected": true
}
```

---

### Delete User
**DELETE** `/users/{nickname}`

**Response – 200**
```json
{
  "message": "User alice deleted successfully"
}
```

---

## Rooms API

### Create Room
**POST** `/rooms`

**Request Body**
```json
{
  "name": "General",
  "creatorNickname": "alice",
  "description": "Public chat room"
}
```

**Response – 201**
```json
{
  "id": "room-id",
  "name": "General",
  "creatorNickname": "alice"
}
```

---

### Get Room by ID
**GET** `/rooms/{id}`

---

### Join Room
**POST** `/rooms/{id}/participants/{nickname}`

**Response – 201**
```json
{
  "message": "User alice joined room room-id"
}
```

---

### Get Room Participants
**GET** `/rooms/{id}/participants?requester=alice`

**Response – 200**
```json
[
  {
    "id": "user-id",
    "nickname": "alice",
    "joinedAt": "2026-01-01T00:00:00.000Z"
  }
]
```

---

### Delete Room
**DELETE** `/rooms/{id}`

**Request Body**
```json
{
  "requesterNickname": "alice"
}
```

**Response – 200**
```json
{
  "message": "Room room-id deleted successfully"
}
```

---

## Common DTOs

### PaginationMetaDto
```json
{
  "page": 1,
  "limit": 20,
  "total": 100
}
```

---

## Notes
- Rate limiting applied on Rooms APIs
- Validation enabled globally
- Swagger gene
