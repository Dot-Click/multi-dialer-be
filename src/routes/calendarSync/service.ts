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

// ═══════════════════════════════════════════════════════════════════════════════
// OUTLOOK / MICROSOFT GRAPH
// ═══════════════════════════════════════════════════════════════════════════════

const OUTLOOK_SCOPES = ["Calendars.ReadWrite", "offline_access", "User.Read"];
const OUTLOOK_AUTH_ENDPOINT = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const OUTLOOK_TOKEN_ENDPOINT = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

function getOutlookConfig() {
  return {
    clientId: process.env.OUTLOOK_CLIENT_ID!,
    clientSecret: process.env.OUTLOOK_CLIENT_SECRET!,
    redirectUri: process.env.OUTLOOK_REDIRECT_URI!,
  };
}

async function graphRequest(accessToken: string, method: string, path: string, body?: any): Promise<any> {
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (res.status === 204) return null;
  if (!res.ok) {
    const err: any = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Graph API error: ${res.status}`);
  }
  return res.json();
}

async function getOutlookAccessToken(userId: string): Promise<string | null> {
  const tokenRecord = await prisma.externalCalendarToken.findUnique({
    where: { userId_provider: { userId, provider: "OUTLOOK" } },
  });
  if (!tokenRecord) return null;

  if (tokenRecord.expiresAt.getTime() - Date.now() < 5 * 60 * 1000) {
    try {
      const { clientId, clientSecret, redirectUri } = getOutlookConfig();
      const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: tokenRecord.refreshToken,
        redirect_uri: redirectUri,
        grant_type: "refresh_token",
      });
      const res = await fetch(OUTLOOK_TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      if (!res.ok) throw new Error("Refresh failed");
      const data: any = await res.json();
      await prisma.externalCalendarToken.update({
        where: { userId_provider: { userId, provider: "OUTLOOK" } },
        data: {
          accessToken: data.access_token,
          expiresAt: new Date(Date.now() + data.expires_in * 1000),
          ...(data.refresh_token && { refreshToken: data.refresh_token }),
        },
      });
      return data.access_token;
    } catch (err: any) {
      console.error("[CalSync] Outlook token refresh failed:", err.message);
      return null;
    }
  }

  return tokenRecord.accessToken;
}

export function generateOutlookAuthUrl(userId: string, timezone = "UTC"): string {
  const { clientId, redirectUri } = getOutlookConfig();
  const state = Buffer.from(JSON.stringify({ userId, ts: Date.now(), tz: timezone })).toString("base64url");
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: OUTLOOK_SCOPES.join(" "),
    state,
    prompt: "consent",
  });
  return `${OUTLOOK_AUTH_ENDPOINT}?${params.toString()}`;
}

export async function handleOutlookOAuthCallback(code: string, state: string): Promise<string> {
  let decoded: { userId: string; ts: number; tz?: string };
  try {
    decoded = JSON.parse(Buffer.from(state, "base64url").toString());
  } catch {
    throw new Error("Invalid OAuth state");
  }

  const { userId, ts, tz } = decoded;
  if (Date.now() - ts > 10 * 60 * 1000) throw new Error("OAuth state expired");

  const { clientId, clientSecret, redirectUri } = getOutlookConfig();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  const res = await fetch(OUTLOOK_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`Outlook token exchange failed: ${res.statusText}`);
  const tokens: any = await res.json();

  if (!tokens.access_token) throw new Error("No access token in Outlook response");

  await prisma.externalCalendarToken.upsert({
    where: { userId_provider: { userId, provider: "OUTLOOK" } },
    create: {
      userId,
      provider: "OUTLOOK",
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || "",
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      calendarId: "primary",
      timezone: tz || "UTC",
    },
    update: {
      accessToken: tokens.access_token,
      ...(tokens.refresh_token && { refreshToken: tokens.refresh_token }),
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      ...(tz && { timezone: tz }),
    },
  });

  return userId;
}

// ─── Outlook Appointment ──────────────────────────────────────────────────────

export async function syncAppointmentToOutlook(
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
  const accessToken = await getOutlookAccessToken(agentId);
  if (!accessToken) return null;

  const contactName = appointment.contact?.fullName || "Contact";
  const eventBody: any = {
    subject: `Appointment: ${contactName}`,
    body: { contentType: "text", content: appointment.notes || "" },
    start: { dateTime: appointment.scheduledAt.toISOString().replace("Z", ""), timeZone: "UTC" },
    end: { dateTime: appointment.endsAt.toISOString().replace("Z", ""), timeZone: "UTC" },
    ...(appointment.location ? { location: { displayName: appointment.location } } : {}),
    ...(appointment.meetingLink
      ? { onlineMeeting: { joinUrl: appointment.meetingLink } }
      : {}),
  };

  if (appointment.externalEventId) {
    try {
      await graphRequest(accessToken, "PATCH", `/me/events/${appointment.externalEventId}`, eventBody);
      return appointment.externalEventId;
    } catch {}
  }

  const result = await graphRequest(accessToken, "POST", "/me/events", eventBody);
  return result?.id ?? null;
}

export async function deleteAppointmentFromOutlook(agentId: string, externalEventId: string): Promise<void> {
  const accessToken = await getOutlookAccessToken(agentId);
  if (!accessToken) return;
  try {
    await graphRequest(accessToken, "DELETE", `/me/events/${externalEventId}`);
  } catch {}
}

// ─── Outlook Callback ─────────────────────────────────────────────────────────

export async function syncCallbackToOutlook(
  agentId: string,
  callback: {
    id: string;
    scheduledAt: Date;
    notes?: string | null;
    contact?: { fullName: string } | null;
    externalEventId?: string | null;
  },
): Promise<string | null> {
  const accessToken = await getOutlookAccessToken(agentId);
  if (!accessToken) return null;

  const contactName = callback.contact?.fullName || "Contact";
  const start = callback.scheduledAt;
  const end = new Date(start.getTime() + 30 * 60 * 1000);

  const eventBody = {
    subject: `Callback: ${contactName}`,
    body: { contentType: "text", content: callback.notes || "" },
    start: { dateTime: start.toISOString().replace("Z", ""), timeZone: "UTC" },
    end: { dateTime: end.toISOString().replace("Z", ""), timeZone: "UTC" },
  };

  if (callback.externalEventId) {
    try {
      await graphRequest(accessToken, "PATCH", `/me/events/${callback.externalEventId}`, eventBody);
      return callback.externalEventId;
    } catch {}
  }

  const result = await graphRequest(accessToken, "POST", "/me/events", eventBody);
  return result?.id ?? null;
}

export async function deleteCallbackFromOutlook(agentId: string, externalEventId: string): Promise<void> {
  const accessToken = await getOutlookAccessToken(agentId);
  if (!accessToken) return;
  try {
    await graphRequest(accessToken, "DELETE", `/me/events/${externalEventId}`);
  } catch {}
}

// ─── Outlook Task ─────────────────────────────────────────────────────────────

export async function syncTaskToOutlook(
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
  const accessToken = await getOutlookAccessToken(agentId);
  if (!accessToken) return null;

  const descParts = [
    task.contact?.fullName ? `Contact: ${task.contact.fullName}` : null,
    task.notes,
  ].filter(Boolean);

  const dueDay = new Date(task.dueAt);
  dueDay.setUTCHours(9, 0, 0, 0);
  const dueEnd = new Date(task.dueAt);
  dueEnd.setUTCHours(10, 0, 0, 0);

  const eventBody = {
    subject: `Task: ${task.title}`,
    body: { contentType: "text", content: descParts.join("\n") },
    start: { dateTime: dueDay.toISOString().replace("Z", ""), timeZone: "UTC" },
    end: { dateTime: dueEnd.toISOString().replace("Z", ""), timeZone: "UTC" },
  };

  if (task.externalEventId) {
    try {
      await graphRequest(accessToken, "PATCH", `/me/events/${task.externalEventId}`, eventBody);
      return task.externalEventId;
    } catch {}
  }

  const result = await graphRequest(accessToken, "POST", "/me/events", eventBody);
  return result?.id ?? null;
}

export async function deleteTaskFromOutlook(agentId: string, externalEventId: string): Promise<void> {
  const accessToken = await getOutlookAccessToken(agentId);
  if (!accessToken) return;
  try {
    await graphRequest(accessToken, "DELETE", `/me/events/${externalEventId}`);
  } catch {}
}

// ─── Outlook Calendar Event ───────────────────────────────────────────────────

export async function syncCalendarEventToOutlook(
  userId: string,
  event: {
    id: string;
    title: string;
    description?: string | null;
    startDate: Date;
    endDate?: Date | null;
    externalEventId?: string | null;
  },
): Promise<string | null> {
  const accessToken = await getOutlookAccessToken(userId);
  if (!accessToken) return null;

  const start = event.startDate;
  const end = event.endDate ?? new Date(start.getTime() + 60 * 60 * 1000);

  const eventBody = {
    subject: event.title,
    body: { contentType: "text", content: event.description || "" },
    start: { dateTime: start.toISOString().replace("Z", ""), timeZone: "UTC" },
    end: { dateTime: end.toISOString().replace("Z", ""), timeZone: "UTC" },
  };

  if (event.externalEventId) {
    try {
      await graphRequest(accessToken, "PATCH", `/me/events/${event.externalEventId}`, eventBody);
      return event.externalEventId;
    } catch {}
  }

  const result = await graphRequest(accessToken, "POST", "/me/events", eventBody);
  return result?.id ?? null;
}

export async function deleteCalendarEventFromOutlook(userId: string, externalEventId: string): Promise<void> {
  const accessToken = await getOutlookAccessToken(userId);
  if (!accessToken) return;
  try {
    await graphRequest(accessToken, "DELETE", `/me/events/${externalEventId}`);
  } catch {}
}
