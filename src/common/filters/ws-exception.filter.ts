import { Catch, ArgumentsHost } from '@nestjs/common';
import { BaseWsExceptionFilter, WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';

@Catch()
export class WsExceptionFilter extends BaseWsExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const client = host.switchToWs().getClient<Socket>();
    
    let error = 'Internal server error';
    let message = 'An error occurred';

    if (exception instanceof WsException) {
      error = exception.getError() as string;
      message = exception.message;
    } else if (exception instanceof Error) {
      error = exception.name;
      message = exception.message;
    }

    client.emit('error', {
      error,
      message,
      timestamp: new Date().toISOString(),
    });
  }
}
