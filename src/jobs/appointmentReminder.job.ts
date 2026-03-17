import cron from "node-cron";
import prisma from "../lib/prisma";
import { createInternalNotification } from "../routes/notification/controller";
import { sendEmail, getBaseEmailTemplate } from "../services/email.service";

/**
 * Appointment Reminder Job
 * Runs every minute to check for upcoming events and sends reminders based on user settings.
 */
export const startAppointmentReminderJob = () => {
  cron.schedule("* * * * *", async () => {
    console.log("[Job] Running Appointment Reminder Check...");

    try {
      const now = new Date();
      // Increase buffer slightly to catch events accurately
      const buffer = new Date(now.getTime() + 2 * 60 * 1000); 

      // 1. Find upcoming calendar events that haven't had a reminder sent
      const upcomingEvents = await prisma.calendar.findMany({
        where: {
          startDate: {
            gt: now
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
        return;
      }

      for (const event of upcomingEvents) {
        try {
          const settings = event.assignTo.systemSettings?.[0]?.notificationSetting;

          // Default to 15 minutes if not set, or skip if fully disabled
          if (!settings || (!settings.inAppChannel && !settings.appointmentReminder)) {
            continue;
          }

          // Respect specific category toggles
          if (event.category === 'FOLLOW_UP' && !settings.followUpCallEvent) continue;
          if (event.category === 'APPOINTMENT' && !settings.scheduledMeetingEvent) continue;

          const reminderMinutes = settings.reminderMinutes || 0;
          const reminderTime = new Date(event.startDate.getTime() - reminderMinutes * 60000);

          // If current time reached the reminder threshold
          if (now >= reminderTime) {
            console.log(`[Job] Triggering reminder for event: ${event.title} to user ${event.assignTo.email}`);

            // A. In-App & Push Notification
            if (settings.inAppChannel) {
                const categoryLabel = (event.category || 'TASK').toLowerCase().replace('_', ' ');
                await createInternalNotification(
                  event.assignToId,
                  `⏰ Reminder: ${event.title}`,
                  `Your ${categoryLabel} is scheduled in ${reminderMinutes} minutes at ${event.startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`,
                  'event'
                );
            }

            // B. Email Notification
            if (settings.appointmentReminder && settings.appointmentReminderEmail) {
                const eventTime = new Date(event.startDate).toLocaleString();
                const htmlContent = getBaseEmailTemplate(
                  "Appointment Reminder",
                  `
                  <p>Hello,</p>
                  <p>This is a reminder for your upcoming appointment. Please find the details below:</p>
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
                  </div>
                  `
                );

                await sendEmail({
                  to: settings.appointmentReminderEmail,
                  from: event.assignBy.email,
                  fromName: event.assignBy.fullName || "Dialer Reminder",
                  subject: `⏰ Reminder: ${event.title}`,
                  text: `Reminder: ${event.title} at ${eventTime}.`,
                  html: htmlContent,
                });
            }

            // 4. Mark as sent to prevent duplicates
            await prisma.calendar.update({
              where: { id: event.id },
              data: { reminderSent: true },
            });
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
