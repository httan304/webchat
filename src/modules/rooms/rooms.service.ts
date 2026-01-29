import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Room } from './entities/room.entity';
import { RoomParticipant } from './entities/room-participant.entity';
import { CreateRoomDto } from './dto/create-room.dto';
import { UsersService } from '../users/users.service';

@Injectable()
export class RoomsService {
  private readonly logger = new Logger(RoomsService.name);

  constructor(
      @InjectRepository(Room)
      private readonly roomRepository: Repository<Room>,
      @InjectRepository(RoomParticipant)
      private readonly participantRepository: Repository<RoomParticipant>,
      private readonly usersService: UsersService,
  ) {}

  async create(createRoomDto: CreateRoomDto): Promise<Room> {
    const room = this.roomRepository.create({
      name: createRoomDto.name,
      description: createRoomDto.description,
    });

    return await this.roomRepository.save(room);
  }

  async findOne(roomId: string): Promise<Room> {
    const room = await this.roomRepository.findOne({
      where: { id: roomId },
      relations: ['participants', 'participants.user'],
    });

    if (!room) {
      throw new NotFoundException(`Room ${roomId} not found`);
    }

    return room;
  }

  async findAll(): Promise<Room[]> {
    return this.roomRepository.find({
      relations: ['participants'],
      order: { createdAt: 'DESC' },
    });
  }

  async addParticipant(roomId: string, userNickname: string): Promise<void> {
    const room = await this.findOne(roomId);
    const user = await this.usersService.findByNickname(userNickname);

    const existing = await this.participantRepository.findOne({
      where: { roomId, userId: user.id },
    });

    if (existing) {
      throw new BadRequestException('User is already a participant');
    }

    const participant = this.participantRepository.create({
      roomId,
      userId: user.id,
    });

    await this.participantRepository.save(participant);
    this.logger.log(`User ${userNickname} added to room ${roomId}`);
  }

  async removeParticipant(roomId: string, userNickname: string): Promise<void> {
    const user = await this.usersService.findByNickname(userNickname);

    const result = await this.participantRepository.delete({
      roomId,
      userId: user.id,
    });

    if (result.affected === 0) {
      throw new NotFoundException('Participant not found');
    }

    this.logger.log(`User ${userNickname} removed from room ${roomId}`);
  }

  async isParticipant(roomId: string, userNickname: string): Promise<boolean> {
    const user = await this.usersService.findByNickname(userNickname);

    const participant = await this.participantRepository.findOne({
      where: { roomId, userId: user.id },
    });

    return !!participant;
  }

  async getParticipants(roomId: string): Promise<RoomParticipant[]> {
    return this.participantRepository.find({
      where: { roomId },
      relations: ['user'],
    });
  }
}
