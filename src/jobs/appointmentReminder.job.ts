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
            include: {
              systemSettings: {
                include: {
                  notificationSetting: true,
                },
              },
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
          // Calculate when the reminder should trigger
          // Use the creator's reminderMinutes as the threshold if available, else default to 15
          const creatorSettings = event.assignBy.systemSettings?.[0]?.notificationSetting;
          const assigneeSettings = event.assignTo.systemSettings?.[0]?.notificationSetting;
          
          const reminderMinutes = creatorSettings?.reminderMinutes ?? assigneeSettings?.reminderMinutes ?? 15;
          const reminderTime = new Date(event.startDate.getTime() - (reminderMinutes * 60000));

          if (now >= reminderTime) {
            console.log(`[Job] Triggering reminder for event: ${event.title}`);
            const categoryLabel = (event.category || 'TASK').toLowerCase().replace('_', ' ');
            const startTimeStr = event.startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            // 1. Notify Assignee (Agent)
            if (assigneeSettings) {
                const shouldNotifyAgent = (assigneeSettings.inAppChannel || assigneeSettings.appointmentNotification) && 
                    (event.category !== 'FOLLOW_UP' || assigneeSettings.followUpCallEvent) &&
                    (event.category !== 'APPOINTMENT' || assigneeSettings.scheduledMeetingEvent);

                if (shouldNotifyAgent) {
                    await createInternalNotification(
                      event.assignToId,
                      `⏰ Reminder: ${event.title}`,
                      `Your ${categoryLabel} is scheduled in ${reminderMinutes} minutes at ${startTimeStr}.`,
                      'event'
                    );

                    // Email for agent if enabled
                    if (assigneeSettings.appointmentReminder && assigneeSettings.appointmentReminderEmail) {
                        try {
                            const htmlContent = getBaseEmailTemplate("Appointment Reminder", `
                                <p>Hello ${event.assignTo.fullName || 'there'},</p>
                                <p>This is a reminder for your upcoming ${categoryLabel}:</p>
                                <div class="info-card">
                                    <div class="info-item"><span class="info-label">Event:</span><span class="info-value highlight">${event.title}</span></div>
                                    <div class="info-item"><span class="info-label">Time:</span><span class="info-value">${event.startDate.toLocaleString()}</span></div>
                                </div>
                            `);
                            await sendEmail({
                                to: assigneeSettings.appointmentReminderEmail,
                                from: event.assignBy.email,
                                subject: `⏰ Reminder: ${event.title}`,
                                text: `Reminder: ${event.title} starting soon.`,
                                html: htmlContent,
                            });
                        } catch (e) { console.error("Agent email failed:", e); }
                    }
                }
            }

            // 2. Notify Creator (Admin/Organizer)
            if (creatorSettings && creatorSettings.appointmentNotification && event.assignById !== event.assignToId) {
                await createInternalNotification(
                  event.assignById,
                  `⏰ Reminder (As Organizer): ${event.title}`,
                  `The ${categoryLabel} you scheduled for ${event.assignTo.fullName || 'the agent'} starts in ${reminderMinutes} minutes.`,
                  'event'
                );

                // Admin email if enabled
                if (creatorSettings.appointmentReminder && creatorSettings.appointmentReminderEmail) {
                    try {
                        const htmlContent = getBaseEmailTemplate("Appointment Reminder (Organizer)", `
                            <p>Hello,</p>
                            <p>An appointment you organized is starting soon:</p>
                            <div class="info-card">
                                <div class="info-item"><span class="info-label">Event:</span><span class="info-value highlight">${event.title}</span></div>
                                <div class="info-item"><span class="info-label">Assignee:</span><span class="info-value">${event.assignTo.fullName}</span></div>
                                <div class="info-item"><span class="info-label">Time:</span><span class="info-value">${event.startDate.toLocaleString()}</span></div>
                            </div>
                        `);
                        await sendEmail({
                            to: creatorSettings.appointmentReminderEmail,
                            from: "system@multidialer.com",
                            subject: `⏰ Organizer Reminder: ${event.title}`,
                            text: `Reminder: ${event.title} you organized is starting soon.`,
                            html: htmlContent,
                        });
                    } catch (e) { console.error("Admin organizer email failed:", e); }
                }
            }

            // 3. Mark as sent
            await prisma.calendar.update({
              where: { id: event.id },
              data: { reminderSent: true }
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
