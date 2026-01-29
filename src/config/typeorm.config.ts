import { DataSource } from 'typeorm';
import { User } from '../modules/users/entities/user.entity';
import { Room } from '../modules/rooms/entities/room.entity';
import { Message } from '../modules/chat/entities/message.entity';
import { RoomParticipant } from '../modules/rooms/entities/room-participant.entity';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DATABASE_HOST,
  port: parseInt(process.env.DATABASE_PORT || '5432', 10),
  username: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
  entities: [User, Room, Message, RoomParticipant],
  migrations: ['src/migrations/*.ts'],
  synchronize: true,
  logging: process.env.NODE_ENV === 'development',
});
