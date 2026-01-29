# Chat Room Application - Backend

A real-time chat application backend built with NestJS, Socket.io, TypeORM, and PostgreSQL.

## Features

- **Nickname-based Authentication**: Simple nickname selection (no password required)
- **Chat Room Management**: Create, join, list, and delete chat rooms
- **Real-time Messaging**: Send and receive messages instantly via WebSocket
- **Message Editing**: Edit your last message (if no one else has sent a message since)
- **User Presence**: Track online/offline status of participants
- **Persistent Storage**: All data stored in PostgreSQL

## Technology Stack

- **NestJS**: Enterprise-grade Node.js framework
- **TypeScript**: Type-safe development
- **Socket.io**: WebSocket library for real-time communication
- **TypeORM**: ORM for database operations
- **PostgreSQL**: Relational database
- **Docker**: Containerization

## Quick Start

### Using Docker (Recommended)

```bash
# Start the application
docker-compose up --build

# The server will be available at:
# HTTP: http://localhost:3000
# WebSocket: ws://localhost:3000
```

### Local Development

```bash
# Install dependencies
npm install

# Start PostgreSQL
docker-compose up -d postgres

# Run in development mode
npm run start:dev
```

## API Documentation

### REST Endpoints

#### Users

**Create User**
```http
POST /users
Content-Type: application/json

{
  "nickname": "john_doe"
}

Response: 201 Created
{
  "id": 1,
  "nickname": "john_doe",
  "isConnected": false,
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

**Get All Users**
```http
GET /users

Response: 200 OK
[
  {
    "id": 1,
    "nickname": "john_doe",
    "isConnected": true,
    ...
  }
]
```

#### Rooms

**Create Room**
```http
POST /rooms
Content-Type: application/json

{
  "name": "General Chat",
  "creatorNickname": "john_doe"
}

Response: 201 Created
{
  "id": 1,
  "name": "General Chat",
  "creatorId": 1,
  "creator": {
    "id": 1,
    "nickname": "john_doe"
  },
  "createdAt": "2024-01-01T00:00:00.000Z"
}
```

**List All Rooms**
```http
GET /rooms

