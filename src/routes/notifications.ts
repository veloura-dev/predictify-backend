import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { z } from "zod";
import { logger } from "../config/logger";
import { requireAuth } from "../middleware/requireAuth";
import {
  getNotificationPreferences,
  notificationCategories,
  notificationChannels,
  patchNotificationPreferences,
} from "../services/notificationPrefs";

const notificationCategorySchema = z.enum(notificationCategories);
const notificationChannelSchema = z.enum(notificationChannels);

const patchPreferencesBodySchema = z
  .object({
    preferences: z
      .array(
        z
          .object({
            category: notificationCategorySchema,
            channel: notificationChannelSchema,
            enabled: z.boolean(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export const notificationsRouter = Router();

notificationsRouter.use(requireAuth);

notificationsRouter.get(
  "/preferences",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as Request & { user: { id: string } }).user.id;
      const preferences = await getNotificationPreferences(userId);

      logger.info(
        {
          reqId: (req as Request & { id?: string }).id,
          userId,
          preferenceCount: preferences.length,
        },
        "notification_preferences_loaded",
      );

      return res.status(200).json({
        data: {
          preferences,
        },
      });
    } catch (error) {
      return next(error);
    }
  },
);

notificationsRouter.patch(
  "/preferences",
  async (req: Request, res: Response, next: NextFunction) => {
    const parsed = patchPreferencesBodySchema.safeParse(req.body);
    if (!parsed.success) {
      logger.warn(
        {
          reqId: (req as Request & { id?: string }).id,
          issues: parsed.error.issues,
        },
        "notification_preferences_validation_failed",
      );

      return res.status(400).json({
        error: {
          code: "validation_error",
          details: parsed.error.issues,
        },
      });
    }

    try {
      const userId = (req as Request & { user: { id: string } }).user.id;
      const preferences = await patchNotificationPreferences(
        userId,
        parsed.data.preferences,
      );

      logger.info(
        {
          reqId: (req as Request & { id?: string }).id,
          userId,
          updatedCount: parsed.data.preferences.length,
        },
        "notification_preferences_updated",
      );

      return res.status(200).json({
        data: {
          preferences,
        },
      });
    } catch (error) {
      return next(error);
    }
  },
);
