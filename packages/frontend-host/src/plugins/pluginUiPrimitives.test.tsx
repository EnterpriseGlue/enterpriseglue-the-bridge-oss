import { Modal } from '@carbon/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  PluginConfirmModalV1,
  PluginPageHeaderV1,
  PluginPageLayoutV1,
  pluginUiPreferencesV1,
  pluginUiPrimitivesV1,
} from './pluginUiPrimitives';

describe('plugin host UI primitives', () => {
  it('renders one responsive logical page landmark with a labelled heading', () => {
    const layout = PluginPageLayoutV1({
      labelledBy: 'plugin-title',
      maxWidth: 'wide',
      children: 'Content',
    }) as React.ReactElement<Record<string, unknown>>;
    const header = PluginPageHeaderV1({
      headingId: 'plugin-title',
      eyebrow: 'Support',
      title: 'Cases',
      subtitle: 'Version-aware technical support',
    }) as React.ReactElement<Record<string, unknown>>;

    expect(layout.type).toBe('main');
    expect(layout.props['aria-labelledby']).toBe('plugin-title');
    expect(layout.props.style).toEqual(
      expect.objectContaining({
        inlineSize: '100%',
        maxInlineSize: '96rem',
        marginInline: 'auto',
      }),
    );
    expect(header.type).toBe('header');
    expect(JSON.stringify(header.props.children)).toContain('plugin-title');
    expect(JSON.stringify(header.props.children)).toContain('Cases');
  });

  it('delegates keyboard focus containment to Carbon Modal and locks close/submit while busy', async () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    const launcherButtonRef = {
      current: null,
    } as React.RefObject<HTMLButtonElement | null>;
    const modal = PluginConfirmModalV1({
      open: true,
      title: 'Delete case data',
      description: 'This action cannot be undone.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      busyLabel: 'Deleting…',
      busy: true,
      danger: true,
      launcherButtonRef,
      onClose,
      onConfirm,
    }) as React.ReactElement<Record<string, unknown>>;

    expect(modal.type).toBe(Modal);
    expect(modal.props).toEqual(
      expect.objectContaining({
        open: true,
        modalHeading: 'Delete case data',
        primaryButtonText: 'Deleting…',
        secondaryButtonText: 'Cancel',
        primaryButtonDisabled: true,
        danger: true,
        launcherButtonRef,
      }),
    );
    (
      modal.props.onRequestClose as (() => void)
    )();
    await (
      modal.props.onRequestSubmit as (() => Promise<void>)
    )();
    expect(onClose).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();

    const focus = vi.fn();
    const readyLauncherButtonRef = {
      current: { focus } as unknown as HTMLButtonElement,
    } as React.RefObject<HTMLButtonElement | null>;
    vi.stubGlobal('window', {
      requestAnimationFrame(callback: FrameRequestCallback) {
        callback(0);
        return 1;
      },
    });
    const readyModal = PluginConfirmModalV1({
      open: true,
      title: 'Delete case data',
      description: 'This action cannot be undone.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      busyLabel: 'Deleting…',
      busy: false,
      danger: true,
      launcherButtonRef: readyLauncherButtonRef,
      onClose,
      onConfirm,
    }) as React.ReactElement<Record<string, unknown>>;

    (readyModal.props.onRequestClose as (() => void))();
    expect(onClose).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it('derives direction and reduced-motion preference without changing plugin strings', () => {
    expect(
      pluginUiPreferencesV1({
        locale: 'ar-SA',
        reducedMotion: true,
      }),
    ).toEqual({
      locale: 'ar-SA',
      direction: 'rtl',
      prefersReducedMotion: true,
    });
    expect(pluginUiPreferencesV1({ locale: 'de-DE' })).toEqual({
      locale: 'de-DE',
      direction: 'ltr',
      prefersReducedMotion: false,
    });
    expect(Object.isFrozen(pluginUiPrimitivesV1)).toBe(true);
  });
});
