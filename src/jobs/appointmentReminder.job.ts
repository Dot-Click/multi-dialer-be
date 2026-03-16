import cron from "node-cron";
import prisma from "../lib/prisma";
import { sendEmail, getBaseEmailTemplate } from "../services/email.service";

/**
 * Appointment Reminder Job
 * Runs every 5 minutes to check for upcoming events in the next hour.
 */
export const startAppointmentReminderJob = () => {
  cron.schedule("*/5 * * * *", async () => {
    console.log("[Job] Running Appointment Reminder Check...");

    try {
      const now = new Date();
      const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);

      // 1. Find upcoming calendar events
      const upcomingEvents = await prisma.calendar.findMany({
        where: {
          startDate: {
            gt: now,
            lte: oneHourFromNow,
          },
          reminderSent: false,
          status: "SET",
        },
        include: {
          assignBy: {
            select: {
              email: true,
              fullName: true,
            },
          },
          assignTo: {
            include: {
              systemSettings: {
                include: {
                  notificationSetting: true,
                },
              },
            },
          },
        },
      });

      if (upcomingEvents.length === 0) {
        console.log("[Job] No upcoming appointments requiring reminders.");
        return;
      }

      console.log(`[Job] Found ${upcomingEvents.length} upcoming appointments.`);

      for (const event of upcomingEvents) {
        try {
          // Get the NotificationSetting for the recipient (assignTo)
          const settings = event.assignTo.systemSettings?.[0]?.notificationSetting;

          if (!settings || !settings.appointmentReminder) {
            console.log(`[Job] Reminders disabled for recipient of event: ${event.id}`);
            // Still mark as sent so we don't keep checking it
            await prisma.calendar.update({
              where: { id: event.id },
              data: { reminderSent: true },
            });
            continue;
          }

          const targetEmail = settings.appointmentReminderEmail;

          if (!targetEmail) {
            console.log(`[Job] No reminder email configured for event: ${event.id}`);
            await prisma.calendar.update({
              where: { id: event.id },
              data: { reminderSent: true },
            });
            continue;
          }

          // 2. Validate that the appointmentReminderEmail exists in the User table
          const existingUser = await prisma.user.findUnique({
            where: { email: targetEmail },
          });

          if (!existingUser) {
            console.log(`[Job] Target email ${targetEmail} not found in User table. Skipping reminder for event: ${event.id}`);
            await prisma.calendar.update({
              where: { id: event.id },
              data: { reminderSent: true },
            });
            continue;
          }

          const senderEmail = event.assignBy.email; // Creator's email
          const eventTime = new Date(event.startDate).toLocaleString();

          const htmlContent = getBaseEmailTemplate(
            "Appointment Reminder",
            `
            <p>Hello,</p>
            <p>This is a reminder for your upcoming appointment scheduled in the next hour. Please find the details below:</p>
            <div class="info-card">
              <div class="info-item">
                <span class="info-label">Event:</span>
                <span class="info-value highlight">${event.title}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Date/Time:</span>
                <span class="info-value">${eventTime}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Organizer:</span>
                <span class="info-value">${event.assignBy.fullName || "Dialer Admin"}</span>
              </div>
              ${event.description ? `
              <div class="info-item" style="margin-top: 15px;">
                <span class="info-label" style="display: block; width: 100%;">Description:</span>
                <span class="info-value" style="display: block; margin-top: 5px; color: #64748b; font-style: italic;">${event.description}</span>
              </div>` : ""}
            </div>
            <p>If you need to reschedule, please log in to your dashboard.</p>
            `
          );

          const emailResult = await sendEmail({
            to: targetEmail,
            from: senderEmail,
            fromName: event.assignBy.fullName || "Dialer Reminder",
            subject: `⏰ Reminder: ${event.title}`,
            text: `Reminder: ${event.title} at ${eventTime}. Description: ${event.description || "None"}`,
            html: htmlContent,
          });

          if (emailResult.success) {
            // 4. Mark as sent to prevent duplicates
            await prisma.calendar.update({
              where: { id: event.id },
              data: { reminderSent: true },
            });
            console.log(`[Job] Successfully sent reminder for event: ${event.id}`);
          }
        } catch (eventError) {
          console.error(`[Job] Error processing event ${event.id}:`, eventError);
        }
      }
    } catch (error) {
      console.error("[Job] Critical error in Appointment Reminder Job:", error);
    }
  });
};
