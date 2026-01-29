import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateOptimizedTables1769668085712 implements MigrationInterface {
	name = 'CreateOptimizedTables1769668085712'

	public async up(queryRunner: QueryRunner): Promise<void> {
		// ========================================
		// 1. Enable UUID extension
		// ========================================
		await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

		// ========================================
		// 2. Create users table
		// ========================================
		await queryRunner.query(`
            CREATE TABLE "users" (
                "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
                "nickname" VARCHAR(50) NOT NULL,
                "isConnected" BOOLEAN NOT NULL DEFAULT false,
                "lastSeen" TIMESTAMP NULL,
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_users" PRIMARY KEY ("id"),
                CONSTRAINT "UQ_users_nickname" UNIQUE ("nickname")
            )
        `);

		// ========================================
		// 3. Create rooms table
		// ========================================
		await queryRunner.query(`
            CREATE TABLE "rooms" (
                "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
                "name" VARCHAR(255) NOT NULL,
                "description" TEXT NULL,
                "creatorNickname" VARCHAR(50) NOT NULL,
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_rooms" PRIMARY KEY ("id")
            )
        `);

		// ========================================
		// 4. Create room_participants table
		// ========================================
		await queryRunner.query(`
            CREATE TABLE "room_participants" (
                "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
                "roomId" UUID NOT NULL,
                "nickname" VARCHAR(50) NOT NULL,
                "joinedAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_room_participants" PRIMARY KEY ("id"),
                CONSTRAINT "UQ_room_participant" UNIQUE ("roomId", "nickname")
            )
        `);

		// ========================================
		// 5. Create messages table
		// ========================================
		await queryRunner.query(`
            CREATE TABLE "messages" (
                "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
                "roomId" UUID NOT NULL,
                "senderNickname" VARCHAR(50) NOT NULL,
                "content" TEXT NOT NULL,
                "edited" BOOLEAN NOT NULL DEFAULT false,
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_messages" PRIMARY KEY ("id")
            )
        `);

		// ========================================
		// 6. Create indexes for users
		// ========================================
		await queryRunner.query(`
            CREATE UNIQUE INDEX "IDX_users_nickname" 
            ON "users" ("nickname")
        `);

		await queryRunner.query(`
            CREATE INDEX "IDX_users_isConnected" 
            ON "users" ("isConnected")
        `);

		await queryRunner.query(`
            CREATE INDEX "IDX_users_createdAt" 
            ON "users" ("createdAt")
        `);

		// ========================================
		// 7. Create indexes for rooms
		// ========================================
		await queryRunner.query(`
            CREATE INDEX "IDX_rooms_creatorNickname" 
            ON "rooms" ("creatorNickname")
        `);

		await queryRunner.query(`
            CREATE INDEX "IDX_rooms_createdAt" 
            ON "rooms" ("createdAt")
        `);

		// ========================================
		// 8. Create indexes for room_participants
		// ========================================
		// Note: Unique constraint already creates index for (roomId, nickname)

		await queryRunner.query(`
            CREATE INDEX "IDX_room_participants_roomId" 
            ON "room_participants" ("roomId")
        `);

		await queryRunner.query(`
            CREATE INDEX "IDX_room_participants_nickname" 
            ON "room_participants" ("nickname")
        `);

		// ========================================
		// 9. Create indexes for messages
		// ========================================
		await queryRunner.query(`
            CREATE INDEX "IDX_messages_roomId_createdAt" 
            ON "messages" ("roomId", "createdAt" DESC)
        `);

		await queryRunner.query(`
            CREATE INDEX "IDX_messages_senderNickname_createdAt" 
            ON "messages" ("senderNickname", "createdAt" DESC)
        `);

		await queryRunner.query(`
            CREATE INDEX "IDX_messages_createdAt" 
            ON "messages" ("createdAt" DESC)
        `);

		// ========================================
		// 10. Add foreign keys for room_participants
		// ========================================
		await queryRunner.query(`
            ALTER TABLE "room_participants"
            ADD CONSTRAINT "FK_room_participants_roomId"
            FOREIGN KEY ("roomId") 
            REFERENCES "rooms"("id")
            ON DELETE CASCADE
            ON UPDATE NO ACTION
        `);

		await queryRunner.query(`
            ALTER TABLE "room_participants"
            ADD CONSTRAINT "FK_room_participants_nickname"
            FOREIGN KEY ("nickname") 
            REFERENCES "users"("nickname")
            ON DELETE CASCADE
            ON UPDATE NO ACTION
        `);

		// ========================================
		// 11. Add foreign keys for messages
		// ========================================
		await queryRunner.query(`
            ALTER TABLE "messages"
            ADD CONSTRAINT "FK_messages_roomId"
            FOREIGN KEY ("roomId") 
            REFERENCES "rooms"("id")
            ON DELETE CASCADE
            ON UPDATE NO ACTION
        `);

		await queryRunner.query(`
            ALTER TABLE "messages"
            ADD CONSTRAINT "FK_messages_senderNickname"
            FOREIGN KEY ("senderNickname") 
            REFERENCES "users"("nickname")
            ON DELETE CASCADE
            ON UPDATE NO ACTION
        `);

		// ========================================
		// 12. Optional: Add foreign key for room creator
		// ========================================
		await queryRunner.query(`
            ALTER TABLE "rooms"
            ADD CONSTRAINT "FK_rooms_creatorNickname"
            FOREIGN KEY ("creatorNickname") 
            REFERENCES "users"("nickname")
            ON DELETE CASCADE
            ON UPDATE NO ACTION
        `);

		console.log('✅ All tables, indexes, and constraints created successfully!');
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		// ========================================
		// Drop foreign keys first (reverse order)
		// ========================================
		await queryRunner.query(`ALTER TABLE "rooms" DROP CONSTRAINT IF EXISTS "FK_rooms_creatorNickname"`);
		await queryRunner.query(`ALTER TABLE "messages" DROP CONSTRAINT IF EXISTS "FK_messages_senderNickname"`);
		await queryRunner.query(`ALTER TABLE "messages" DROP CONSTRAINT IF EXISTS "FK_messages_roomId"`);
		await queryRunner.query(`ALTER TABLE "room_participants" DROP CONSTRAINT IF EXISTS "FK_room_participants_nickname"`);
		await queryRunner.query(`ALTER TABLE "room_participants" DROP CONSTRAINT IF EXISTS "FK_room_participants_roomId"`);

		// ========================================
		// Drop indexes
		// ========================================
		// Messages indexes
		await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_messages_createdAt"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_messages_senderNickname_createdAt"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_messages_roomId_createdAt"`);

		// Room participants indexes
		await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_room_participants_nickname"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_room_participants_roomId"`);

		// Rooms indexes
		await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_rooms_createdAt"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_rooms_creatorNickname"`);

		// Users indexes
		await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_users_createdAt"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_users_isConnected"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_users_nickname"`);

		// ========================================
		// Drop tables
		// ========================================
		await queryRunner.query(`DROP TABLE IF EXISTS "messages"`);
		await queryRunner.query(`DROP TABLE IF EXISTS "room_participants"`);
		await queryRunner.query(`DROP TABLE IF EXISTS "rooms"`);
		await queryRunner.query(`DROP TABLE IF EXISTS "users"`);

		console.log('✅ All tables dropped successfully!');
	}
}
