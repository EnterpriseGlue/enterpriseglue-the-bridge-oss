import React from 'react';
import { LogoGithub, LogoGitlab, Branch } from '@carbon/icons-react';

export type GitProviderType = 'github' | 'gitlab' | 'bitbucket' | 'azure-devops' | string | null | undefined;

interface GitProviderIconProps {
  type: GitProviderType;
  size?: number;
}

/**
 * Shared Git provider icon
 * Used on both Project Overview and Platform Settings pages so logos stay consistent.
 */
export const GitProviderIcon: React.FC<GitProviderIconProps> = ({ type, size = 18 }) => {
  switch (type) {
    case 'github':
      return <LogoGithub size={size} />;
    case 'gitlab':
      return <LogoGitlab size={size} />;
    case 'bitbucket':
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 32 32"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M19.154 20.418h-6.256l-1.692-8.842h9.464zM1.954 2.498c-0.004-0-0.008-0-0.013-0-0.531 0-0.961 0.43-0.961 0.961 0 0.055 0.005 0.109 0.013 0.161l-0.001-0.006 4.084 24.795c0.107 0.62 0.638 1.086 1.279 1.093h19.595c0.003 0 0.007 0 0.010 0 0.478 0 0.875-0.347 0.953-0.803l0.001-0.006 4.093-25.071c0.008-0.046 0.012-0.1 0.012-0.154 0-0.531-0.43-0.961-0.961-0.961-0.004 0-0.009 0-0.013 0h0.001z" />
        </svg>
      );
    case 'azure-devops':
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 512 512"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M31,197.6l42.1-55.6L230.7,78V31.7l138.2,101.1L86.6,187.5v154.3l-55.6-16L31,197.6z M481,114.2v274.7l-107.9,91.8    l-174.4-57.3v57.3l-112.1-139l282.3,33.7V132.7L481,114.2z" />
        </svg>
      );
    default:
      return <Branch size={size} />;
  }
};
