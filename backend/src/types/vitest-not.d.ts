import '@vitest/expect';

/**
 * Temporary workaround for Vitest/Chai type mismatch where `.not` is not
 * exposed on `Assertion` in our current dependency set.
 *
 * Remove once upstream Vitest/Chai typings include `expect(...).not` without
 * local augmentation.
 */
declare module '@vitest/expect' {
  interface Assertion<T = any> {
    not: Assertion<T>;
  }
}
