import { Modal } from '@carbon/react';
import type {
  FrontendPluginHostContextV1,
  PluginConfirmModalPropsV1,
  PluginPageHeaderPropsV1,
  PluginPageLayoutPropsV1,
  PluginUiPrimitivesV1,
} from '@enterpriseglue/plugin-sdk';
import React from 'react';

const maxWidths: Record<
  NonNullable<PluginPageLayoutPropsV1['maxWidth']>,
  string
> = {
  content: '64rem',
  wide: '96rem',
  full: 'none',
};

export function PluginPageLayoutV1({
  children,
  as = 'main',
  maxWidth = 'content',
  labelledBy,
  className,
  style,
}: PluginPageLayoutPropsV1): React.ReactElement {
  return React.createElement(
    as,
    {
      'aria-labelledby': labelledBy,
      className,
      style: {
        boxSizing: 'border-box',
        inlineSize: '100%',
        maxInlineSize: maxWidths[maxWidth],
        marginInline: maxWidth === 'full' ? undefined : 'auto',
        paddingBlock: 'clamp(var(--spacing-4), 3vw, var(--spacing-6))',
        paddingInline:
          'clamp(var(--spacing-4), 4vw, var(--spacing-6))',
        ...style,
      },
    },
    children,
  );
}

export function PluginPageHeaderV1({
  title,
  subtitle,
  eyebrow,
  icon: Icon,
  actions,
  headingId,
}: PluginPageHeaderPropsV1): React.ReactElement {
  return React.createElement(
    'header',
    {
      style: {
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 'var(--spacing-4)',
        marginBlockEnd: 'var(--spacing-5)',
      },
    },
    React.createElement(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'flex-start',
          gap: 'var(--spacing-3)',
          minInlineSize: 0,
        },
      },
      Icon
        ? React.createElement(
            'span',
            {
              'aria-hidden': true,
              style: {
                display: 'inline-flex',
                flex: '0 0 auto',
                padding: 'var(--spacing-2)',
                color: 'var(--color-icon-primary)',
                background: 'var(--color-bg-secondary)',
                border: '1px solid var(--color-border-primary)',
              },
            },
            React.createElement(Icon, {
              size: 24,
              'aria-hidden': true,
            }),
          )
        : null,
      React.createElement(
        'div',
        { style: { minInlineSize: 0 } },
        eyebrow
          ? React.createElement(
              'p',
              {
                style: {
                  margin: 0,
                  color: 'var(--color-text-secondary)',
                  fontSize: 'var(--text-12)',
                  lineHeight: 'var(--leading-normal)',
                },
              },
              eyebrow,
            )
          : null,
        React.createElement(
          'h1',
          {
            id: headingId,
            style: {
              margin: 0,
              overflowWrap: 'anywhere',
              fontSize: 'var(--text-32)',
              fontWeight: 'var(--font-weight-regular)',
              lineHeight: 'var(--leading-tight)',
            },
          },
          title,
        ),
        subtitle
          ? React.createElement(
              'p',
              {
                style: {
                  maxInlineSize: '70ch',
                  marginBlock: 'var(--spacing-2) 0',
                  color: 'var(--color-text-secondary)',
                  fontSize: 'var(--text-16)',
                  lineHeight: 'var(--leading-normal)',
                },
              },
              subtitle,
            )
          : null,
      ),
    ),
    actions
      ? React.createElement(
          'div',
          {
            style: {
              display: 'flex',
              flexWrap: 'wrap',
              gap: 'var(--spacing-2)',
            },
          },
          actions,
        )
      : null,
  );
}

export function PluginConfirmModalV1({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onClose,
  onConfirm,
  danger = false,
  busy = false,
  busyLabel,
  launcherButtonRef,
}: PluginConfirmModalPropsV1): React.ReactElement {
  const restoreLauncherFocus = () => {
    if (!launcherButtonRef) return;
    const restore = () => launcherButtonRef.current?.focus();
    if (
      typeof window !== 'undefined' &&
      typeof window.requestAnimationFrame === 'function'
    ) {
      window.requestAnimationFrame(restore);
      return;
    }
    queueMicrotask(restore);
  };
  return React.createElement(
    Modal,
    {
      open,
      modalHeading: title,
      primaryButtonText: busy ? (busyLabel ?? confirmLabel) : confirmLabel,
      secondaryButtonText: cancelLabel,
      primaryButtonDisabled: busy,
      danger,
      launcherButtonRef,
      onRequestClose: () => {
        if (!busy) {
          onClose();
          restoreLauncherFocus();
        }
      },
      onRequestSubmit: async () => {
        if (!busy) {
          await onConfirm();
          restoreLauncherFocus();
        }
      },
      size: 'sm',
    },
    React.createElement(
      'p',
      {
        style: {
          marginBlock: 0,
          color: 'var(--color-text-primary)',
        },
      },
      description,
    ),
  );
}

export const pluginUiPrimitivesV1: Readonly<PluginUiPrimitivesV1> =
  Object.freeze({
    PageLayout: PluginPageLayoutV1,
    PageHeader: PluginPageHeaderV1,
    ConfirmModal: PluginConfirmModalV1,
  });

const rtlLanguagePattern = /^(ar|dv|fa|he|ku|ps|ur|yi)(?:-|$)/i;

export function pluginUiPreferencesV1(input: {
  locale?: string;
  reducedMotion?: boolean;
}): Pick<
  FrontendPluginHostContextV1['ui'],
  'locale' | 'direction' | 'prefersReducedMotion'
> {
  const locale = input.locale?.trim() || 'en';
  return {
    locale,
    direction: rtlLanguagePattern.test(locale) ? 'rtl' : 'ltr',
    prefersReducedMotion: input.reducedMotion === true,
  };
}
