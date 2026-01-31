export enum BulkheadNameType {
	ChatWrite = 'chat-write',
	ChatRead = 'chat-read',

	UserWrite = 'user-write',
	UserRead = 'user-read',
	UserCreate = 'user-create',
	UserDelete = 'user-delete',

	RoomWrite = 'room-write',
	RoomRead = 'room-read',
	RoomJoin = 'room-join',
	RoomLeave = 'room-leave',
	RoomCreate = 'room-create',
	RoomDelete = 'room-delete',

	MessageWrite = 'message-write',
	MessageRead = 'message-read',
	MessageCreate = 'message-create',
	MessageDelete = 'message-delete',
}
