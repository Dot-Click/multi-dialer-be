import { google } from "googleapis";
import prisma from "../../lib/prisma";

const GOOGLE_SCOPES = ["https://www.googleapis.com/auth/calendar.events"];

// Google Calendar requires local time (no Z/offset) when timeZone is specified.
// "2026-06-28T15:00:00.000Z" in Asia/Karachi → "2026-06-28T20:00:00"
function toLocalDateTimeString(utcDate: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(utcDate)
    .replace(" ", "T");
}

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CALENDAR_CLIENT_ID,
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
    process.env.GOOGLE_CALENDAR_REDIRECT_URI,
  );
}

async function getAuthClientForUser(userId: string) {
  const tokenRecord = await prisma.externalCalendarToken.findUnique({
    where: { userId_provider: { userId, provider: "GOOGLE" } },
  });
  if (!tokenRecord) return null;

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({
    access_token: tokenRecord.accessToken,
    refresh_token: tokenRecord.refreshToken,
    expiry_date: tokenRecord.expiresAt.getTime(),
  });

  // Refresh token if expired or within 5 minutes of expiry
  if (tokenRecord.expiresAt.getTime() - Date.now() < 5 * 60 * 1000) {
    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      await prisma.externalCalendarToken.update({
        where: { userId_provider: { userId, provider: "GOOGLE" } },
        data: {
          accessToken: credentials.access_token!,
          expiresAt: new Date(credentials.expiry_date!),
          ...(credentials.refresh_token && { refreshToken: credentials.refresh_token }),
        },
      });
      oauth2Client.setCredentials(credentials);
    } catch (err: any) {
      console.error("[CalSync] Token refresh failed:", err.message);
      return null;
    }
  }

  const calendarId = tokenRecord.calendarId || "primary";
  const timeZone = tokenRecord.timezone || "UTC";

  return { oauth2Client, calendarId, timeZone };
}

export function generateAuthUrl(userId: string, timezone = "UTC"): string {
  const oauth2Client = getOAuth2Client();
  const state = Buffer.from(JSON.stringify({ userId, ts: Date.now(), tz: timezone })).toString("base64url");
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: GOOGLE_SCOPES,
    state,
    prompt: "consent",
  });
}

export async function handleOAuthCallback(code: string, state: string): Promise<string> {
  let decoded: { userId: string; ts: number; tz?: string };
  try {
    decoded = JSON.parse(Buffer.from(state, "base64url").toString());
  } catch {
    throw new Error("Invalid OAuth state");
  }

  const { userId, ts, tz } = decoded;
  if (Date.now() - ts > 10 * 60 * 1000) throw new Error("OAuth state expired");

  const oauth2Client = getOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);

  if (!tokens.access_token) throw new Error("No access token in Google response");

  await prisma.externalCalendarToken.upsert({
    where: { userId_provider: { userId, provider: "GOOGLE" } },
    create: {
      userId,
      provider: "GOOGLE",
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || "",
      expiresAt: new Date(tokens.expiry_date || Date.now() + 3600 * 1000),
      calendarId: "primary",
      timezone: tz || "UTC",
    },
    update: {
      accessToken: tokens.access_token,
      ...(tokens.refresh_token && { refreshToken: tokens.refresh_token }),
      expiresAt: new Date(tokens.expiry_date || Date.now() + 3600 * 1000),
      ...(tz && { timezone: tz }),
    },
  });

  return userId;
}

export async function getCalendarSyncStatus(userId: string) {
  const tokens = await prisma.externalCalendarToken.findMany({
    where: { userId },
    select: { provider: true, expiresAt: true, calendarId: true, createdAt: true, updatedAt: true },
  });
  return tokens.map((t) => ({
    ...t,
    connected: true,
  }));
}

export async function disconnectProvider(userId: string, provider: "GOOGLE" | "OUTLOOK") {
  await prisma.externalCalendarToken.deleteMany({ where: { userId, provider } });
}

