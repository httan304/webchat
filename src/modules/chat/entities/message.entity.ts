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
@Index(['roomId', 'createdAt']) // ✅ Composite index for room messages query
@Index(['senderNickname', 'createdAt']) // ✅ Index for user's messages
@Index(['createdAt']) // ✅ Index for chronological queries
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

  // ✅ Optional: ManyToOne relationship with Room
  // Uncomment if you want to use relations
  @ManyToOne(() => Room, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'roomId' })
  room?: Room;
}
