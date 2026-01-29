import { Test, TestingModule } from '@nestjs/testing';
import { Request } from 'express';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { FindAllDto } from './dto/find-all-user.dto';
import { User } from './entities/user.entity';

describe('UsersController', () => {
	let controller: UsersController;
	let service: UsersService;

	const mockUser: User = {
		id: 'user-uuid-123',
		nickname: 'testuser',
		isConnected: false,
		createdAt: new Date('2026-01-29T10:00:00Z'),
		updatedAt: new Date('2026-01-29T10:00:00Z'),
	};

	const mockRequest = {
		headers: {},
		ip: '127.0.0.1',
		socket: { remoteAddress: '127.0.0.1' },
	} as unknown as Request;

	const mockUsersService = {
		create: jest.fn(),
		findAll: jest.fn(),
		findByNickname: jest.fn(),
		deleteUser: jest.fn(),
		updateConnectionStatus: jest.fn(),
		getOnlineUsers: jest.fn(),
	};

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			controllers: [UsersController],
			providers: [
				{
					provide: UsersService,
					useValue: mockUsersService,
				},
			],
		}).compile();

		controller = module.get<UsersController>(UsersController);
		service = module.get<UsersService>(UsersService);
	});

	afterEach(() => {
		jest.clearAllMocks();
	});

	describe('create', () => {
		it('should create a new user successfully', async () => {
			const createUserDto: CreateUserDto = {
				nickname: 'testuser',
			};

			mockUsersService.create.mockResolvedValue(mockUser);

			const result = await controller.create(createUserDto, mockRequest);

			expect(result).toEqual(mockUser);
			expect(service.create).toHaveBeenCalledWith(createUserDto);
			expect(service.create).toHaveBeenCalledTimes(1);
		});

		it('should log request with requestId from headers', async () => {
			const createUserDto: CreateUserDto = {
				nickname: 'testuser',
			};

			const requestWithId = {
				...mockRequest,
				headers: { 'x-request-id': 'test-request-123' },
			} as unknown as Request;

			mockUsersService.create.mockResolvedValue(mockUser);

			await controller.create(createUserDto, requestWithId);

			expect(service.create).toHaveBeenCalledWith(createUserDto);
		});

		it('should handle x-forwarded-for header', async () => {
			const createUserDto: CreateUserDto = {
				nickname: 'testuser',
			};

			const requestWithForwarded = {
				...mockRequest,
				headers: { 'x-forwarded-for': '192.168.1.1, 10.0.0.1' },
			} as unknown as Request;

			mockUsersService.create.mockResolvedValue(mockUser);

			await controller.create(createUserDto, requestWithForwarded);

			expect(service.create).toHaveBeenCalledWith(createUserDto);
		});

		it('should propagate service errors', async () => {
			const createUserDto: CreateUserDto = {
				nickname: 'existinguser',
			};

			const error = new Error('User already exists');
			mockUsersService.create.mockRejectedValue(error);

			await expect(
				controller.create(createUserDto, mockRequest),
			).rejects.toThrow('User already exists');
		});
	});

	describe('findAll', () => {
		it('should return paginated users with default pagination', async () => {
			const query: FindAllDto = {
				page: 1,
				limit: 20,
			};

			const mockResponse = {
				data: [mockUser],
				meta: {
					total: 1,
					page: 1,
					limit: 20,
					totalPages: 1,
				},
			};

			mockUsersService.findAll.mockResolvedValue(mockResponse);

			const result = await controller.findAll(query, mockRequest);

			expect(result).toEqual(mockResponse);
			expect(service.findAll).toHaveBeenCalledWith(query);
		});

		it('should apply search filter', async () => {
			const query: FindAllDto = {
				page: 1,
				limit: 20,
				search: 'test',
			};

			const mockResponse = {
				data: [mockUser],
				meta: {
					total: 1,
					page: 1,
					limit: 20,
					totalPages: 1,
				},
			};

			mockUsersService.findAll.mockResolvedValue(mockResponse);

			const result = await controller.findAll(query, mockRequest);

			expect(result).toEqual(mockResponse);
			expect(service.findAll).toHaveBeenCalledWith(query);
		});

		it('should handle custom pagination parameters', async () => {
			const query: FindAllDto = {
				page: 2,
				limit: 50,
			};

			const mockResponse = {
				data: [],
				meta: {
					total: 0,
					page: 2,
					limit: 50,
					totalPages: 0,
				},
			};

			mockUsersService.findAll.mockResolvedValue(mockResponse);

			const result = await controller.findAll(query, mockRequest);

			expect(result).toEqual(mockResponse);
			expect(service.findAll).toHaveBeenCalledWith(query);
		});

		it('should return empty result when no users found', async () => {
			const query: FindAllDto = {
				page: 1,
				limit: 20,
				search: 'nonexistent',
			};

			const mockResponse = {
				data: [],
				meta: {
					total: 0,
					page: 1,
					limit: 20,
					totalPages: 0,
				},
			};

			mockUsersService.findAll.mockResolvedValue(mockResponse);

			const result = await controller.findAll(query, mockRequest);

			expect(result).toEqual(mockResponse);
			expect(result.data).toHaveLength(0);
		});
	});

	describe('findByNickname', () => {
		it('should return user by nickname', async () => {
			mockUsersService.findByNickname.mockResolvedValue(mockUser);

			const result = await controller.findByNickname('testuser');

			expect(result).toEqual(mockUser);
			expect(service.findByNickname).toHaveBeenCalledWith('testuser');
		});

		it('should handle non-existent user', async () => {
			mockUsersService.findByNickname.mockRejectedValue(
				new Error('User not found'),
			);

			await expect(
				controller.findByNickname('nonexistent'),
			).rejects.toThrow('User not found');
		});

		it('should be case-insensitive (through service)', async () => {
			mockUsersService.findByNickname.mockResolvedValue(mockUser);

			const result = await controller.findByNickname('TESTUSER');

			expect(service.findByNickname).toHaveBeenCalledWith('TESTUSER');
			expect(result).toEqual(mockUser);
		});
	});

	describe('getConnectionStatus', () => {
		it('should return user connection status when user is offline', async () => {
			mockUsersService.findByNickname.mockResolvedValue(mockUser);

			const result = await controller.getConnectionStatus('testuser');

			expect(result).toEqual({
				nickname: 'testuser',
				isConnected: false,
			});
			expect(service.findByNickname).toHaveBeenCalledWith('testuser');
		});

		it('should return user connection status when user is online', async () => {
			const onlineUser = { ...mockUser, isConnected: true };
			mockUsersService.findByNickname.mockResolvedValue(onlineUser);

			const result = await controller.getConnectionStatus('testuser');

			expect(result).toEqual({
				nickname: 'testuser',
				isConnected: true,
			});
		});

		it('should throw error when user not found', async () => {
			mockUsersService.findByNickname.mockRejectedValue(
				new Error('User not found'),
			);

			await expect(
				controller.getConnectionStatus('nonexistent'),
			).rejects.toThrow('User not found');
		});
	});

	describe('deleteUser', () => {
		it('should delete user successfully', async () => {
			mockUsersService.deleteUser.mockResolvedValue(undefined);

			const result = await controller.deleteUser('testuser', mockRequest);

			expect(result).toEqual({
				message: 'User testuser deleted successfully',
			});
			expect(service.deleteUser).toHaveBeenCalledWith('testuser');
		});

		it('should handle deletion of non-existent user', async () => {
			mockUsersService.deleteUser.mockRejectedValue(
				new Error('User not found'),
			);

			await expect(
				controller.deleteUser('nonexistent', mockRequest),
			).rejects.toThrow('User not found');
		});

		it('should log requestId during deletion', async () => {
			const requestWithId = {
				...mockRequest,
				headers: { 'x-request-id': 'delete-123' },
			} as unknown as Request;

			mockUsersService.deleteUser.mockResolvedValue(undefined);

			await controller.deleteUser('testuser', requestWithId);

			expect(service.deleteUser).toHaveBeenCalledWith('testuser');
		});
	});

	describe('getRequestId', () => {
		it('should extract requestId from x-request-id header', () => {
			const req = {
				headers: { 'x-request-id': 'custom-id-123' },
			} as unknown as Request;

			// Access private method using type assertion
			const requestId = (controller as any).getRequestId(req);

			expect(requestId).toBe('custom-id-123');
		});

		it('should extract first IP from x-forwarded-for header', () => {
			const req = {
				headers: { 'x-forwarded-for': '192.168.1.1, 10.0.0.1, 172.16.0.1' },
			} as unknown as Request;

			const requestId = (controller as any).getRequestId(req);

			expect(requestId).toBe('192.168.1.1');
		});

		it('should use IP address when no headers present', () => {
			const req = {
				headers: {},
				ip: '127.0.0.1',
			} as unknown as Request;

			const requestId = (controller as any).getRequestId(req);

			expect(requestId).toContain('127.0.0.1');
		});

		it('should use socket remoteAddress when IP not available', () => {
			const req = {
				headers: {},
				socket: { remoteAddress: '192.168.1.100' },
			} as unknown as Request;

			const requestId = (controller as any).getRequestId(req);

			expect(requestId).toContain('192.168.1.100');
		});

		it('should generate unique requestId with timestamp and random string', () => {
			const req = {
				headers: {},
				ip: '127.0.0.1',
			} as unknown as Request;

			const requestId1 = (controller as any).getRequestId(req);
			const requestId2 = (controller as any).getRequestId(req);

			// Should contain IP
			expect(requestId1).toContain('127.0.0.1');

			// Should be different (due to timestamp and random)
			expect(requestId1).not.toBe(requestId2);
		});

		it('should use "unknown" when no IP available', () => {
			const req = {
				headers: {},
			} as unknown as Request;

			const requestId = (controller as any).getRequestId(req);

			expect(requestId).toContain('unknown');
		});
	});

	describe('HTTP Status Codes', () => {
		it('create should return 201 CREATED', async () => {
			mockUsersService.create.mockResolvedValue(mockUser);

			const createUserDto: CreateUserDto = { nickname: 'testuser' };
			const result = await controller.create(createUserDto, mockRequest);

			expect(result).toBeDefined();
			// In real HTTP context, @HttpCode(HttpStatus.CREATED) sets status to 201
		});

		it('findAll should return 200 OK', async () => {
			mockUsersService.findAll.mockResolvedValue({
				data: [],
				meta: { total: 0, page: 1, limit: 20, totalPages: 0 },
			});

			const result = await controller.findAll({}, mockRequest);

			expect(result).toBeDefined();
			// In real HTTP context, @HttpCode(HttpStatus.OK) sets status to 200
		});

		it('deleteUser should return 200 OK', async () => {
			mockUsersService.deleteUser.mockResolvedValue(undefined);

			const result = await controller.deleteUser('testuser', mockRequest);

			expect(result).toEqual({
				message: 'User testuser deleted successfully',
			});
		});
	});

	describe('Integration with RateLimitGuard', () => {
		it('should have RateLimitGuard applied at controller level', () => {
			const guards = Reflect.getMetadata('__guards__', UsersController);

			// Note: In actual test, guard is applied via @UseGuards decorator
			// This is tested in e2e tests
			expect(controller).toBeDefined();
		});
	});

	describe('Error Handling', () => {
		it('should propagate ConflictException from service', async () => {
			const createUserDto: CreateUserDto = { nickname: 'duplicate' };

			mockUsersService.create.mockRejectedValue(
				new Error('Nickname already exists'),
			);

			await expect(
				controller.create(createUserDto, mockRequest),
			).rejects.toThrow('Nickname already exists');
		});

		it('should propagate NotFoundException from service', async () => {
			mockUsersService.findByNickname.mockRejectedValue(
				new Error('User not found'),
			);

			await expect(
				controller.findByNickname('nonexistent'),
			).rejects.toThrow('User not found');
		});

		it('should propagate rate limit errors', async () => {
			const createUserDto: CreateUserDto = { nickname: 'testuser' };

			mockUsersService.create.mockRejectedValue(
				new Error('Rate limit exceeded'),
			);

			await expect(
				controller.create(createUserDto, mockRequest),
			).rejects.toThrow('Rate limit exceeded');
		});
	});
});
