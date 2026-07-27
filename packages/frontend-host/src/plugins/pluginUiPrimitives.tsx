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
        paddingBlock: 'clamp(var(--cds-spacing-05), 3vw, var(--cds-spacing-07))',
        paddingInline:
          'clamp(var(--cds-spacing-05), 4vw, var(--cds-spacing-07))',
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
        gap: 'var(--cds-spacing-05)',
        marginBlockEnd: 'var(--cds-spacing-06)',
      },
    },
    React.createElement(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'flex-start',
          gap: 'var(--cds-spacing-04)',
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
                padding: 'var(--cds-spacing-03)',
                color: 'var(--cds-icon-primary)',
                background: 'var(--cds-layer-02)',
                border: '1px solid var(--cds-border-subtle-01)',
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
                  color: 'var(--cds-text-secondary)',
                  font: 'var(--cds-label-01-font)',
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
              font: 'var(--cds-heading-05-font)',
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
                  marginBlock: 'var(--cds-spacing-03) 0',
                  color: 'var(--cds-text-secondary)',
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
              gap: 'var(--cds-spacing-03)',
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
          color: 'var(--cds-text-primary)',
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
