import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {InjectRepository} from '@nestjs/typeorm';
import {In, Repository} from 'typeorm';
import {Room} from './entities/room.entity';
import {RoomParticipant} from './entities/room-participant.entity';
import {User} from '../users/entities/user.entity';
import {UsersService} from '../users/users.service';

import {CircuitBreakerService} from '@/services/circuit-breaker.service';
import {CacheService} from '@/services/cache.service';
import {RateLimiterService} from '@/services/rate-limiter.service';
import {BulkheadService} from '@/services/bulkhead.service';
import {BulkheadNameType} from '@/types/bulkhead-name-type';
import {isUUID} from "class-validator";
import {CACHED_RATE_LIMIT_ROOM_KEY, CACHED_ROOM_KEY, CACHED_ROOM_PARTICIPANTS} from "@/types/cached-key.type";

@Injectable()
export class RoomsService {
  private readonly logger = new Logger(RoomsService.name);

  private readonly CACHE_TTL = 300; // 5 minutes

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
      `${CACHED_RATE_LIMIT_ROOM_KEY.ROOM_RATE_LIMIT}:${ownerNickname}`,
      { maxRequests: 3, windowMs: 60_000 },
    );

    if (!rate.allowed) {
      throw new HttpException(
        'Room creation rate limit exceeded',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const room = await this.executeProtected(
      BulkheadNameType.ChatWrite,
      'room-create',
      () => this.performCreateRoom(name, ownerNickname, description),
    );

    // Cache room
    await this.cache.set(
      `${CACHED_ROOM_KEY.ROOM_CREATED}:${room.id}`,
      room,
      this.CACHE_TTL,
    );

    // Cache invalidate
    await this.cache.deletePattern(`${CACHED_ROOM_KEY.ROOM_LIST}*`);
    await this.cache.deletePattern(`${CACHED_ROOM_PARTICIPANTS.PARTICIPANT_LIST}:${room.id}:*`);
    return room
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
      BulkheadNameType.RoomJoin,
      'room-join',
      () => this.performJoinRoom(roomId, nickname),
    );
  }

  async leaveRoom(roomId: string, nickname: string): Promise<void> {
    if (!isUUID(roomId)) {
      throw new BadRequestException('Invalid room id');
    }
    return this.executeProtected(
      BulkheadNameType.RoomLeave,
      'room-leave',
      () => this.performLeaveRoom(roomId, nickname),
    );
  }

  /**
   * Perform join room operation
   * @private
   */
  private async performJoinRoom(roomId: string, nickname: string): Promise<void> {
    try {
      // 1. Check room exists
      const room = await this.roomRepository.findOne({ where: { id: roomId }, select: ['id'] });
      if (!room) {
        throw new NotFoundException('Room not found');
      }

      if (room.creatorNickname === nickname) {
        // Room owner is always a participant
        return;
      }

      // 2. Check user exists
      const user = await this.userRepository.findOne({ where: { nickname }, select: ['id'] });
      if (!user) {
        throw new NotFoundException('User not found');
      }

      // 3. Check if already joined
      const joined = await this.participantRepository.findOne({
        where: { roomId, nickname },
        select: ['id']
      });

      if (joined) {
        // Idempotent - already joined is OK
        return;
      }

      // 4. Add participant
      await this.participantRepository.save(
        this.participantRepository.create({ roomId, nickname }),
      );
      // // 5. Invalidate caches
      await this.cache.deletePattern(`${CACHED_ROOM_PARTICIPANTS.PARTICIPANT_LIST}:${roomId}*`);
      await this.cache.delete(`${CACHED_ROOM_KEY.ROOM_LIST}:${roomId}`);

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

  async performLeaveRoom(roomId: string, nickname: string): Promise<void> {
    const room = await this.roomRepository.findOne({where: {id: roomId}, select: ['id', 'creatorNickname']});
    if(!room) {
      throw new NotFoundException('Room not found');
    }
    if (room.creatorNickname === nickname) {
      throw new ForbiddenException('Room creator cannot leave the room');
    }
    const user = await this.userRepository.findOne({ where: { nickname }, select: ['id'] });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const participant = await this.participantRepository.findOne({where: {roomId, nickname}, select: ['id']});
    if (!participant) {
      throw new NotFoundException(`Participant ${nickname} not found in ${roomId}`);
    }

    await this.participantRepository.delete({roomId, nickname});

    // Invalidate caches
    await this.cache.deletePattern(`${CACHED_ROOM_PARTICIPANTS.PARTICIPANT_LIST}:${roomId}*`);
    await this.cache.deletePattern(`${CACHED_ROOM_KEY.ROOM_LIST}:${roomId}*`);
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
      BulkheadNameType.RoomDelete,
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
        select: ['id', 'creatorNickname']
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
      await this.cache.delete(`${CACHED_ROOM_KEY.ROOM_CREATED}:${roomId}`);
      await this.cache.deletePattern(`${CACHED_ROOM_KEY.ROOM_LIST}*`);
      await this.cache.deletePattern(`${CACHED_ROOM_PARTICIPANTS.PARTICIPANT_LIST}:${roomId}*`);

      this.logger.warn(`Room deleted: ${room.name} by ${requesterNickname}`);
    } catch (error) {
      this.logger.error(
        `Error deleting room ${roomId}: ${error.message}`,
        error.stack,
      );

      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException ||
        error instanceof BadRequestException
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
    const cacheKey = `${CACHED_ROOM_PARTICIPANTS.PARTICIPANT_LIST}:${roomId}`;
    const participants: any = await this.cache.get(cacheKey)
    if(participants) return participants
    return this.executeProtected(
      BulkheadNameType.RoomRead,
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
      if (!participants || !participants.length) return []
      return participants.map(p => {
        return {
          id: p.id,
          nickname: p.nickname,
          isOwner: p.nickname === room.creatorNickname,
          joinedAt: p.joinedAt,
        };
      })
    } catch (error) {
      this.logger.error(
        `Error getting participants for room ${roomId}: ${error.message}`,
        error.stack,
      );

      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException ||
        error instanceof BadRequestException
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
    this.logger.debug('findOne roomId:', roomId);
    if (!isUUID(roomId)) {
      throw new BadRequestException('Invalid room id');
    }
    const cacheKey = `${CACHED_ROOM_KEY.ROOM_CREATED}:${roomId}`;
    const room: Room | null = await this.cache.get(cacheKey);
    if (room) return room

    return await this.executeProtected(
      BulkheadNameType.RoomRead,
      'room-find-one',
      async () => {
        const room = await this.roomRepository.findOne({
          where: { id: roomId },
          // relations: ['participants'],
        });

        if (!room) {
          throw new NotFoundException('Room not found');
        }
        await this.cache.set(cacheKey, room, this.CACHE_TTL);
        return room;
      },
      async () => null, // fallback
    )
  }

  /**
   * Get rooms user created OR joined
   * ✅ Circuit Breaker
   * ✅ Bulkhead
   * ✅ Caching
   */
  async getMyRooms(nickname: string): Promise<Room[]> {
    return await this.executeProtected(
      BulkheadNameType.RoomRead,
      'room-get-my',
      () => this.performGetMyRooms(nickname),
      async () => [],
    )
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
      const joinedRoomIds = await this.participantRepository
        .createQueryBuilder('p')
        .select('DISTINCT p.roomId', 'roomId')
        .where('p.nickname = :nickname', { nickname })
        .getRawMany<{ roomId: string }>();

      const joinedIds = joinedRoomIds.map(r => r.roomId);

      let joinedRooms: Room[] = [];
      if (joinedIds.length > 0) {
        joinedRooms = await this.roomRepository.find({where: {id: In(joinedIds)}});
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
          bulkheadName === BulkheadNameType.ChatRead ? 50 : 100,
        ttlMs: 10_000,
      },
      async () => {
        try {
          return await this.circuitBreaker.execute(
            {
              name: cbName,
              failureThreshold: 5,
              openDurationMs: 30_000,
              halfOpenMaxAttempts: 1,
            },
            task,
          );
        } catch (err) {
          if (fallback) {
            return fallback();
          }

          throw err;
        }
      },
    );
  }

}
