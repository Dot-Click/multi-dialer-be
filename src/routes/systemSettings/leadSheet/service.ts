import prisma from "../../../lib/prisma";
import { LeadSheetQuestionType, Prisma } from "@prisma/client";

export type LeadSheetQuestionInput = {
  text: string;
  type: LeadSheetQuestionType | string;
  options?: string[];
  required?: boolean;
};

export type CreateLeadSheetInput = {
  title: string;
  questions?: LeadSheetQuestionInput[];
};

export type UpdateLeadSheetInput = {
  title?: string;
  questions?: LeadSheetQuestionInput[];
};

const CHOICE_TYPES = new Set<LeadSheetQuestionType>([
  LeadSheetQuestionType.DROPDOWN,
  LeadSheetQuestionType.CHECKBOX,
  LeadSheetQuestionType.RADIO,
]);

function badRequest(message: string) {
  const err = new Error(message) as Error & { statusCode?: number };
  err.statusCode = 400;
  return err;
}

function normalizeQuestionType(input: LeadSheetQuestionType | string): LeadSheetQuestionType {
  if (typeof input !== "string") return input;

  const v = input.trim().toLowerCase();
  switch (v) {
    case "textfield":
      return LeadSheetQuestionType.TEXTFIELD;
    case "dropdown":
      return LeadSheetQuestionType.DROPDOWN;
    case "checkbox":
      return LeadSheetQuestionType.CHECKBOX;
    case "radio":
      return LeadSheetQuestionType.RADIO;
    case "datetime":
      return LeadSheetQuestionType.DATETIME;
    default:
      throw badRequest(
        `Invalid question type "${input}". Allowed: textfield, dropdown, checkbox, radio, datetime.`
      );
  }
}

function cleanStringArray(arr: unknown, fieldName: string): string[] {
  if (!Array.isArray(arr)) throw badRequest(`${fieldName} must be an array of strings.`);
  const cleaned = arr
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter((x) => x.length > 0);
  return cleaned;
}

export function validateAndNormalizeQuestions(
  questions: unknown
): Array<Pick<Prisma.LeadSheetQuestionCreateWithoutLeadSheetInput, "text" | "type" | "options" | "required">> {
  if (questions == null) return [];
  if (!Array.isArray(questions)) throw badRequest("questions must be an array.");

  return questions.map((q, idx) => {
    if (!q || typeof q !== "object") throw badRequest(`questions[${idx}] must be an object.`);

    const text = (q as any).text;
    const rawType = (q as any).type;
    const rawOptions = (q as any).options;
    const rawRequired = (q as any).required;

    if (typeof text !== "string" || text.trim().length === 0) {
      throw badRequest(`questions[${idx}].text is required and must be a non-empty string.`);
    }
    if (rawType == null) throw badRequest(`questions[${idx}].type is required.`);

    const type = normalizeQuestionType(rawType);
    const isChoice = CHOICE_TYPES.has(type);

    // Normalize options
    let options: string[] = [];
    if (rawOptions != null) options = cleanStringArray(rawOptions, `questions[${idx}].options`);

    if (isChoice) {
      if (options.length < 2) {
        throw badRequest(
          `questions[${idx}].options is required for ${type} and must have at least 2 options.`
        );
      }
      if (rawRequired !== true) {
        throw badRequest(`questions[${idx}].required must be true for ${type}.`);
      }
      return { text: text.trim(), type, options, required: true };
    }

    // Non-choice types: options must be omitted/empty, required must be false/omitted
    if (options.length > 0) {
      throw badRequest(`questions[${idx}].options is only allowed for dropdown/checkbox/radio.`);
    }
    if (rawRequired === true) {
      throw badRequest(`questions[${idx}].required can only be true for dropdown/checkbox/radio.`);
    }

    const required = rawRequired === false ? false : null;
    return { text: text.trim(), type, options: [], required };
  });
}

async function getOrCreateSystemSettings(userId: string) {
  let systemSettings = await prisma.system_Setting.findFirst({ where: { userId } });
  if (!systemSettings) {
    systemSettings = await prisma.system_Setting.create({ data: { userId } });
  }
  return systemSettings;
}

