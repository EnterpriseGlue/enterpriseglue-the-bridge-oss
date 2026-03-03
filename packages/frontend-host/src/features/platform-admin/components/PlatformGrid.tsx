import React from 'react';
import clsx from 'clsx';
import { Grid, Column, FeatureFlags } from '@carbon/react';

type Span = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16;

type Offset = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15;

interface PlatformGridProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  narrow?: boolean;
  condensed?: boolean;
  fullWidth?: boolean;
}

export function PlatformGrid({
  children,
  className,
  style,
  narrow = false,
  condensed = false,
  fullWidth = true,
}: PlatformGridProps) {
  const mergedStyle: React.CSSProperties | undefined = fullWidth
    ? {
        maxInlineSize: '100%',
        width: '100%',
        ...style,
      }
    : style;

  return (
    <FeatureFlags flags={{ 'enable-css-grid': true }}>
      <Grid
        narrow={narrow}
        condensed={condensed}
        fullWidth={fullWidth}
        className={className}
        style={mergedStyle}
      >
        {children}
      </Grid>
    </FeatureFlags>
  );
}

interface PlatformRowProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export function PlatformRow({ children, className, style }: PlatformRowProps) {
  return (
    <div className={clsx(className)} style={{ display: 'contents', ...style }}>
      {children}
    </div>
  );
}

interface PlatformColProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  sm?: Span;
  md?: Span;
  lg?: Span;
  xlg?: Span;
  max?: Span;
  offsetSm?: Offset;
  offsetMd?: Offset;
  offsetLg?: Offset;
  offsetXlg?: Offset;
  offsetMax?: Offset;
}

export function PlatformCol({
  children,
  className,
  style,
  sm,
  md,
  lg,
  xlg,
  max,
  offsetSm,
  offsetMd,
  offsetLg,
  offsetXlg,
  offsetMax,
}: PlatformColProps) {
  const spanWithOffset = (span?: Span, offset?: Offset) => {
    if (span === undefined && (offset === undefined || offset === 0)) return undefined;
    if (offset !== undefined && offset > 0) return { span, offset };
    return span;
  };

  return (
    <Column
      className={className}
      style={style}
      sm={spanWithOffset(sm, offsetSm)}
      md={spanWithOffset(md, offsetMd)}
      lg={spanWithOffset(lg, offsetLg)}
      xlg={spanWithOffset(xlg, offsetXlg)}
      max={spanWithOffset(max, offsetMax)}
    >
      {children}
    </Column>
  );
}
