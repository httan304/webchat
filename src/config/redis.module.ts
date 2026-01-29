import { Global, Module } from '@nestjs/common';
import { Redis } from 'ioredis';

@Global()
@Module({
    providers: [
        {
            provide: Redis,
            useFactory: () =>
                new Redis({
                    host: process.env.REDIS_HOST || 'redis',
                    port: 6379,
                }),
        },
    ],
    exports: [Redis],
})
export class RedisModule {}
