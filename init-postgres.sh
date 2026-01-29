#!/bin/bash
set -e

# This script runs when PostgreSQL container first starts
# It creates the database user and database

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    -- Create user if not exists
    DO \$\$
    BEGIN
        IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'chatapp') THEN
            CREATE USER chatapp WITH PASSWORD 'chatapp_password';
        END IF;
    END
    \$\$;

    -- Grant privileges
    GRANT ALL PRIVILEGES ON DATABASE chatapp_db TO chatapp;
    GRANT ALL ON SCHEMA public TO chatapp;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO chatapp;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO chatapp;
EOSQL

echo "Database user 'chatapp' created successfully"
