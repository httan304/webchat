import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  ForbiddenException,
  ConflictException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Room } from './entities/room.entity';
import { RoomParticipant } from './entities/room-participant.entity';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';

import { CircuitBreakerService } from '../../services/circuit-breaker.service';
import { CacheService } from '../../services/cache.service';
import { RateLimiterService } from '../../services/rate-limiter.service';
import { BulkheadService } from '../../services/bulkhead.service';
import { BulkheadNameType } from '../../types/bulkhead-name-type';

@Injectable()
export class RoomsService {
  private readonly logger = new Logger(RoomsService.name);

  private readonly CACHE_TTL = 300; // 5 minutes
  private readonly ROOM_CACHE_PREFIX = 'room:';
  private readonly ROOMS_LIST_PREFIX = 'rooms-list:';
  private readonly PARTICIPANT_CACHE_PREFIX = 'participant:';

  constructor(
    @InjectRepository(Room)
    private readonly roomRepository: Repository<Room>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(RoomParticipant)
    private readonly participantRepository: Repository<RoomParticipant>,
    private readonly usersService: UsersService,
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly cache: CacheService,
    private readonly rateLimiter: RateLimiterService,
    private readonly bulkhead: BulkheadService,
  ) {}

  /**
   * Create a new room
   * ✅ Rate Limiting
   * ✅ Circuit Breaker
   * ✅ Bulkhead
   * ✅ Cache invalidation
   */
  async createRoom(
    name: string,
    ownerNickname: string,
    description?: string,
  ): Promise<Room> {
    // ✅ 1. Rate Limiting - Prevent spam room creation
    const rateLimitKey = `room-create:${ownerNickname}`;
    const rate = await this.rateLimiter.isAllowed(rateLimitKey, {
      maxRequests: 3, // 3 rooms
      windowMs: 60_000, // per minute
    });

    if (!rate.allowed) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Room creation rate limit exceeded',
          retryAfter: rate.retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // ✅ 2. Execute with Circuit Breaker + Bulkhead
    return this.bulkhead.execute(
      {
        name: BulkheadNameType.ChatWrite,
        maxConcurrency: 50,
        ttlMs: 15_000,
      },
      () =>
        this.circuitBreaker.execute(
          'room-create',
          () => this.performCreateRoom(name, ownerNickname, description),
          // ✅ Fallback
          async (error: Error) => {
            this.logger.error(`Circuit breaker fallback for createRoom: ${error.message}`);
            throw new HttpException(
              'Room service temporarily unavailable',
              HttpStatus.SERVICE_UNAVAILABLE,
            );
          },
        ),
    );
  }

