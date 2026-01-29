import {
  Entity,
  PrimaryGeneratedColumn,
  ManyToOne,
  CreateDateColumn,
  ForeignKey,
  Column,
  Index,
} from 'typeorm';
import { Room } from './room.entity';
import { User } from '../../users/entities/user.entity';

@Entity('room_participants')
// @Index(['roomId', 'userId'], { unique: true, name: 'idx_room_user' })
export class RoomParticipant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ForeignKey(() => Room)
  @Column()
  roomId: string;

  @ForeignKey(() => User)
  @Column()
  userId: string;

  @CreateDateColumn()
  joinedAt: Date;

  @ManyToOne(() => Room, (room) => room.participants)
  room: Room;

  @ManyToOne(() => User, (user) => user.roomParticipants)
  user: User;
}
