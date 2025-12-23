-- CreateEnum
CREATE TYPE "LeadSheetQuestionType" AS ENUM ('TEXTFIELD', 'DROPDOWN', 'CHECKBOX', 'RADIO', 'DATETIME');

-- CreateTable
CREATE TABLE "lead_sheets" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "systemSettingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_sheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_sheet_questions" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "type" "LeadSheetQuestionType" NOT NULL,
    "options" TEXT[],
    "required" BOOLEAN,
    "leadSheetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_sheet_questions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lead_sheets_title_key" ON "lead_sheets"("title");

-- AddForeignKey
ALTER TABLE "lead_sheets" ADD CONSTRAINT "lead_sheets_systemSettingId_fkey" FOREIGN KEY ("systemSettingId") REFERENCES "system_settings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_sheet_questions" ADD CONSTRAINT "lead_sheet_questions_leadSheetId_fkey" FOREIGN KEY ("leadSheetId") REFERENCES "lead_sheets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
