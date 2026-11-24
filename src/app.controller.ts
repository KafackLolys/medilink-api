import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  // V2 route copies

  @Get('v2')
  getHelloV2(): string {
    return this.appService.getHelloV2();
  }
}
