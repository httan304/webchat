import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoomsService } from './rooms.service';
import { RoomsController } from './rooms.controller';
import { Room } from './entities/room.entity';
import { RoomParticipant } from './entities/room-participant.entity';
import { User } from '../users/entities/user.entity'; // ✅ ADD THIS
import { UsersModule } from '../users/users.module';

import { CircuitBreakerService } from '@/services/circuit-breaker.service';
import { CacheService } from '@/services/cache.service';
import { RateLimiterService } from '@/services/rate-limiter.service';
import { BulkheadService } from '@/services/bulkhead.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Room,
      RoomParticipant,
      User,
    ]),
    UsersModule,
  ],
  controllers: [RoomsController],
  providers: [
    RoomsService,
    CircuitBreakerService,
    CacheService,
    RateLimiterService,
    BulkheadService,
  ],
  exports: [RoomsService],
})
export class RoomsModule {}
