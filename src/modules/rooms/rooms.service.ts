import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  ForbiddenException,
  ConflictException,
  HttpException,
  HttpStatus, ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Room } from './entities/room.entity';
import { RoomParticipant } from './entities/room-participant.entity';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';

import { CircuitBreakerService } from '@/services/circuit-breaker.service';
import { CacheService } from '@/services/cache.service';
import { RateLimiterService } from '@/services/rate-limiter.service';
import { BulkheadService } from '@/services/bulkhead.service';
import { BulkheadNameType } from '@/types/bulkhead-name-type';
import {isUUID} from "class-validator";

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
    // Rate limit giữ nguyên
    const rate = await this.rateLimiter.isAllowed(
      `room-create:${ownerNickname}`,
      { maxRequests: 3, windowMs: 60_000 },
    );

    if (!rate.allowed) {
      throw new HttpException(
        'Room creation rate limit exceeded',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return this.executeProtected(
      BulkheadNameType.ChatWrite,
      'room-create',
      () => this.performCreateRoom(name, ownerNickname, description),
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
      const owner = await this.userRepository.findOne({
        where: { nickname: ownerNickname },
        select: ['nickname'],
      });

      if (!owner) {
        throw new NotFoundException(`User '${ownerNickname}' not found`);
      }

      // Check room name exists
      const exists = await this.roomRepository.findOne({ where: { name } });
      if (exists) {
        throw new ConflictException('Room name already exists');
      }

      // Create room
      const room = await this.roomRepository.save(
        this.roomRepository.create({
          name,
          creatorNickname: ownerNickname,
          description,
        }),
      );

      // Owner auto-join (safe now)
      await this.participantRepository.save(
        this.participantRepository.create({
          roomId: room.id,
          nickname: ownerNickname,
        }),
      );

      // Cache invalidate
      await this.cache.deletePattern(`${this.ROOMS_LIST_PREFIX}*`);
      await this.cache.deletePattern(`${this.PARTICIPANT_CACHE_PREFIX}${ownerNickname}:*`);

      // Cache room
      await this.cache.set(
        `${this.ROOM_CACHE_PREFIX}${room.id}`,
        room,
        this.CACHE_TTL,
      );

      return room;
    } catch (error) {
      if (
        error?.code === '23503' ||
        error instanceof NotFoundException ||
        error instanceof ConflictException
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
    if (!isUUID(roomId)) {
      throw new BadRequestException('Invalid room id');
    }
    return this.executeProtected(
      BulkheadNameType.ChatWrite,
      'room-join',
      () => this.performJoinRoom(roomId, nickname),
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
  async deleteRoom(roomId: string, requester: string): Promise<void> {
    if (!isUUID(roomId)) {
      throw new BadRequestException('Invalid room id');
    }
    return this.executeProtected(
      BulkheadNameType.ChatWrite,
      'room-delete',
      () => this.performDeleteRoom(roomId, requester),
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
      if (room.creatorNickname !== requesterNickname) {
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
    // Rate Limiting
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

    // Cache first
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
        where: { creatorNickname: nickname },
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
  async getParticipants(roomId: string, requester: string) {
    if (!isUUID(roomId)) {
      throw new BadRequestException('Invalid room id');
    }
    return this.executeProtected(
      BulkheadNameType.ChatRead,
      'room-get-participants',
      () => this.performGetParticipants(roomId, requester),
      async () => [],
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
        select: ['id', 'creatorNickname'],
      });

      if (!room) {
        throw new NotFoundException('Room not found');
      }

      // 2. Authorization check (only owner can view)
      if (room.creatorNickname !== requesterNickname) {
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
  async findOne(roomId: string): Promise<Room | null> {
    if (!isUUID(roomId)) {
      throw new BadRequestException('Invalid room id');
    }
    const cacheKey = `${this.ROOM_CACHE_PREFIX}${roomId}`;

    return this.cache.getOrSet(
      cacheKey,
      () =>
        this.executeProtected(
          BulkheadNameType.ChatRead,
          'room-find-one',
          async () => {
            const room = await this.roomRepository.findOne({
              where: { id: roomId },
              relations: ['participants'],
            });

            if (!room) {
              throw new NotFoundException('Room not found');
            }

            return room;
          },
          async () => null, // fallback
        ),
      this.CACHE_TTL,
    );
  }

  /**
   * Add participant to a room
   * ✅ Circuit Breaker
   * ✅ Bulkhead
   * ✅ Cache invalidation
   */
  async addParticipant(roomId: string, userNickname: string): Promise<void> {
    if (!isUUID(roomId)) {
      throw new BadRequestException('Invalid room id');
    }
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
   * Get rooms user created OR joined
   * ✅ Circuit Breaker
   * ✅ Bulkhead
   * ✅ Caching
   */
  async getMyRooms(nickname: string): Promise<Room[]> {
    const cacheKey = `${this.ROOMS_LIST_PREFIX}my:${nickname}`;

    return this.cache.getOrSet(
      cacheKey,
      () =>
        this.executeProtected(
          BulkheadNameType.ChatRead,
          'room-get-my',
          () => this.performGetMyRooms(nickname),
          async () => [],
        ),
      this.CACHE_TTL,
    );
  }

  /**
   * Perform get my rooms
   * @param nickname
   * @private
   */
  private async performGetMyRooms(nickname: string): Promise<Room[]> {
    try {
      const createdRooms = await this.roomRepository.find({
        where: { creatorNickname: nickname },
      });
      console.log('createdRooms', createdRooms);
      const joinedRoomIds = await this.participantRepository
        .createQueryBuilder('p')
        .select('DISTINCT p.roomId', 'roomId')
        .where('p.nickname = :nickname', { nickname })
        .getRawMany<{ roomId: string }>();

      const joinedIds = joinedRoomIds.map(r => r.roomId);

      let joinedRooms: Room[] = [];
      if (joinedIds.length > 0) {
        joinedRooms = await this.roomRepository.findByIds(joinedIds);
      }
      const roomMap = new Map<string, Room>();

      for (const room of createdRooms) {
        roomMap.set(room.id, room);
      }

      for (const room of joinedRooms) {
        roomMap.set(room.id, room);
      }

      return Array.from(roomMap.values());
    } catch (error) {
      this.logger.error(
        `Error getting my rooms for ${nickname}: ${error.message}`,
        error.stack,
      );

      throw new HttpException(
        'Failed to get user rooms',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }


  private isBypassError(error: any): boolean {
    return (
      error instanceof NotFoundException ||
      error instanceof ConflictException ||
      error instanceof BadRequestException ||
      error instanceof ForbiddenException ||
      (error instanceof HttpException && error.getStatus() < 500)
    );
  }

  private async executeProtected<T>(
    bulkheadName: BulkheadNameType,
    cbName: string,
    task: () => Promise<T>,
    fallback?: () => Promise<T>,
  ): Promise<T> {
    return this.bulkhead.execute(
      {
        name: bulkheadName,
        maxConcurrency:
          bulkheadName === BulkheadNameType.ChatWrite ? 50 : 100,
        ttlMs: 10_000,
      },
      async () =>
        this.circuitBreaker.execute(
          cbName,
          task,
          async (err) => {
            // Business error
            if (this.isBypassError(err)) {
              throw err;
            }

            // Infra error → fallback / 503
            if (fallback) return fallback();

            throw new ServiceUnavailableException(
              'Service temporarily unavailable',
            );
          },
        ),
    );
  }

}