// ─── Appointment ─────────────────────────────────────────────────────────────

export async function syncAppointmentToGoogle(
  agentId: string,
  appointment: {
    id: string;
    scheduledAt: Date;
    endsAt: Date;
    notes?: string | null;
    location?: string | null;
    meetingLink?: string | null;
    contact?: { fullName: string } | null;
    externalEventId?: string | null;
  },
): Promise<string | null> {
  const auth = await getAuthClientForUser(agentId);
  if (!auth) return null;

  const { oauth2Client, calendarId, timeZone } = auth;
  const calendar = google.calendar({ version: "v3", auth: oauth2Client });

  const contactName = appointment.contact?.fullName || "Contact";
  const eventBody: any = {
    summary: `Appointment: ${contactName}`,
    description: appointment.notes || undefined,
    location: appointment.location || undefined,
    start: { dateTime: toLocalDateTimeString(appointment.scheduledAt, timeZone), timeZone },
    end: { dateTime: toLocalDateTimeString(appointment.endsAt, timeZone), timeZone },
    extendedProperties: {
      private: { slingvoId: appointment.id, slingvoType: "appointment" },
    },
  };

  if (appointment.meetingLink) {
    eventBody.conferenceData = {
      entryPoints: [{ entryPointType: "video", uri: appointment.meetingLink }],
    };
  }

  if (appointment.externalEventId) {
    try {
      await calendar.events.update({ calendarId, eventId: appointment.externalEventId, requestBody: eventBody });
      return appointment.externalEventId;
    } catch {
      // Fall through and create a new one if the remote event is gone
    }
  }

  const result = await calendar.events.insert({ calendarId, requestBody: eventBody });
  return result.data.id ?? null;
}

export async function deleteAppointmentFromGoogle(agentId: string, externalEventId: string): Promise<void> {
  const auth = await getAuthClientForUser(agentId);
  if (!auth) return;
  const { oauth2Client, calendarId } = auth;
  const calendar = google.calendar({ version: "v3", auth: oauth2Client });
  try {
    await calendar.events.delete({ calendarId, eventId: externalEventId });
  } catch {
    // Already deleted on Google's side — ignore
  }
}

// ─── Callback ────────────────────────────────────────────────────────────────

export async function syncCallbackToGoogle(
  agentId: string,
  callback: {
    id: string;
    scheduledAt: Date;
    notes?: string | null;
    contact?: { fullName: string } | null;
    externalEventId?: string | null;
  },
): Promise<string | null> {
  const auth = await getAuthClientForUser(agentId);
  if (!auth) return null;

  const { oauth2Client, calendarId, timeZone } = auth;
  const calendar = google.calendar({ version: "v3", auth: oauth2Client });

  const contactName = callback.contact?.fullName || "Contact";
  const start = callback.scheduledAt;
  const end = new Date(start.getTime() + 30 * 60 * 1000); // 30-min block

  const eventBody: any = {
    summary: `Callback: ${contactName}`,
    description: callback.notes || undefined,
    start: { dateTime: toLocalDateTimeString(start, timeZone), timeZone },
    end: { dateTime: toLocalDateTimeString(end, timeZone), timeZone },
    extendedProperties: {
      private: { slingvoId: callback.id, slingvoType: "callback" },
    },
  };

  if (callback.externalEventId) {
    try {
      await calendar.events.update({ calendarId, eventId: callback.externalEventId, requestBody: eventBody });
      return callback.externalEventId;
    } catch {}
  }

  const result = await calendar.events.insert({ calendarId, requestBody: eventBody });
  return result.data.id ?? null;
}

export async function deleteCallbackFromGoogle(agentId: string, externalEventId: string): Promise<void> {
  const auth = await getAuthClientForUser(agentId);
  if (!auth) return;
  const { oauth2Client, calendarId } = auth;
  const calendar = google.calendar({ version: "v3", auth: oauth2Client });
  try {
    await calendar.events.delete({ calendarId, eventId: externalEventId });
  } catch {}
}

