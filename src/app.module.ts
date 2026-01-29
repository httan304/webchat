import { Module } from '@nestjs/common';
import {ConfigModule, ConfigService} from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ServicesModule } from './services/service.module';

// Feature modules
import { UsersModule } from './modules/users/users.module';
import { RoomsModule } from './modules/rooms/rooms.module';
import { ChatModule } from './modules/chat/chat.module';
import {CacheModule} from "@nestjs/cache-manager";
import {redisStore} from "cache-manager-redis-yet";
import {User} from "@/modules/users/entities/user.entity";
import {Message} from "@/modules/chat/entities/message.entity";
import {RoomParticipant} from "@/modules/rooms/entities/room-participant.entity";
import {Room} from "@/modules/rooms/entities/room.entity";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      cache: true,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get('DATABASE_HOST') || 'localhost',
        port: configService.get('DATABASE_PORT') || 5432,
        username: configService.get('DATABASE_USER'),
        password: configService.get('DATABASE_PASSWORD'),
        database: configService.get('DATABASE_NAME'),
        entities: [User, Room, Message, RoomParticipant],
        logging:
          configService.get('DATABASE_LOGGING') === 'true'
            ? ['query', 'error', 'warn']
            : ['error'],
        maxQueryExecutionTime: 1000,
        poolSize: parseInt(configService.get('DATABASE_POOL_SIZE') || '20'),
        migrations: ['dist/migrations/**/*.js'],
        migrationsRun: false,
        synchronize: false,
        ssl: false
      }),
    }),

    CacheModule.registerAsync({
      isGlobal: true,
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        store: redisStore,
        host: configService.get('REDIS_HOST') || 'localhost',
        port: configService.get('REDIS_PORT') || 6379,
        password: configService.get('REDIS_PASSWORD'),
        db: configService.get('REDIS_DB') || 0,
        ttl: 300,
      }),
    }),

    ServicesModule,

    UsersModule,
    RoomsModule,
    ChatModule,
  ],
})
export class AppModule {}
