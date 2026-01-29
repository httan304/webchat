/**
 * All socket event names used in Chat module
 * Centralized to avoid magic strings
 */
export enum ChatEvent {
	// room
	ROOM_JOIN = 'room:join',
	ROOM_LEAVE = 'room:leave',

	// message
	MESSAGE_SEND = 'message:send',
	MESSAGE_NEW = 'message:new',
	MESSAGE_EDIT = 'message:edit',
	MESSAGE_EDITED = 'message:edited',
	MESSAGE_DELETE = 'message:delete',
	MESSAGE_DELETED = 'message:deleted',

	// typing
	USER_TYPING = 'user:typing',
	USER_STOP_TYPING = 'user:stopTyping',

	// presence
	USER_CONNECTED = 'user:connected',
	USER_DISCONNECTED = 'user:disconnected',

	// error
	ERROR = 'error',
}

/**
 * Payload mapping for each event (optional but recommended)
 */
export interface ChatEventPayload {
	[ChatEvent.ROOM_JOIN]: { roomId: string };
	[ChatEvent.ROOM_LEAVE]: { roomId: string };

	[ChatEvent.MESSAGE_SEND]: any;
	[ChatEvent.MESSAGE_NEW]: any;
	[ChatEvent.MESSAGE_EDIT]: any;
	[ChatEvent.MESSAGE_EDITED]: any;
	[ChatEvent.MESSAGE_DELETE]: any;
	[ChatEvent.MESSAGE_DELETED]: { messageId: string };

	[ChatEvent.USER_TYPING]: { roomId: string };
	[ChatEvent.USER_STOP_TYPING]: { roomId: string };

	[ChatEvent.USER_CONNECTED]: { nickname: string; timestamp: number };
	[ChatEvent.USER_DISCONNECTED]: { nickname: string; timestamp: number };

	[ChatEvent.ERROR]: { message: string; code: string };
}
