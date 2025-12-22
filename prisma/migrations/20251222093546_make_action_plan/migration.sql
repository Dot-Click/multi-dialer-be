-- CreateEnum
CREATE TYPE "ActionSchedType" AS ENUM ('FREQUENCY_BASED', 'DATE_BASED');

-- CreateEnum
CREATE TYPE "ActionStepType" AS ENUM ('EMAIL', 'PHONE_CALL', 'TASK', 'LETTER', 'MAILING_LABEL');

-- CreateEnum
CREATE TYPE "ActionTriggerType" AS ENUM ('NONE', 'CALLING_LIST', 'GROUP');

-- CreateEnum
CREATE TYPE "ActionEndLogic" AS ENUM ('DO_NOTHING', 'REPEAT_PLAN', 'START_OTHER_PLAN');

-- CreateTable
CREATE TABLE "action_plans" (
    "id" TEXT NOT NULL,
    "systemSettingId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "schedulingType" "ActionSchedType" NOT NULL DEFAULT 'FREQUENCY_BASED',
    "schedulingLogic" "ActionSchedType" NOT NULL DEFAULT 'FREQUENCY_BASED',
    "weekendScheduling" "ActionSchedType" NOT NULL DEFAULT 'FREQUENCY_BASED',
    "triggerType" "ActionTriggerType" NOT NULL DEFAULT 'NONE',
    "triggerSourceId" TEXT,
    "removeOnTriggerExit" BOOLEAN NOT NULL DEFAULT false,
    "endLogic" "ActionEndLogic" NOT NULL DEFAULT 'DO_NOTHING',
    "assignGroupEnabled" BOOLEAN NOT NULL DEFAULT false,
    "assignGroupId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "action_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_steps" (
    "id" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "actionType" "ActionStepType" NOT NULL,
    "contentValue" TEXT NOT NULL,
    "dayOffset" INTEGER NOT NULL DEFAULT 0,
    "planId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "action_steps_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "action_plans" ADD CONSTRAINT "action_plans_systemSettingId_fkey" FOREIGN KEY ("systemSettingId") REFERENCES "system_settings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_steps" ADD CONSTRAINT "action_steps_planId_fkey" FOREIGN KEY ("planId") REFERENCES "action_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
