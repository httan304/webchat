# Testing Guide - Backend Only

This guide focuses on testing the backend API and WebSocket functionality without a frontend client.

## Prerequisites

- Docker & Docker Compose
- cURL or HTTP client (Postman, Insomnia, HTTPie)
- WebSocket client (wscat, websocat, Postman)

## Quick Start

```bash
# Start the backend
docker-compose up --build

# Wait for: "Application is running on: http://localhost:3000"
```

## Testing REST API

### Method 1: Using cURL

#### 1. Create Users

```bash
# Create first user
curl -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -d '{"nickname": "alice"}'

# Create second user
curl -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -d '{"nickname": "bob"}'

# List all users
curl http://localhost:3000/users
```

#### 2. Create and Manage Rooms

```bash
# Create a room
curl -X POST http://localhost:3000/rooms \
  -H "Content-Type: application/json" \
  -d '{"name": "General Chat", "creatorNickname": "alice"}'

# List all rooms
curl http://localhost:3000/rooms

# Get specific room
curl http://localhost:3000/rooms/1

# Get room participants (after joining via WebSocket)
curl http://localhost:3000/rooms/1/participants

# Delete room (only creator can delete)
curl -X DELETE "http://localhost:3000/rooms/1?nickname=alice"
```

### Method 2: Using Postman

1. Import `postman_collection.json`
2. The collection includes all REST endpoints
3. Execute requests in sequence

### Method 3: Using HTTPie

```bash
# Install HTTPie: pip install httpie

# Create user
http POST localhost:3000/users nickname=alice

# Create room
http POST localhost:3000/rooms name="General Chat" creatorNickname=alice

# List rooms
http GET localhost:3000/rooms
```

## Testing WebSocket

### Method 1: Using wscat (Recommended)

```bash
# Install wscat
npm install -g wscat

# Connect to WebSocket server
wscat -c ws://localhost:3000

# Once connected, send events:

# Join room
> {"event": "join_room", "data": {"roomId": 1, "nickname": "alice"}}

# Send message
> {"event": "send_message", "data": {"roomId": 1, "nickname": "alice", "content": "Hello!"}}

# Edit message (use the message ID from response)
> {"event": "edit_message", "data": {"messageId": 1, "nickname": "alice", "content": "Hello, Updated!"}}

# Get participants
> {"event": "get_participants", "data": {"roomId": 1}}

# Leave room
> {"event": "leave_room", "data": {"roomId": 1, "nickname": "alice"}}
```

### Method 2: Using websocat

```bash
# Install websocat
# macOS: brew install websocat
# Linux: cargo install websocat

# Connect and interact
websocat ws://localhost:3000
```

### Method 3: Using Postman (WebSocket Support)

1. Open Postman
2. Create new WebSocket Request
3. Connect to: `ws://localhost:3000`
4. Send JSON events in the message field

### Method 4: Using Node.js Script

Create `test-websocket.js`:

```javascript
const io = require('socket.io-client');

const socket = io('http://localhost:3000');

socket.on('connect', () => {
  console.log('Connected to server');
  
  // Join room
  socket.emit('join_room', {
    roomId: 1,
    nickname: 'alice'
  });
});

socket.on('joined_room', (data) => {
  console.log('Joined room:', data);
  
  // Send message
  socket.emit('send_message', {
    roomId: 1,
    nickname: 'alice',
    content: 'Hello from Node.js!'
  });
});

socket.on('new_message', (message) => {
  console.log('New message:', message);
});

socket.on('message_edited', (message) => {
  console.log('Message edited:', message);
});

socket.on('user_joined', (data) => {
  console.log('User joined:', data);
});

socket.on('user_left', (data) => {
  console.log('User left:', data);
});

socket.on('error', (error) => {
  console.error('Error:', error);
});

// Run: node test-websocket.js
```

### Method 5: Using Python Script

Create `test_websocket.py`:

```python
import socketio

sio = socketio.Client()

@sio.event
def connect():
    print('Connected to server')
    sio.emit('join_room', {'roomId': 1, 'nickname': 'alice'})

@sio.event
def joined_room(data):
    print('Joined room:', data)
    sio.emit('send_message', {
        'roomId': 1,
        'nickname': 'alice',
        'content': 'Hello from Python!'
    })

@sio.event
def new_message(data):
    print('New message:', data)

@sio.event
def disconnect():
    print('Disconnected from server')

sio.connect('http://localhost:3000')
sio.wait()

# Run: pip install python-socketio && python test_websocket.py
```

## Complete Test Scenario

### Scenario: Two Users Chatting

**Terminal 1 - Alice:**
```bash
# Connect
wscat -c ws://localhost:3000

# Join room
> {"event": "join_room", "data": {"roomId": 1, "nickname": "alice"}}

# Send message
> {"event": "send_message", "data": {"roomId": 1, "nickname": "alice", "content": "Hi Bob!"}}

# Edit message
> {"event": "edit_message", "data": {"messageId": 1, "nickname": "alice", "content": "Hi Bob! How are you?"}}
```

**Terminal 2 - Bob:**
```bash
# Connect
wscat -c ws://localhost:3000

# Join room
> {"event": "join_room", "data": {"roomId": 1, "nickname": "bob"}}

# Bob will see Alice's messages automatically

# Send reply
> {"event": "send_message", "data": {"roomId": 1, "nickname": "bob", "content": "Hi Alice! I'm good!"}}
```

**Terminal 3 - Monitor via REST:**
```bash
# Check participants
curl http://localhost:3000/rooms/1/participants

# Check if users are connected
curl http://localhost:3000/users
```