  /**
   * Perform create room operation
   * @private
   */
  private async performCreateRoom(
    name: string,
    ownerNickname: string,
    description?: string,
  ): Promise<Room> {
    try {
      // 1. Check if room name exists
      const exists = await this.roomRepository.findOne({ where: { name } });
      if (exists) {
        throw new ConflictException('Room name already exists');
      }

      // 2. Create room
      const room = await this.roomRepository.save(
        this.roomRepository.create({
          name,
          ownerNickname,
          description,
        }),
      );

      // 3. Owner auto-join
      await this.participantRepository.save(
        this.participantRepository.create({
          roomId: room.id,
          nickname: ownerNickname,
        }),
      );

      // 4. Invalidate caches
      await this.cache.deletePattern(`${this.ROOMS_LIST_PREFIX}*`);
      await this.cache.deletePattern(`${this.PARTICIPANT_CACHE_PREFIX}${ownerNickname}:*`);

      // 5. Cache the new room
      await this.cache.set(
        `${this.ROOM_CACHE_PREFIX}${room.id}`,
        room,
        this.CACHE_TTL,
      );

      this.logger.log(`Room created: ${room.name} by ${ownerNickname}`);

      return room;
    } catch (error) {
      this.logger.error(
        `Error creating room: ${error.message}`,
        error.stack,
      );

      if (
        error instanceof ConflictException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }

      throw new HttpException(
        'Failed to create room',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Join a room
   * ✅ Circuit Breaker
   * ✅ Bulkhead
   * ✅ Cache invalidation
   */
  async joinRoom(roomId: string, nickname: string): Promise<void> {
    return this.bulkhead.execute(
      {
        name: BulkheadNameType.ChatWrite,
        maxConcurrency: 50,
        ttlMs: 15_000,
      },
      () =>
        this.circuitBreaker.execute(
          'room-join',
          () => this.performJoinRoom(roomId, nickname),
          async (error: Error) => {
            this.logger.error(`Circuit breaker fallback for joinRoom: ${error.message}`);
            throw new HttpException(
              'Room service temporarily unavailable',
              HttpStatus.SERVICE_UNAVAILABLE,
            );
          },
        ),
    );
  }

  /**
   * Perform join room operation
   * @private
   */
  private async performJoinRoom(roomId: string, nickname: string): Promise<void> {
    try {
      // 1. Check room exists
      const room = await this.roomRepository.findOne({ where: { id: roomId } });
      if (!room) {
        throw new NotFoundException('Room not found');
      }

      // 2. Check user exists
      const user = await this.userRepository.findOne({ where: { nickname } });
      if (!user) {
        throw new NotFoundException('User not found');
      }

      // 3. Check if already joined
      const joined = await this.participantRepository.findOne({
        where: { roomId, nickname },
      });

      if (joined) {
        // Idempotent - already joined is OK
        return;
      }

      // 4. Add participant
      await this.participantRepository.save(
        this.participantRepository.create({ roomId, nickname }),
      );

      // 5. Invalidate caches
      await this.cache.deletePattern(`${this.PARTICIPANT_CACHE_PREFIX}room:${roomId}*`);
      await this.cache.deletePattern(`${this.PARTICIPANT_CACHE_PREFIX}${roomId}:${nickname}`);
      await this.cache.delete(`${this.ROOM_CACHE_PREFIX}${roomId}`);

      this.logger.log(`User ${nickname} joined room ${roomId}`);
    } catch (error) {
      this.logger.error(
        `Error joining room ${roomId}: ${error.message}`,
        error.stack,
      );

      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }

      throw new HttpException(
        'Failed to join room',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Delete a room
   * ✅ Rate Limiting
   * ✅ Circuit Breaker
   * ✅ Bulkhead
   * ✅ Cache invalidation
   */
  async deleteRoom(roomId: string, requesterNickname: string): Promise<void> {
    // ✅ Rate Limiting
    const rateLimitKey = `room-delete:${requesterNickname}`;
    const rate = await this.rateLimiter.isAllowed(rateLimitKey, {
      maxRequests: 5, // 5 deletions
      windowMs: 60_000, // per minute
    });

    if (!rate.allowed) {
      throw new HttpException(
        'Room deletion rate limit exceeded',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return this.bulkhead.execute(
      {
        name: BulkheadNameType.ChatWrite,
        maxConcurrency: 50,
        ttlMs: 15_000,
      },
      () =>
        this.circuitBreaker.execute(
          'room-delete',
          () => this.performDeleteRoom(roomId, requesterNickname),
          async (error: Error) => {
            this.logger.error(`Circuit breaker fallback for deleteRoom: ${error.message}`);
            throw new HttpException(
              'Room service temporarily unavailable',
              HttpStatus.SERVICE_UNAVAILABLE,
            );
          },
        ),
    );
  }

  /**
   * Perform delete room operation
   * @private
   */
  private async performDeleteRoom(roomId: string, requesterNickname: string): Promise<void> {
    try {
      // 1. Get room with ownership check
      const room = await this.roomRepository.findOne({
        where: { id: roomId },
      });

      if (!room) {
        throw new NotFoundException('Room not found');
      }

      // 2. Check ownership
      if (room.ownerNickname !== requesterNickname) {
        throw new ForbiddenException('Only room owner can delete this room');
      }

      // 3. Delete participants first
      await this.participantRepository.delete({ roomId });

      // 4. Delete room
      await this.roomRepository.delete(roomId);

      // 5. Invalidate caches
      await this.cache.delete(`${this.ROOM_CACHE_PREFIX}${roomId}`);
      await this.cache.deletePattern(`${this.ROOMS_LIST_PREFIX}*`);
      await this.cache.deletePattern(`${this.PARTICIPANT_CACHE_PREFIX}room:${roomId}*`);
      await this.cache.deletePattern(`${this.PARTICIPANT_CACHE_PREFIX}*:${roomId}`);

      this.logger.warn(`Room deleted: ${room.name} by ${requesterNickname}`);
    } catch (error) {
      this.logger.error(
        `Error deleting room ${roomId}: ${error.message}`,
        error.stack,
      );

      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }

      throw new HttpException(
        'Failed to delete room',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get rooms created by user
   * ✅ Rate Limiting
   * ✅ Circuit Breaker
   * ✅ Bulkhead
   * ✅ Caching
   */
  async getRoomsCreatedBy(nickname: string): Promise<Room[]> {
    // ✅ Rate Limiting
    const rateLimitKey = `room-list:${nickname}`;
    const rate = await this.rateLimiter.isAllowed(rateLimitKey, {
      maxRequests: 20, // 20 requests
      windowMs: 60_000, // per minute
    });

    if (!rate.allowed) {
      throw new HttpException(
        'Rate limit exceeded',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // ✅ Cache first
    const cacheKey = `${this.ROOMS_LIST_PREFIX}created:${nickname}`;

    return this.cache.getOrSet(
      cacheKey,
      () =>
        this.bulkhead.execute(
          {
            name: BulkheadNameType.ChatRead,
            maxConcurrency: 100,
            ttlMs: 10_000,
          },
          () =>
            this.circuitBreaker.execute(
              'room-list-created',
              () => this.performGetRoomsCreatedBy(nickname),
              // ✅ Fallback - return empty array
              async () => {
                this.logger.warn(`Circuit breaker fallback for getRoomsCreatedBy`);
                return [];
              },
            ),
        ),
      this.CACHE_TTL,
    );
  }

  /**
   * Perform get rooms created by
   * @private
   */
  private async performGetRoomsCreatedBy(nickname: string): Promise<Room[]> {
    try {
      return await this.roomRepository.find({
        where: { ownerNickname: nickname },
        order: { createdAt: 'DESC' },
      });
    } catch (error) {
      this.logger.error(
        `Error getting rooms created by ${nickname}: ${error.message}`,
      );
      throw new HttpException(
        'Failed to get rooms',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get participants of a room
   * ✅ Rate Limiting
   * ✅ Circuit Breaker
   * ✅ Bulkhead
   * ✅ Caching
   */
  async getParticipants(roomId: string, requesterNickname: string) {
    // ✅ Rate Limiting
    const rateLimitKey = `room-participants:${requesterNickname}:${roomId}`;
    const rate = await this.rateLimiter.isAllowed(rateLimitKey, {
      maxRequests: 20,
      windowMs: 60_000,
    });

    if (!rate.allowed) {
      throw new HttpException(
        'Rate limit exceeded',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // ✅ Cache first
    const cacheKey = `${this.PARTICIPANT_CACHE_PREFIX}room:${roomId}`;

    return this.cache.getOrSet(
      cacheKey,
      () =>
        this.bulkhead.execute(
          {
            name: BulkheadNameType.ChatRead,
            maxConcurrency: 100,
            ttlMs: 10_000,
          },
          () =>
            this.circuitBreaker.execute(
              'room-get-participants',
              () => this.performGetParticipants(roomId, requesterNickname),
              // ✅ Fallback
              async () => {
                this.logger.warn(`Circuit breaker fallback for getParticipants`);
                return [];
              },
            ),
        ),
      60, // Cache for 1 minute (participants change frequently)
    );
  }

  /**
   * Perform get participants
   * @private
   */
  private async performGetParticipants(roomId: string, requesterNickname: string) {
    try {
      // 1. Check room exists
      const room = await this.roomRepository.findOne({
        where: { id: roomId },
        select: ['id', 'ownerNickname'],
      });

      if (!room) {
        throw new NotFoundException('Room not found');
      }

      // 2. Authorization check (only owner can view)
      if (room.ownerNickname !== requesterNickname) {
        throw new ForbiddenException('Only room owner can view participants');
      }

      // 3. Get participants
      const participants = await this.participantRepository.find({
        where: { roomId },
        select: ['id', 'nickname', 'joinedAt'],
        order: { joinedAt: 'ASC' },
      });

      return participants;
    } catch (error) {
      this.logger.error(
        `Error getting participants for room ${roomId}: ${error.message}`,
        error.stack,
      );

      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }

      throw new HttpException(
        'Failed to get participants',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get room by id
   * ✅ Caching
   * ✅ Circuit Breaker
   * ✅ Bulkhead
   */
  async findOne(roomId: string): Promise<Room> {
    // ✅ Try cache first
    const cacheKey = `${this.ROOM_CACHE_PREFIX}${roomId}`;
    let room = await this.cache.get<Room>(cacheKey);

    if (room) {
      return room;
    }

    // ✅ Cache miss - query database
    return this.bulkhead.execute(
      {
        name: BulkheadNameType.ChatRead,
        maxConcurrency: 100,
        ttlMs: 10_000,
      },
      () =>
        this.circuitBreaker.execute(
          'room-find-one',
          async () => {
            try {
              room = await this.roomRepository.findOne({
                where: { id: roomId },
                relations: ['participants', 'participants.user'],
              });

              if (!room) {
                throw new NotFoundException(`Room ${roomId} not found`);
              }

              // Cache for future requests
              await this.cache.set(cacheKey, room, this.CACHE_TTL);

              return room;
            } catch (error) {
              if (error instanceof NotFoundException) {
                throw error;
              }

              this.logger.error(
                `Error finding room ${roomId}: ${error.message}`,
              );
              throw new HttpException(
                'Failed to get room',
                HttpStatus.INTERNAL_SERVER_ERROR,
              );
            }
          },
          // ✅ Fallback
          async (error: Error) => {
            this.logger.error(`Circuit breaker fallback for findOne: ${error.message}`);
            throw new HttpException(
              'Room service temporarily unavailable',
              HttpStatus.SERVICE_UNAVAILABLE,
            );
          },
        ),
    );
  }

  /**
   * Add participant to a room
   * ✅ Circuit Breaker
   * ✅ Bulkhead
   * ✅ Cache invalidation
   */
  async addParticipant(roomId: string, userNickname: string): Promise<void> {
    return this.bulkhead.execute(
      {
        name: BulkheadNameType.ChatWrite,
        maxConcurrency: 50,
        ttlMs: 15_000,
      },
      () =>
        this.circuitBreaker.execute(
          'room-add-participant',
          () => this.performAddParticipant(roomId, userNickname),
          async (error: Error) => {
            this.logger.error(`Circuit breaker fallback for addParticipant: ${error.message}`);
            throw new HttpException(
              'Room service temporarily unavailable',
              HttpStatus.SERVICE_UNAVAILABLE,
            );
          },
        ),
    );
  }

  /**
   * Perform add participant
   * @private
   */
  private async performAddParticipant(roomId: string, userNickname: string): Promise<void> {
    try {
      // 1. Check room exists
      const room = await this.roomRepository.findOne({ where: { id: roomId } });
      if (!room) {
        throw new NotFoundException('Room not found');
      }

      // 2. Check user exists
      const user = await this.usersService.findByNickname(userNickname);
      if (!user) {
        throw new NotFoundException('User not found');
      }

      // 3. Check if already participant
      const existing = await this.participantRepository.findOne({
        where: { roomId, nickname: user.nickname },
      });

      if (existing) {
        throw new BadRequestException('User is already a participant');
      }

      // 4. Add participant
      const participant = this.participantRepository.create({
        roomId,
        nickname: user.nickname,
      });

      await this.participantRepository.save(participant);

      // 5. Invalidate caches
      await this.cache.deletePattern(`${this.PARTICIPANT_CACHE_PREFIX}room:${roomId}*`);
      await this.cache.delete(`${this.ROOM_CACHE_PREFIX}${roomId}`);
      await this.cache.deletePattern(`${this.PARTICIPANT_CACHE_PREFIX}${user.nickname}:*`);

      this.logger.log(`User ${userNickname} added to room ${roomId}`);
    } catch (error) {
      this.logger.error(
        `Error adding participant to room ${roomId}: ${error.message}`,
        error.stack,
      );

      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }

      throw new HttpException(
        'Failed to add participant',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get health status
   */
  async getHealthStatus(): Promise<any> {
    try {
      return {
        status: 'healthy',
        circuitBreaker: await this.circuitBreaker.getHealthStatus(),
        bulkhead: {
          write: await this.bulkhead.getStatus({
            name: BulkheadNameType.ChatWrite,
            maxConcurrency: 50,
          }),
          read: await this.bulkhead.getStatus({
            name: BulkheadNameType.ChatRead,
            maxConcurrency: 100,
          }),
        },
        cache: this.cache.getStats(),
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`Error getting health status: ${error.message}`);
      return {
        status: 'degraded',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }
}
