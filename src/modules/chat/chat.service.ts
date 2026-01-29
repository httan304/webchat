import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Message } from './entities/message.entity';
import { Room } from '../rooms/entities/room.entity';
import { RoomParticipant } from '../rooms/entities/room-participant.entity';
import { SendMessageDto, EditMessageDto } from './dto/chat.dto';

import { CircuitBreakerService } from '@/services/circuit-breaker.service';
import { CacheService } from '@/services/cache.service';
import { RateLimiterService } from '@/services/rate-limiter.service';
import { BulkheadService } from '@/services/bulkhead.service';
import { BulkheadNameType } from '@/types/bulkhead-name-type';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  private readonly CACHE_TTL = 300; // 5 minutes
  private readonly MESSAGE_CACHE_PREFIX = 'message:';
  private readonly ROOM_MESSAGES_PREFIX = 'room-messages:';
  private readonly PARTICIPANT_CACHE_PREFIX = 'participant:';

  constructor(
    @InjectRepository(Message)
    private readonly messageRepository: Repository<Message>,
    @InjectRepository(RoomParticipant)
    private readonly participantRepository: Repository<RoomParticipant>,
    @InjectRepository(Room)
    private readonly roomRepository: Repository<Room>,
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly cache: CacheService,
    private readonly rateLimiter: RateLimiterService,
    private readonly bulkhead: BulkheadService,
  ) {}

  /**
   * Send a message with full resilience patterns
   * ✅ Rate Limiting
   * ✅ Circuit Breaker
   * ✅ Bulkhead
   * ✅ Caching invalidation
   */
  async sendMessage(data: SendMessageDto): Promise<Message> {
    const { roomId, nickname, content } = data;

    // ✅ 1. Rate Limiting - Prevent spam
    const rateLimitKey = `chat-send:${nickname}:${roomId}`;
    const rate = await this.rateLimiter.isAllowed(rateLimitKey, {
      maxRequests: 5,  // 5 messages
      windowMs: 10_000, // per 10 seconds
    });

    if (!rate.allowed) {
      this.logger.warn(
        `Rate limit exceeded for ${nickname} in room ${roomId}`,
      );
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Message rate limit exceeded',
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
          'chat-send-message',
          () => this.performSendMessage(data),
          // ✅ Fallback function
          async (error: Error) => {
            this.logger.error(
              `Circuit breaker fallback triggered for sendMessage: ${error.message}`,
            );
            throw new HttpException(
              'Chat service temporarily unavailable. Please try again.',
              HttpStatus.SERVICE_UNAVAILABLE,
            );
          },
        ),
    );
  }

  /**
   * Perform send message operation
   * @private
   */
  private async performSendMessage(data: SendMessageDto): Promise<Message> {
    const { roomId, nickname, content } = data;

    try {
      // 1. Check if user is participant (with cache)
      const cacheKey = `${this.PARTICIPANT_CACHE_PREFIX}${roomId}:${nickname}`;
      let isParticipant = await this.cache.get<boolean>(cacheKey);

      if (isParticipant === null) {
        isParticipant = await this.participantRepository.exists({
          where: { roomId, nickname },
        });

        // Cache participant status for 5 minutes
        await this.cache.set(cacheKey, isParticipant, 300);
      }

      if (!isParticipant) {
        throw new ForbiddenException('You are not a participant of this room');
      }

      // 2. Save message
      const message = await this.messageRepository.save({
        roomId,
        senderNickname: nickname,
        content,
      });

      // 3. Invalidate room messages cache
      await this.cache.deletePattern(`${this.ROOM_MESSAGES_PREFIX}${roomId}*`);

      // 4. Cache the new message
      await this.cache.set(
        `${this.MESSAGE_CACHE_PREFIX}${message.id}`,
        message,
        this.CACHE_TTL,
      );

      this.logger.log(
        `Message sent: ${message.id} by ${nickname} in room ${roomId}`,
      );

      return message;
    } catch (error) {
      this.logger.error(
        `Error sending message in room ${roomId}: ${error.message}`,
        error.stack,
      );

      if (
        error instanceof ForbiddenException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }

      throw new HttpException(
        'Failed to send message',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Edit last message with full resilience patterns
   * ✅ Circuit Breaker
   * ✅ Bulkhead
   * ✅ Caching
   */
  async editLastMessage(data: EditMessageDto): Promise<Message> {
    // ✅ Execute with Circuit Breaker + Bulkhead
    return this.bulkhead.execute(
      {
        name: BulkheadNameType.ChatWrite,
        maxConcurrency: 50,
        ttlMs: 15_000,
      },
      () =>
        this.circuitBreaker.execute(
          'chat-edit-message',
          () => this.performEditMessage(data),
          // ✅ Fallback function
          async (error: Error) => {
            this.logger.error(
              `Circuit breaker fallback triggered for editMessage: ${error.message}`,
            );
            throw new HttpException(
              'Chat service temporarily unavailable. Please try again.',
              HttpStatus.SERVICE_UNAVAILABLE,
            );
          },
        ),
    );
  }

  /**
   * Perform edit message operation
   * @private
   */
  private async performEditMessage(data: EditMessageDto): Promise<Message> {
    const { roomId, nickname, content } = data;

    try {
      // 1. Get last message in room (try cache first)
      const cacheKey = `${this.ROOM_MESSAGES_PREFIX}${roomId}:last`;
      let lastMessage = await this.cache.get<Message>(cacheKey);

      if (!lastMessage) {
        lastMessage = await this.messageRepository.findOne({
          where: { roomId },
          order: { createdAt: 'DESC' },
        });

        if (lastMessage) {
          await this.cache.set(cacheKey, lastMessage, 60); // Cache for 1 minute
        }
      }

      if (!lastMessage) {
        throw new NotFoundException('No messages in room');
      }

      // 2. Check ownership
      if (lastMessage.senderNickname !== nickname) {
        throw new ForbiddenException(
          'You can only edit your last message',
        );
      }

      // 3. Update message
      lastMessage.content = content;
      lastMessage.updatedAt = new Date();
      lastMessage.edited = true;

      const updatedMessage = await this.messageRepository.save(lastMessage);

      // 4. Invalidate caches
      await this.cache.delete(`${this.MESSAGE_CACHE_PREFIX}${lastMessage.id}`);
      await this.cache.deletePattern(`${this.ROOM_MESSAGES_PREFIX}${roomId}*`);

      // 5. Cache updated message
      await this.cache.set(
        `${this.MESSAGE_CACHE_PREFIX}${updatedMessage.id}`,
        updatedMessage,
        this.CACHE_TTL,
      );

      this.logger.log(
        `Message edited: ${updatedMessage.id} by ${nickname}`,
      );

      return updatedMessage;
    } catch (error) {
      this.logger.error(
        `Error editing message in room ${roomId}: ${error.message}`,
        error.stack,
      );

      if (
        error instanceof ForbiddenException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }

      throw new HttpException(
        'Failed to edit message',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get room messages with pagination
   * ✅ Rate Limiting
   * ✅ Circuit Breaker
   * ✅ Bulkhead
   * ✅ Caching
   */
  async getRoomMessages(
    roomId: string,
    nickname: string,
    page = 1,
    limit = 50,
  ): Promise<{
    data: Message[];
    meta: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };
  }> {
    // ✅ 1. Rate Limiting
    const rateLimitKey = `chat-list:${nickname}:${roomId}`;
    const rate = await this.rateLimiter.isAllowed(rateLimitKey, {
      maxRequests: 20,   // 20 requests
      windowMs: 60_000,  // per minute
    });

    if (!rate.allowed) {
      throw new HttpException(
        'Rate limit exceeded',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // ✅ 2. Try cache first
    const cacheKey = `${this.ROOM_MESSAGES_PREFIX}${roomId}:${page}:${limit}`;

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
              'chat-get-messages',
              () => this.performGetRoomMessages(roomId, nickname, page, limit),
              // ✅ Fallback - return empty result
              async (error: Error) => {
                this.logger.error(
                  `Circuit breaker fallback for getRoomMessages: ${error.message}`,
                );
                return {
                  data: [],
                  meta: {
                    total: 0,
                    page,
                    limit,
                    totalPages: 0,
                  },
                };
              },
            ),
        ),
      this.CACHE_TTL,
    );
  }

  /**
   * Perform get room messages operation
   * @private
   */
  private async performGetRoomMessages(
    roomId: string,
    nickname: string,
    page: number,
    limit: number,
  ): Promise<{
    data: Message[];
    meta: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };
  }> {
    try {
      // 1. Check room exists
      const room = await this.roomRepository.findOne({
        where: { id: roomId },
      });

      if (!room) {
        throw new NotFoundException('Room not found');
      }

      // 2. Ensure user has joined
      await this.ensureJoined(roomId, nickname);

      // 3. Get messages with pagination
      const skip = (page - 1) * limit;

      const [data, total] = await this.messageRepository.findAndCount({
        where: { roomId },
        order: { createdAt: 'DESC' },
        skip,
        take: limit,
      });

      return {
        data,
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      this.logger.error(
        `Error getting messages for room ${roomId}: ${error.message}`,
        error.stack,
      );

      if (
        error instanceof ForbiddenException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }

      throw new HttpException(
        'Failed to get messages',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Delete a message
   * ✅ Circuit Breaker
   * ✅ Bulkhead
   * ✅ Caching invalidation
   */
  async deleteMessage(messageId: string, nickname: string): Promise<void> {
    return this.bulkhead.execute(
      {
        name: BulkheadNameType.ChatWrite,
        maxConcurrency: 50,
        ttlMs: 15_000,
      },
      () =>
        this.circuitBreaker.execute(
          'chat-delete-message',
          async () => {
            try {
              // 1. Get message (try cache first)
              let message = await this.cache.get<Message>(
                `${this.MESSAGE_CACHE_PREFIX}${messageId}`,
              );

              if (!message) {
                message = await this.messageRepository.findOne({
                  where: { id: messageId },
                });
              }

              if (!message) {
                throw new NotFoundException('Message not found');
              }

              // 2. Check ownership
              if (message.senderNickname !== nickname) {
                throw new ForbiddenException(
                  'You can only delete your own messages',
                );
              }

              // 3. Delete message
              await this.messageRepository.remove(message);

              // 4. Invalidate caches
              await this.cache.delete(
                `${this.MESSAGE_CACHE_PREFIX}${messageId}`,
              );
              await this.cache.deletePattern(
                `${this.ROOM_MESSAGES_PREFIX}${message.roomId}*`,
              );

              this.logger.log(
                `Message deleted: ${messageId} by ${nickname}`,
              );
            } catch (error) {
              this.logger.error(
                `Error deleting message ${messageId}: ${error.message}`,
                error.stack,
              );

              if (
                error instanceof ForbiddenException ||
                error instanceof NotFoundException
              ) {
                throw error;
              }

              throw new HttpException(
                'Failed to delete message',
                HttpStatus.INTERNAL_SERVER_ERROR,
              );
            }
          },
          // ✅ Fallback
          async (error: Error) => {
            this.logger.error(
              `Circuit breaker fallback for deleteMessage: ${error.message}`,
            );
            throw new HttpException(
              'Chat service temporarily unavailable',
              HttpStatus.SERVICE_UNAVAILABLE,
            );
          },
        ),
    );
  }

  /**
   * ✅ NEW: Get a single message (for WebSocket gateway)
   */
  async getMessage(messageId: string): Promise<Message> {
    try {
      // Try cache first
      let message = await this.cache.get<Message>(
        `${this.MESSAGE_CACHE_PREFIX}${messageId}`,
      );

      if (!message) {
        message = await this.messageRepository.findOne({
          where: { id: messageId },
        });

        if (message) {
          // Cache for future requests
          await this.cache.set(
            `${this.MESSAGE_CACHE_PREFIX}${messageId}`,
            message,
            this.CACHE_TTL,
          );
        }
      }

      if (!message) {
        throw new NotFoundException('Message not found');
      }

      return message;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      this.logger.error(
        `Error getting message ${messageId}: ${error.message}`,
      );
      throw new HttpException(
        'Failed to get message',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * ✅ NEW: Get room participants with connection status
   */
  async getRoomParticipants(roomId: string): Promise<any[]> {
    const cacheKey = `${this.PARTICIPANT_CACHE_PREFIX}room:${roomId}`;
    const cached = await this.cache.get<any[]>(cacheKey);
    if (cached) return cached;

    // ✅ Use QueryBuilder with leftJoinAndSelect
    const participants = await this.participantRepository
      .createQueryBuilder('participant')
      .leftJoinAndSelect('participant.user', 'user')  // Explicit join
      .where('participant.roomId = :roomId', { roomId })
      .select([
        'participant.id',
        'participant.roomId',
        'participant.nickname',
        'participant.joinedAt',
        'user.id',
        'user.nickname',
        'user.isConnected',
        'user.lastSeen',
      ])
      .getMany();

    const result = participants.map((p) => ({
      id: p.user?.id || null,
      nickname: p.nickname,
      isConnected: p.user?.isConnected || false,
      lastSeen: p.user?.lastSeen || null,
      joinedAt: p.joinedAt,
    }));

    await this.cache.set(cacheKey, result, 60);
    return result;
  }

  /**
   * Ensure user has joined the room
   * @private
   */
  private async ensureJoined(roomId: string, nickname: string): Promise<void> {
    // Try cache first
    const cacheKey = `${this.PARTICIPANT_CACHE_PREFIX}${roomId}:${nickname}`;
    let joined = await this.cache.get<boolean>(cacheKey);

    if (joined === null) {
      joined = await this.participantRepository.exists({
        where: { roomId, nickname },
      });

      // Cache for 5 minutes
      await this.cache.set(cacheKey, joined, 300);
    }

    if (!joined) {
      throw new ForbiddenException('User has not joined room');
    }
  }

  /**
   * Get health status of chat service
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
