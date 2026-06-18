import { startAppointmentReminderJob } from "./appointmentReminder.job";
import { startDialerHealthJob } from "./dialerHealth.job";
import { startCallbackDueJob } from "./callbackDue.job";

/**
 * Initialize all core background jobs.
 */
export const initJobs = () => {
    console.log("[Jobs] Initializing background tasks...");
    startAppointmentReminderJob();
    startDialerHealthJob();
    startCallbackDueJob();
};
