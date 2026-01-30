import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { RoomParticipant } from './room-participant.entity';
import { Message } from '../../chat/entities/message.entity';

@Entity('rooms')
@Index(['creatorNickname'])
export class Room {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true, default: '' })
  description: string;

  @Column({ type: 'varchar', length: 50 })
  creatorNickname: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => RoomParticipant, (participant) => participant.room)
  participants?: RoomParticipant[];

  @OneToMany(() => Message, (message) => message.room)
  messages?: Message[];
}
