import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/authenticated-request.interface';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { MessagesService } from './messages.service';
import { MessagesGateway } from './messages.gateway';

@Controller('messages')
@UseGuards(FirebaseAuthGuard)
export class MessagesController {
  constructor(private readonly messages: MessagesService, private readonly gateway: MessagesGateway) {}

  @Get('conversations')
  listConversations(@Req() request: AuthenticatedRequest) {
    return this.messages.listConversations(request.firebaseUser);
  }

  @Get('conversations/:id')
  listMessages(
    @Req() request: AuthenticatedRequest,
    @Param('id') conversationId: string,
  ) {
    return this.messages.listMessages(request.firebaseUser, conversationId);
  }

  @Post('conversations/:id')
  sendMessage(
    @Req() request: AuthenticatedRequest,
    @Param('id') conversationId: string,
    @Body() body: { body?: unknown },
  ) {
    return this.messages.sendMessage(
      request.firebaseUser,
      conversationId,
      body?.body,
    );
  }

  // V2 route copies

  @Get('v2/conversations')
  listConversationsV2(@Req() request: AuthenticatedRequest) {
    return this.messages.listConversationsV2(request.firebaseUser);
  }

  @Get('v2/conversations/:id')
  listMessagesV2(
    @Req() request: AuthenticatedRequest,
    @Param('id') conversationId: string,
  ) {
    return this.messages.listMessagesV2(request.firebaseUser, conversationId);
  }

  @Patch('v2/conversations/:id/read')
  async markConversationReadV2(
    @Req() request: AuthenticatedRequest,
    @Param('id') conversationId: string,
  ) {
    const result = await this.messages.markConversationReadV2(request.firebaseUser, conversationId);
    this.gateway.publishConversationRead(conversationId, request.firebaseUser.uid, result.readAt);
    return result;
  }

  @Post('v2/conversations/:id')
  async sendMessageV2(
    @Req() request: AuthenticatedRequest,
    @Param('id') conversationId: string,
    @Body() body: { body?: unknown },
  ) {
    const message = await this.messages.sendMessageV2(request.firebaseUser, conversationId, body?.body);
    const participants = await this.messages.getConversationParticipants(request.firebaseUser.uid, conversationId);
    const recipientUserId = participants.doctorUserId === request.firebaseUser.uid ? participants.patientUserId : participants.doctorUserId;
    const unreadCount = await this.messages.getUnreadCount(recipientUserId, conversationId);
    this.gateway.publishNewMessage(conversationId, message, recipientUserId, unreadCount);
    return message;
  }
}
