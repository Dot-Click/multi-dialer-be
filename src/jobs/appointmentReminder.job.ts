import cron from "node-cron";
import prisma from "../lib/prisma";
import { createInternalNotification } from "../routes/notification/controller";
import { sendEmail, getBaseEmailTemplate } from "../services/email.service";
import { resolveCompanyContext } from "../utils/resolveCompany";

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
                            const { companyId } = await resolveCompanyContext(event.assignToId);
                            await sendEmail({
                                to: assigneeSettings.appointmentReminderEmail,
                                from: event.assignTo.email,
                                replyToEmail: event.assignTo.email,
                                companyId,
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
                        const { companyId } = await resolveCompanyContext(event.assignById);
                        await sendEmail({
                            to: creatorSettings.appointmentReminderEmail,
                            from: "system@multidialer.com",
                            replyToEmail: event.assignBy.email,
                            companyId,
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

      // ── Task reminders ──────────────────────────────────────────────────
      // Send a reminder for tasks coming due within 30 minutes (once each).
      const taskReminderWindow = new Date(now.getTime() + 30 * 60 * 1000);
      const dueTasks = await prisma.task.findMany({
        where: {
          reminderSent: false,
          status: { in: ["OPEN", "IN_PROGRESS"] },
          dueAt: { gt: now, lte: taskReminderWindow },
        },
        include: {
          contact: { select: { fullName: true } },
          agent: {
            select: {
              id: true,
              email: true,
              fullName: true,
              systemSettings: { include: { notificationSetting: true } },
            },
          },
        },
      });

      for (const task of dueTasks) {
        try {
          const dueStr = task.dueAt.toLocaleString();
          const contactName = task.contact?.fullName ? ` for ${task.contact.fullName}` : "";

          // In-app notification for the assigned agent.
          await createInternalNotification(
            task.agentId,
            `⏰ Task due soon: ${task.title}`,
            `Your task${contactName} is due at ${dueStr}.`,
            "event"
          );

          // Reminder email — to the configured reminder address if set, else the
          // agent's own email. Uses the existing SES-backed email service.
          const settings = task.agent.systemSettings?.[0]?.notificationSetting;
          const toEmail = settings?.appointmentReminderEmail || task.agent.email;
          if (toEmail) {
            try {
              const htmlContent = getBaseEmailTemplate("Task Reminder", `
                <p>Hello ${task.agent.fullName || "there"},</p>
                <p>This is a reminder for an upcoming task:</p>
                <div class="info-card">
                    <div class="info-item"><span class="info-label">Task:</span><span class="info-value highlight">${task.title}</span></div>
                    <div class="info-item"><span class="info-label">Due:</span><span class="info-value">${dueStr}</span></div>
                    ${task.contact?.fullName ? `<div class="info-item"><span class="info-label">Contact:</span><span class="info-value">${task.contact.fullName}</span></div>` : ""}
                    ${task.notes ? `<div class="info-item"><span class="info-label">Notes:</span><span class="info-value">${task.notes}</span></div>` : ""}
                </div>
              `);
              const { companyId } = await resolveCompanyContext(task.agentId);
              await sendEmail({
                to: toEmail,
                from: "system@multidialer.com",
                replyToEmail: task.agent.email,
                companyId,
                subject: `⏰ Task due soon: ${task.title}`,
                text: `Reminder: your task "${task.title}" is due at ${dueStr}.`,
                html: htmlContent,
              });
            } catch (e) {
              console.error(`[Job] Task reminder email failed for task ${task.id}:`, e);
            }
          }

          await prisma.task.update({
            where: { id: task.id },
            data: { reminderSent: true },
          });
        } catch (taskError) {
          console.error(`[Job] Error processing task ${task.id}:`, taskError);
        }
      }
    } catch (error) {
      console.error("[Job] Critical error in Appointment Reminder Job:", error);
    }
  });
};
