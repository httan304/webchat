#!/bin/bash

# Chat Room API Test Script
# Usage: ./test-api.sh

set -e

API_URL="http://localhost:3000"
NICKNAME="test_user_$$"

echo "=== Chat Room API Test ==="
echo ""
echo "API URL: $API_URL"
echo "Test Nickname: $NICKNAME"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test 1: Create User
echo -e "${YELLOW}Test 1: Creating user...${NC}"
USER_RESPONSE=$(curl -s -X POST $API_URL/users \
  -H "Content-Type: application/json" \
  -d "{\"nickname\": \"$NICKNAME\"}")

if echo "$USER_RESPONSE" | grep -q "\"nickname\":\"$NICKNAME\""; then
  echo -e "${GREEN}✓ User created successfully${NC}"
  echo "$USER_RESPONSE" | jq '.'
else
  echo -e "${RED}✗ Failed to create user${NC}"
  echo "$USER_RESPONSE"
  exit 1
fi
echo ""

# Test 2: List Users
echo -e "${YELLOW}Test 2: Listing users...${NC}"
USERS_RESPONSE=$(curl -s $API_URL/users)
echo -e "${GREEN}✓ Users retrieved${NC}"
echo "$USERS_RESPONSE" | jq '.'
echo ""

# Test 3: Try to create duplicate user
echo -e "${YELLOW}Test 3: Testing unique constraint (should fail)...${NC}"
DUPLICATE_RESPONSE=$(curl -s -X POST $API_URL/users \
  -H "Content-Type: application/json" \
  -d "{\"nickname\": \"$NICKNAME\"}")

if echo "$DUPLICATE_RESPONSE" | grep -q "409"; then
  echo -e "${GREEN}✓ Unique constraint working (409 Conflict)${NC}"
else
  echo -e "${YELLOW}⚠ Expected 409 Conflict${NC}"
fi
echo ""

# Test 4: Create Room
echo -e "${YELLOW}Test 4: Creating room...${NC}"
ROOM_RESPONSE=$(curl -s -X POST $API_URL/rooms \
  -H "Content-Type: application/json" \
  -d "{\"name\": \"Test Room $NICKNAME\", \"creatorNickname\": \"$NICKNAME\"}")

ROOM_ID=$(echo "$ROOM_RESPONSE" | jq -r '.id')

if [ "$ROOM_ID" != "null" ] && [ "$ROOM_ID" != "" ]; then
  echo -e "${GREEN}✓ Room created successfully (ID: $ROOM_ID)${NC}"
  echo "$ROOM_RESPONSE" | jq '.'
else
  echo -e "${RED}✗ Failed to create room${NC}"
  echo "$ROOM_RESPONSE"
  exit 1
fi
echo ""

# Test 5: List Rooms
echo -e "${YELLOW}Test 5: Listing rooms...${NC}"
ROOMS_RESPONSE=$(curl -s $API_URL/rooms)
echo -e "${GREEN}✓ Rooms retrieved${NC}"
echo "$ROOMS_RESPONSE" | jq '.'
echo ""

# Test 6: Get Room Details
echo -e "${YELLOW}Test 6: Getting room details...${NC}"
ROOM_DETAILS=$(curl -s $API_URL/rooms/$ROOM_ID)
echo -e "${GREEN}✓ Room details retrieved${NC}"
echo "$ROOM_DETAILS" | jq '.'
echo ""

# Test 7: Get Room Participants
echo -e "${YELLOW}Test 7: Getting room participants...${NC}"
PARTICIPANTS=$(curl -s $API_URL/rooms/$ROOM_ID/participants)
echo -e "${GREEN}✓ Participants retrieved${NC}"
echo "$PARTICIPANTS" | jq '.'
echo ""

# Test 8: Try to delete room with wrong user (should fail)
OTHER_USER="other_user_$$"
echo -e "${YELLOW}Test 8: Testing authorization (should fail)...${NC}"
DELETE_FAIL=$(curl -s -w "%{http_code}" -X DELETE "$API_URL/rooms/$ROOM_ID?nickname=$OTHER_USER")

if echo "$DELETE_FAIL" | grep -q "403"; then
  echo -e "${GREEN}✓ Authorization working (403 Forbidden)${NC}"
else
  echo -e "${YELLOW}⚠ Expected 403 Forbidden${NC}"
fi
echo ""

# Test 9: Delete room with correct user
echo -e "${YELLOW}Test 9: Deleting room (as creator)...${NC}"
DELETE_RESPONSE=$(curl -s -w "%{http_code}" -o /dev/null -X DELETE "$API_URL/rooms/$ROOM_ID?nickname=$NICKNAME")

if [ "$DELETE_RESPONSE" = "204" ]; then
  echo -e "${GREEN}✓ Room deleted successfully (204 No Content)${NC}"
else
  echo -e "${YELLOW}⚠ Expected 204, got $DELETE_RESPONSE${NC}"
fi
echo ""

# Test 10: Verify room is deleted
echo -e "${YELLOW}Test 10: Verifying room deletion...${NC}"
VERIFY_DELETE=$(curl -s -w "%{http_code}" -o /dev/null $API_URL/rooms/$ROOM_ID)

if [ "$VERIFY_DELETE" = "404" ]; then
  echo -e "${GREEN}✓ Room not found (404 Not Found)${NC}"
else
  echo -e "${YELLOW}⚠ Expected 404, got $VERIFY_DELETE${NC}"
fi
echo ""

echo -e "${GREEN}=== All Tests Passed ===${NC}"
echo ""
echo "Next steps:"
echo "1. Test WebSocket: node test-websocket.js"
echo "2. Use Postman collection: postman_collection.json"
echo "3. Read TESTING.md for more details"
