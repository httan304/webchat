#!/bin/bash

# Chat Room Database Initialization Script
# This script creates the PostgreSQL database and user for the chat application

set -e  # Exit on error

# Configuration
DB_USER="chatapp"
DB_PASSWORD="chatapp_password"
DB_NAME="chatapp_db"
POSTGRES_USER="${POSTGRES_USER:-postgres}"

echo "=================================="
echo "Chat Room Database Initialization"
echo "=================================="
echo ""

# Check if PostgreSQL is running
if ! pg_isready -q; then
    echo "❌ PostgreSQL is not running!"
    echo "Please start PostgreSQL first:"
    echo "  macOS: brew services start postgresql"
    echo "  Linux: sudo systemctl start postgresql"
    echo "  Docker: docker-compose up -d postgres"
    exit 1
fi

echo "✓ PostgreSQL is running"
echo ""

# Function to run SQL as postgres user
run_sql() {
    psql -U "$POSTGRES_USER" -c "$1" 2>/dev/null || true
}

# Check if user exists
echo "Checking if user '$DB_USER' exists..."
USER_EXISTS=$(psql -U "$POSTGRES_USER" -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'")

if [ "$USER_EXISTS" = "1" ]; then
    echo "⚠ User '$DB_USER' already exists"
    read -p "Do you want to drop and recreate? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "Dropping user..."
        psql -U "$POSTGRES_USER" -c "DROP USER IF EXISTS $DB_USER;"
    else
        echo "Skipping user creation"
    fi
fi

# Create user if it doesn't exist
if [ "$USER_EXISTS" != "1" ] || [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Creating user '$DB_USER'..."
    psql -U "$POSTGRES_USER" -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD';"
    echo "✓ User created"
fi

echo ""

# Check if database exists
echo "Checking if database '$DB_NAME' exists..."
DB_EXISTS=$(psql -U "$POSTGRES_USER" -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'")

if [ "$DB_EXISTS" = "1" ]; then
    echo "⚠ Database '$DB_NAME' already exists"
    read -p "Do you want to drop and recreate? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "Dropping database..."
        psql -U "$POSTGRES_USER" -c "DROP DATABASE IF EXISTS $DB_NAME;"
    else
        echo "Using existing database"
    fi
fi

# Create database if it doesn't exist
if [ "$DB_EXISTS" != "1" ] || [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Creating database '$DB_NAME'..."
    psql -U "$POSTGRES_USER" -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"
    echo "✓ Database created"
fi

echo ""

# Grant privileges
echo "Granting privileges..."
psql -U "$POSTGRES_USER" -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;"

# Connect to database and grant schema privileges
psql -U "$POSTGRES_USER" -d "$DB_NAME" <<EOF
GRANT ALL ON SCHEMA public TO $DB_USER;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO $DB_USER;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO $DB_USER;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO $DB_USER;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO $DB_USER;
EOF

echo "✓ Privileges granted"
echo ""

# Create tables
echo "Creating tables..."
psql -U "$POSTGRES_USER" -d "$DB_NAME" <<EOF

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    nickname VARCHAR(50) UNIQUE NOT NULL,
    is_connected BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Rooms table
CREATE TABLE IF NOT EXISTS rooms (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    creator_id INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    deleted_at TIMESTAMP NULL
);

-- Room participants table
CREATE TABLE IF NOT EXISTS room_participants (
    id SERIAL PRIMARY KEY,
    room_id INTEGER REFERENCES rooms(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id),
    joined_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(room_id, user_id)
);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    content TEXT NOT NULL,
    room_id INTEGER REFERENCES rooms(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id),
    edited BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_users_nickname ON users(nickname);
CREATE INDEX IF NOT EXISTS idx_rooms_creator_id ON rooms(creator_id);
CREATE INDEX IF NOT EXISTS idx_rooms_deleted_at ON rooms(deleted_at);
CREATE INDEX IF NOT EXISTS idx_room_participants_room_id ON room_participants(room_id);
CREATE INDEX IF NOT EXISTS idx_room_participants_user_id ON room_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_room_id ON messages(room_id);
CREATE INDEX IF NOT EXISTS idx_messages_user_id ON messages(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);

-- Grant table permissions
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO $DB_USER;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO $DB_USER;

EOF

echo "✓ Tables created"
echo ""

# Verify setup
echo "Verifying setup..."
TABLE_COUNT=$(psql -U "$POSTGRES_USER" -d "$DB_NAME" -tAc "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'")

echo "✓ Found $TABLE_COUNT tables"
echo ""

# Test connection as chatapp user
echo "Testing connection as '$DB_USER'..."
if psql -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1" > /dev/null 2>&1; then
    echo "✓ Connection successful!"
else
    echo "❌ Connection failed!"
    exit 1
fi

echo ""
echo "=================================="
echo "✓ Database initialization complete!"
echo "=================================="
echo ""
echo "Connection details:"
echo "  Host:     localhost"
echo "  Port:     5432"
echo "  Database: $DB_NAME"
echo "  Username: $DB_USER"
echo "  Password: $DB_PASSWORD"
echo ""
echo "Connect with:"
echo "  psql -U $DB_USER -d $DB_NAME"
echo ""
