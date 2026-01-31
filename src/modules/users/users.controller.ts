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
} from '@nestjs/common';
import { Request } from 'express';
import {
	ApiTags,
	ApiOperation,
	ApiResponse,
	ApiParam,
	ApiQuery,
	ApiBody,
} from '@nestjs/swagger';

import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { FindAllDto } from './dto/find-all-user.dto';
import { FindAllUsersResponseDto } from './dto/find-all-user-response.dto';
import { User } from './entities/user.entity';

@ApiTags('Users')
@Controller('users')
export class UsersController {
	private readonly logger = new Logger(UsersController.name);

	constructor(private readonly usersService: UsersService) {}

	/**
	 * Create new user
	 * @param createUserDto
	 * @param req
	 */
	@Post()
	@HttpCode(HttpStatus.CREATED)
	@ApiOperation({ summary: 'Create a new user' })
	@ApiBody({ type: CreateUserDto })
	@ApiResponse({ status: 201, description: 'User created successfully', type: User })
	@ApiResponse({ status: 400, description: 'Invalid input' })
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
	@ApiOperation({ summary: 'Get all users with pagination & search' })
	@ApiQuery({ name: 'page', required: false, example: 1 })
	@ApiQuery({ name: 'limit', required: false, example: 20 })
	@ApiQuery({ name: 'search', required: false, example: 'john' })
	@ApiResponse({
		status: 200,
		description: 'List of users',
		type: FindAllUsersResponseDto,
	})
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
	@ApiOperation({ summary: 'Get user by nickname' })
	@ApiParam({ name: 'nickname', example: 'alice' })
	@ApiResponse({ status: 200, type: User })
	@ApiResponse({ status: 404, description: 'User not found' })
	async findByNickname(
		@Param('nickname') nickname: string,
	): Promise<User | null> {
		return this.usersService.findByNickname(nickname);
	}

	/**
	 * Delete user
	 * DELETE /users/:nickname
	 */
	@Delete(':nickname')
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ summary: 'Delete user by nickname' })
	@ApiParam({ name: 'nickname', example: 'alice' })
	@ApiResponse({
		status: 200,
		schema: {
			example: {
				message: 'User alice deleted successfully',
			},
		},
	})
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
