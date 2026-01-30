import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { Room } from '../../rooms/entities/room.entity';

@Entity('messages')
@Index(['roomId', 'createdAt'])
@Index(['senderNickname', 'createdAt'])
@Index(['createdAt'])
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  roomId: string;

  @Column({ type: 'varchar', length: 50 })
  senderNickname: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'boolean', default: false })
  edited: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => Room, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'roomId' })
  room?: Room;
}