export async function createLeadSheetInDb(payload: CreateLeadSheetInput, userId: string) {
  if (!payload || typeof payload !== "object") throw badRequest("Request body must be an object.");
  if (!payload.title || typeof payload.title !== "string" || payload.title.trim().length === 0) {
    throw badRequest("title is required and must be a non-empty string.");
  }

  const systemSettings = await getOrCreateSystemSettings(userId);
  const normalizedQuestions = validateAndNormalizeQuestions(payload.questions);

  try {
    return await prisma.leadSheet.create({
      data: {
        title: payload.title.trim(),
        systemSettingId: systemSettings.id,
        questions: {
          create: normalizedQuestions.map((q) => ({
            text: q.text,
            type: q.type,
            options: q.options,
            required: q.required ?? null,
          })),
        },
      },
      include: {
        questions: true,
        systemSetting: {
          include: {
            user: { select: { id: true, fullName: true, email: true } },
          },
        },
      },
    });
  } catch (err: any) {
    if (err?.code === "P2002") {
      throw badRequest("A Lead Sheet with this title already exists.");
    }
    throw err;
  }
}

export async function getLeadSheetsForUser(userId: string) {
  const systemSettings = await prisma.system_Setting.findFirst({ where: { userId } });
  if (!systemSettings) return [];

  return prisma.leadSheet.findMany({
    where: { systemSettingId: systemSettings.id },
    orderBy: { createdAt: "desc" },
    include: {
      questions: { orderBy: { createdAt: "asc" } },
    },
  });
}

export async function getLeadSheetByIdForUser(id: string, userId: string) {
  const systemSettings = await prisma.system_Setting.findFirst({ where: { userId } });
  if (!systemSettings) return null;

  return prisma.leadSheet.findFirst({
    where: { id, systemSettingId: systemSettings.id },
    include: {
      questions: { orderBy: { createdAt: "asc" } },
    },
  });
}

export async function updateLeadSheetForUser(id: string, payload: UpdateLeadSheetInput, userId: string) {
  if (!payload || typeof payload !== "object") throw badRequest("Request body must be an object.");

  const systemSettings = await prisma.system_Setting.findFirst({ where: { userId } });
  if (!systemSettings) {
    const err = new Error("SystemSettings not found for user") as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }

  const existing = await prisma.leadSheet.findFirst({
    where: { id, systemSettingId: systemSettings.id },
    select: { id: true },
  });
  if (!existing) {
    const err = new Error("Lead Sheet not found") as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }

  const data: Prisma.LeadSheetUpdateInput = {};

  if (payload.title != null) {
    if (typeof payload.title !== "string" || payload.title.trim().length === 0) {
      throw badRequest("title must be a non-empty string.");
    }
    data.title = payload.title.trim();
  }

  const shouldReplaceQuestions = payload.questions != null;
  const normalizedQuestions = shouldReplaceQuestions
    ? validateAndNormalizeQuestions(payload.questions)
    : [];

  try {
    return await prisma.leadSheet.update({
      where: { id },
      data: {
        ...data,
        ...(shouldReplaceQuestions
          ? {
              questions: {
                deleteMany: {},
                create: normalizedQuestions.map((q) => ({
                  text: q.text,
                  type: q.type,
                  options: q.options,
                  required: q.required ?? null,
                })),
              },
            }
          : {}),
      },
      include: {
        questions: { orderBy: { createdAt: "asc" } },
        systemSetting: {
          include: {
            user: { select: { id: true, fullName: true, email: true } },
          },
        },
      },
    });
  } catch (err: any) {
    if (err?.code === "P2002") {
      throw badRequest("A Lead Sheet with this title already exists.");
    }
    throw err;
  }
}

export async function deleteLeadSheetForUser(id: string, userId: string) {
  const systemSettings = await prisma.system_Setting.findFirst({ where: { userId } });
  if (!systemSettings) {
    const err = new Error("SystemSettings not found for user") as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }

  const existing = await prisma.leadSheet.findFirst({
    where: { id, systemSettingId: systemSettings.id },
    select: { id: true },
  });
  if (!existing) {
    const err = new Error("Lead Sheet not found") as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }

  await prisma.leadSheet.delete({ where: { id } });
  return true;
}


