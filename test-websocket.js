#!/usr/bin/env node

/**
 * Simple WebSocket Test Script
 * 
 * Usage: node test-websocket.js
 * 
 * Requirements: npm install socket.io-client
 */

const io = require('socket.io-client');

const SERVER_URL = 'http://localhost:3000';
const ROOM_ID = 1;
const NICKNAME = 'test_user_' + Math.floor(Math.random() * 1000);

console.log('=== Chat Room WebSocket Test ===\n');
console.log(`Connecting to: ${SERVER_URL}`);
console.log(`Nickname: ${NICKNAME}\n`);

const socket = io(SERVER_URL);

// Connection events
socket.on('connect', () => {
  console.log('✓ Connected to server\n');
  console.log('Joining room...');
  
  socket.emit('join_room', {
    roomId: ROOM_ID,
    nickname: NICKNAME
  });
});

socket.on('disconnect', () => {
  console.log('\n✗ Disconnected from server');
});

// Room events
socket.on('joined_room', (data) => {
  console.log('✓ Joined room successfully\n');
  console.log('Room State:');
  console.log('- Participants:', data.data.participants.length);
  console.log('- Messages:', data.data.messages.length);
  
  if (data.data.messages.length > 0) {
    console.log('\nRecent Messages:');
    data.data.messages.slice(-3).forEach(msg => {
      console.log(`  [${msg.nickname}]: ${msg.content}`);
    });
  }
  
  console.log('\nSending test message...');
  socket.emit('send_message', {
    roomId: ROOM_ID,
    nickname: NICKNAME,
    content: `Hello! This is a test message from ${NICKNAME}`
  });
});

socket.on('message_sent', (data) => {
  console.log('✓ Message sent successfully');
  console.log('  Message ID:', data.data.id);
  
  console.log('\nEditing message...');
  socket.emit('edit_message', {
    messageId: data.data.id,
    nickname: NICKNAME,
    content: `Hello! This is an EDITED test message from ${NICKNAME}`
  });
});

socket.on('message_edited', (data) => {
  console.log('✓ Message edited successfully');
  console.log('  Edited:', data.data.edited);
  
  console.log('\nGetting participants...');
  socket.emit('get_participants', {
    roomId: ROOM_ID
  });
});

socket.on('room_participants', (data) => {
  console.log('✓ Participants received:');
  data.forEach(p => {
    const status = p.isConnected ? '🟢 Online' : '⚫ Offline';
    console.log(`  - ${p.nickname} ${status}`);
  });
  
  console.log('\n=== Test Complete ===');
  console.log('Leaving room in 2 seconds...');
  
  setTimeout(() => {
    socket.emit('leave_room', {
      roomId: ROOM_ID,
      nickname: NICKNAME
    });
  }, 2000);
});

socket.on('left_room', () => {
  console.log('✓ Left room successfully');
  socket.disconnect();
  process.exit(0);
});

// Broadcast events
socket.on('user_joined', (data) => {
  console.log(`→ User joined: ${data.nickname}`);
});

socket.on('user_left', (data) => {
  console.log(`← User left: ${data.nickname}`);
});

socket.on('new_message', (message) => {
  if (message.nickname !== NICKNAME) {
    console.log(`\n💬 New message from ${message.nickname}:`);
    console.log(`   ${message.content}`);
  }
});

// Error handling
socket.on('error', (error) => {
  console.error('\n✗ Error:', error);
  process.exit(1);
});

socket.on('connect_error', (error) => {
  console.error('\n✗ Connection Error:', error.message);
  console.error('\nMake sure the server is running at:', SERVER_URL);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\nShutting down...');
  socket.disconnect();
  process.exit(0);
});
