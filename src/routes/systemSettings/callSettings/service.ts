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

    // Build recording connects — only include a slot if an ID was provided
    const recordingConnects = {
      ...(onHoldRecording1Id
        ? { onHoldRecording1: { connect: { id: onHoldRecording1Id } } }
        : {}),
      ...(onHoldRecording2Id
        ? { onHoldRecording2: { connect: { id: onHoldRecording2Id } } }
        : {}),
      ...(ivrRecordingId
        ? { ivrRecording: { connect: { id: ivrRecordingId } } }
        : {}),
      ...(answeringMachineRecordingId
        ? { answeringMachineRecording: { connect: { id: answeringMachineRecordingId } } }
        : {}),
    };

    const callSettings = await prisma.callSettings.create({
      data: {
        ...rest,
        ...recordingConnects,
        systemSettingId: systemSettings.id,
      },
      // Return the recording objects alongside the created record
      include: {
        onHoldRecording1: true,
        onHoldRecording2: true,
        ivrRecording: true,
        answeringMachineRecording: true,
      },
    });

    return callSettings;
  } catch (error) {
    throw error;
  }
}