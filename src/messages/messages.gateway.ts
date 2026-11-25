import { ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { AccountStatus, type User } from '../interfaces/database';
import { FirebaseService } from '../firebase/firebase.service';
import { MessagesService } from './messages.service';

type AuthenticatedSocket = Socket & { data: { userId?: string } };

@WebSocketGateway({ cors: { origin: true, credentials: true }, transports: ['websocket', 'polling'] })
export class MessagesGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  constructor(private readonly firebase: FirebaseService, private readonly messages: MessagesService) { }

  async handleConnection(client: AuthenticatedSocket): Promise<void> {
    try {
      const token = client.handshake.auth?.token;
      if (typeof token !== 'string' || !token.trim()) { client.disconnect(true); return; }
      const decoded = await this.firebase.getAuth().verifyIdToken(token, true);
      const snapshot = await this.firebase.getFirestore().collection('users').doc(decoded.uid).get();
      if (!snapshot.exists) { client.disconnect(true); return; }
      const user = snapshot.data() as User;
      if (user.status === AccountStatus.SUSPENDED || user.status === AccountStatus.DELETED) { client.disconnect(true); return; }
      client.data.userId = decoded.uid;
      await client.join(this.userRoom(decoded.uid));
      client.emit('connection:ready', { userId: decoded.uid });
    } catch { client.disconnect(true); }
  }

  handleDisconnect(_client: AuthenticatedSocket): void { }

  @SubscribeMessage('conversation:join')
  async joinConversation(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() body: { conversationId?: unknown }): Promise<{ joined: boolean }> {
    const userId = client.data.userId;
    const id = body?.conversationId;
    if (!userId || typeof id !== 'string' || !id) return { joined: false };
    try {
      await this.messages.getConversationParticipants(userId, id);
      await client.join(this.conversationRoom(id));
      return { joined: true };
    } catch {
      client.emit('conversation:error', { conversationId: id, message: 'Accès à cette conversation refusé' });
      return { joined: false };
    }
  }

  @SubscribeMessage('conversation:leave')
  async leaveConversation(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() body: { conversationId?: unknown }): Promise<{ left: boolean }> {
    const id = body?.conversationId;
    if (typeof id !== 'string' || !id) return { left: false };
    await client.leave(this.conversationRoom(id));
    return { left: true };
  }

  publishNewMessage(conversationId: string, message: { id: string; senderUserId: string; body: string; sentAt: string; readAt: string | null }, recipientUserId: string, unreadCount: number): void {
    this.server.to(this.conversationRoom(conversationId)).emit('message:new', { conversationId, message });
    this.server.to(this.userRoom(recipientUserId)).emit('conversation:updated', { conversationId, preview: message.body, lastMessageAt: message.sentAt, unreadCount });
  }

  publishConversationRead(conversationId: string, readerUserId: string, readAt: string): void {
    this.server.to(this.conversationRoom(conversationId)).emit('message:read', { conversationId, readerUserId, readAt });
    this.server.to(this.userRoom(readerUserId)).emit('conversation:read', { conversationId, readerUserId, readAt, unreadCount: 0 });
  }

  private conversationRoom(id: string): string { return `conversation:${id}`; }
  private userRoom(id: string): string { return `user:${id}`; }
}