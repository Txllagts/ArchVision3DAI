-- AlterTable
ALTER TABLE "ProjectFile" ADD COLUMN "clientKey" TEXT;

-- CreateIndex
CREATE INDEX "ProjectFile_projectId_clientKey_idx" ON "ProjectFile"("projectId", "clientKey");
