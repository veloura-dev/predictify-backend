import { eq } from "drizzle-orm";
import { db } from "../db";
import { users } from "./schema";

export interface UserRow {
  id: string;
  stellarAddress: string;
  createdAt: Date;
}

export async function upsertUserByStellarAddress(stellarAddress: string): Promise<UserRow> {
  await db
    .insert(users)
    .values({ stellarAddress })
    .onConflictDoNothing({ target: users.stellarAddress });

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.stellarAddress, stellarAddress))
    .limit(1);

  if (!user) {
    throw new Error("Failed to create or load user");
  }

  return user;
}
