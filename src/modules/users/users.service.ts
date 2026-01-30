import {
  Injectable,
  ConflictException,
  NotFoundException,
  Logger,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { User } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { FindAllDto } from './dto/find-all-user.dto';
import { FindAllUsersResponseDto } from './dto/find-all-user-response.dto';

import { CircuitBreakerService } from '@/services/circuit-breaker.service';
import { CacheService } from '@/services/cache.service';
import { RateLimiterService } from '@/services/rate-limiter.service';
import { BulkheadService } from '@/services/bulkhead.service';
import { BulkheadNameType } from '@/types/bulkhead-name-type';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  private readonly CACHE_TTL = 300;
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
      async () => {
        // NotFound SHOULD NOT hit circuit breaker
        const user = await this.userRepository.findOne({
          where: { nickname },
        });

        if (!user) {
          this.logger.warn(`User ${nickname} not found for status update`);
          return;
        }

        return this.circuitBreaker.execute(
          'user-update-connection',
          async () => {
            user.isConnected = isConnected;
            user.lastSeen = new Date();

            await this.userRepository.save(user);
            await this.cache.delete(`${this.USER_CACHE_PREFIX}${nickname}`);

            this.logger.debug(
              `🔌 ${nickname} → ${isConnected ? 'online' : 'offline'}`,
            );
          },
          async (error: Error) => {
            this.logger.warn(
              `Circuit breaker fallback updateConnectionStatus: ${error.message}`,
            );
          },
        );
      },
    );
  }

  /**
   * Create a new user
   * @param dto
   */
  async create(dto: CreateUserDto): Promise<User> {
    const rate = await this.rateLimiter.isAllowed(
      `user-create:${dto.nickname}`,
      { maxRequests: 3, windowMs: 60_000 },
    );

    if (!rate.allowed) {
      throw new HttpException(
        'User creation rate limit exceeded',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return this.executeProtected(
      BulkheadNameType.ChatWrite,
      'user-create',
      () => this.performCreate(dto),
    );
  }

  /**
   * Perform user creation
   * @param dto
   * @private
   */
  private async performCreate(dto: CreateUserDto): Promise<User> {
    const exists = await this.userRepository.findOne({
      where: { nickname: dto.nickname },
    });

    if (exists) {
      throw new ConflictException(`Nickname '${dto.nickname}' already exists`);
    }

    const user = this.userRepository.create({
      nickname: dto.nickname,
      isConnected: false,
    });

    const saved = await this.userRepository.save(user);

    await this.cache.set(
      `${this.USER_CACHE_PREFIX}${saved.nickname}`,
      saved,
      this.CACHE_TTL,
    );

    await this.cache.deletePattern(`${this.USERS_LIST_PREFIX}*`);

    return saved;
  }

  /**
   * Find user by nickname
   * @param nickname
   */
  async findByNickname(nickname: string): Promise<User> {
    const cacheKey = `${this.USER_CACHE_PREFIX}${nickname}`;

    return this.cache.getOrSet(
      cacheKey,
      () =>
        this.executeProtected(
          BulkheadNameType.ChatRead,
          'user-find-by-nickname',
          async () => {
            const user = await this.userRepository.findOne({
              where: { nickname: ILike(nickname) },
            });

            if (!user) {
              throw new NotFoundException(`User '${nickname}' not found`);
            }

            return user;
          },
        ),
      this.CACHE_TTL,
    );
  }

  /**
   * Find all users with pagination and optional search
   * @param query
   */
  async findAll(query: FindAllDto): Promise<FindAllUsersResponseDto> {
    const rate = await this.rateLimiter.isAllowed(
      `user-list:${query.search || 'all'}`,
      { maxRequests: 20, windowMs: 60_000 },
    );

    if (!rate.allowed) {
      throw new HttpException(
        'Rate limit exceeded',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, query.limit ?? 20);

    const cacheKey = `${this.USERS_LIST_PREFIX}p${page}:l${limit}:s${
      query.search ?? 'none'
    }`;

    return this.cache.getOrSet(
      cacheKey,
      () =>
        this.executeProtected(
          BulkheadNameType.ChatRead,
          'user-find-all',
          async () => {
            const skip = (page - 1) * limit;

            const qb = this.userRepository.createQueryBuilder('u');

            if (query.search) {
              qb.where('LOWER(u.nickname) LIKE :search', {
                search: `%${query.search.toLowerCase()}%`,
              });
            }

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
          },
          async () => ({
            data: [],
            meta: { total: 0, page, limit, totalPages: 0 },
          }),
        ),
      this.CACHE_TTL,
    );
  }

  /**
   * Delete user by nickname
   * @param nickname
   */
  async deleteUser(nickname: string): Promise<void> {
    return this.executeProtected(
      BulkheadNameType.ChatWrite,
      'user-delete',
      async () => {
        const user = await this.userRepository.findOne({
          where: { nickname },
        });

        if (!user) {
          throw new NotFoundException(`User '${nickname}' not found`);
        }

        await this.userRepository.delete(user.id);

        await Promise.all([
          this.cache.delete(`${this.USER_CACHE_PREFIX}${nickname}`),
          this.cache.deletePattern(`${this.USERS_LIST_PREFIX}*`),
        ]);
      },
    );
  }


  private isBypassError(error: any): boolean {
    return (
      error instanceof NotFoundException ||
      error instanceof ConflictException ||
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
      async () => {
        try {
          return await this.circuitBreaker.execute(
            cbName,
            task,
            async (err) => {
              if (this.isBypassError(err)) {
                throw err;
              }

              if (fallback) return fallback();

              throw new ServiceUnavailableException(
                'Service temporarily unavailable',
              );
            },
          );
        } catch (err) {
          if (this.isBypassError(err)) {
            throw err;
          }
          throw err;
        }
      },
    );
  }
}