// ─── Task ─────────────────────────────────────────────────────────────────────

export async function syncTaskToGoogle(
  agentId: string,
  task: {
    id: string;
    title: string;
    dueAt: Date;
    notes?: string | null;
    contact?: { fullName: string } | null;
    externalEventId?: string | null;
  },
): Promise<string | null> {
  const auth = await getAuthClientForUser(agentId);
  if (!auth) return null;

  const { oauth2Client, calendarId, timeZone } = auth;
  const calendar = google.calendar({ version: "v3", auth: oauth2Client });

  const descParts = [
    task.contact?.fullName ? `Contact: ${task.contact.fullName}` : null,
    task.notes,
  ].filter(Boolean);

  // Use a timed event (9am–10am) on the due date so it syncs reliably to mobile
  const dueDay = new Date(task.dueAt);
  dueDay.setHours(9, 0, 0, 0);
  const dueEnd = new Date(task.dueAt);
  dueEnd.setHours(10, 0, 0, 0);

  const eventBody: any = {
    summary: `Task: ${task.title}`,
    description: descParts.length ? descParts.join("\n") : undefined,
    start: { dateTime: toLocalDateTimeString(dueDay, timeZone), timeZone },
    end: { dateTime: toLocalDateTimeString(dueEnd, timeZone), timeZone },
    extendedProperties: {
      private: { slingvoId: task.id, slingvoType: "task" },
    },
  };

  if (task.externalEventId) {
    try {
      await calendar.events.update({ calendarId, eventId: task.externalEventId, requestBody: eventBody });
      return task.externalEventId;
    } catch {}
  }

  const result = await calendar.events.insert({ calendarId, requestBody: eventBody });
  return result.data.id ?? null;
}

export async function deleteTaskFromGoogle(agentId: string, externalEventId: string): Promise<void> {
  const auth = await getAuthClientForUser(agentId);
  if (!auth) return;
  const { oauth2Client, calendarId } = auth;
  const calendar = google.calendar({ version: "v3", auth: oauth2Client });
  try {
    await calendar.events.delete({ calendarId, eventId: externalEventId });
  } catch {}
}

// ─── Calendar (internal Calendar model) ──────────────────────────────────────

export async function syncCalendarEventToGoogle(
  userId: string,
  event: {
    id: string;
    title: string;
    description?: string | null;
    startDate: Date;
    endDate?: Date | null;
    category?: string;
    externalEventId?: string | null;
  },
): Promise<string | null> {
  const auth = await getAuthClientForUser(userId);
  if (!auth) return null;

  const { oauth2Client, calendarId, timeZone } = auth;
  const calendar = google.calendar({ version: "v3", auth: oauth2Client });

  const start = event.startDate;
  const end = event.endDate ?? new Date(start.getTime() + 60 * 60 * 1000);

  const eventBody: any = {
    summary: event.title,
    description: event.description || undefined,
    start: { dateTime: toLocalDateTimeString(start, timeZone), timeZone },
    end: { dateTime: toLocalDateTimeString(end, timeZone), timeZone },
    extendedProperties: {
      private: { slingvoId: event.id, slingvoType: event.category?.toLowerCase() || "event" },
    },
  };

  if (event.externalEventId) {
    try {
      await calendar.events.update({ calendarId, eventId: event.externalEventId, requestBody: eventBody });
      return event.externalEventId;
    } catch {}
  }

  const result = await calendar.events.insert({ calendarId, requestBody: eventBody });
  return result.data.id ?? null;
}

export async function deleteCalendarEventFromGoogle(userId: string, externalEventId: string): Promise<void> {
  const auth = await getAuthClientForUser(userId);
  if (!auth) return;
  const { oauth2Client, calendarId } = auth;
  const calendar = google.calendar({ version: "v3", auth: oauth2Client });
  try {
    await calendar.events.delete({ calendarId, eventId: externalEventId });
  } catch {}
}
