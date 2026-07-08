import prisma from "../lib/prisma";
import { deleteFromR2 } from "../utils/r2-uploader";

/**
 * Deletes every R2 (Cloudflare) object owned by a user before their account
 * row is removed — the DB rows referencing these files cascade-delete on
 * user delete, but Postgres cascade only removes rows, it never reaches
 * Cloudflare, so the actual files would otherwise be orphaned forever.
 *
 * Covers: library recordings (on-hold music, voicemail greetings, IVR, etc.),
 * call recordings copied from Twilio into R2, and the user's profile image.
 * Best-effort — individual failures are logged (inside deleteFromR2) but never
 * thrown, so a storage hiccup never blocks the actual user deletion.
 */
export async function releaseR2ResourcesForUser(userId: string): Promise<void> {
  const [recordings, callRecords, user] = await Promise.all([
    prisma.recording.findMany({ where: { userId }, select: { url: true } }),
    prisma.callRecord.findMany({
      where: { userId, recordingUrl: { not: null } },
      select: { recordingUrl: true },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { image: true } }),
  ]);

  for (const recording of recordings) {
    await deleteFromR2(recording.url);
  }

  for (const callRecord of callRecords) {
    await deleteFromR2(callRecord.recordingUrl);
  }

  if (user?.image) {
    await deleteFromR2(user.image);
  }
}