Response: 200 OK
[
  {
    "id": 1,
    "name": "General Chat",
    "creator": {
      "id": 1,
      "nickname": "john_doe"
    },
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
]
```

**Get Room Details**
```http
GET /rooms/:id

Response: 200 OK
{
  "id": 1,
  "name": "General Chat",
  "creator": {...},
  "createdAt": "2024-01-01T00:00:00.000Z"
}
```

**Get Room Participants**
```http
GET /rooms/:id/participants

Response: 200 OK
[
  {
    "id": 1,
    "roomId": 1,
    "userId": 1,
    "user": {
      "id": 1,
      "nickname": "john_doe",
      "isConnected": true
    },
    "joinedAt": "2024-01-01T00:00:00.000Z"
  }
]
```

**Delete Room**
```http
DELETE /rooms/:id?nickname=john_doe

Response: 204 No Content
```

### WebSocket Events

Connect to: `ws://localhost:3000`

#### Client → Server Events

**Join Room**
```javascript
socket.emit('join_room', {
  roomId: 1,
  nickname: 'john_doe'
});

// Response
{
  event: 'joined_room',
  data: {
    roomId: 1,
    participants: [
      {
        nickname: 'john_doe',
        isConnected: true,
        joinedAt: '2024-01-01T00:00:00.000Z'
      }
    ],
    messages: [
      {
        id: 1,
        content: 'Hello!',
        nickname: 'alice',
        edited: false,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z'
      }
    ]
  }
}
```

**Leave Room**
```javascript
socket.emit('leave_room', {
  roomId: 1,
  nickname: 'john_doe'
});

// Response
{
  event: 'left_room',
  data: { roomId: 1 }
}
```

**Send Message**
```javascript
socket.emit('send_message', {
  roomId: 1,
  nickname: 'john_doe',
  content: 'Hello, World!'
});

// Response
{
  event: 'message_sent',
  data: {
    id: 1,
    content: 'Hello, World!',
    nickname: 'john_doe',
    roomId: 1,
    edited: false,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z'
  }
}
```

**Edit Message**
```javascript
socket.emit('edit_message', {
  messageId: 1,
  nickname: 'john_doe',
  content: 'Hello, Updated World!'
});

// Response
{
  event: 'message_edited',
  data: {
    id: 1,
    content: 'Hello, Updated World!',
    nickname: 'john_doe',
    roomId: 1,
    edited: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:01.000Z'
  }
}
```

**Get Participants**
```javascript
socket.emit('get_participants', {
  roomId: 1
});

// Response
{
  event: 'room_participants',
  data: [
    {
      nickname: 'john_doe',
      isConnected: true,
      joinedAt: '2024-01-01T00:00:00.000Z'
    }
  ]
}
```

#### Server → Client Events

**User Joined**
```javascript
socket.on('user_joined', (data) => {
  // data: { nickname: 'alice', roomId: 1 }
});
```

**User Left**
```javascript
socket.on('user_left', (data) => {
  // data: { nickname: 'alice', roomId: 1 }
});
```

**New Message**
```javascript
socket.on('new_message', (message) => {
  // message: { id, content, nickname, roomId, edited, createdAt, updatedAt }
});
```

**Message Edited**
```javascript
socket.on('message_edited', (message) => {
  // message: { id, content, nickname, roomId, edited: true, createdAt, updatedAt }
});
```

**User Disconnected**
```javascript
socket.on('user_disconnected', (data) => {
  // data: { nickname: 'alice' }
});
```

**Error**
```javascript
socket.on('error', (error) => {
  // error: { error: 'ErrorType', message: 'Error description', timestamp: '...' }
});
```

## Database Schema

### Users
```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  nickname VARCHAR(50) UNIQUE NOT NULL,
  is_connected BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### Rooms
```sql
CREATE TABLE rooms (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  creator_id INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP NULL
);
```

### Room Participants
```sql
CREATE TABLE room_participants (
  id SERIAL PRIMARY KEY,
  room_id INTEGER REFERENCES rooms(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  joined_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(room_id, user_id)
);
```

### Messages
```sql
CREATE TABLE messages (
  id SERIAL PRIMARY KEY,
  content TEXT NOT NULL,
  room_id INTEGER REFERENCES rooms(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  edited BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

## Testing

### Using cURL

```bash
# Create user
curl -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -d '{"nickname": "testuser"}'

# Create room
curl -X POST http://localhost:3000/rooms \
  -H "Content-Type: application/json" \
  -d '{"name": "Test Room", "creatorNickname": "testuser"}'

# List rooms
curl http://localhost:3000/rooms

# Get room participants
curl http://localhost:3000/rooms/1/participants

# Delete room
curl -X DELETE "http://localhost:3000/rooms/1?nickname=testuser"
```

### Using Postman

Import `postman_collection.json` for ready-to-use API requests.

### WebSocket Testing

Use any WebSocket client:
- **Postman** (WebSocket support)
- **wscat**: `npm install -g wscat && wscat -c ws://localhost:3000`
- **websocat**: `websocat ws://localhost:3000`
- Browser console with Socket.io client

### Unit Tests

```bash
npm run test
```

### E2E Tests

```bash
npm run test:e2e
```

## Environment Variables

```env
# Application
NODE_ENV=development
PORT=3000

# Database
DATABASE_HOST=postgres
DATABASE_PORT=5432
DATABASE_USER=chatapp
DATABASE_PASSWORD=chatapp_password
DATABASE_NAME=chatapp_db
```

## Project Structure

```
src/
├── modules/
│   ├── users/
│   │   ├── entities/user.entity.ts
│   │   ├── dto/create-user.dto.ts
│   │   ├── users.controller.ts
│   │   ├── users.service.ts
│   │   ├── users.service.spec.ts
│   │   └── users.module.ts
│   ├── rooms/
│   │   ├── entities/
│   │   │   ├── room.entity.ts
│   │   │   └── room-participant.entity.ts
│   │   ├── dto/create-room.dto.ts
│   │   ├── rooms.controller.ts
│   │   ├── rooms.service.ts
│   │   └── rooms.module.ts
│   └── chat/
│       ├── entities/message.entity.ts
│       ├── dto/chat.dto.ts
│       ├── chat.gateway.ts
│       ├── chat.service.ts
│       └── chat.module.ts
├── common/
│   └── filters/ws-exception.filter.ts
├── config/
│   └── typeorm.config.ts
├── app.module.ts
└── main.ts
```

## Design Decisions

### 1. Nickname as Identity
- **Why**: Prototype simplicity
- **Production**: Add JWT authentication

### 2. Message Edit Constraints
- Can only edit your last message
- Only if no one else has replied
- **Why**: Prevents conversation confusion

### 3. Soft Delete for Rooms
- Uses `deleted_at` timestamp
- **Why**: Audit trail and data recovery

### 4. WebSocket Room Pattern
- Socket.io rooms for broadcasting
- **Limitation**: Single server only
- **Solution**: Add Redis adapter for scaling

### 5. TypeORM Synchronize
- Enabled in development
- **Production**: Use migrations

## Production Concerns

### Security
- [ ] Add authentication (JWT)
- [ ] Add authorization/permissions
- [ ] Implement rate limiting
- [ ] XSS input sanitization
- [ ] CORS configuration
- [ ] SSL/TLS for WebSocket

### Scalability
- [ ] Redis adapter for Socket.io
- [ ] Implement caching
- [ ] Database connection pooling
- [ ] Message pagination
- [ ] Message archiving

### Monitoring
- [ ] Structured logging
- [ ] Health check endpoints
- [ ] Metrics collection
- [ ] Error tracking
- [ ] Performance monitoring

### Database
- [ ] Switch to migrations
- [ ] Add connection pooling
- [ ] Set up backups
- [ ] Consider read replicas

## Development

```bash
# Install dependencies
npm install

# Development with watch mode
npm run start:dev

# Build for production
npm run build

# Run production build
npm run start:prod

# Lint code
npm run lint

# Format code
npm run format
```

## License

MIT
