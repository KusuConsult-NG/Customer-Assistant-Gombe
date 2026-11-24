import { Module } from '@nestjs/common';
import { SituationRoomController } from './situation-room.controller';
import { SituationRoomService } from './situation-room.service';
import { PetitionExportService } from './petition-export.service';

@Module({
  controllers: [SituationRoomController],
  providers: [SituationRoomService, PetitionExportService],
  exports: [SituationRoomService, PetitionExportService],
})
export class SituationRoomModule {}
