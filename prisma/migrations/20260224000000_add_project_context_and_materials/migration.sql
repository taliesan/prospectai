-- CreateTable
CREATE TABLE "ProjectContext" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rawDescription" TEXT,
    "processedBrief" TEXT NOT NULL,
    "issueAreas" TEXT,
    "defaultAsk" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectContext_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMaterial" (
    "id" TEXT NOT NULL,
    "projectContextId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "filename" TEXT,
    "url" TEXT,
    "extractedText" TEXT,
    "charCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectMaterial_pkey" PRIMARY KEY ("id")
);

-- AlterTable: Add new fields to Profile
ALTER TABLE "Profile" ADD COLUMN "projectContextId" TEXT;
ALTER TABLE "Profile" ADD COLUMN "relationshipContext" TEXT;
ALTER TABLE "Profile" ADD COLUMN "fundraiserName" TEXT;
ALTER TABLE "Profile" ADD COLUMN "specificAsk" TEXT;

-- CreateIndex
CREATE INDEX "ProjectContext_userId_idx" ON "ProjectContext"("userId");

-- CreateIndex
CREATE INDEX "ProjectMaterial_projectContextId_idx" ON "ProjectMaterial"("projectContextId");

-- AddForeignKey
ALTER TABLE "ProjectContext" ADD CONSTRAINT "ProjectContext_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMaterial" ADD CONSTRAINT "ProjectMaterial_projectContextId_fkey" FOREIGN KEY ("projectContextId") REFERENCES "ProjectContext"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_projectContextId_fkey" FOREIGN KEY ("projectContextId") REFERENCES "ProjectContext"("id") ON DELETE SET NULL ON UPDATE CASCADE;
