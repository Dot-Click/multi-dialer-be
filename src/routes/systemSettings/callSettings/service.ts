import prisma from "../../../lib/prisma";
import { validateData } from "../../../middlewares/vald.middleware";
import {
  createCallSettingsSchema,
} from "../../../schemas/callSettings.schema";

export async function insertCallSettingsInDb(payload: any, userId: string) {
  try {
    // Validate payload with Zod
    const result = (await validateData(createCallSettingsSchema, payload)) as any;

    if (!("data" in result)) {
      throw { errors: result };
    }

    const {
      onHoldRecording1Id,
      onHoldRecording2Id,
      ivrRecordingId,
      answeringMachineRecordingId,
      busyRecordingId,
      ...rest
    } = result.data;

    // Get or create user's systemSettings
    let systemSettings = await prisma.system_Setting.findFirst({
      where: { userId },
    });

    if (!systemSettings) {
      systemSettings = await prisma.system_Setting.create({
        data: { userId },
      });
    }

    // Build recording IDs — use direct ID fields to avoid "Unknown argument" errors with connect
    const recordingIds = {
      ...(onHoldRecording1Id !== undefined ? { onHoldRecording1Id } : {}),
      ...(onHoldRecording2Id !== undefined ? { onHoldRecording2Id } : {}),
      ...(ivrRecordingId !== undefined ? { ivrRecordingId } : {}),
      ...(answeringMachineRecordingId !== undefined ? { answeringMachineRecordingId } : {}),
      ...(busyRecordingId !== undefined ? { busyRecordingId } : {}),
    };

    const callSettings = await prisma.callSettings.create({
      data: {
        ...rest,
        ...recordingIds,
        systemSettingId: systemSettings.id,
      },
      // Return the recording objects alongside the created record
      include: {
        onHoldRecording1: true,
        onHoldRecording2: true,
        ivrRecording: true,
        answeringMachineRecording: true,
        busyRecording: true,
      },
    });

    return callSettings;
  } catch (error) {
    throw error;
  }
}