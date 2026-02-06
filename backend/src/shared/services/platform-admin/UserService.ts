/**
 * User Service
 * Handles user CRUD operations, account management, and email workflows
 */

import { getDataSource } from '@shared/db/data-source.js';
import { User } from '@shared/db/entities/User.js';
import { RefreshToken } from '@shared/db/entities/RefreshToken.js';
import { generateId } from '@shared/utils/id.js';
import { addCaseInsensitiveEquals } from '@shared/db/adapters/QueryHelpers.js';
import { hashPassword, generatePassword } from '@shared/utils/password.js';
import { randomBytes } from 'crypto';
import { Errors } from '@shared/middleware/errorHandler.js';

export interface CreateUserInput {
  email: string;
  firstName?: string;
  lastName?: string;
  platformRole?: 'admin' | 'developer' | 'user';
  createdByUserId: string;
}

export interface UpdateUserInput {
  firstName?: string;
  lastName?: string;
  platformRole?: 'admin' | 'developer' | 'user';
  isActive?: boolean;
}

export interface UserDTO {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  platformRole: string;
  isActive: boolean;
  isEmailVerified: boolean;
  mustResetPassword: boolean;
  createdAt: number;
  updatedAt: number;
  lastLoginAt: number | null;
  createdByUserId: string | null;
  failedLoginAttempts?: number;
  lockedUntil?: number | null;
}

export interface CreateUserResult {
  user: UserDTO;
  temporaryPassword: string;
  verificationToken: string;
}

function toUserDTO(user: User, includeAdmin = false): UserDTO {
  const dto: UserDTO = {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    platformRole: user.platformRole || 'user',
    isActive: Boolean(user.isActive),
    isEmailVerified: Boolean(user.isEmailVerified),
    mustResetPassword: Boolean(user.mustResetPassword),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt,
    createdByUserId: user.createdByUserId,
  };

  if (includeAdmin) {
    dto.failedLoginAttempts = user.failedLoginAttempts;
    dto.lockedUntil = user.lockedUntil;
  }

  return dto;
}

export class UserService {
  /**
   * List all users ordered by creation date
   */
  async listUsers(): Promise<UserDTO[]> {
    const dataSource = await getDataSource();
    const userRepo = dataSource.getRepository(User);
    const result = await userRepo.find({ order: { createdAt: 'DESC' } });
    return result.map((u) => toUserDTO(u));
  }

  /**
   * Get a single user by ID
   */
  async getUser(id: string): Promise<UserDTO> {
    const dataSource = await getDataSource();
    const userRepo = dataSource.getRepository(User);
    const user = await userRepo.findOneBy({ id });
    if (!user) throw Errors.notFound('User', id);
    return toUserDTO(user, true);
  }

  /**
   * Create a new user with a temporary password and verification token
   */
  async createUser(input: CreateUserInput): Promise<CreateUserResult> {
    const { email, firstName, lastName, platformRole = 'user', createdByUserId } = input;

    const temporaryPassword = generatePassword();
    const passwordHash = await hashPassword(temporaryPassword);
    const verificationToken = randomBytes(32).toString('hex');
    const tokenExpiry = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

    const userId = generateId();
    const now = Date.now();

    const dataSource = await getDataSource();
    const userRepo = dataSource.getRepository(User);

    // Check if user already exists (case-insensitive)
    let existingQb = userRepo.createQueryBuilder('u');
    existingQb = addCaseInsensitiveEquals(existingQb, 'u', 'email', 'email', email);
    const existing = await existingQb.getOne();
    if (existing) {
      throw Errors.conflict('User with this email already exists');
    }

    await userRepo.insert({
      id: userId,
      email,
      passwordHash,
      firstName: firstName || null,
      lastName: lastName || null,
      platformRole,
      isActive: true,
      mustResetPassword: true,
      failedLoginAttempts: 0,
      createdAt: now,
      updatedAt: now,
      createdByUserId,
      isEmailVerified: false,
      emailVerificationToken: verificationToken,
      emailVerificationTokenExpiry: tokenExpiry,
    });

    const user = await userRepo.findOneBy({ id: userId });

    return {
      user: toUserDTO(user!),
      temporaryPassword,
      verificationToken,
    };
  }

  /**
   * Update user fields
   */
  async updateUser(id: string, input: UpdateUserInput): Promise<UserDTO> {
    const dataSource = await getDataSource();
    const userRepo = dataSource.getRepository(User);

    const existing = await userRepo.findOneBy({ id });
    if (!existing) throw Errors.notFound('User', id);

    const updateData: any = { updatedAt: Date.now() };
    if (input.firstName !== undefined) updateData.firstName = input.firstName;
    if (input.lastName !== undefined) updateData.lastName = input.lastName;
    if (input.platformRole !== undefined) updateData.platformRole = input.platformRole;
    if (input.isActive !== undefined) updateData.isActive = input.isActive;

    await userRepo.update({ id }, updateData);

    const user = await userRepo.findOneBy({ id });
    return toUserDTO(user!);
  }

  /**
   * Soft-delete user (deactivate) and revoke all refresh tokens
   */
  async deactivateUser(id: string): Promise<void> {
    const dataSource = await getDataSource();
    const userRepo = dataSource.getRepository(User);

    const existing = await userRepo.findOneBy({ id });
    if (!existing) throw Errors.notFound('User', id);

    const now = Date.now();
    await dataSource.transaction(async (manager) => {
      await manager.getRepository(User).update({ id }, {
        isActive: false,
        updatedAt: now,
      });
      await manager.getRepository(RefreshToken).update({ userId: id }, { revokedAt: now });
    });
  }

  /**
   * Unlock a locked user account
   */
  async unlockUser(id: string): Promise<void> {
    const dataSource = await getDataSource();
    const userRepo = dataSource.getRepository(User);

    await userRepo.update({ id }, {
      failedLoginAttempts: 0,
      lockedUntil: null,
      updatedAt: Date.now(),
    });
  }
}

export const userService = new UserService();
