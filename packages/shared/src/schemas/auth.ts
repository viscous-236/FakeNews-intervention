/**
 * packages/shared/src/schemas/auth.ts (TASK-038, TASK-039)
 *
 * Strict validation schemas for authentication and token endpoints.
 */

import { z } from 'zod';

export const registerSchema = z
  .object({
    username: z
      .string()
      .trim()
      .regex(
        /^[a-z0-9_]{3,20}$/,
        'Username must be 3-20 characters long and contain only lowercase letters, numbers, and underscores',
      ),
    email: z.string().trim().email('Invalid email address').max(255),
    password: z
      .string()
      .min(10, 'Password must be at least 10 characters long')
      .max(128, 'Password must not exceed 128 characters'),
    displayName: z
      .string()
      .trim()
      .min(1, 'Display name must not be empty')
      .max(50, 'Display name must not exceed 50 characters'),
  })
  .strict();

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z
  .object({
    identifier: z.string().trim().min(1, 'Username or email is required').max(128),
    password: z.string().min(1, 'Password is required').max(128),
  })
  .strict();

export type LoginInput = z.infer<typeof loginSchema>;

export const verifyEmailSchema = z
  .object({
    token: z.string().trim().min(1, 'Token is required'),
  })
  .strict();

export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

export const forgotPasswordSchema = z
  .object({
    email: z.string().trim().email('Invalid email address').max(255),
  })
  .strict();

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    token: z.string().trim().min(1, 'Token is required'),
    password: z
      .string()
      .min(10, 'Password must be at least 10 characters long')
      .max(128, 'Password must not exceed 128 characters'),
  })
  .strict();

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z
      .string()
      .min(10, 'New password must be at least 10 characters long')
      .max(128, 'New password must not exceed 128 characters'),
  })
  .strict();

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
