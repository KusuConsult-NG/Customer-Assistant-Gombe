import { Module } from '@nestjs/common';
import { SituationRoomModule } from '../situation-room/situation-room.module';
import { SmsController } from './sms.controller';

@Module({
  imports: [SituationRoomModule],
  controllers: [SmsController],
})
export class SmsModule {}
