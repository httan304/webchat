import { IsOptional, IsInt, Min, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class FindAllDto {
    @ApiPropertyOptional({
        example: 1,
        description: 'Page number (starts from 1)',
        default: 1,
        minimum: 1,
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number = 1;

    @ApiPropertyOptional({
        example: 20,
        description: 'Number of items per page',
        default: 20,
        minimum: 1,
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    limit?: number = 20;

    @ApiPropertyOptional({
        example: 'john',
        description: 'Search keyword (nickname, name, etc.)',
    })
    @IsOptional()
    @IsString()
    search?: string;
}
