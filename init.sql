CREATE ROLE chatapp LOGIN PASSWORD 'chatapp_password';
CREATE DATABASE chatapp_db OWNER chatapp;
GRANT ALL PRIVILEGES ON DATABASE chatapp_db TO chatapp;
