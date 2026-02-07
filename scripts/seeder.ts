import prisma from "../src/lib/prisma";
import { faker } from "@faker-js/faker";
import { 
  UserRole, UserStatus, Plan, Status, BillingCycle, 
  SubscriptionStatus, TeamAccess, MediaType, FileCategory, 
  EventType, PhoneType, IntegrationProvider, IntegrationStatus,
  ActionSchedType, ActionStepType, ActionTriggerType, ActionEndLogic,
  LeadSheetQuestionType, LeadCallStatus, RecordingType
} from "@prisma/client";
import bcrypt from "bcrypt";

async function cleanDb() {
  console.log("Cleaning database...");
  const tablenames = await prisma.$queryRaw<
    Array<{ tablename: string }>
  >`SELECT tablename FROM pg_tables WHERE schemaname='public'`;

  const tables = tablenames
    .map(({ tablename }) => tablename)
    .filter((name) => name !== "_prisma_migrations")
    .map((name) => `"public"."${name}"`)
    .join(", ");

  try {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables} CASCADE;`);
    console.log("Database cleaned.");
  } catch (error) {
    console.log("Error cleaning database (might be empty):", error);
  }
}

async function main() {
  await cleanDb();

  const password = await bcrypt.hash("Password123!", 10);

  console.log(" Seeding Users...");
  // 1. Create Users
  const users = await Promise.all([
    prisma.user.create({
      data: {
        email: "admin@example.com",
        fullName: "Super Admin",
        emailVerified: true,
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
      },
    }),
    prisma.user.create({
      data: {
        email: "owner@example.com",
        fullName: "Business Owner",
        emailVerified: true,
        role: UserRole.OWNER,
        status: UserStatus.ACTIVE,
      },
    }),
    ...Array.from({ length: 5 }).map((_, i) =>
      prisma.user.create({
        data: {
          email: faker.internet.email(),
          fullName: faker.person.fullName(),
          emailVerified: true,
          role: UserRole.AGENT,
          status: UserStatus.ACTIVE,
        },
      })
    ),
  ]);

  const admin = users[0];
  const owner = users[1];
  const agents = users.slice(2);

  console.log("Seeding BetterAuth Tables...");
  for (const user of users) {
    // Session
    await prisma.session.create({
      data: {
        token: faker.string.uuid(),
        expiresAt: faker.date.future(),
        userId: user.id,
        ipAddress: faker.internet.ip(),
        userAgent: faker.internet.userAgent(),
      },
    });

    // Account
    await prisma.account.create({
      data: {
        accountId: faker.string.uuid(),
        providerId: "credential",
        password,
        userId: user.id,
        accessToken: faker.string.alphanumeric(40),
      },
    });
  }

  // Verifications
  for (let i = 0; i < 10; i++) {
    await prisma.verification.create({
      data: {
        identifier: faker.internet.email(),
        value: faker.string.numeric(6),
        expiresAt: faker.date.future(),
      },
    });
  }

  console.log("Seeding Companies & Settings...");
  for (const user of users) {
    // 1. Create Company
    await prisma.company.create({
      data: {
        companyName: faker.company.name(),
        userId: user.id,
        defaultTimeZone: "UTC",
      },
    });

    // 2. Wait for middleware or fetch auto-created records
    // Since seeder is fast, we might need a small delay or just find them
    let systemSetting = await prisma.system_Setting.findFirst({
      where: { userId: user.id },
    });

    if (!systemSetting) {
      systemSetting = await prisma.system_Setting.create({
        data: { userId: user.id },
      });
    }

    // Upsert defaults for System Settings (middleware handles some, but let's be safe)
    await prisma.appearance.upsert({
      where: { systemSettingId: systemSetting.id },
      update: {},
      create: { systemSettingId: systemSetting.id },
    });
    await prisma.notificationSetting.upsert({
      where: { systemSettingId: systemSetting.id },
      update: {},
      create: { systemSettingId: systemSetting.id },
    });
    await prisma.dialerSetting.upsert({
      where: { systemSettingId: systemSetting.id },
      update: {},
      create: { systemSettingId: systemSetting.id },
    });

    // 3. Library
    let library = await prisma.library.findFirst({
      where: { userId: user.id },
    });

    if (!library) {
      library = await prisma.library.create({
        data: { userId: user.id },
      });
    }

    // Use unique names for scripts/templates to avoid global unique constraint conflicts
    await prisma.script.create({
      data: {
        libraryId: library.id,
        scriptName: `${faker.word.adjective()} ${faker.word.noun()} Script ${user.id.slice(0, 4)}`,
        scriptText: "Hello, my name is {agent_name} from {company_name}. How are you today?",
      },
    });

    await prisma.sMSTemplate.create({
      data: {
        libraryId: library.id,
        templateName: `SMS Template ${user.id.slice(0, 4)} ${faker.number.int(1000)}`,
        content: "Hi {customer_name}, just following up on our call. Best regards.",
      },
    });

    await prisma.emailTemplate.create({
      data: {
        libraryId: library.id,
        templateName: `Email Template ${user.id.slice(0, 4)} ${faker.number.int(1000)}`,
        subject: faker.lorem.sentence(),
        content: "<h1>Welcome!</h1><p>We are glad to have you.</p>",
      },
    });

    // CRM Data
    const dataDialer = await prisma.dataDialer.create({
      data: { userId: user.id },
    });

    for (let j = 0; j < 20; j++) {
      const contact = await prisma.contact.create({
        data: {
          fullName: faker.person.fullName(),
          city: faker.location.city(),
          state: faker.location.state(),
          zip: faker.location.zipCode(),
          dataDialerId: dataDialer.id,
        },
      });

      await prisma.contactEmail.create({
        data: {
          email: faker.internet.email(),
          contactId: contact.id,
          isPrimary: true,
        },
      });

      await prisma.contactPhone.create({
        data: {
          number: faker.phone.number(),
          type: PhoneType.MOBILE,
          contactId: contact.id,
        },
      });
    }

    // Leads
    for (let k = 0; k < 10; k++) {
      await prisma.lead.create({
        data: {
          fullName: faker.person.fullName(),
          email: faker.internet.email(),
          phone: "+92300" + faker.string.numeric(7), 
          address: faker.location.streetAddress(),
          city: faker.location.city(),
          state: faker.location.state(),
          zip: faker.location.zipCode(),
          phoneType: "MOBILE",
          priority: faker.number.int({ min: 1, max: 10 }),
          status: LeadCallStatus.PENDING,
          userId: user.id,
        },
      });
    }

    // Telephony
    await prisma.callerId.create({
      data: {
        label: faker.company.catchPhrase(),
        countryCode: "US",
        numberOfLines: faker.number.int({ min: 1, max: 5 }),
        systemSettingId: systemSetting.id,
      },
    });

    // Action Plans
    const actionPlan = await prisma.actionPlan.create({
      data: {
        name: `${faker.commerce.productName()} Action Plan`,
        systemSettingId: systemSetting.id,
      },
    });

    await prisma.actionStep.create({
      data: {
        order: 1,
        actionType: ActionStepType.EMAIL,
        contentValue: "Welcome Email",
        dayOffset: 0,
        planId: actionPlan.id,
      },
    });

    // Billing
    const billing = await prisma.billing.create({
      data: {
        userId: user.id,
        invoiceNumber: `INV-${faker.string.alphanumeric(10).toUpperCase()}`,
        plan: Plan.PROFESSIONAL,
        amount: 9900,
        date: new Date(),
        status: Status.PAID,
      },
    });

    await prisma.userSubscription.create({
      data: {
        userId: user.id,
        plan: Plan.PROFESSIONAL,
        status: SubscriptionStatus.ACTIVE,
        startDate: new Date(),
        billingId: billing.id,
      },
    });
  }

  console.log("Seeding complete! 🚀");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });