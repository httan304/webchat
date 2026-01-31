import {ConflictException, HttpException, HttpStatus, Injectable, Logger, NotFoundException,} from '@nestjs/common';
import {InjectRepository} from '@nestjs/typeorm';
import {ILike, Repository} from 'typeorm';
import {User} from './entities/user.entity';
import {CreateUserDto} from './dto/create-user.dto';
import {FindAllDto} from './dto/find-all-user.dto';
import {FindAllUsersResponseDto} from './dto/find-all-user-response.dto';

import {CircuitBreakerService} from '@/services/circuit-breaker.service';
import {CacheService} from '@/services/cache.service';
import {RateLimiterService} from '@/services/rate-limiter.service';
import {BulkheadService} from '@/services/bulkhead.service';
import {BulkheadNameType} from '@/types/bulkhead-name-type';
import {CACHED_USER_KEY, CACHED_RATE_LIMIT_KEY} from "@/types/cached-key.type";

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  private readonly CACHE_TTL = 300;

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
    this.logger.debug('updateConnectionStatus', nickname, isConnected)
    return this.executeProtected(
      BulkheadNameType.UserWrite,
      'user-update-connection',
      () => this.updateUserStatus(nickname, isConnected),
    );
  }

  async updateUserStatus(nickname: string, isConnected: boolean): Promise<any> {
    const user = await this.userRepository.findOne({
      where: { nickname },
    });

    if (!user) {
      this.logger.warn(`User ${nickname} not found for status update`);
      // create new user
      this.logger.debug(
        `${nickname} → ${isConnected ? 'online' : 'offline'}`,
      );
      return await this.userRepository.save({
        isConnected,
        nickname: nickname,
        lastSeen: new Date(),
      });

    } else {
      const updated = {...user, isConnected};
      this.logger.debug(
        `${nickname} → ${isConnected ? 'online' : 'offline'}`,
      );
      return await this.userRepository.save(updated);
    }
  }


  /**
   * Create a new user
   * @param dto
   */
  async create(dto: CreateUserDto): Promise<User> {
    const rate = await this.rateLimiter.isAllowed(
      `${CACHED_RATE_LIMIT_KEY.USER_RATE_LIMIT}:${dto.nickname}`,
      { maxRequests: 3, windowMs: 60_000 },
    );

    if (!rate.allowed) {
      throw new HttpException(
        'User creation rate limit exceeded',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const saved = await  this.executeProtected(
      BulkheadNameType.UserCreate,
      'user-create',
      () => this.performCreate(dto),
    );
    await this.cache.set(
      `${CACHED_USER_KEY.USER_CREATED}:${saved.nickname}`,
      saved,
      this.CACHE_TTL,
    );

    await this.cache.deletePattern(`${CACHED_USER_KEY.USER_LIST}*`);
    return saved
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

    return await this.userRepository.save(user);
  }

  /**
   * Find user by nickname
   * @param nickname
   */
  async findByNickname(nickname: string): Promise<User | null> {
    this.logger.debug('findByNickname', nickname);
    const cacheKey = `${CACHED_USER_KEY.USER_CREATED}:${nickname}`;
    const user = await this.cache.get<User>(cacheKey);
    if (user) return user

    return await this.executeProtected(
      BulkheadNameType.UserRead,
      'user-find-by-nickname',
      async () => {
        const user = await this.userRepository.findOne({
          where: {nickname: ILike(nickname)},
          select: ['id', 'nickname', 'isConnected']
        });

        if (!user) {
          throw new NotFoundException(`User '${nickname}' not found`);
        }
        return user
      })
  }

  /**
   * Find all users with pagination and optional search
   * @param query
   */
  async findAll(query: FindAllDto): Promise<FindAllUsersResponseDto> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, query.limit ?? 20);

    let cacheKey = `${CACHED_USER_KEY.USER_LIST}:p${page}:l${limit}`;
    if (query && query.search) {
      cacheKey = cacheKey.concat(`:s${
        query.search
      }`);
    }
    const users: any = await this.cache.get(cacheKey)
    if (users) return users
    return await this.executeProtected(
      BulkheadNameType.UserRead,
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
        await this.cache.set(cacheKey, data, this.CACHE_TTL)
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
    )
  }

  /**
   * Delete user by nickname
   * @param nickname
   */
  async deleteUser(nickname: string): Promise<void> {
    return this.executeProtected(
      BulkheadNameType.UserDelete,
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
          this.cache.delete(`${CACHED_USER_KEY.USER_CREATED}:${nickname}`),
          this.cache.deletePattern(`${CACHED_USER_KEY.USER_LIST}*`),
        ]);
      },
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
          bulkheadName === BulkheadNameType.UserRead ? 50 : 100,
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
