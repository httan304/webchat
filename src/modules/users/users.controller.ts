import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  HttpCode,
  HttpStatus,
  Query,
  Req,
  Param,
  Logger,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { FindAllDto } from './dto/find-all-user.dto';
import { FindAllUsersResponseDto } from './dto/find-all-user-response.dto';
import { User } from './entities/user.entity';
import { RateLimitGuard } from '../../guard/rate-limit.guard';

@UseGuards(RateLimitGuard)
@Controller('users')
export class UsersController {
  private readonly logger = new Logger(UsersController.name);

  constructor(private readonly usersService: UsersService) {}

  /**
   * Create a new user
   * POST /users
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() createUserDto: CreateUserDto,
    @Req() req: Request,
  ): Promise<User> {
    const requestId = this.getRequestId(req);

    this.logger.log(
      `Creating user: ${createUserDto.nickname} (requestId=${requestId})`,
    );

    return this.usersService.create(createUserDto);
  }

  /**
   * Get all users with pagination & search
   * GET /users?page=1&limit=20&search=john
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  async findAll(
    @Query() query: FindAllDto,
    @Req() req: Request,
  ): Promise<FindAllUsersResponseDto> {
    const requestId = this.getRequestId(req);

    this.logger.log(
      `Fetch users page=${query.page}, limit=${query.limit}, search=${query.search} (requestId=${requestId})`,
    );

    return this.usersService.findAll(query);
  }

  /**
   * Get user by nickname
   * GET /users/:nickname
   */
  @Get(':nickname')
  @HttpCode(HttpStatus.OK)
  async findByNickname(
    @Param('nickname') nickname: string,
  ): Promise<User> {
    return this.usersService.findByNickname(nickname);
  }

  /**
   * Get user connection status
   * GET /users/:nickname/status
   */
  @Get(':nickname/status')
  @HttpCode(HttpStatus.OK)
  async getConnectionStatus(
    @Param('nickname') nickname: string,
  ): Promise<{ nickname: string; isConnected: boolean }> {
    const user = await this.usersService.findByNickname(nickname);
    return {
      nickname: user.nickname,
      isConnected: user.isConnected,
    };
  }

  /**
   * Delete user
   * DELETE /users/:nickname
   */
  @Delete(':nickname')
  @HttpCode(HttpStatus.OK)
  async deleteUser(
    @Param('nickname') nickname: string,
    @Req() req: Request,
  ): Promise<{ message: string }> {
    const requestId = this.getRequestId(req);

    await this.usersService.deleteUser(nickname);

    return { message: `User ${nickname} deleted successfully` };
  }

  /**
   * Extract request identifier (rate-limit / bulkhead key)
   */
  private getRequestId(req: Request): string {
    const headerId = req.headers['x-request-id'] as string;
    if (headerId) return headerId;

    const forwardedFor = req.headers['x-forwarded-for'] as string;
    if (forwardedFor) {
      return forwardedFor.split(',')[0].trim();
    }

    const ip = req.ip || req.socket?.remoteAddress || 'unknown';

    return `${ip}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
