import {
	Injectable,
	NotFoundException,
	ForbiddenException,
	Logger,
	HttpException,
	HttpStatus, ConflictException, BadRequestException, ServiceUnavailableException,
} from '@nestjs/common';
import {InjectRepository} from '@nestjs/typeorm';
import {MoreThan, Repository} from 'typeorm';

import {Message} from './entities/message.entity';
import {Room} from '../rooms/entities/room.entity';
import {RoomParticipant} from '../rooms/entities/room-participant.entity';
import {SendMessageDto, EditMessageDto} from './dto/chat.dto';

import {CircuitBreakerService} from '@/services/circuit-breaker.service';
import {CacheService} from '@/services/cache.service';
import {RateLimiterService} from '@/services/rate-limiter.service';
import {BulkheadService} from '@/services/bulkhead.service';
import {BulkheadNameType} from '@/types/bulkhead-name-type';
import {isUUID} from "class-validator";

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
	) {
	}

	/**
	 * Send a message with full resilience patterns
	 * ✅ Rate Limiting
	 * ✅ Circuit Breaker
	 * ✅ Bulkhead
	 * ✅ Caching invalidation
	 */
	async sendMessage(data: SendMessageDto): Promise<Message> {
		const { roomId, nickname } = data;
		this.assertUUID(roomId, 'roomId');
		const rateLimitKey = `chat-send:${nickname}:${roomId}`;
		const rate = await this.rateLimiter.isAllowed(rateLimitKey, {
			maxRequests: 5,
			windowMs: 10_000,
		});

		if (!rate.allowed) {
			throw new HttpException(
				{
					statusCode: HttpStatus.TOO_MANY_REQUESTS,
					message: 'Message rate limit exceeded',
					retryAfter: rate.retryAfter,
				},
				HttpStatus.TOO_MANY_REQUESTS,
			);
		}

		return this.executeProtected(
			BulkheadNameType.ChatWrite,
			'chat-send-message',
			() => this.performSendMessage(data),
		);
	}

	/**
	 * Perform send message operation
	 * @private
	 */
	private async performSendMessage(data: SendMessageDto): Promise<Message> {
		const {roomId, nickname, content} = data;
		this.assertUUID(roomId, 'messageId');
		try {
      const room = await this.roomRepository.findOne({where: {id: roomId}, select: ['id']})
      if (!room) {
        throw new NotFoundException('Room not found');
      }
			// 1. Check if user is participant (with cache)
			const cacheKey = `${this.PARTICIPANT_CACHE_PREFIX}${roomId}:${nickname}`;
			let isParticipant = await this.cache.get<boolean>(cacheKey);

			if (isParticipant === null) {
				isParticipant = await this.participantRepository.exists({
					where: {roomId, nickname},
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
		this.assertUUID(data.messageId, 'messageId');
		this.assertUUID(data.roomId, 'roomId');
		return this.executeProtected(
			BulkheadNameType.ChatWrite,
			'chat-edit-message',
			() => this.performEditMessage(data),
		);
	}


	/**
	 * Perform edit message operation
	 * @private
	 */
	private async performEditMessage(data: EditMessageDto): Promise<Message> {
		const {roomId, nickname, content} = data;

		try {
			// 1. Get last message in room (try cache first)
			const cacheKey = `${this.ROOM_MESSAGES_PREFIX}${roomId}:last`;
			let lastMessage = await this.cache.get<Message>(cacheKey);

			if (!lastMessage) {
				lastMessage = await this.messageRepository.findOne({
					where: {roomId},
					order: {createdAt: 'DESC'},
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
	 * Delete a message
	 * ✅ Circuit Breaker
	 * ✅ Bulkhead
	 * ✅ Caching invalidation
	 */
	async deleteMessage(messageId: string, nickname: string): Promise<void> {
		this.assertUUID(messageId, 'messageId');
		return this.executeProtected(
			BulkheadNameType.ChatWrite,
			'chat-delete-message',
			() => this.performDeleteMessage(messageId, nickname),
		);
	}

	private async performDeleteMessage(messageId: string, nickname: string): Promise<void> {
		const message =
			(await this.cache.get<Message>(`${this.MESSAGE_CACHE_PREFIX}${messageId}`)) ??
			(await this.messageRepository.findOne({ where: { id: messageId } }));

		if (!message) throw new NotFoundException('Message not found');
		if (message.senderNickname !== nickname) {
			throw new ForbiddenException('You can only delete your own messages');
		}

		await this.messageRepository.remove(message);

		await this.cache.delete(`${this.MESSAGE_CACHE_PREFIX}${messageId}`);
		await this.cache.deletePattern(
			`${this.ROOM_MESSAGES_PREFIX}${message.roomId}*`,
		);
	}

  /**
   * Get messages for a room with pagination
   * ✅ REQUIREMENT: View message history when joining a room
   * ✅ Rate Limiting
   * ✅ Circuit Breaker
   * ✅ Bulkhead
   * ✅ Caching
   */
  async getMessages(
    roomId: string,
    page: number = 1,
    limit: number = 50,
  ): Promise<{
    data: Message[];
    meta: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };
  }> {
		this.assertUUID(roomId, 'roomId');
		// 1. Rate Limiting
    const rateLimitKey = `chat-get-messages:${roomId}`;
    const rate = await this.rateLimiter.isAllowed(rateLimitKey, {
      maxRequests: 30, // 30 requests
      windowMs: 60_000, // per minute
    });

    if (!rate.allowed) {
      throw new HttpException(
        'Rate limit exceeded',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // 2. Sanitize pagination
    const sanitizedPage = Math.max(1, page);
    const sanitizedLimit = Math.min(100, Math.max(1, limit));

    // 3. Cache first
    const cacheKey = `${this.ROOM_MESSAGES_PREFIX}${roomId}:p${sanitizedPage}:l${sanitizedLimit}`;

		return this.cache.getOrSet(
			cacheKey,
			() =>
				this.executeProtected(
					BulkheadNameType.ChatRead,
					'chat-get-messages',
					() => this.performGetMessages(roomId, page, limit),
					async () => ({
						data: [],
						meta: { total: 0, page, limit, totalPages: 0 },
					}),
				),
			this.CACHE_TTL,
		);
  }

  /**
   * Perform get messages operation
   * @private
   */
  private async performGetMessages(
    roomId: string,
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
			this.assertUUID(roomId, 'roomId');
			// 1. Verify room exists
      const room = await this.roomRepository.findOne({
        where: { id: roomId },
        select: ['id']
      });

      if (!room) {
        throw new NotFoundException('Room not found');
      }

      // 2. Calculate pagination
      const skip = (page - 1) * limit;

      // 3. Build query
      const qb = this.messageRepository.createQueryBuilder('m');

      qb.where('m.roomId = :roomId', { roomId })
        .orderBy('m.createdAt', 'DESC')
        .skip(skip)
        .take(limit);

      // 4. Execute query
      const [messages, total] = await qb.getManyAndCount();
      if (!messages || !messages.length) return {
        data: [],
        meta: {
          total: 0,
          page: 1,
          limit: limit,
          totalPages: 0
        }
      }

      // 5. Calculate total pages
      const totalPages = Math.ceil(total / limit);

      this.logger.log(
        `Fetched ${messages.length} messages for room ${roomId} (page ${page}/${totalPages})`,
      );

      return {
        data: messages,
        meta: {
          total,
          page,
          limit,
          totalPages,
        },
      };
    } catch (error) {
      this.logger.error(
        `Error getting messages for room ${roomId}: ${error.message}`,
        error.stack,
      );

      if (error instanceof NotFoundException) {
        throw error;
      }

      throw new HttpException(
        'Failed to get messages',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get messages in chronological order
   * @param roomId
   * @param page
   * @param limit
   */
  async getMessagesChronological(
    roomId: string,
    page: number = 1,
    limit: number = 50,
  ): Promise<{
    data: Message[];
    meta: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };
  }> {
		this.assertUUID(roomId, 'roomId');
		const rateLimitKey = `chat-get-messages-chrono:${roomId}`;
    const rate = await this.rateLimiter.isAllowed(rateLimitKey, {
      maxRequests: 30,
      windowMs: 60_000,
    });

    if (!rate.allowed) {
      throw new HttpException(
        'Rate limit exceeded',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const sanitizedPage = Math.max(1, page);
    const sanitizedLimit = Math.min(100, Math.max(1, limit));

    const cacheKey = `${this.ROOM_MESSAGES_PREFIX}chrono:${roomId}:p${sanitizedPage}:l${sanitizedLimit}`;

    return this.cache.getOrSet(
      cacheKey,
      async () => {
        try {
          const room = await this.roomRepository.findOne({
            where: { id: roomId },
          });

          if (!room) {
            throw new NotFoundException('Room not found');
          }

          const skip = (sanitizedPage - 1) * sanitizedLimit;

          const qb = this.messageRepository.createQueryBuilder('m');

          qb.where('m.roomId = :roomId', { roomId })
            .orderBy('m.createdAt', 'ASC') // ✅ Oldest first
            .skip(skip)
            .take(sanitizedLimit);

          const [messages, total] = await qb.getManyAndCount();
          const totalPages = Math.ceil(total / sanitizedLimit);

          return {
            data: messages,
            meta: {
              total,
              page: sanitizedPage,
              limit: sanitizedLimit,
              totalPages,
            },
          };
        } catch (error) {
          if (error instanceof NotFoundException) {
            throw error;
          }
          throw new HttpException(
            'Failed to get messages',
            HttpStatus.INTERNAL_SERVER_ERROR,
          );
        }
      },
      this.CACHE_TTL,
    );
  }

  /**
   * Get messages since a specific timestamp
   * @param roomId
   * @param since
   * @param limit
   */
  async getMessagesSince(
    roomId: string,
    since: Date,
    limit: number = 100,
  ): Promise<Message[]> {
		this.assertUUID(roomId, 'roomId');
		const rateLimitKey = `chat-get-messages-since:${roomId}`;
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

    try {
      const room = await this.roomRepository.findOne({
        where: { id: roomId },
      });

      if (!room) {
        throw new NotFoundException('Room not found');
      }

      const messages = await this.messageRepository.find({
        where: {
          roomId,
          createdAt: MoreThan(since),
        },
        order: {
          createdAt: 'ASC',
        },
        take: Math.min(limit, 100),
      });

      this.logger.log(
        `Fetched ${messages.length} messages since ${since.toISOString()} for room ${roomId}`,
      );

      return messages;
    } catch (error) {
      this.logger.error(
        `Error getting messages since ${since}: ${error.message}`,
      );

      if (error instanceof NotFoundException) {
        throw error;
      }

      throw new HttpException(
        'Failed to get messages',
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
						// Business error → bypass
						if (this.isBypassError(err)) {
							throw err;
						}

						// Infra error → fallback
						if (fallback) return fallback();

						throw new ServiceUnavailableException(
							'Service temporarily unavailable',
						);
					},
				),
		);
	}

	private assertUUID(id: string, name = 'id') {
		if (!isUUID(id)) {
			throw new BadRequestException(`${name} is not a valid UUID`);
		}
	}

}
