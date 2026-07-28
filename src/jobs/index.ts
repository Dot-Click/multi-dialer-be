import { startAppointmentReminderJob } from "./appointmentReminder.job";
import { startDialerHealthJob } from "./dialerHealth.job";
import { startCallbackDueJob } from "./callbackDue.job";
import { startUserLifecycleJob } from "./userLifecycle.job";
import { startEmailQueueJob } from "./emailQueue.job";

/**
 * Initialize all core background jobs.
 */
export const initJobs = () => {
    console.log("[Jobs] Initializing background tasks...");
    startAppointmentReminderJob();
    startDialerHealthJob();
    startCallbackDueJob();
    startUserLifecycleJob();
    startEmailQueueJob();
};
