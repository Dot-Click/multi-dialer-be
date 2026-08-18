import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import prisma from "../../../lib/prisma";
import { encryptSmtpPassword, decryptSmtpPassword } from "../../../utils/encryption";

function throwHttp(statusCode: number, message: string): never {
  throw { message, statusCode };
}

const MASKED_PASSWORD = "••••••";

// Resolves the company for the acting user — agents use their creating
// admin/owner's company, mirroring the pattern used for other integrations.
export async function resolveCompanyIdForUser(userId: string, role: string, createdById: string | null | undefined) {
  const targetUserId = role === "AGENT" && createdById ? createdById : userId;
  const company = await prisma.company.findFirst({
    where: { userId: targetUserId },
    select: { id: true },
  });
  if (!company) throwHttp(404, "No company found for this account. Please set up your company first.");
  return company.id;
}

export async function getSmtpConfigFromDb(companyId: string) {
  const config = await prisma.smtpConfig.findUnique({ where: { companyId } });
  if (!config) return null;

  const { password, ...rest } = config;
  return { ...rest, password: MASKED_PASSWORD };
}

export async function upsertSmtpConfigInDb(companyId: string, payload: {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password?: string;
  fromName: string;
  fromEmail: string;
}) {
  const existing = await prisma.smtpConfig.findUnique({ where: { companyId }, select: { password: true } });

  // On create a password is required; on update it's optional — omitting it keeps the stored one.
  if (!existing && !payload.password) {
    throwHttp(400, "Password is required when setting up SMTP for the first time.");
  }

  const encryptedPassword = payload.password
    ? encryptSmtpPassword(payload.password)
    : existing!.password;

  const config = await prisma.smtpConfig.upsert({
    where: { companyId },
    update: {
      host: payload.host,
      port: payload.port,
      secure: payload.secure,
      username: payload.username,
      password: encryptedPassword,
      fromName: payload.fromName,
      fromEmail: payload.fromEmail,
      isVerified: false,
      verifiedAt: null,
    },
    create: {
      companyId,
      host: payload.host,
      port: payload.port,
      secure: payload.secure,
      username: payload.username,
      password: encryptedPassword,
      fromName: payload.fromName,
      fromEmail: payload.fromEmail,
    },
  });

  const { password, ...rest } = config;
  return { ...rest, password: MASKED_PASSWORD };
}

export async function deleteSmtpConfigFromDb(companyId: string) {
  const existing = await prisma.smtpConfig.findUnique({ where: { companyId }, select: { id: true } });
  if (!existing) throwHttp(404, "SMTP configuration not found");

  await prisma.smtpConfig.delete({ where: { companyId } });
  return true;
}

export async function testSmtpConfigInDb(companyId: string, testRecipientEmail: string) {
  const config = await prisma.smtpConfig.findUnique({ where: { companyId } });
  if (!config) throwHttp(404, "SMTP configuration not found. Save your settings first.");

  try {
    const smtpSecure = config.port === 465 ? true : false;
    // `family: 4` is accepted by nodemailer at runtime (forwarded to
    // net.createConnection) but is not declared on SMTPTransport.Options,
    // so we cast to bypass the excess-property check. Without this cast
    // TypeScript falls through to the generic TransportOptions overload
    // and complains about `host` not existing — misleading, since the
    // real mismatch is `family`.
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: smtpSecure,
      requireTLS: !smtpSecure,
      tls: { rejectUnauthorized: false },
      auth: {
        user: config.username,
        pass: decryptSmtpPassword(config.password),
      },
      // Nodemailer's defaults (2min connect, 10min socket) leave "Save &
      // Test" hanging that long when a host silently drops the connection
      // instead of rejecting it cleanly — fail fast instead so the UI gets
      // a quick answer.
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
      // Force IPv4 at the socket layer. Railway has no outbound IPv6 route,
      // and dns.setDefaultResultOrder("ipv4first") only reorders DNS results
      // — if anything downstream still picks an IPv6 address (OS getaddrinfo
      // quirks, nodemailer's own dns.lookup call, etc.) the connection fails
      // instantly with ENETUNREACH. `family: 4` is passed straight through
      // to net.createConnection and skips the AAAA lookup entirely.
      family: 4,
    } as SMTPTransport.Options);

    await transporter.verify();

    await transporter.sendMail({
      from: `${config.fromName} <${config.fromEmail}>`,
      to: testRecipientEmail,
      subject: "Your SMTP connection is working",
      text: "This is a test email confirming your SMTP configuration is set up correctly.",
      html: "<p>This is a test email confirming your SMTP configuration is set up correctly.</p>",
    });

    await prisma.smtpConfig.update({
      where: { companyId },
      data: { isVerified: true, verifiedAt: new Date() },
    });

    return { success: true };
  } catch (error: any) {
    await prisma.smtpConfig.update({
      where: { companyId },
      data: { isVerified: false, verifiedAt: null },
    });

    return { success: false, error: error?.message || "Failed to send test email with the provided SMTP settings." };
  }
}
