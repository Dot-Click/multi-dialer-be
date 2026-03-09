import prisma from "../../lib/prisma";

export const calendarInclude = {
  assignTo: {
    select: {
      id: true,
      fullName: true,
      email: true,
    },
  },
  assignBy: {
    select: {
      id: true,
      fullName: true,
      email: true,
    },
  },
};

export async function insertCalendarEventInDb(data: any) {
  return prisma.calendar.create({ data });
}

