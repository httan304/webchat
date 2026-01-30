import { Test, TestingModule } from '@nestjs/testing';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { Room } from './entities/room.entity';

// Mock the guard
jest.mock('@/guard/rate-limit.guard', () => ({
	RateLimitGuard: jest.fn().mockImplementation(() => ({
		canActivate: jest.fn(() => true),
	})),
}));

describe('RoomsController', () => {
	let controller: RoomsController;
	let service: RoomsService;

	const mockRoom: Room = {
		id: 'room-uuid-123',
		name: 'Test Room',
		description: 'Test Description',
		creatorNickname: 'alice',
		createdAt: new Date('2026-01-29'),
		updatedAt: new Date('2026-01-29'),
	};

	const mockRoomsService = {
		createRoom: jest.fn(),
		findOne: jest.fn(),
		addParticipant: jest.fn(),
	};

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			controllers: [RoomsController],
			providers: [
				{
					provide: RoomsService,
					useValue: mockRoomsService,
				},
			],
		}).compile();

		controller = module.get<RoomsController>(RoomsController);
		service = module.get<RoomsService>(RoomsService);
	});

	afterEach(() => {
		jest.clearAllMocks();
	});

	describe('create', () => {
		it('should create a new room', async () => {
			const createRoomDto: CreateRoomDto = {
				name: 'Test Room',
				creatorNickname: 'alice',
				description: 'Test Description',
			};

			mockRoomsService.createRoom.mockResolvedValue(mockRoom);

			const result = await controller.create(createRoomDto);

			expect(result).toEqual(mockRoom);
			expect(service.createRoom).toHaveBeenCalledWith(
				'Test Room',
				'alice',
				'Test Description',
			);
		});

		it('should create room without description', async () => {
			const createRoomDto: CreateRoomDto = {
				description: 'Test Description',
				name: 'Test Room',
				creatorNickname: 'alice',
			};

			mockRoomsService.createRoom.mockResolvedValue(mockRoom);

			await controller.create(createRoomDto);

			expect(service.createRoom).toHaveBeenCalledWith(
				'Test Room',
				'alice',
				undefined,
			);
		});

		it('should propagate service errors', async () => {
			const createRoomDto: CreateRoomDto = {
				description: 'Test Description',
				name: 'Test Room',
				creatorNickname: 'alice',
			};

			mockRoomsService.createRoom.mockRejectedValue(
				new Error('Room creation failed'),
			);

			await expect(controller.create(createRoomDto)).rejects.toThrow(
				'Room creation failed',
			);
		});
	});

	describe('findOne', () => {
		it('should return a room by id', async () => {
			mockRoomsService.findOne.mockResolvedValue(mockRoom);

			const result = await controller.findOne('room-uuid-123');

			expect(result).toEqual(mockRoom);
			expect(service.findOne).toHaveBeenCalledWith('room-uuid-123');
		});

		it('should throw error if room not found', async () => {
			mockRoomsService.findOne.mockRejectedValue(
				new Error('Room not found'),
			);

			await expect(controller.findOne('nonexistent')).rejects.toThrow(
				'Room not found',
			);
		});
	});

	describe('addParticipant', () => {
		it('should add participant to room', async () => {
			mockRoomsService.addParticipant.mockResolvedValue(undefined);

			const result = await controller.addParticipant(
				'room-uuid-123',
				'bob',
			);

			expect(result).toEqual({
				message: 'User bob added to room room-uuid-123',
			});
			expect(service.addParticipant).toHaveBeenCalledWith(
				'room-uuid-123',
				'bob',
			);
		});

		it('should propagate service errors', async () => {
			mockRoomsService.addParticipant.mockRejectedValue(
				new Error('User not found'),
			);

			await expect(
				controller.addParticipant('room-uuid-123', 'nonexistent'),
			).rejects.toThrow('User not found');
		});
	});
});
