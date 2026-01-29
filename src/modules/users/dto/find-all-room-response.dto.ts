import { PaginationMetaDto } from './pagination-meta.dto';
import {Room} from "@/modules/rooms/entities/room.entity";

export class FindAllRoomsResponseDto {
    data: Room[];
    meta: PaginationMetaDto;
}
