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
import { RoomParticipant } from './room-participant.entity';

@Entity('rooms')
@Index(['createdAt'])
export class Room {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => Message, (message) => message.room, { lazy: true })
  messages: Promise<Message[]>;

  @OneToMany(() => RoomParticipant, (participant) => participant.room)
  participants: RoomParticipant[];
}