## Testing Features

### 1. User Management

```bash
# Create user
curl -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -d '{"nickname": "testuser"}'

# Verify unique constraint (should fail)
curl -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -d '{"nickname": "testuser"}'

# Expected: 409 Conflict
```

### 2. Room Management

```bash
# Create room
curl -X POST http://localhost:3000/rooms \
  -H "Content-Type: application/json" \
  -d '{"name": "Test Room", "creatorNickname": "alice"}'

# Only creator can delete
curl -X DELETE "http://localhost:3000/rooms/1?nickname=bob"
# Expected: 403 Forbidden

curl -X DELETE "http://localhost:3000/rooms/1?nickname=alice"
# Expected: 204 No Content
```

### 3. Message Editing Rules

```bash
# In wscat:

# Alice sends first message
> {"event": "send_message", "data": {"roomId": 1, "nickname": "alice", "content": "Message 1"}}

# Alice can edit (it's her last message)
> {"event": "edit_message", "data": {"messageId": 1, "nickname": "alice", "content": "Message 1 edited"}}

# Bob sends a message
> {"event": "send_message", "data": {"roomId": 1, "nickname": "bob", "content": "Message 2"}}

# Alice tries to edit her first message (should fail - Bob sent a message after)
> {"event": "edit_message", "data": {"messageId": 1, "nickname": "alice", "content": "Message 1 edited again"}}
# Expected: Error - can only edit if it's the last message
```

### 4. Connection Status

```bash
# Check initial status
curl http://localhost:3000/users

# Connect via WebSocket
wscat -c ws://localhost:3000
> {"event": "join_room", "data": {"roomId": 1, "nickname": "alice"}}

# Check status again (alice should be connected)
curl http://localhost:3000/users

# Disconnect wscat (Ctrl+C)

# Check status (alice should be disconnected)
curl http://localhost:3000/users
```

## Expected Responses

### Success Responses

**User Created:**
```json
{
  "id": 1,
  "nickname": "alice",
  "isConnected": false,
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

**Room Created:**
```json
{
  "id": 1,
  "name": "General Chat",
  "creatorId": 1,
  "creator": {
    "id": 1,
    "nickname": "alice"
  },
  "createdAt": "2024-01-01T00:00:00.000Z"
}
```

**Joined Room:**
```json
{
  "event": "joined_room",
  "data": {
    "roomId": 1,
    "participants": [...],
    "messages": [...]
  }
}
```

### Error Responses

**Duplicate Nickname:**
```json
{
  "statusCode": 409,
  "message": "Nickname already taken",
  "error": "Conflict"
}
```

**Room Not Found:**
```json
{
  "statusCode": 404,
  "message": "Room not found",
  "error": "Not Found"
}
```

**Forbidden Action:**
```json
{
  "statusCode": 403,
  "message": "Only the room creator can delete this room",
  "error": "Forbidden"
}
```

## Performance Testing

### Using Apache Bench

```bash
# Install: apt-get install apache2-utils

# Test user creation
ab -n 100 -c 10 -p user.json -T application/json \
  http://localhost:3000/users

# user.json:
# {"nickname": "user${RANDOM}"}
```

### Using Artillery

```bash
# Install: npm install -g artillery

# Create artillery.yml
artillery quick --count 10 --num 100 http://localhost:3000/rooms
```

## Debugging

### Enable Detailed Logging

Edit `src/app.module.ts`:
```typescript
logging: true, // Always enable logging
```

### Check Database

```bash
# Connect to PostgreSQL
docker-compose exec postgres psql -U chatapp chatapp_db

# Query tables
SELECT * FROM users;
SELECT * FROM rooms;
SELECT * FROM messages;
SELECT * FROM room_participants;
```

### Check Logs

```bash
# View application logs
docker-compose logs -f app

# View PostgreSQL logs
docker-compose logs -f postgres
```

## Troubleshooting

### WebSocket Not Connecting

```bash
# Check if server is running
curl http://localhost:3000

# Check WebSocket endpoint
curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" \
  http://localhost:3000/socket.io/?EIO=4&transport=polling
```

### Database Connection Issues

```bash
# Ensure PostgreSQL is ready
docker-compose ps

# Check database connection
docker-compose exec app npm run typeorm -- schema:log
```

### Port Already in Use

```bash
# Find process using port 3000
lsof -i :3000

# Or kill it
kill -9 $(lsof -t -i:3000)
```

## Automated Testing

### Run Unit Tests

```bash
npm run test
```

### Run E2E Tests

```bash
npm run test:e2e
```

### Run with Coverage

```bash
npm run test:cov
```

## CI/CD Testing

Example GitHub Actions workflow:

```yaml
name: Test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: chatapp_password
          POSTGRES_DB: chatapp_db
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '18'
      
      - run: npm install
      - run: npm run test
      - run: npm run test:e2e
```

## Additional Tools

### Swagger/OpenAPI (Future)

```bash
# Install Swagger
npm install --save @nestjs/swagger swagger-ui-express

# Access at http://localhost:3000/api/docs
```

### Database GUI

```bash
# Use pgAdmin or DBeaver to connect:
# Host: localhost
# Port: 5432
# User: chatapp
# Password: chatapp_password
# Database: chatapp_db
```

## Summary

This guide covers all methods to test the backend without a frontend:
- REST API testing (cURL, Postman, HTTPie)
- WebSocket testing (wscat, websocat, scripts)
- Feature verification
- Performance testing
- Debugging techniques

The backend is fully testable and production-ready!
