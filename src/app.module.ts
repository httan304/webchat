import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager';
import * as redisStore from 'cache-manager-redis-store';

import { User } from './modules/users/entities/user.entity';
import { Room } from './modules/rooms/entities/room.entity';
import { Message } from './modules/chat/entities/message.entity';
import { RoomParticipant } from './modules/rooms/entities/room-participant.entity';

import { UsersModule } from './modules/users/users.module';
import { RoomsModule } from './modules/rooms/rooms.module';
import { ChatModule } from './modules/chat/chat.module';

import { CircuitBreakerService } from './services/circuit-breaker.service';
import { CacheService } from './services/cache.service';
import { RateLimiterService } from './services/rate-limiter.service';
import { BulkheadService } from './services/bulkhead.service';
import {
  RequestProcessingPipeline,
  TracingHandler,
  AuthorizationHandler,
  ValidationHandler,
  SecurityHeadersHandler,
  RateLimitingHandler,
} from './services/chain-of-responsibility.service';
import {RedisModule} from "@/config/redis.module";
import {RedisProvider} from "@/infrastructure/redis/redis.provider";

@Global()
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  providers: [
    CircuitBreakerService,
    RedisProvider,
    CacheService,
    RateLimiterService,
    BulkheadService,
    TracingHandler,
    AuthorizationHandler,
    ValidationHandler,
    SecurityHeadersHandler,
    {
      provide: RateLimitingHandler,
      useFactory: () =>
          new RateLimitingHandler({
            maxRequests: parseInt(process.env.RATE_LIMIT_MAX || '100'),
            windowMs: parseInt(process.env.RATE_LIMIT_WINDOW || '60000'),
          }),
    },
    RequestProcessingPipeline,
  ],
  exports: [
    CircuitBreakerService,
    CacheService,
    RateLimiterService,
    BulkheadService,
    RequestProcessingPipeline,
  ],
})
export class InfrastructureModule {}

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
        synchronize: configService.get('NODE_ENV') === 'development',
        logging:
            configService.get('DATABASE_LOGGING') === 'true'
                ? ['query', 'error', 'warn']
                : ['error'],
        maxQueryExecutionTime: 1000,
        poolSize: parseInt(configService.get('DATABASE_POOL_SIZE') || '20'),
        migrations: ['src/migrations/**/*.ts'],
        migrationsRun: true,
        ssl:
            configService.get('NODE_ENV') === 'production'
                ? { rejectUnauthorized: false }
                : false,
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
    RedisModule,
    InfrastructureModule,
    UsersModule,
    RoomsModule,
    ChatModule,
  ],

  controllers: [],
})
export class AppModule {}
