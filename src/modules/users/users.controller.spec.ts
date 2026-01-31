import { Test, TestingModule } from '@nestjs/testing';
import { Request } from 'express';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { FindAllDto } from './dto/find-all-user.dto';
import { User } from './entities/user.entity';
import { RateLimitGuard } from '@/guard/rate-limit.guard';

describe('UsersController', () => {
	let controller: UsersController;
	let service: jest.Mocked<UsersService>;

	const mockUser: User = {
		id: 'user-1',
		nickname: 'testuser',
		isConnected: false,
		lastSeen: new Date(),
		createdAt: new Date(),
		updatedAt: new Date(),
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
		})
			.overrideGuard(RateLimitGuard)
			.useValue({ canActivate: () => true })
			.compile();

		controller = module.get(UsersController);
		service = module.get(UsersService) as jest.Mocked<UsersService>;
		jest.clearAllMocks();
	});

	describe('create()', () => {
		it('should create user successfully', async () => {
			const dto: CreateUserDto = { nickname: 'testuser' };
			service.create.mockResolvedValue(mockUser);

			const result = await controller.create(dto, mockRequest);

			expect(result).toEqual(mockUser);
			expect(service.create).toHaveBeenCalledWith(dto);
		});

		it('should propagate service error', async () => {
			service.create.mockRejectedValue(new Error('rate limited'));

			await expect(
				controller.create({ nickname: 'test' }, mockRequest),
			).rejects.toThrow('rate limited');
		});
	});

	describe('findAll()', () => {
		it('should return paginated users', async () => {
			const query: FindAllDto = { page: 1, limit: 20 };

			const response = {
				data: [mockUser],
				meta: {
					total: 1,
					page: 1,
					limit: 20,
					totalPages: 1,
				},
			};

			service.findAll.mockResolvedValue(response);

			const result = await controller.findAll(query, mockRequest);

			expect(result).toEqual(response);
			expect(service.findAll).toHaveBeenCalledWith(query);
		});

		it('should propagate service error', async () => {
			service.findAll.mockRejectedValue(new Error('db error'));

			await expect(
				controller.findAll({}, mockRequest),
			).rejects.toThrow('db error');
		});
	});

	describe('findByNickname()', () => {
		it('should return user', async () => {
			service.findByNickname.mockResolvedValue(mockUser);

			const result = await controller.findByNickname('testuser');

			expect(result).toEqual(mockUser);
			expect(service.findByNickname).toHaveBeenCalledWith('testuser');
		});

		it('should propagate NotFoundException', async () => {
			service.findByNickname.mockRejectedValue(new Error('not found'));

			await expect(
				controller.findByNickname('unknown'),
			).rejects.toThrow('not found');
		});
	});

	describe('deleteUser()', () => {
		it('should delete user successfully', async () => {
			service.deleteUser.mockResolvedValue(undefined);

			const result = await controller.deleteUser('testuser', mockRequest);

			expect(result).toEqual({
				message: 'User testuser deleted successfully',
			});
			expect(service.deleteUser).toHaveBeenCalledWith('testuser');
		});

		it('should propagate delete error', async () => {
			service.deleteUser.mockRejectedValue(new Error('not found'));

			await expect(
				controller.deleteUser('unknown', mockRequest),
			).rejects.toThrow('not found');
		});
	});

	describe('getRequestId()', () => {
		it('should use x-request-id header', () => {
			const req = {
				headers: { 'x-request-id': 'req-123' },
			} as unknown as Request;

			const id = (controller as any).getRequestId(req);
			expect(id).toBe('req-123');
		});

		it('should use first x-forwarded-for IP', () => {
			const req = {
				headers: { 'x-forwarded-for': '1.1.1.1, 2.2.2.2' },
			} as unknown as Request;

			const id = (controller as any).getRequestId(req);
			expect(id).toBe('1.1.1.1');
		});

		it('should fallback to ip', () => {
			const req = {
				headers: {},
				ip: '127.0.0.1',
			} as unknown as Request;

			const id = (controller as any).getRequestId(req);
			expect(id).toContain('127.0.0.1');
		});

		it('should fallback to unknown', () => {
			const req = {
				headers: {},
			} as unknown as Request;

			const id = (controller as any).getRequestId(req);
			expect(id).toContain('unknown');
		});
	});
});
