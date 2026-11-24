import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/authenticated-request.interface';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { MessagesService } from './messages.service';

@Controller('messages')
@UseGuards(FirebaseAuthGuard)
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

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

  @Post('v2/conversations/:id')
  sendMessageV2(
    @Req() request: AuthenticatedRequest,
    @Param('id') conversationId: string,
    @Body() body: { body?: unknown },
  ) {
    return this.messages.sendMessageV2(
      request.firebaseUser,
      conversationId,
      body?.body,
    );
  }
}
