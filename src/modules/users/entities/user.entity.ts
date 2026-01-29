
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { Message } from '../../chat/entities/message.entity';
import { RoomParticipant } from '../../rooms/entities/room-participant.entity';

@Entity('users')
@Index(['nickname'], { unique: true })
@Index(['isConnected'])
@Index(['createdAt'])
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50, unique: true })
  nickname: string;

  @Column({ type: 'boolean', default: false })
  isConnected: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => Message, (message) => message.user)
  messages: Message[];

  @OneToMany(() => RoomParticipant, (participant) => participant.user)
  roomParticipants: RoomParticipant[];
}
