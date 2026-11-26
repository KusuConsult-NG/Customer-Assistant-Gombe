import { Module } from '@nestjs/common';
import { SituationRoomController } from './situation-room.controller';
import { SituationRoomService } from './situation-room.service';
import { PetitionExportService } from './petition-export.service';
import { CampaignOpsService } from './campaign-ops.service';

@Module({
  controllers: [SituationRoomController],
  providers: [SituationRoomService, PetitionExportService, CampaignOpsService],
  exports: [SituationRoomService, PetitionExportService, CampaignOpsService],
})
export class SituationRoomModule {}
