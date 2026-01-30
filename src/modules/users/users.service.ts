import {
  Injectable,
  ConflictException,
  NotFoundException,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { User } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { FindAllDto } from './dto/find-all-user.dto';
import { FindAllUsersResponseDto } from './dto/find-all-user-response.dto';

import { CircuitBreakerService } from '../../services/circuit-breaker.service';
import { CacheService } from '../../services/cache.service';
import { RateLimiterService } from '../../services/rate-limiter.service';
import { BulkheadService } from '../../services/bulkhead.service';
import { BulkheadNameType } from '../../types/bulkhead-name-type';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  private readonly CACHE_TTL = 300; // 5 minutes
  private readonly USER_CACHE_PREFIX = 'user:';
  private readonly USERS_LIST_PREFIX = 'users:list:';

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly cache: CacheService,
    private readonly rateLimiter: RateLimiterService,
    private readonly bulkhead: BulkheadService,
  ) {}

  /**
   * Create a new user
   * ✅ Rate Limiting
   * ✅ Circuit Breaker
   * ✅ Bulkhead
   * ✅ Caching
   */
  async create(dto: CreateUserDto): Promise<User> {
    // Rate Limiting - Prevent spam user creation
    const rateLimitKey = `user-create:${dto.nickname}`;
    const rate = await this.rateLimiter.isAllowed(rateLimitKey, {
      maxRequests: 3, // 3 attempts
      windowMs: 60_000, // per minute
    });

    if (!rate.allowed) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'User creation rate limit exceeded',
          retryAfter: rate.retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Execute with Bulkhead + Circuit Breaker
    return this.bulkhead.execute(
      {
        name: BulkheadNameType.ChatWrite,
        maxConcurrency: 50,
        ttlMs: 15_000,
      },
      () =>
        this.circuitBreaker.execute(
          'user-create',
          () => this.performCreate(dto),
          // ✅ Fallback
          async (error: Error) => {
            this.logger.error(
              `Circuit breaker fallback for create: ${error.message}`,
            );
            throw new HttpException(
              'User service temporarily unavailable',
              HttpStatus.SERVICE_UNAVAILABLE,
            );
          },
        ),
    );
  }

  /**
   * Perform create user operation
   * @private
   */
  private async performCreate(dto: CreateUserDto): Promise<User> {
    try {
      // 1. Check if nickname exists
      const exists = await this.userRepository.findOne({
        where: { nickname: dto.nickname },
      });

      if (exists) {
        throw new ConflictException(
          `Nickname '${dto.nickname}' already exists`,
        );
      }

      // 2. Create user
      const user: User = this.userRepository.create({
        nickname: dto.nickname,
        isConnected: false,
      });

      const saved = await this.userRepository.save(user);

      // 3. Cache the new user
      await this.cache.set(
        `${this.USER_CACHE_PREFIX}${saved.nickname}`,
        saved,
        this.CACHE_TTL,
      );

      // 4. Invalidate users list cache
      await this.cache.deletePattern(`${this.USERS_LIST_PREFIX}*`);

      this.logger.log(`User created: ${saved.nickname}`);

      return saved;
    } catch (error) {
      this.logger.error(
        `Error creating user: ${error.message}`,
        error.stack,
      );

      if (error instanceof ConflictException) {
        throw error;
      }

      throw new HttpException(
        'Failed to create user',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Find user by nickname
   * ✅ Circuit Breaker
   * ✅ Bulkhead
   * ✅ Caching
   */
  async findByNickname(nickname: string): Promise<User> {
    // Try cache first
    const cacheKey = `${this.USER_CACHE_PREFIX}${nickname}`;

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
              'user-find-by-nickname',
              () => this.performFindByNickname(nickname),
              // ✅ Fallback - return null or throw
              async (error: Error) => {
                this.logger.error(
                  `Circuit breaker fallback for findByNickname: ${error.message}`,
                );
                throw new HttpException(
                  'User service temporarily unavailable',
                  HttpStatus.SERVICE_UNAVAILABLE,
                );
              },
            ),
        ),
      this.CACHE_TTL,
    );
  }

  /**
   * Perform find by nickname
   * @private
   */
  private async performFindByNickname(nickname: string): Promise<User> {
    try {
      const user = await this.userRepository.findOne({
        where: { nickname: ILike(nickname) },
      });

      if (!user) {
        throw new NotFoundException(`User '${nickname}' not found`);
      }

      return user;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      this.logger.error(
        `Error finding user by nickname: ${error.message}`,
        error.stack,
      );

      throw new HttpException(
        'Failed to find user',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Find all users with pagination and search
   * ✅ Rate Limiting
   * ✅ Circuit Breaker
   * ✅ Bulkhead
   * ✅ Caching
   */
  async findAll(query: FindAllDto): Promise<FindAllUsersResponseDto> {
    // Rate Limiting
    const rateLimitKey = `user-list:${query.search || 'all'}`;
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

    // Sanitize pagination
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, query.limit ?? 20);

    // Try cache first
    const cacheKey = `${this.USERS_LIST_PREFIX}p${page}:l${limit}:s${
      query.search ?? 'none'
    }`;

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
              'user-find-all',
              () => this.performFindAll(query, page, limit),
              // ✅ Fallback - return empty result
              async (error: Error) => {
                this.logger.error(
                  `Circuit breaker fallback for findAll: ${error.message}`,
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
   * Perform find all users
   * @private
   */
  private async performFindAll(
    query: FindAllDto,
    page: number,
    limit: number,
  ): Promise<FindAllUsersResponseDto> {
    try {
      const skip = (page - 1) * limit;

      const qb = this.userRepository.createQueryBuilder('u');

      // Apply search filter if provided
      if (query.search) {
        qb.where('LOWER(u.nickname) LIKE :search', {
          search: `%${query.search.toLowerCase()}%`,
        });
      }

      // Order and paginate
      qb.orderBy('u.createdAt', 'DESC').skip(skip).take(limit);

      const [data, total] = await qb.getManyAndCount();

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
        `Error finding all users: ${error.message}`,
        error.stack,
      );

      throw new HttpException(
        'Failed to get users',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Update user's connection status
   * ✅ Circuit Breaker
   * ✅ Bulkhead
   * ✅ Cache invalidation
   */
  async updateConnectionStatus(
    nickname: string,
    isConnected: boolean,
  ): Promise<void> {
    return this.bulkhead.execute(
      {
        name: BulkheadNameType.ChatWrite,
        maxConcurrency: 50,
        ttlMs: 10_000,
      },
      () =>
        this.circuitBreaker.execute(
          'user-update-connection',
          () => this.performUpdateConnectionStatus(nickname, isConnected),
          // Fallback - log but don't throw (non-critical operation)
          async (error: Error) => {
            this.logger.warn(
              `Circuit breaker fallback for updateConnectionStatus: ${error.message}`,
            );
            // Don't throw - connection status update is not critical
          },
        ),
    );
  }

  /**
   * Perform update connection status
   * @private
   */
  private async performUpdateConnectionStatus(
    nickname: string,
    isConnected: boolean,
  ): Promise<void> {
    try {
      const user = await this.userRepository.findOne({
        where: { nickname },
      });

      if (!user) {
        this.logger.warn(`User ${nickname} not found for status update`);
        return;
      }

      // Update connection status and lastSeen
      user.isConnected = isConnected;
      user.lastSeen = new Date();

      await this.userRepository.save(user);

      // Invalidate cache
      await this.cache.delete(`${this.USER_CACHE_PREFIX}${nickname}`);

      this.logger.debug(
        `🔌 ${nickname} → ${isConnected ? 'online' : 'offline'}`,
      );
    } catch (error) {
      this.logger.error(
        `Error updating connection status for ${nickname}: ${error.message}`,
        error.stack,
      );

      // Don't throw - this is a background operation
      // Circuit breaker will track failures
    }
  }

  /**
   * Get online users
   * ✅ Rate Limiting
   * ✅ Circuit Breaker
   * ✅ Bulkhead
   * ✅ Caching
   */
  async getOnlineUsers(): Promise<User[]> {
    // Rate Limiting
    const rateLimitKey = 'user-online-list';
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

    // Try cache first (short TTL since status changes frequently)
    const cacheKey = `${this.USERS_LIST_PREFIX}online`;

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
              'user-get-online',
              () => this.performGetOnlineUsers(),
              // ✅ Fallback - return empty array
              async (error: Error) => {
                this.logger.error(
                  `Circuit breaker fallback for getOnlineUsers: ${error.message}`,
                );
                return [];
              },
            ),
        ),
      60, // Cache for 1 minute (changes frequently)
    );
  }

  /**
   * Perform get online users
   * @private
   */
  private async performGetOnlineUsers(): Promise<User[]> {
    try {
      return await this.userRepository.find({
        where: { isConnected: true },
        order: { lastSeen: 'DESC' },
      });
    } catch (error) {
      this.logger.error(
        `Error getting online users: ${error.message}`,
        error.stack,
      );

      throw new HttpException(
        'Failed to get online users',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Delete user by nickname
   * ✅ Rate Limiting
   * ✅ Circuit Breaker
   * ✅ Bulkhead
   * ✅ Cache cleanup
   */
  async deleteUser(nickname: string): Promise<void> {
    // Rate Limiting
    const rateLimitKey = `user-delete:${nickname}`;
    const rate = await this.rateLimiter.isAllowed(rateLimitKey, {
      maxRequests: 3, // 3 attempts
      windowMs: 60_000, // per minute
    });

    if (!rate.allowed) {
      throw new HttpException(
        'Delete rate limit exceeded',
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
          'user-delete',
          () => this.performDeleteUser(nickname),
          // ✅ Fallback
          async (error: Error) => {
            this.logger.error(
              `Circuit breaker fallback for deleteUser: ${error.message}`,
            );
            throw new HttpException(
              'User service temporarily unavailable',
              HttpStatus.SERVICE_UNAVAILABLE,
            );
          },
        ),
    );
  }

  /**
   * Perform delete user
   * @private
   */
  private async performDeleteUser(nickname: string): Promise<void> {
    try {
      // 1. Find user
      const user = await this.userRepository.findOne({
        where: { nickname },
      });

      if (!user) {
        throw new NotFoundException(`User '${nickname}' not found`);
      }

      // 2. Delete user (CASCADE will handle participants and messages)
      await this.userRepository.delete(user.id);

      // 3. Cleanup caches
      await Promise.all([
        this.cache.delete(`${this.USER_CACHE_PREFIX}${nickname}`),
        this.cache.deletePattern(`${this.USERS_LIST_PREFIX}*`),
        this.cache.deletePattern(`participant:*:${nickname}`),
        this.cache.deletePattern(`room-messages:*`), // User's messages cache
      ]);

      this.logger.warn(`🗑️ User deleted: ${nickname}`);
    } catch (error) {
      this.logger.error(
        `Error deleting user ${nickname}: ${error.message}`,
        error.stack,
      );

      if (error instanceof NotFoundException) {
        throw error;
      }

      throw new HttpException(
        'Failed to delete user',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get user by id
   * ✅ Caching
   * ✅ Circuit Breaker
   * ✅ Bulkhead
   */
  async findById(id: string): Promise<User> {
    // Try cache first
    const cacheKey = `${this.USER_CACHE_PREFIX}id:${id}`;

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
              'user-find-by-id',
              async () => {
                try {
                  const user = await this.userRepository.findOne({
                    where: { id },
                  });

                  if (!user) {
                    throw new NotFoundException(`User with id ${id} not found`);
                  }

                  return user;
                } catch (error) {
                  if (error instanceof NotFoundException) {
                    throw error;
                  }

                  this.logger.error(
                    `Error finding user by id: ${error.message}`,
                  );
                  throw new HttpException(
                    'Failed to find user',
                    HttpStatus.INTERNAL_SERVER_ERROR,
                  );
                }
              },
              // Fallback
              async (error: Error) => {
                this.logger.error(
                  `Circuit breaker fallback for findById: ${error.message}`,
                );
                throw new HttpException(
                  'User service temporarily unavailable',
                  HttpStatus.SERVICE_UNAVAILABLE,
                );
              },
            ),
        ),
      this.CACHE_TTL,
    );
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
