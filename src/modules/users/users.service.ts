import {
    Injectable,
    ConflictException,
    NotFoundException,
    Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { User } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { FindAllDto } from './dto/find-all-user.dto';
import { FindAllUsersResponseDto } from './dto/find-all-user-response.dto';
import { CircuitBreakerService } from '../../services/circuit-breaker.service';
import { CacheService } from '../../services/cache.service';
import { BulkheadService } from '../../services/bulkhead.service';
import { BulkheadNameType } from '../../types/bulkhead-name-type';

@Injectable()
export class UsersService {
    private readonly logger = new Logger(UsersService.name);

    private readonly CACHE_TTL = 300;
    private readonly USER_CACHE_PREFIX = 'user:';
    private readonly USERS_LIST_PREFIX = 'users:list:';

    constructor(
      @InjectRepository(User)
      private readonly userRepository: Repository<User>,
      private readonly circuitBreakerService: CircuitBreakerService,
      private readonly cacheService: CacheService,
      private readonly bulkheadService: BulkheadService,
    ) {}

    /**
     * Create a new user
     * @param dto
     */
    async create(dto: CreateUserDto): Promise<User> {
        return this.bulkheadService.execute(
          { name: BulkheadNameType.ChatWrite, ttlMs: 10_000, maxConcurrency: 50 },
          () =>
            this.circuitBreakerService.execute(
              BulkheadNameType.UserCreate,
              async () => {
                  const exists = await this.userRepository.findOne({
                      where: { nickname: dto.nickname },
                  });

                  if (exists) {
                      throw new ConflictException(
                        `Nickname '${dto.nickname}' already exists`,
                      );
                  }

                  const user = this.userRepository.create({
                      nickname: dto.nickname,
                      isConnected: false,
                  });

                  const saved = await this.userRepository.save(user);

                  await this.cacheService.set(
                    `${this.USER_CACHE_PREFIX}${saved.nickname}`,
                    saved,
                    this.CACHE_TTL,
                  );

                  await this.cacheService.deletePattern(
                    `${this.USERS_LIST_PREFIX}*`,
                  );

                  this.logger.log(`User created: ${saved.nickname}`);
                  return saved;
              },
            ),
        );
    }

    /**
     * Find user by nickname
     * @param nickname
     */
    async findByNickname(nickname: string): Promise<User> {
        return this.cacheService.getOrSet(
          `${this.USER_CACHE_PREFIX}${nickname}`,
          async () =>
            this.bulkheadService.execute(
              { name: BulkheadNameType.ChatRead, maxConcurrency: 50,
                  ttlMs: 5_000, },
              async () => {
                  const user = await this.userRepository.findOne({
                      where: { nickname: ILike(nickname) },
                  });

                  if (!user) {
                      throw new NotFoundException(
                        `User '${nickname}' not found`,
                      );
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
    async findAll(
      query: FindAllDto,
    ): Promise<FindAllUsersResponseDto> {
        const page = Math.max(1, query.page ?? 1);
        const limit = Math.min(100, query.limit ?? 20);

        const cacheKey = `${this.USERS_LIST_PREFIX}p${page}:l${limit}:s${
          query.search ?? 'none'
        }`;

        return this.cacheService.getOrSet(
          cacheKey,
          () =>
            this.bulkheadService.execute(
              { name: BulkheadNameType.ChatRead, ttlMs: 5_000, maxConcurrency: 50 },
              () => this.performFindAll(query, page, limit),
            ),
          this.CACHE_TTL,
        );
    }

    private async performFindAll(
      query: FindAllDto,
      page: number,
      limit: number,
    ): Promise<FindAllUsersResponseDto> {
        const skip = (page - 1) * limit;

        const qb = this.userRepository.createQueryBuilder('u');

        if (query.search) {
            qb.where('LOWER(u.nickname) LIKE :search', {
                search: `%${query.search.toLowerCase()}%`,
            });
        }

        qb.orderBy('u.updatedAt', 'DESC').skip(skip).take(limit);

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
    }


    /**
     * Update user's connection status
     * @param nickname
     * @param isConnected
     */
    async updateConnectionStatus(
      nickname: string,
      isConnected: boolean,
    ): Promise<void> {
        await this.bulkheadService.execute(
          { name: BulkheadNameType.ChatWrite, ttlMs: 3_000, maxConcurrency: 50 },
          async () => {
              const user = await this.userRepository.findOne({
                  where: { nickname },
              });

              if (!user) return;

              user.isConnected = isConnected;
              await this.userRepository.save(user);

              // invalidate cache only
              await this.cacheService.delete(
                `${this.USER_CACHE_PREFIX}${nickname}`,
              );

              this.logger.debug(
                `🔌 ${nickname} → ${isConnected ? 'online' : 'offline'}`,
              );
          },
        );
    }

    /**
     * Delete user by nickname
     * @param nickname
     */
    async deleteUser(nickname: string): Promise<void> {
        const user = await this.findByNickname(nickname);

        await this.userRepository.delete(user.id);

        await Promise.all([
            this.cacheService.delete(`${this.USER_CACHE_PREFIX}${nickname}`),
            this.cacheService.deletePattern(`${this.USERS_LIST_PREFIX}*`),
        ]);

        this.logger.warn(`🗑 User deleted: ${nickname}`);
    }
}
