import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from './pagination-meta.dto';
import { Room } from '@/modules/rooms/entities/room.entity';

export class FindAllRoomsResponseDto {
    @ApiProperty({
        type: () => Room,
        isArray: true,
        description: 'List of rooms',
    })
    data: Room[];

    @ApiProperty({
        type: () => PaginationMetaDto,
        description: 'Pagination metadata',
    })
    meta: PaginationMetaDto;
}
