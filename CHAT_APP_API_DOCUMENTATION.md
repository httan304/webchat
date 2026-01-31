# Chat App API Documentation

Base URL: `http://localhost:3000`

Swagger UI: `http://localhost:3000/api`

---
# Chat App API

## Overview

REST API for managing **Users**, **Chat Rooms**, and **Messages**.

* OpenAPI version: 3.0.0
* API Version: 1.0
* Base entities: Users, Rooms, Messages

---

## Users API

### Create User

**POST** `/users`

**Request Body**

```json
{
  "nickname": "alice_123"
}
```

**Responses**

* `201` User created successfully
* `400` Invalid input

---

### Get All Users

**GET** `/users`

**Query Parameters**

| Name   | Type   | Description                 | Default |
| ------ | ------ | --------------------------- | ------- |
| page   | number | Page number (starts from 1) | 1       |
| limit  | number | Items per page              | 20      |
| search | string | Search keyword              | -       |

**Response 200**

```json
{
  "data": [],
  "meta": {
    "total": 100,
    "page": 1,
    "limit": 20,
    "totalPages": 5
  }
}
```

---

### Get User by Nickname

**GET** `/users/{nickname}`

**Path Parameter**

* `nickname` (string)

**Responses**

* `200` User found
* `404` User not found

---

### Delete User

**DELETE** `/users/{nickname}`

**Response 200**

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
  "name": "General Chat",
  "description": "This room is for general discussion",
  "creatorNickname": "alice"
}
```

**Response 201** Room created

---

### Get Room by ID

**GET** `/rooms/{id}`

**Response 200** Room found

---

### Delete Room

**DELETE** `/rooms/{id}`

**Request Body**

```json
{
  "requesterNickname": "alice"
}
```

**Response 200**

```json
{
  "message": "Room <id> deleted successfully"
}
```

---

### Get Room Participants

**GET** `/rooms/{id}/participants`

**Query Parameters**

* `requester` (optional string)

**Response 200**

```json
[
  {
    "id": "user-uuid",
    "nickname": "alice",
    "isOwner": true,
    "joinedAt": "2026-01-29T10:00:00.000Z"
  }
]
```

---

### Join Room

**POST** `/rooms/{id}/participants/{nickname}`

**Response 201**

```json
{
  "message": "User alice joined room <id>"
}
```

---

### Leave Room

**DELETE** `/rooms/{id}/participants/{nickname}`

**Response 201**

```json
{
  "message": "User alice left room <id>"
}
```

---

### Get My Rooms

**GET** `/rooms/my/{nickname}`

**Description**
Returns rooms created by or joined by the user.

**Response 200**

```json
[]
```

---

## Messages API

### Get Messages (Pagination)

**GET** `/rooms/{roomId}/messages`

**Query Parameters**

| Name  | Type   | Required |
| ----- | ------ | -------- |
| page  | number | No       |
| limit | number | No       |

---

### Get Messages (Chronological)

**GET** `/rooms/{roomId}/messages/chronological`

**Query Parameters**

* `page` (number, required)
* `limit` (number, required)

---

### Get Messages Since Timestamp

**GET** `/rooms/{roomId}/messages/since`

**Query Parameters**

* `timestamp` (ISO string)
* `limit` (number)

**Response 400** Invalid timestamp format

---

### Get Latest Messages

**GET** `/rooms/{roomId}/messages/latest`

**Query Parameters**

* `limit` (number)

---

## WebSocket Testing

This project includes a client.html file for testing WebSocket connections.

### Usage
1. Open `client.html` in a browser
2. Connect to the WebSocket server
3. Join rooms and send messages
4. Observe real-time message delivery

> `client.html` is intended **only for development & testing**.

----

## ⚡ WEBSOCKET EVENTS

### Connect
```
ws://localhost:3000/chat?nickname=alice
```

### Client → Server
- `room:join`
- `room:leave`
- `message:send`
- `message:edit`
- `message:delete`
- `user:typing`
- `user:stopTyping`

### Server → Client
- `message:new`
- `user_joined_room`
- `user_left_room`
- `user:connected`
- `user:disconnected`
- `user:typing`
- `user:stopTyping`
---

## Notes

* All data formats are JSON
* Pagination starts from page `1`
* Authentication is not defined in this API spec

---

## Notes
- Rate limiting applied on Rooms APIs
- Bulkhead design for all service
- Circuit breaker pattern
- Validation enabled globally
- Swagger gene
