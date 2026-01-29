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
import { Repository, MoreThan } from 'typeorm';

import { Message } from './entities/message.entity';
import { SendMessageDto, EditMessageDto } from './dto/chat.dto';

import { CircuitBreakerService } from '../../services/circuit-breaker.service';
import { CacheService } from '../../services/cache.service';
import { RateLimiterService } from '../../services/rate-limiter.service';
import { BulkheadNameType } from '../../types/bulkhead-name-type';
import {BulkheadService} from "@/services/bulkhead.service";

@Injectable()
export class ChatService {
    private readonly logger = new Logger(ChatService.name);

    private readonly CACHE_TTL = 300;
    private readonly MESSAGE_CACHE_PREFIX = 'message:';
    private readonly ROOM_MESSAGES_PREFIX = 'room-messages:';

    constructor(
      @InjectRepository(Message)
      private readonly messageRepository: Repository<Message>,
      private readonly circuitBreaker: CircuitBreakerService,
      private readonly cache: CacheService,
      private readonly rateLimiter: RateLimiterService,
      private readonly bulkhead: BulkheadService,
    ) {}

    /**
     * Send a message
     * @param dto
     * @param userId
     */
    async sendMessage(
      dto: SendMessageDto,
      userId: string,
    ): Promise<Message> {
        const rate = await this.rateLimiter.isAllowed(
          `chat-send:${userId}:${dto.roomId}`,
          { maxRequests: 5, windowMs: 10_000 },
        );

        if (!rate.allowed) {
            throw new HttpException(
              'Message rate limit exceeded',
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
              'chat-send-message',
              () => this.performSendMessage(dto, userId),
            ),
        );
    }

    /**
     * Perform the send message operation
     * @param dto
     * @param userId
     * @private
     */
    private async performSendMessage(
      dto: SendMessageDto,
      userId: string,
    ): Promise<Message> {
        const message = this.messageRepository.create({
            content: dto.content,
            roomId: dto.roomId,
            userId,
        });

        const saved = await this.messageRepository.save(message);

        await this.cache.deletePattern(
          `${this.ROOM_MESSAGES_PREFIX}${dto.roomId}*`,
        );
        await this.cache.set(
          `${this.MESSAGE_CACHE_PREFIX}${saved.id}`,
          saved,
          this.CACHE_TTL,
        );

        return saved;
    }

    /**
     * Edit a message
     * @param dto
     * @param userId
     */
    async editMessage(
      dto: EditMessageDto,
      userId: string,
    ): Promise<Message> {
        return this.bulkhead.execute(
          {
              name: BulkheadNameType.ChatWrite,
              maxConcurrency: 50,
              ttlMs: 15_000,
          },
          () =>
            this.circuitBreaker.execute(
              'chat-edit-message',
              () => this.performEditMessage(dto, userId),
            ),
        );
    }

    /**
     * Perform the edit message operation
     * @param dto
     * @param userId
     * @private
     */
    private async performEditMessage(
      dto: EditMessageDto,
      userId: string,
    ): Promise<Message> {
        let message =
          await this.cache.get<Message>(
            `${this.MESSAGE_CACHE_PREFIX}${dto.messageId}`,
          );

        if (!message) {
            message = await this.messageRepository.findOne({
                where: { id: dto.messageId },
            });
        }

        if (!message) throw new NotFoundException('Message not found');
        if (message.userId !== userId)
            throw new ForbiddenException('Cannot edit others message');

        const last = await this.messageRepository.findOne({
            where: { roomId: message.roomId },
            order: { createdAt: 'DESC' },
        });

        if (!last || last.id !== message.id) {
            throw new BadRequestException('Only last message can be edited');
        }

        message.content = dto.content;
        message.edited = true;

        const updated = await this.messageRepository.save(message);

        await this.cache.set(
          `${this.MESSAGE_CACHE_PREFIX}${updated.id}`,
          updated,
          this.CACHE_TTL,
        );
        await this.cache.deletePattern(
          `${this.ROOM_MESSAGES_PREFIX}${message.roomId}*`,
        );

        return updated;
    }

    /**
     * Get messages for a room with pagination
     * @param roomId
     * @param page
     * @param limit
     * @param userId
     */
    async getRoomMessages(
      roomId: string,
      page = 1,
      limit = 20,
      userId: string,
    ) {
        const rate = await this.rateLimiter.isAllowed(
          `chat-list:${userId}:${roomId}`,
          { maxRequests: 20, windowMs: 60_000 },
        );

        if (!rate.allowed) {
            throw new HttpException(
              'Rate limit exceeded',
              HttpStatus.TOO_MANY_REQUESTS,
            );
        }

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
                  () =>
                    this.performGetRoomMessages(roomId, page, limit),
                ),
            ),
          this.CACHE_TTL,
        );
    }

    /**
     * Get messages for a room with pagination
     * @param roomId
     * @param page
     * @param limit
     * @private
     */
    private async performGetRoomMessages(
      roomId: string,
      page: number,
      limit: number,
    ) {
        const skip = (page - 1) * limit;

        const [data, total] =
          await this.messageRepository.findAndCount({
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
    }

    /**
     * Delete a message
     * @param messageId
     * @param userId
     */
    async deleteMessage(messageId: string, userId: string): Promise<void> {
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
                  const msg = await this.messageRepository.findOne({
                      where: { id: messageId },
                  });

                  if (!msg) throw new NotFoundException();
                  if (msg.userId !== userId)
                      throw new ForbiddenException();

                  await this.messageRepository.remove(msg);
                  await this.cache.delete(
                    `${this.MESSAGE_CACHE_PREFIX}${messageId}`,
                  );
                  await this.cache.deletePattern(
                    `${this.ROOM_MESSAGES_PREFIX}${msg.roomId}*`,
                  );
              },
            ),
        );
    }

    /**
     * Get health status of chat service components
     */
    async getHealthStatus(): Promise<any> {
        return {
            circuitBreaker: this.circuitBreaker.getHealthStatus(),
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
            cache: await this.cache.getStats(),
        };
    }
}
