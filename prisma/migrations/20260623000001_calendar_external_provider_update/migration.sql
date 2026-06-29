-- AlterTable
ALTER TABLE "calendar" ADD COLUMN     "externalEventId" TEXT,
ADD COLUMN     "externalProvider" "ExternalProvider" NOT NULL DEFAULT 'NONE';
-- AlterTable
ALTER TABLE "callbacks" ADD COLUMN     "externalEventId" TEXT,
ADD COLUMN     "externalProvider" "ExternalProvider" NOT NULL DEFAULT 'NONE';
-- AlterTable
ALTER TABLE "external_calendar_tokens" ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'UTC';
-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "externalEventId" TEXT,
ADD COLUMN     "externalProvider" "ExternalProvider" NOT NULL DEFAULT 'NONE';
-- CreateIndex
CREATE UNIQUE INDEX "calendar_externalEventId_key" ON "calendar"("externalEventId");
-- CreateIndex
CREATE UNIQUE INDEX "callbacks_externalEventId_key" ON "callbacks"("externalEventId");
-- CreateIndex
CREATE UNIQUE INDEX "tasks_externalEventId_key" ON "tasks"("externalEventId");
